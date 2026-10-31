#!/usr/bin/env python3
"""Replace the verified app/worker pair, then retire the previous rollback pair."""
import argparse
from contextlib import contextmanager
import fcntl
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import subprocess
import tarfile
import time
import urllib.request
import retention as r
import verify_runtime


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(30)
        self.sock.connect('/var/run/docker.sock')


def create(name, old, image, release):
    config = dict(old['Config'])
    config.pop('Hostname', None)
    config['Image'] = image
    config['Env'] = [v for v in config.get('Env', []) if not v.startswith('HELLO_RELEASE=')]
    config['Env'].append('HELLO_RELEASE=' + release)
    config['Labels'] = dict(config.get('Labels') or {}, **{
        'cn.codeforpeople.service': 'hello-agent', 'cn.codeforpeople.release': release})
    config['HostConfig'] = old['HostConfig']
    conn = UnixHTTP('localhost')
    try:
        conn.request('POST', '/containers/create?name=' + name, json.dumps(config),
                     {'Content-Type': 'application/json'})
        response = conn.getresponse()
        body = response.read()
        if response.status != 201:
            raise RuntimeError('Candidate creation failed: HTTP ' + str(response.status))
        return json.loads(body)['Id']
    finally:
        conn.close()


def database_state(configs):
    roots = {m['Source'] for c in configs for m in c['Mounts']
             if m['Type'] == 'bind' and m['Destination'] == '/data'}
    if len(roots) != 1:
        raise RuntimeError('Expected one shared, bind-mounted application database directory')
    result = {}
    for path in Path(next(iter(roots))).rglob('*'):
        if not path.is_file() or path.suffix not in ('.db', '.sqlite', '.sqlite3'):
            continue
        db = sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True, timeout=10)
        try:
            if db.execute('pragma quick_check').fetchall() != [('ok',)]:
                raise RuntimeError('Database quick_check failed')
            schema = db.execute("select name,type,sql from sqlite_master order by name,type").fetchall()
            state = db.execute('select rowid, verified_at, fingerprint, heartbeat_at from safety_alert_state order by rowid').fetchall()
            result[str(path)] = {'schema': schema, 'state': state}
        finally:
            db.close()
    if not result:
        raise RuntimeError('No database found')
    return result


def check_worker(before, after):
    if before.keys() != after.keys():
        raise RuntimeError('Database set changed')
    advanced = False
    for path in before:
        a, b = before[path], after[path]
        if a['schema'] != b['schema']:
            raise RuntimeError('This infrastructure-only workflow refuses schema changes')
        if [x[:3] for x in a['state']] != [x[:3] for x in b['state']]:
            raise RuntimeError('Existing alert verification changed')
        advanced |= any(new[3] and new[3] != old[3] for old, new in zip(a['state'], b['state']))
    return advanced


