#!/usr/bin/env python3
"""Offline privacy maintenance for one explicitly configured Docker deployment.
Python 3.6+; no secrets or application output are written to the journal.
"""
import argparse
import datetime
import fcntl
import gzip
import tarfile
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request


def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('operation failed: ' + args[0])
    return result.stdout.decode('utf-8')


def is_database_backup(file):
    if file.suffix in ('.db', '.sqlite', '.sqlite3'):
        with file.open('rb') as handle:
            return handle.read(16) == b'SQLite format 3\x00'
    if file.suffix not in ('.gz', '.tgz'):
        return False
    # Inspect without extraction. Malformed compressed backups fail closed.
    with gzip.open(str(file), 'rb') as handle:
        if handle.read(16) == b'SQLite format 3\x00':
            return True
    try:
        with tarfile.open(str(file), 'r|gz') as archive:
            for member in archive:
                if not member.isfile() or not member.name.endswith(('.db', '.sqlite', '.sqlite3')):
                    continue
                with archive.extractfile(member) as handle:
                    if handle.read(16) == b'SQLite format 3\x00':
                        return True
    except tarfile.ReadError:
        # Non-tar gzip can be a log or source artifact; it is not a DB backup.
        return False
    return False


def prune_backups(directory, days, now=None):
    """Only SQLite backups in the declared directory; never follow symlinks.
    Reserve one scheduling interval so hourly runs keep the seven-day ceiling.
    """
    cutoff = (now or time.time()) - days * 86400 + 3600
    removed = 0
    for root, dirs, files in os.walk(str(directory), followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(root) / d).is_symlink()]
        for name in files:
            file = Path(root) / name
            if file.is_symlink():
                continue
            if file.stat().st_mtime > cutoff:
                continue
            if not is_database_backup(file):
                continue
            # A live WAL/SHM is not an approved standalone backup.
            if any(Path(str(file) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')):
                raise RuntimeError('backup has database sidecars; inspect before removing')
            file.unlink()
            removed += 1
    return removed


def atomic_json(file, value):
    temporary = file.with_suffix('.tmp')
    with temporary.open('w') as handle:
        json.dump(value, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(str(temporary), 0o600)
    os.replace(str(temporary), str(file))
    directory = os.open(str(file.parent), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def operate(config, restore=None):
    state = Path(config['stateDir'])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (state / 'maintenance.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    status = {'ok': False, 'startedAt': datetime.datetime.utcnow().isoformat() + 'Z', 'stage': 'validate'}
    atomic_json(state / 'status.json', status)
    environment_file = None
    try:
        meta = json.loads(run(['docker', 'inspect', config['container']]))[0]
        mounts = {m['Destination']: m for m in meta['Mounts']}
        if mounts.get('/data', {}).get('Source') != config['dataDir'] or mounts.get('/privacy-ledger', {}).get('Source') != config['ledgerDir']:
            raise RuntimeError('configured data/ledger mounts differ from deployment')
        env = dict(item.split('=', 1) for item in meta['Config']['Env'] if '=' in item)
        db = env.get('HELLO_DATABASE_URI', '')
        if not db.startswith('file:/data/') or '/' in db[len('file:/data/'):] or not db.endswith('.db'):
            raise RuntimeError('explicit single SQLite database required')
        ledger = Path(config['ledgerDir']) / 'deletions.ndjson'
        if env.get('HELLO_PRIVACY_DELETION_LEDGER') != '/privacy-ledger/deletions.ndjson' or not ledger.is_file():
            raise RuntimeError('independent deletion ledger unavailable')
        days = int(env['HELLO_PRIVACY_BACKUP_DAYS'])
        if days != 7:
            raise RuntimeError('this deployment requires the approved seven-day backup policy')
        backups = Path(config['backupDir'])
        if not backups.is_dir() or backups.is_symlink():
            raise RuntimeError('backup directory must be prepared first')
        # Configuration may include legacy deployment snapshots; never the live data directory.
        roots = [backups] + [Path(value) for value in config.get('legacyBackupDirs', [])]
        for root in roots:
            if not root.is_dir() or root.is_symlink() or root.resolve() == Path(config['dataDir']).resolve() or root.resolve() in Path(config['dataDir']).resolve().parents:
                raise RuntimeError('invalid backup root')
        status['stage'] = 'expire-backups'
        status['expiredBackups'] = sum(prune_backups(root, days) for root in roots)
        selected = None
        if restore:
            selected = Path(restore).resolve()
            if selected.parent != backups.resolve() or not selected.is_file() or selected.suffix != '.db' or selected.stat().st_mtime < time.time() - days * 86400:
                raise RuntimeError('restore requires a current managed backup')
        with tempfile.NamedTemporaryFile(mode='w', dir=str(state), delete=False) as handle:
            environment_file = handle.name
            for key, value in env.items():
                if '\n' in value or '\r' in value:
                    raise RuntimeError('multiline Docker environment unsupported')
                handle.write(key + '=' + value + '\n')
        common = ['docker', 'run', '--rm', '--init', '--memory=768m', '--cpus=0.75', '--pids-limit=256', '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--log-driver', 'none', '--env-file', environment_file, '--workdir', meta['Config']['WorkingDir']]
        for source, target, mode in [(config['dataDir'], '/data', 'rw'), (config['ledgerDir'], '/privacy-ledger', 'rw'), (config['backupDir'], '/privacy-backups', 'rw'), (config['sourceDir'], '/privacy-ops', 'ro')]:
            common += ['-v', source + ':' + target + ':' + mode]
        # Use the reviewed maintenance implementation even before the next full application build.
        common += ['-v', config['sourceDir'] + '/maintenance.ts:' + meta['Config']['WorkingDir'] + '/src/privacy/maintenance.ts:ro', '--entrypoint', 'node', meta['Image']]
        status['stage'] = 'stop-traffic'
        run(['docker', 'stop', '--time', '120', config['container']])
        # From here any failure leaves this instance stopped. An hourly retry is safe.
        stamp = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%S%fZ')
        status['stage'] = 'backup'
        run(common + ['/privacy-ops/privacy-snapshot.mjs', 'backup', db[5:], '/privacy-backups/' + stamp + '.db'])
        pending_restore = state / 'restore-pending.json'
        if selected:
            atomic_json(pending_restore, {'pending': True})
            status['stage'] = 'restore'
            run(common + ['/privacy-ops/privacy-snapshot.mjs', 'restore', '/privacy-backups/' + selected.name, db[5:]])
        status['stage'] = 'delete-expired-and-replay-ledger'
        run(common + ['--import', 'tsx', 'scripts/privacy-maintenance.ts', '--apply'] + (['--restore'] if pending_restore.exists() else []))
        status['stage'] = 'retire-deletion-guards'
        run(common + ['/privacy-ops/privacy-snapshot.mjs', 'retire', db[5:], '/privacy-ledger/deletions.ndjson'])
        status['stage'] = 'start-and-health-check'
        run(['docker', 'start', config['container']])
        for attempt in range(30):
            try:
                with urllib.request.urlopen(config['healthUrl'], timeout=5) as response:
                    if response.status == 200:
                        break
            except Exception:
                pass
            time.sleep(2)
        else:
            run(['docker', 'stop', '--time', '120', config['container']])
            raise RuntimeError('health check failed')
        if pending_restore.exists():
            pending_restore.unlink()
        status.update(ok=True, stage='complete', backup=stamp + '.db', completedAt=datetime.datetime.utcnow().isoformat() + 'Z')
    finally:
        if environment_file:
            os.unlink(environment_file)
        atomic_json(state / 'status.json', status)
        # Deliberately no user IDs, paths to media, tokens, provider errors or content.
        print(json.dumps(status))
        lock.close()
    return status


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('config')
    parser.add_argument('--restore', help='managed backup; requires offline ledger replay before restart')
    args = parser.parse_args()
    try:
        with open(args.config) as handle:
            operate(json.load(handle), args.restore)
    except Exception:
        print('Privacy maintenance failed; inspect status.json and the configured deployment. No automatic restore bypass.')
        raise SystemExit(1)
