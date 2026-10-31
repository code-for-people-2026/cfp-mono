#!/usr/bin/env python3
"""Test a candidate offline on a disposable snapshot before stopping live services."""
import argparse
import fcntl
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import time
import retention as r


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE,
                                   universal_newlines=True, timeout=180).strip()


def copy_mount(source, target, destination, image):
    if source.is_dir():
        shutil.copytree(str(source), str(target))
    else:
        shutil.copy2(str(source), str(target))
    schemas = {}
    if destination == '/data':
        for path in source.rglob('*'):
            if not path.is_file() or path.suffix not in ('.db', '.sqlite', '.sqlite3'):
                continue
            relative = str(path.relative_to(source))
            copied = target / relative
            for suffix in ['', '-wal', '-shm']:
                extra = Path(str(copied) + suffix)
                if extra.exists():
                    extra.unlink()  # Only files in this invocation's disposable copy.
            # ECS's Python 3.6 has no Connection.backup(). Use the pinned Node 24
            # runtime; the original database + WAL are mounted READ ONLY.
            run('docker', 'run', '--rm', '--network', 'none', '--user', '0:0',
                '--mount', 'type=bind,src=' + str(source) + ',dst=/source,readonly',
                '--mount', 'type=bind,src=' + str(target) + ',dst=/snapshot',
                '--entrypoint', 'node', image, '--input-type=module', '-e',
                "import {DatabaseSync,backup} from 'node:sqlite';"
                "const db=new DatabaseSync('/source/'+process.argv[1],{readOnly:true});"
                "try{await backup(db,'/snapshot/'+process.argv[1]);}finally{db.close();}",
                relative)
            db = sqlite3.connect('file:' + str(copied) + '?mode=ro', uri=True)
            try:
                schemas[str(copied)] = db.execute(
                    'select name,type,sql from sqlite_master order by name,type').fetchall()
            finally:
                db.close()
    files = [target] + list(target.rglob('*')) if target.is_dir() else [target]
    for path in files:
        os.chown(str(path), 1000, 1000)
    return schemas


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(30)
        self.sock.connect('/var/run/docker.sock')


def verify(image, same_source=False):
    metadata = json.loads(run('docker', 'image', 'inspect', image))[0]
    if metadata['Size'] >= 1900000000:
        raise RuntimeError('Runtime image exceeds the 1.9 GB budget')
    old = json.loads(run('docker', 'inspect', 'cfp-hello-agent-full-preview'))[0]
    token = r.stamp()
    root = r.ROOT / 'smoke' / token
    root.mkdir(parents=True, mode=0o700)
    name = 'cfp-hello-agent-smoke-' + token.lower()
    cid = None
    try:
        binds, schemas = [], {}
        for index, mount in enumerate(old['Mounts']):
            if mount['Type'] != 'bind' or not mount['Source'].startswith('/opt/cfp-hello-agent/'):
                raise RuntimeError('Unexpected business mount; refusing to reuse it in smoke')
            source = Path(mount['Source'])
            target = root / ('mount-' + str(index))
            schemas.update(copy_mount(source, target, mount['Destination'], metadata['Id']))
            binds.append(str(target) + ':' + mount['Destination'])
        if not schemas:
            raise RuntimeError('No isolated database snapshot was created')
        config = dict(old['Config'])
        config['Image'] = metadata['Id']
        config.pop('Hostname', None)
        config['Env'] = [x for x in config['Env'] if not x.startswith('HELLO_RELEASE=')]
        config['Env'].append('HELLO_RELEASE=runtime-smoke')
        host = dict(old['HostConfig'])
        host.update({'NetworkMode': 'none', 'PortBindings': {}, 'Binds': binds, 'Mounts': [],
                     'RestartPolicy': {'Name': 'no'}, 'VolumesFrom': None, 'Links': None})
        config['HostConfig'] = host
        conn = UnixHTTP('localhost')
        try:
            conn.request('POST', '/containers/create?name=' + name, json.dumps(config),
                         {'Content-Type': 'application/json'})
            response = conn.getresponse()
            body = response.read()
            if response.status != 201:
                raise RuntimeError('Smoke container creation failed')
            cid = json.loads(body)['Id']
        finally:
            conn.close()
        run('docker', 'start', cid)
        passed = False
        for _ in range(45):
            try:
                text = run('docker', 'exec', cid, 'node', '-e',
                           "fetch('http://127.0.0.1:3310/api/ready').then(async r=>{"
                           "if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))")
                if json.loads(text).get('ok'):
                    passed = True
                    break
            except (subprocess.CalledProcessError, ValueError):
                pass
            time.sleep(2)
        if not passed:
            raise RuntimeError('Isolated readiness did not pass')
        result = run('docker', 'exec', cid, 'node', '--import', 'tsx', '--input-type=module', '-e',
                     "import fs from 'node:fs'; import assert from 'node:assert/strict';"
                     "import sharp from 'sharp'; await import('libsql');"
                     "await import('./src/operations/alerts.ts');"
                     "assert(!fs.existsSync('.next/cache'));assert(!fs.existsSync('.data/secret'));"
                     "assert.notEqual(process.getuid(),0);"
                     "const r=await fetch('http://127.0.0.1:3310/chat/index.html');"
                     "assert(r.ok);assert((await r.text()).includes('<html'));"
                     "const png=await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer();"
                     "assert(png.length>0);"
                     "console.log(JSON.stringify({nonRoot:true,isolatedDatabaseReadiness:true,h5:true,"
                     "sqliteNative:true,sharp:true,workerImports:true,buildCacheAbsent:true,buildSecretAbsent:true}));")
        hash_js = (
            "const fs=require('fs'),path=require('path'),crypto=require('crypto');"
            "const h=crypto.createHash('sha256');function walk(p){"
            "for(const e of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){"
            "const q=path.join(p,e.name);if(e.isDirectory())walk(q);else if(e.isFile()){"
            "h.update(q);h.update(fs.readFileSync(q));}}}"
            "walk('src');walk('public');console.log(h.digest('hex'));")
        before_hash = run('docker', 'exec', 'cfp-hello-agent-full-preview', 'node', '-e', hash_js)
        after_hash = run('docker', 'exec', cid, 'node', '-e', hash_js)
        if same_source and before_hash != after_hash:
            raise RuntimeError('Application source or public assets changed')
        for path, schema in schemas.items():
            db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
            try:
                if db.execute('pragma quick_check').fetchall() != [('ok',)]:
                    raise RuntimeError('Copied database integrity failed')
                if db.execute('select name,type,sql from sqlite_master order by name,type').fetchall() != schema:
                    raise RuntimeError('Candidate changed schema; live deployment blocked')
            finally:
                db.close()
        receipt = {'image': image, 'imageBytes': metadata['Size'], 'checks': json.loads(result),
                   'network': 'none', 'businessMountsUsed': False, 'schemaUnchanged': True,
                   'appSourceAndAssetsUnchanged': before_hash == after_hash,
                   'appSourceAndAssetsSha256': after_hash}
        r.save(root / 'receipt.json', receipt)
        print(json.dumps(receipt))
        return receipt
    finally:
        if cid:
            run('docker', 'rm', '-f', cid)
        for target in root.glob('mount-*'):
            if target.is_dir():
                shutil.rmtree(str(target))
            else:
                target.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image')
    parser.add_argument('--same-source', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    with open('/var/lock/cfp-hello-agent-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verify(args.image, args.same_source)