@contextmanager
def backup_policy(root, configs):
    """Enroll archives in the existing privacy job, holding its lock until done.

    Image retention never deletes backups. The privacy job alone enforces the
    approved seven-day policy, including archives from earlier deployments.
    """
    policy_path = root.parent / 'privacy-ops/full/config.json'
    policy = json.loads(policy_path.read_text())
    if policy.get('container') != r.NAMES[0]:
        raise RuntimeError('Privacy policy belongs to another deployment')
    for config in configs:
        mounts = {m['Destination']: m['Source'] for m in config['Mounts'] if m['Type'] == 'bind'}
        env = dict(v.split('=', 1) for v in config['Config'].get('Env', []) if '=' in v)
        if (mounts.get('/data') != policy.get('dataDir') or
                mounts.get('/privacy-ledger') != policy.get('ledgerDir') or
                not mounts.get('/data') or not mounts.get('/privacy-ledger') or
                env.get('HELLO_PRIVACY_BACKUP_DAYS') != '7'):
            raise RuntimeError('Privacy backup policy differs from the live deployment')
    archives = root / 'deployments'
    if archives.resolve() != archives.absolute():
        raise RuntimeError('Deployment backup root must not traverse symlinks')
    for key in ('dataDir', 'ledgerDir'):
        live = Path(policy[key]).resolve()
        if live == archives.resolve() or archives.resolve() in live.parents:
            raise RuntimeError('Backup root contains live data')
    # Open the same inode as privacy-operations.py, without truncating it. A
    # running maintenance job prevents deployment before any service is stopped.
    with (Path(policy['stateDir']) / 'maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        archives.mkdir(mode=0o700, parents=True, exist_ok=True)
        roots = policy.get('legacyBackupDirs', [])
        if not isinstance(roots, list) or any(not isinstance(p, str) for p in roots):
            raise RuntimeError('Invalid privacy backup roots')
        if str(archives) not in roots:
            policy['legacyBackupDirs'] = roots + [str(archives)]
            r.save(policy_path, policy)
        yield


def backup(configs, dest):
    before = database_state(configs)
    # The deletion ledger stays independent and must never be restored from a snapshot.
    sources = {m['Source'] for c in configs for m in c['Mounts']
               if m['Type'] == 'bind' and m['Destination'] == '/data'}
    if not sources or any(not p.startswith('/opt/cfp-hello-agent/') for p in sources):
        raise RuntimeError('Unexpected data mounts')
    archive = dest / 'data.tar.gz'
    with tarfile.open(str(archive), 'w:gz') as tf:
        for p in sorted(sources):
            tf.add(p, arcname=p.lstrip('/'))
    # Read every archived member to detect truncated backup before replacing services.
    with tarfile.open(str(archive), 'r:gz') as tf:
        for item in tf:
            if item.isfile():
                f = tf.extractfile(item)
                while f.read(1024 * 1024):
                    pass
    r.save(dest / 'database-state.json', before)
    return before


def deploy(release, root=r.ROOT, same_source=False):
    if not re.fullmatch(r'preview-[a-zA-Z0-9_-]+', release):
        raise RuntimeError('Invalid release name')
    journal = root / 'deployment-journal.json'
    if journal.exists():
        raise RuntimeError('An interrupted deployment needs recovery; refusing to overwrite its journal')
    state = json.loads((root / 'retention.json').read_text())
    rows = r.inventory()
    r.validate(state, rows)
    r.ready(state)
    if shutil.disk_usage(root).free < 2 * 1024 ** 3:
        raise RuntimeError('Less than 2 GiB free; running services were not stopped')
    image = 'cfp-hello-agent:' + release
    metadata = json.loads(r.docker('image', 'inspect', image))[0]
    labels = metadata['Config'].get('Labels') or {}
    if labels.get('cn.codeforpeople.release') != release:
        raise RuntimeError('Image was not produced by the managed build workflow')
    if metadata['Id'] in {state['current']['image'], state['rollback']['image']}:
        raise RuntimeError('Candidate must be a new image')
    configs = [next(c for c in rows if c['Id'] == ref['id']) for ref in state['current']['containers']]
    with backup_policy(root, configs):
        verify_runtime.verify(image, same_source=same_source)
        token = r.stamp()
        dest = root / 'deployments' / token
        r.save(dest / 'previous-containers.json', configs)
        progress = {'release': release, 'previousState': state, 'configs': str(dest / 'previous-containers.json'),
                    'renamed': [], 'created': [], 'backup': str(dest / 'data.tar.gz')}
        r.save(journal, progress)
        try:
            for c in reversed(configs):
                r.docker('stop', '-t', '30', c['Id'])
            before = backup(configs, dest)
            for name, config in zip(r.NAMES, configs):
                rollback_name = name + '-rollback-' + token
                r.docker('rename', config['Id'], rollback_name)
                progress['renamed'].append({'id': config['Id'], 'from': name, 'to': rollback_name})
                r.save(journal, progress)
                cid = create(name, config, metadata['Id'], release)
                progress['created'].append(cid)
                r.save(journal, progress)
                r.docker('start', cid)
            healthy = False
            for _ in range(60):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:3318/api/ready', timeout=3) as response:
                        ready = json.load(response)
                    if ready.get('ok') and ready.get('release') == release:
                        healthy = True
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(2)
            if not healthy:
                raise RuntimeError('Candidate readiness failed')
            advanced = False
            for _ in range(25):
                advanced = check_worker(before, database_state(configs))
                if advanced:
                    break
                time.sleep(2)
            if not advanced:
                raise RuntimeError('Alert worker heartbeat did not advance')
            live = r.inventory()
            current = [next(c for c in live if c['Id'] == cid) for cid in progress['created']]
            previous = [next(c for c in live if c['Id'] == c0['Id']) for c0 in configs]
            next_state = {'schema': 1, 'current': r.record(current, tag=image), 'rollback': r.record(previous, tag=state['current']['tag']),
                          'retired': state.get('retired', []) + [state['rollback']]}
            # Creating by digest deliberately pins the image; record the verified release tag.
            next_state['current']['tag'] = image
            r.validate(next_state, live)
            r.ready(next_state)
            r.save(dest / 'receipt.json', {'release': release, 'ready': True,
                                         'databaseQuickCheck': 'ok', 'workerHeartbeatAdvanced': True})
            r.save(root / 'retention.json', next_state)
        except BaseException:
            # Only containers created by this transaction can be force removed, never volumes.
            candidates = set(progress['created'])
            for c in r.inventory():
                labels = c['Config'].get('Labels') or {}
                if (c['Name'].lstrip('/') in r.NAMES and c['Image'] == metadata['Id']
                        and labels.get('cn.codeforpeople.release') == release):
                    candidates.add(c['Id'])
            for cid in sorted(candidates):
                r.docker('container', 'rm', '-f', cid)
            for entry in progress['renamed']:
                r.docker('rename', entry['id'], entry['from'])
            for config in configs:
                r.docker('start', config['Id'])
            r.save(root / 'retention.json', state)
            # Keep the failure journal if rollback readiness cannot be confirmed.
            for attempt in range(30):
                try:
                    r.ready(state)
                    break
                except (OSError, RuntimeError):
                    if attempt == 29:
                        raise
                    time.sleep(2)
            journal.unlink()
            raise
        journal.unlink()
        r.cleanup(next_state, root=root, apply=True)
        print(json.dumps({'deployed': image, 'rollback': next_state['rollback']['tag']}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release')
    parser.add_argument('--same-source', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    with open('/var/lock/cfp-hello-agent-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(args.release, same_source=args.same_source)


if __name__ == '__main__':
    main()
