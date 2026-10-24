#!/usr/bin/env python3
"""Single-host, stopped-writer backup. Python 3.6+; Node 24 and pg_dump run in pinned containers.

No production restore command: unpack only creates a NEW quarantine directory.
Latest independent deletion ledger and keys must be supplied separately before replay.
"""
import argparse
import datetime
import fcntl
import json
import os
import re
import shutil
import signal
import socket
import ssl
import stat
import subprocess
import tarfile
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, unquote


def now():
    return datetime.datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'


def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=kwargs.pop('timeout', 600), **kwargs).stdout


def private_file(path, size=None):
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077 or (size is not None and info.st_size != size):
        raise ValueError('Invalid private file')


def real_path(path):
    if not os.path.isabs(path) or os.path.realpath(path) != path or any(c in path for c in '\n,:'):
        raise ValueError('Expected a canonical absolute path')
    return Path(path)


def load_config(path):
    private_file(path)
    with open(path) as source:
        config = json.load(source)
    names = ['appContainer', 'coreContainer', 'postgresContainer', 'nodeImage', 'sourceDirectory',
             'backupDirectory', 'reportDirectory', 'keyFile', 'ledgerFile', 'scriptsDirectory', 'publicOrigin', 'retentionDays']
    if set(config) != set(names) or type(config['retentionDays']) is not int or not 1 <= config['retentionDays'] <= 365:
        raise ValueError('Explicit retention policy required')
    for key in ['appContainer', 'coreContainer', 'postgresContainer']:
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}', config[key]):
            raise ValueError('Invalid container')
    if len({config[key] for key in ['appContainer', 'coreContainer', 'postgresContainer']}) != 3:
        raise ValueError('Distinct containers required')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', config['nodeImage']):
        raise ValueError('Pinned local image required')
    paths = {key: real_path(config[key]) for key in ['sourceDirectory', 'backupDirectory', 'reportDirectory', 'keyFile', 'ledgerFile', 'scriptsDirectory']}
    # No key/ledger/report/backup can live in another payload tree.
    roots = [paths[key] for key in paths if key != 'scriptsDirectory']
    for left in roots:
        for right in roots:
            if left != right and (left in right.parents or right in left.parents):
                raise ValueError('Independent storage paths required')
    if len(set(roots)) != len(roots):
        raise ValueError('Independent storage paths required')
    private_file(paths['keyFile'], 32)
    private_file(paths['ledgerFile'])
    for key in ['sourceDirectory', 'backupDirectory', 'reportDirectory', 'scriptsDirectory']:
        if not paths[key].is_dir():
            raise ValueError('Provision directories first')
    for key in ['sourceDirectory', 'backupDirectory']:
        if os.stat(paths[key]).st_mode & 0o077:
            raise ValueError('Private directory permissions required')
    origin = urlparse(config['publicOrigin'])
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.port not in [None, 443] or origin.path not in ['', '/'] or origin.query or origin.fragment:
        raise ValueError('Exact HTTPS public origin required')
    return config


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def environment(container):
    return dict(item.split('=', 1) for item in container['Config'].get('Env', []) if '=' in item)


