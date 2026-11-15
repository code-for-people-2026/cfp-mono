#!/usr/bin/env python3
"""Test a candidate offline on a disposable snapshot before stopping live services."""
import argparse
import fcntl
import http.client
import json
import os
import re
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


def register_resource(root, name, image, mounts):
    """Persist ownership before Docker can create a resource (including helpers)."""
    journal = root / 'resources.json'
    resources = json.loads(journal.read_text()) if journal.exists() else {}
    resources[name] = {'image': image, 'mounts': mounts}
    r.save(journal, resources)
    fd = os.open(str(root), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def mount_signature(mounts):
    return sorted((m['Source'], m['Destination'], m['RW']) for m in mounts)


def references(container, root):
    for mount in container.get('Mounts', []):
        source = Path(mount['Source']).resolve()
        if source == root or root in source.parents or source in root.parents:
            return True
    return False


def recover(directory):
    """Caller holds deployment lock. Recover only owned, disposable resources.

    Called by the hourly privacy job even if no further deployment is attempted.
    An unknown reference or Docker failure keeps the journal and fails closed;
    the next invocation retries before privacy deletion guards can be retired.
    """
    if not directory.exists():
        return
    if directory.resolve() != directory.absolute():
        raise RuntimeError('Smoke root must not traverse symlinks')
    for root in sorted(directory.iterdir()):
        if not re.fullmatch(r'[0-9]{8}T[0-9]{12}Z', root.name):
            raise RuntimeError('Unknown smoke directory; manual inspection required')
        if root.is_symlink() or not root.is_dir():
            raise RuntimeError('Invalid smoke session directory')
        journal = root / 'resources.json'
        if journal.is_symlink():
            raise RuntimeError('Invalid smoke resource journal')
        resources = json.loads(journal.read_text()) if journal.exists() else {}
        prefix = 'cfp-hello-agent-smoke-' + root.name.lower()
        rows = r.inventory()  # Inventory failure must never authorize deletion.
        owned = []
        for container in rows:
            name = container['Name'].lstrip('/')
            if name not in resources and not references(container, root):
                continue
            expected = resources.get(name)
            if (not expected or not (name == prefix or name.startswith(prefix + '-snapshot-')) or
                    container['Image'] != expected['image'] or
                    container.get('HostConfig', {}).get('NetworkMode') != 'none' or
                    mount_signature(container['Mounts']) != mount_signature(expected['mounts']) or
                    any(m['RW'] and root not in Path(m['Source']).resolve().parents
                        for m in container['Mounts'])):
                raise RuntimeError('Unknown or changed container references smoke data')
            owned.append(container['Id'])
        for cid in owned:
            run('docker', 'rm', '-f', cid)  # Never --volumes; these are journaled test containers.
        if any(references(c, root) for c in r.inventory()):
            raise RuntimeError('Smoke data is still referenced')
        for target in root.glob('mount-*'):
            if target.is_symlink() or not target.is_dir():
                target.unlink()
            else:
                shutil.rmtree(str(target))
        if journal.exists():
            journal.unlink()


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
            helper = 'cfp-hello-agent-smoke-' + target.parent.name.lower() + '-snapshot-' + target.name + '-' + str(len(schemas))
            register_resource(target.parent, helper, image, [
                {'Source': str(source), 'Destination': '/source', 'RW': False},
                {'Source': str(target), 'Destination': '/snapshot', 'RW': True}])
            run('docker', 'run', '--rm', '--name', helper, '--network', 'none', '--user', '0:0',
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


ALLOWED_WORKING_DIRS = (
    '/app/apps/hello-agent',
    '/app/apps/a-j-oker',
)


def candidate_config(old, image, release=None):
    """Build candidate config from the old container and candidate image metadata."""
    metadata = image if isinstance(image, dict) else json.loads(
        run('docker', 'image', 'inspect', image))[0]
    config = dict(old['Config'])
    config.pop('Hostname', None)
    config['Image'] = metadata['Id']
    if release:
        config['Env'] = [v for v in config.get('Env', []) if not v.startswith('HELLO_RELEASE=')]
        config['Env'].append('HELLO_RELEASE=' + release)
        config['Labels'] = dict(config.get('Labels') or {}, **{
            'cn.codeforpeople.service': 'hello-agent',
            'cn.codeforpeople.release': release})
    working_dir = (metadata.get('Config') or {}).get('WorkingDir')
    if working_dir not in ALLOWED_WORKING_DIRS:
        raise RuntimeError('Unsupported candidate image WorkingDir: ' + repr(working_dir))
    config['WorkingDir'] = working_dir
    return config


def verify(image, same_source=False):
    metadata = json.loads(run('docker', 'image', 'inspect', image))[0]
    if metadata['Size'] >= 1900000000:
        raise RuntimeError('Runtime image exceeds the 1.9 GB budget')
    old = json.loads(run('docker', 'inspect', 'cfp-hello-agent-full-preview'))[0]
    recover(r.ROOT / 'smoke')
    token = r.stamp()
    root = r.ROOT / 'smoke' / token
    root.mkdir(parents=True, mode=0o700)
    name = 'cfp-hello-agent-smoke-' + token.lower()
    cid = None
    try:
        binds, schemas, mounts = [], {}, []
        for index, mount in enumerate(old['Mounts']):
            if mount['Type'] != 'bind' or not mount['Source'].startswith('/opt/cfp-hello-agent/'):
                raise RuntimeError('Unexpected business mount; refusing to reuse it in smoke')
            source = Path(mount['Source'])
            target = root / ('mount-' + str(index))
            schemas.update(copy_mount(source, target, mount['Destination'], metadata['Id']))
            binds.append(str(target) + ':' + mount['Destination'])
            mounts.append({'Source': str(target), 'Destination': mount['Destination'], 'RW': True})
        if not schemas:
            raise RuntimeError('No isolated database snapshot was created')
        config = candidate_config(old, metadata, 'runtime-smoke')
        host = dict(old['HostConfig'])
        host.update({'NetworkMode': 'none', 'PortBindings': {}, 'Binds': binds, 'Mounts': [],
                     'RestartPolicy': {'Name': 'no'}, 'VolumesFrom': None, 'Links': None})
        config['HostConfig'] = host
        register_resource(root, name, metadata['Id'], mounts)
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
        recover(r.ROOT / 'smoke')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', nargs='?')
    parser.add_argument('--cleanup', action='store_true', help='recover abandoned smoke resources only')
    parser.add_argument('--same-source', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    with open('/var/lock/cfp-hello-agent-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.cleanup:
            recover(r.ROOT / 'smoke')
        else:
            if not args.image:
                parser.error('image is required unless --cleanup is used')
            # Direct smoke checks must register expiration too. Import lazily to
            # avoid the release/verify_runtime module cycle during normal deploy.
            import release
            old = json.loads(run('docker', 'inspect', r.NAMES[0]))[0]
            with release.backup_policy(r.ROOT, [old]):
                verify(args.image, args.same_source)
