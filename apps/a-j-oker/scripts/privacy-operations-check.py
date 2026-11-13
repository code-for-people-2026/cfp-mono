#!/usr/bin/env python3
"""Exercise backup expiry on real SQLite files, preserving other files/symlinks."""
import importlib.util
import os
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import sqlite3
import tempfile
import time

spec = importlib.util.spec_from_file_location('operations', str(Path(__file__).with_name('privacy-operations.py')))
operations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operations)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    backups = root / 'backups'
    backups.mkdir()
    for name in ('old.db', 'new.db', 'external.db', 'live.db'):
        target = (root if name == 'external.db' else backups) / name
        db = sqlite3.connect(str(target)); db.execute('CREATE TABLE example (id)'); db.close()
        if name != 'new.db':
            os.utime(str(target), (time.time() - 8 * 86400,) * 2)
    (backups / 'not-a-database.db').write_text('keep')
    (backups / 'old.env').write_text('keep')
    (backups / 'link.db').symlink_to(root / 'external.db')
    (backups / 'live.db-wal').touch()
    try:
        operations.prune_backups(backups, 7)
        raise AssertionError('live-looking backup was accepted')
    except RuntimeError:
        pass
    assert (backups / 'live.db').exists()
    (backups / 'live.db-wal').unlink()
    operations.prune_backups(backups, 7)
    assert not (backups / 'old.db').exists()
    assert (backups / 'new.db').exists()
    assert (backups / 'not-a-database.db').exists()
    assert (root / 'external.db').exists()
    assert (backups / 'old.env').exists()
print('Backup expiry: real old SQLite removed; recent backups, symlinks and non-database files preserved.')

# A failed restore must remain closed; the next scheduled run must replay the
# ledger even when it was not explicitly invoked with --restore again.
from unittest.mock import patch
import json
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for sub in ('state', 'data', 'ledger', 'backups', 'source'):
        (root / sub).mkdir()
    (root / 'ledger/deletions.ndjson').touch()
    db = sqlite3.connect(str(root / 'backups/current.db')); db.execute('CREATE TABLE example(id)'); db.close()
    config = {'container': 'synthetic', 'stateDir': str(root/'state'), 'dataDir': str(root/'data'), 'ledgerDir': str(root/'ledger'), 'backupDir': str(root/'backups'), 'sourceDir': str(root/'source'), 'healthUrl': 'http://127.0.0.1:1/ready'}
    meta = {'Mounts': [{'Destination': '/data', 'Source': config['dataDir']}, {'Destination': '/privacy-ledger', 'Source': config['ledgerDir']}], 'Config': {'WorkingDir': '/app', 'Env': ['HELLO_DATABASE_URI=file:/data/hello.db', 'HELLO_PRIVACY_DELETION_LEDGER=/privacy-ledger/deletions.ndjson', 'HELLO_PRIVACY_BACKUP_DAYS=7']}, 'Image': 'synthetic'}
    calls = []
    def fake_run(args):
        calls.append(args)
        if args[:2] == ['docker', 'inspect']: return json.dumps([meta])
        if 'scripts/privacy-maintenance.ts' in args: raise RuntimeError('injected maintenance failure')
        return ''
    with patch.object(operations, 'run', fake_run):
        for restore in (str(root/'backups/current.db'), None):
            try: operations.operate(config, restore)
            except RuntimeError: pass
            else: raise AssertionError('failure incorrectly ignored')
            assert (root/'state/restore-pending.json').exists()
            assert json.loads((root/'state/status.json').read_text())['ok'] is False
            assert not list((root/'state').glob('tmp*')), 'temporary secret file left behind'
    assert not any(c[:2] == ['docker', 'start'] for c in calls)
    assert all('--restore' in c for c in calls if 'scripts/privacy-maintenance.ts' in c)
print('Restore failure stays stopped, removes temporary credentials, and forces ledger replay on scheduled retry.')


import gzip
import tarfile
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    database = root / 'source.db'
    db = sqlite3.connect(str(database)); db.execute('CREATE TABLE example(id)'); db.close()
    with gzip.open(str(root/'old.db.gz'), 'wb') as out: out.write(database.read_bytes())
    for name in ('old-release.tar.gz', 'recent-release.tar.gz'):
        with tarfile.open(str(root/name), 'w:gz') as archive: archive.add(str(database), arcname='data/hello.db')
    with gzip.open(str(root/'old-log.gz'), 'wb') as out: out.write(b'ordinary log')
    for name in ('old.db.gz', 'old-release.tar.gz', 'old-log.gz'):
        os.utime(str(root/name), (time.time()-8*86400,)*2)
    assert operations.prune_backups(root, 7) == 2
    assert (root/'recent-release.tar.gz').exists()
    assert (root/'old-log.gz').exists()
    assert database.exists()
print('Compressed SQLite and release archives containing databases expire; recent archives and non-database gzip remain.')