def preflight(config):
    app, core, pg = [inspect(config[key]) for key in ['appContainer', 'coreContainer', 'postgresContainer']]
    for container, role in [(app, 'service'), (core, 'core'), (pg, 'database')]:
        if container['Config'].get('Labels', {}).get('cn.codeforpeople.bubu.role') != role or not container['State']['Running']:
            raise ValueError('Expected running Bubu containers')
    app_env, core_env = environment(app), environment(core)
    mount = next((m for m in app['Mounts'] if m['Destination'] == app_env.get('BUBU_IDENTITY_DIRECTORY')), None)
    ledger = next((m for m in app['Mounts'] if m['Destination'] == app_env.get('BUBU_DELETION_LEDGER')), None)
    if not mount or mount['Type'] != 'bind' or mount['Source'] != config['sourceDirectory'] or not mount['RW']:
        raise ValueError('App data mount mismatch')
    if not ledger or ledger['Type'] != 'bind' or ledger['Source'] != config['ledgerFile'] or not ledger['RW']:
        raise ValueError('Independent ledger mount mismatch')
    if app_env.get('BUBU_PRIVACY_BACKUP_DAYS') != str(config['retentionDays']) or not re.fullmatch(r'[a-fA-F0-9]{64}', app_env.get('BUBU_MEDIA_ENCRYPTION_KEY', '')) or not app_env.get('BUBU_PAYLOAD_SECRET'):
        raise ValueError('Privacy/key configuration mismatch')
    origin = urlparse(app_env.get('BUBU_LEGACY_ORIGIN', ''))
    if origin.scheme != 'http' or origin.hostname not in ['localhost', '127.0.0.1'] or origin.port != 3321 or not app_env.get('BUBU_CORE_SERVICE_TOKEN') or app_env.get('BUBU_CORE_SERVICE_TOKEN') != core_env.get('BUBU_CORE_SERVICE_TOKEN'):
        raise ValueError('Private original core required')
    db = urlparse(core_env.get('BUBU_CORE_DATABASE_URL', ''))
    if db.scheme not in ['postgres', 'postgresql'] or db.hostname not in ['localhost', '127.0.0.1'] or db.port not in [None, 5432] or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,62}', db.path[1:]) or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,62}', db.username or ''):
        raise ValueError('Private PostgreSQL required')
    # All three services must share the same loopback namespace. Resolve the owner to its immutable ID.
    def network_owner(container):
        mode = container['HostConfig']['NetworkMode']
        return inspect(mode.split(':', 1)[1])['Id'] if mode.startswith('container:') else container['Id']
    owners = {network_owner(c) for c in [app, core, pg]}
    if len(owners) != 1:
        raise ValueError('Private network namespace mismatch')
    owner = next(iter(owners))
    anchor = inspect(owner)
    if owner in [app['Id'], core['Id']] or not anchor['State']['Running']:
        raise ValueError('Network namespace owner must remain running during backup')
    private_containers = [app, core, pg, anchor]
    published = any(bindings for container in private_containers for mapping in [container['HostConfig'].get('PortBindings') or {}, container.get('NetworkSettings', {}).get('Ports') or {}] for port, bindings in mapping.items() if port.split('/')[0] in ['3321', '5432'])
    if anchor['HostConfig']['NetworkMode'] == 'host' or any(c['HostConfig'].get('PublishAllPorts') for c in private_containers) or published:
        raise ValueError('Private core/database ports must not be published')
    source = Path(config['sourceDirectory'])
    for identifier in run(['docker', 'ps', '-q']).decode().split():
        other = inspect(identifier)
        if other['Id'] not in [app['Id'], core['Id'], pg['Id'], owner] and network_owner(other) == owner:
            raise ValueError('Unexpected process shares the private database network')
        if other['Id'] == app['Id']: continue
        for mount in other['Mounts']:
            origin = Path(mount.get('Source', '/'))
            if mount.get('RW') and (origin == source or origin in source.parents or source in origin.parents):
                raise ValueError('Another container can write the sidecar directory')
    password = unquote(db.password or '')
    if not password or any(c in password for c in '\n\r\x00'):
        raise ValueError('Private database credential required')
    return app, core, pg, db.path[1:], db.username, password


def write_report(config, key, value):
    directory = Path(config['reportDirectory'])
    file = directory / 'status.json'
    report = {'version': 1}
    if file.exists():
        if file.is_symlink() or file.stat().st_size > 8192:
            raise ValueError('Invalid status file')
        with file.open() as source:
            report = json.load(source)
    previous = report.get(key, {})
    if key == 'backup' and value['state'] != 'verified' and previous.get('lastVerifiedAt'):
        value['lastVerifiedAt'] = previous['lastVerifiedAt']
    report[key] = value
    temporary = directory / ('.status-' + str(uuid.uuid4()))
    try:
        with temporary.open('x') as target:
            os.chmod(str(temporary), 0o644)  # Content is only timestamps/states; directory is mounted read-only.
            json.dump(report, target); target.flush(); os.fsync(target.fileno())
        os.replace(str(temporary), str(file))
        fd = os.open(str(directory), os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        if temporary.exists(): temporary.unlink()


def node(config, work, script, args, source=False):
    name = 'bubu-backup-tool-' + uuid.uuid4().hex
    command = ['docker', 'run', '--name', name, '--label', 'cn.codeforpeople.bubu.operation=backup', '--rm', '--network', 'none', '--read-only', '--memory', '256m', '--cpus', '0.5',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '0:0', '--entrypoint', 'node',
               '-v', config['scriptsDirectory'] + ':/scripts:ro', '-v', str(work) + ':/work', '-v', config['keyFile'] + ':/backup.key:ro']
    if source:
        # Production data belongs to the application UID with mode 0700/0600. Root without
        # capabilities cannot read it. Grant only DAC read/search, while the bind stays read-only.
        command += ['--cap-add', 'DAC_READ_SEARCH', '-v', config['sourceDirectory'] + ':/source:ro']
    try: run(command + [config['nodeImage'], '/scripts/' + script] + args)
    finally:
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)


def clear_staging(config):
    root = Path(config['backupDirectory'])
    # A SIGKILL may outlive Python's finally blocks. Stop only our own abandoned tools before removing their staging.
    for identifier in run(['docker', 'ps', '-aq', '--filter', 'label=cn.codeforpeople.bubu.operation=backup']).decode().split():
        container = inspect(identifier)
        if not re.fullmatch(r'/bubu-backup-tool-[a-f0-9]{32}', container['Name']): continue
        if any(m['Destination'] == '/work' and Path(m['Source']).parent == root and Path(m['Source']).name.startswith(('.capture-', '.unpack-')) for m in container['Mounts']):
            run(['docker', 'rm', '-f', container['Id']], timeout=30)
    for file in root.iterdir():
        if re.fullmatch(r'\.(capture|unpack)-[a-zA-Z0-9_-]{6,}', file.name):
            if file.is_symlink() or not file.is_dir(): raise ValueError('Unsafe stale staging directory')
            shutil.rmtree(str(file))


def pack(source, target):
    with tarfile.open(str(target), 'x') as archive:
        for root, dirs, files in os.walk(str(source), followlinks=False):
            for name in sorted(dirs + files):
                file = Path(root) / name
                if file.is_symlink() or not (file.is_dir() or file.is_file()):
                    raise ValueError('Unsafe snapshot')
                archive.add(str(file), arcname=str(file.relative_to(source)), recursive=False)


def unpack(source, target):
    """Never use extractall: reject links, paths, duplicate names and expansion bombs before writing."""
    target.mkdir(mode=0o700)
    total, seen = 0, set()
    try:
        with tarfile.open(str(source), 'r:') as archive:
            for item in archive:
                name = item.name
                if name in seen or name.startswith('/') or '\\' in name or any(part in ['', '.', '..'] for part in name.split('/')) or not (item.isfile() or item.isdir()):
                    raise ValueError('Unsafe archive entry')
                seen.add(name); total += item.size
                allowed = name in ['manifest.json', 'database.pg', 'sidecar', 'sidecar/identity.db', 'sidecar/private-attachments'] or re.fullmatch(r'sidecar/private-attachments/[a-f0-9]{64}(/[a-f0-9]{64})?', name)
                if not allowed or total > 64 * 1024 ** 3 or len(seen) > 100000:
                    raise ValueError('Invalid archive inventory')
                destination = target / name
                if item.isdir(): destination.mkdir(mode=0o700, parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with destination.open('xb') as output, archive.extractfile(item) as input_file:
                        os.chmod(str(destination), 0o600)
                        shutil.copyfileobj(input_file, output)
        return target
    except BaseException:
        shutil.rmtree(str(target))
        raise


def prune(config):
    cutoff = time.time() - config['retentionDays'] * 86400
    for file in Path(config['backupDirectory']).iterdir():
        if re.fullmatch(r'bubu-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}\.enc', file.name):
            private_file(file)
            if file.stat().st_mtime < cutoff: file.unlink()


def verify_runtime(app, core):
    for _ in range(45):
        states = [inspect(container['Id'])['State'] for container in [app, core]]
        if not all(state.get('Running') for state in states): raise RuntimeError('Runtime stopped after backup')
        if all(state.get('Health', {}).get('Status') == 'healthy' for state in states): return
        time.sleep(2)
    raise RuntimeError('Runtime health not confirmed')


def backup(config):
    app, core, pg, database, user, password = preflight(config)
    write_report(config, 'backup', {'state': 'running', 'at': now()})
    stopped = []
    try:
        prune(config)
        # Include several plaintext/ciphertext verification copies; this is a capacity guard, not a quota.
        size_command = ['docker', 'exec', '-i', pg['Id'], 'sh', '-ec',
                        'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGCONNECT_TIMEOUT=10; exec psql --host=127.0.0.1 --username="$1" --dbname="$2" -Atc "SELECT pg_database_size(current_database())"',
                        'bubu-backup', user, database]
        database_bytes = int(run(size_command, input=(password + '\n').encode()))
        sidecar_bytes = sum(file.stat().st_size for file in Path(config['sourceDirectory']).rglob('*') if file.is_file())
        if shutil.disk_usage(config['backupDirectory']).free < max(1024 ** 3, 8 * (database_bytes + sidecar_bytes)):
            raise ValueError('Insufficient backup staging space')
        for container in [app, core]:
            # Include before stop so a lost response still leads to a state check in finally.
            stopped.append(container['Id'])
            run(['docker', 'stop', '--time', '45', container['Id']], timeout=60)
        if any(inspect(container['Id'])['State']['Running'] for container in [app, core]):
            raise ValueError('Writers still running')
        with tempfile.TemporaryDirectory(prefix='.capture-', dir=config['backupDirectory']) as temporary:
            work = Path(temporary)
            with (work / 'database.pg').open('xb') as dump:
                subprocess.run(['docker', 'exec', '-i', pg['Id'], 'sh', '-ec',
                    'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGCONNECT_TIMEOUT=10; exec pg_dump --host=127.0.0.1 --username="$1" --dbname="$2" --format=custom --no-owner --no-acl',
                    'bubu-backup', user, database], input=(password + '\n').encode(), check=True, stdout=dump, stderr=subprocess.PIPE, timeout=600)
                dump.flush(); os.fsync(dump.fileno())
            node(config, work, 'backup-snapshot.mjs', ['capture', '/source', '/work/database.pg', '/work/snapshot'], source=True)
            pack(work / 'snapshot', work / 'snapshot.tar')
            node(config, work, 'backup-codec.mjs', ['encrypt', '/work/snapshot.tar', '/work/backup.enc', '/backup.key'])
            node(config, work, 'backup-codec.mjs', ['decrypt', '/work/backup.enc', '/work/verified.tar', '/backup.key'])
            unpack(work / 'verified.tar', work / 'verified')
            node(config, work, 'backup-snapshot.mjs', ['verify', '/work/verified'])
            name = 'bubu-' + datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex + '.enc'
            os.link(str(work / 'backup.enc'), str(Path(config['backupDirectory']) / name))
            fd = os.open(config['backupDirectory'], os.O_RDONLY)
            try: os.fsync(fd)
            finally: os.close(fd)
        # A backup is not reported successful until its original service also recovers.
    finally:
        failures = []
        for identifier in reversed(stopped):
            try:
                if not inspect(identifier)['State']['Running']: run(['docker', 'start', identifier], timeout=120)
            except Exception: failures.append(identifier)
        if failures: raise RuntimeError('Runtime restart failed')
        if stopped: verify_runtime(app, core)
    stamp = now()
    write_report(config, 'backup', {'state': 'verified', 'at': stamp, 'lastVerifiedAt': stamp})


def certificate(config):
    host = urlparse(config['publicOrigin']).hostname
    try:
        with socket.create_connection((host, 443), timeout=10) as sock:
            with ssl.create_default_context().wrap_socket(sock, server_hostname=host) as tls:
                expiry = ssl.cert_time_to_seconds(tls.getpeercert()['notAfter'])
        write_report(config, 'certificate', {'state': 'verified', 'at': now(), 'expiresAt': datetime.datetime.utcfromtimestamp(expiry).isoformat() + 'Z'})
    except Exception:
        write_report(config, 'certificate', {'state': 'failed', 'at': now()})
        raise


def main():
    os.umask(0o077)
    def interrupted(_number, _frame): raise InterruptedError('Host operation interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['check', 'backup', 'certificate', 'unpack'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--archive')
    parser.add_argument('--target')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(); config = load_config(args.config)
    lock = Path(config['reportDirectory']) / 'operations.lock'
    fd = os.open(str(lock), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'check': preflight(config)
        elif args.action == 'certificate': certificate(config)
        elif args.action == 'backup':
            if not args.apply: raise ValueError('Backup requires --apply after the read-only check')
            try:
                clear_staging(config)
                backup(config)
            except BaseException:
                write_report(config, 'backup', {'state': 'failed', 'at': now()})
                raise
        else:
            if not args.archive or not args.target or not args.apply: raise ValueError('Unpack requires explicit archive, new target and --apply')
            source, target = real_path(args.archive), real_path(args.target)
            private_file(source)
            if target.exists() or any(real_path(config[k]) == target or real_path(config[k]) in target.parents or target in real_path(config[k]).parents for k in ['sourceDirectory', 'backupDirectory', 'ledgerFile', 'keyFile', 'reportDirectory']):
                raise ValueError('New independent quarantine target required')
            clear_staging(config)
            with tempfile.TemporaryDirectory(prefix='.unpack-', dir=config['backupDirectory']) as temporary:
                work = Path(temporary); shutil.copyfile(str(source), str(work / 'input.enc'))
                node(config, work, 'backup-codec.mjs', ['decrypt', '/work/input.enc', '/work/archive.tar', '/backup.key'])
                unpack(work / 'archive.tar', work / 'restored')
                node(config, work, 'backup-snapshot.mjs', ['verify', '/work/restored'])
                # Reserve a new quarantine directory; never overwrite production or an existing target.
                target.mkdir(mode=0o700)
                try:
                    shutil.copytree(str(work / 'restored'), str(target / 'snapshot'))
                    (target / 'RESTORE-BLOCKED.txt').write_text('Offline quarantine only. Supply current independent deletion ledger and keys, restore PostgreSQL into an isolated database, replay deletions, verify schema/media and permissions before promotion.\n')
                except BaseException:
                    shutil.rmtree(str(target)); raise
    print(json.dumps({'ok': True, 'action': args.action, 'productionRestored': False}))


if __name__ == '__main__':
    try: main()
    except Exception:
        print('bubu_operations_failed')
        raise SystemExit(1)
