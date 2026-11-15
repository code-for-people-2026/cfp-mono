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

prefixed = 'Payload startup log that is not JSON\n' + operations.RESULT_MARKER + json.dumps({'safetyRetention': {'eligible': 0}}) + '\n'
assert operations.maintenance_result(prefixed) == {'safetyRetention': {'eligible': 0}}
try:
    operations.maintenance_result('Payload startup log only\n')
    raise AssertionError('missing result marker was accepted')
except RuntimeError:
    pass
print('Maintenance result parser ignores harmless non-JSON log prefixes and requires one bounded marker.')


def retention_record(event, operation, recorded, retain=None, review=False, hold=False, case_id=1):
    return {
        'version': 1, 'caseId': case_id, 'receiptDigest': 'a' * 64, 'revision': 2,
        'event': event, 'operationId': operation, 'recordedAt': recorded,
        'retainUntil': retain, 'retentionReviewNeeded': review,
        'legalHold': hold, 'holdReviewAt': None,
    }


with tempfile.TemporaryDirectory() as directory:
    ledger = Path(directory) / 'safety-retention.ndjson'
    old = '2026-01-01T00:00:00.000Z'
    recent = '2026-11-13T00:00:00.000Z'
    future = '2026-12-01T00:00:00.000Z'
    rows = [
        retention_record('purge', None, old),
        retention_record('purge', None, recent),
        retention_record('state_intent', '11111111-1111-1111-1111-111111111111', old, future),
        retention_record('state_commit', '11111111-1111-1111-1111-111111111111', old, future),
        retention_record('state_intent', '22222222-2222-2222-2222-222222222222', old, old, case_id=2),
        retention_record('state_commit', '22222222-2222-2222-2222-222222222222', old, old, case_id=2),
        retention_record('state_intent', '33333333-3333-3333-3333-333333333333', old, old, case_id=3),
    ]
    ledger.write_text(''.join(json.dumps(row) + '\n' for row in rows))
    os.chmod(str(ledger), 0o600)
    before_metadata = ledger.stat()
    result = operations.compact_retention_ledger(ledger, time.mktime(time.strptime('2026-11-14', '%Y-%m-%d')))
    after_metadata = ledger.stat()
    assert (after_metadata.st_uid, after_metadata.st_gid, after_metadata.st_mode & 0o777) == \
        (before_metadata.st_uid, before_metadata.st_gid, 0o600)
    compacted = [json.loads(line) for line in ledger.read_text().splitlines()]
    assert result == {'before': 7, 'after': 4, 'unresolved': 1}
    assert [row['event'] for row in compacted] == ['purge', 'state_intent', 'state_commit', 'state_intent']
    assert all(row.get('operationId') != '22222222-2222-2222-2222-222222222222' for row in compacted)
    original = ledger.read_text()
    try:
        with patch.object(operations.os, 'fchown', side_effect=PermissionError('synthetic ownership failure')):
            operations.compact_retention_ledger(ledger, time.mktime(time.strptime('2026-11-14', '%Y-%m-%d')))
        raise AssertionError('ownership preservation failure was ignored')
    except PermissionError:
        pass
    assert ledger.read_text() == original
    ledger.write_text(original + json.dumps({'unknown': True}) + '\n')
    invalid = ledger.read_text()
    try:
        operations.compact_retention_ledger(ledger, time.time())
        raise AssertionError('unknown retention record was accepted')
    except RuntimeError:
        pass
    assert ledger.read_text() == invalid
print('Retention ledger compaction keeps the eight-day window, preserves restrictive ownership, and fails closed atomically.')

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for sub in ('state', 'data', 'ledger', 'backups', 'source'):
        (root / sub).mkdir()
    (root / 'ledger/deletions.ndjson').touch()
    (root / 'ledger/safety-retention.ndjson').touch()
    os.chmod(str(root / 'ledger/safety-retention.ndjson'), 0o600)
    for name in ('maintenance.ts', 'privacy-maintenance.ts', 'safety-retention.ts', 'safety-retention-ledger.ts'):
        (root / 'source' / name).touch()
    db = sqlite3.connect(str(root / 'backups/current.db')); db.execute('CREATE TABLE example(id)'); db.close()
    runtime_image = 'sha256:' + 'd' * 64
    db = sqlite3.connect(str(root / 'data/hello.db'))
    db.executescript('''
      CREATE TABLE safety_cases (
        id integer PRIMARY KEY, retention_review_needed integer,
        retention_purged_at text, hold_review_at text
      );
      CREATE TABLE payload_migrations (name text);
      INSERT INTO payload_migrations VALUES ('20261114_090000_finite_safety_retention');
    ''')
    db.commit(); db.close()
    main_id, worker_id, unrelated_id = 'a' * 64, 'b' * 64, 'c' * 64
    config = {'container': 'synthetic-main', 'containerId': main_id,
              'companionContainers': [{'name': 'synthetic-worker', 'id': worker_id}],
              'stateDir': str(root/'state'), 'dataDir': str(root/'data'),
              'ledgerDir': str(root/'ledger'), 'backupDir': str(root/'backups'),
              'sourceDir': str(root/'source'), 'healthUrl': 'http://127.0.0.1:1/ready',
              'retentionRuntimeImage': runtime_image}
    states = {main_id: True, worker_id: True, unrelated_id: True}
    names = {'synthetic-main': main_id, 'synthetic-worker': worker_id, 'unrelated': unrelated_id}
    events, maintenance_runs = [], [0]
    counts = ('dryRun', 'eligible', 'expiredExisting', 'legacyNullExpiry',
              'overdueHolds', 'holdsMissingReviewDate', 'reviewNeeded',
              'reviewDueSoon', 'releasedReferenceSweeps',
              'activeRestrictionReferences', 'activeRestrictionReviewsOverdue')
    def metadata(name):
        container_id = names[name]
        mounts = [{'Destination': '/data', 'Source': config['dataDir']}]
        env = []
        if container_id == main_id:
            mounts.append({'Destination': '/privacy-ledger', 'Source': config['ledgerDir']})
            env = ['HELLO_DATABASE_URI=file:/data/hello.db',
                   'HELLO_PRIVACY_DELETION_LEDGER=/privacy-ledger/deletions.ndjson',
                   'HELLO_PRIVACY_BACKUP_DAYS=7']
        return {'Id': container_id, 'Name': '/' + name, 'Mounts': mounts,
                'Config': {'WorkingDir': '/app', 'Env': env,
                           'Labels': {'cn.codeforpeople.service': 'hello-agent',
                                      'cn.codeforpeople.retention-runtime': 'v1'}},
                'Image': runtime_image,
                'State': {'Running': states[container_id]}}
    def fake_run(args):
        if args[:2] == ['docker', 'inspect']:
            target = args[2]
            name = target if target in names else next(name for name, value in names.items() if value == target)
            return json.dumps([metadata(name)])
        if args[:2] == ['docker', 'stop']:
            events.append('stop:' + args[-1]); states[args[-1]] = False; return ''
        if args[:2] == ['docker', 'start']:
            events.append('start:' + args[-1]); states[args[-1]] = True; return ''
        if 'scripts/privacy-maintenance.ts' in args:
            maintenance_runs[0] += 1
            events.append('maintenance')
            if maintenance_runs[0] == 1: raise RuntimeError('injected maintenance failure')
            return operations.RESULT_MARKER + json.dumps({'safetyRetention': {key: 0 for key in counts}}) + '\n'
        return ''
    def fake_prune(root, days): events.append('prune'); return 0
    original_compact = operations.compact_retention_ledger
    def tracked_compact(file, now=None): events.append('compact'); return original_compact(file, now)
    with patch.object(operations, 'run', fake_run), \
            patch.object(operations, 'prune_backups', fake_prune), \
            patch.object(operations, 'compact_retention_ledger', tracked_compact), \
            patch.object(operations, '_wait_main_health'), \
            patch.object(operations, '_database_alert_state', return_value=[(1, 'verified', 'fingerprint', 'baseline')]) as alert_state, \
            patch.object(operations, '_wait_worker_heartbeat'):
        try: operations.operate(config, str(root/'backups/current.db'))
        except RuntimeError: pass
        else: raise AssertionError('failure incorrectly ignored')
        assert states[main_id] is False and states[worker_id] is False
        assert states[unrelated_id] is True
        assert (root/'state'/operations.WRITER_JOURNAL).exists()
        assert (root/'state/restore-pending.json').exists()
        failed = json.loads((root/'state/status.json').read_text())
        assert failed['ok'] is False and failed['failureClosed'] is True
        assert events.index('prune') < events.index('stop:' + worker_id) < events.index('stop:' + main_id) < events.index('compact')
        assert not list((root/'state').glob('tmp*')), 'temporary secret file left behind'

        before_retry = len(events)
        completed = operations.operate(config)
        assert completed['ok'] is True
        assert states[main_id] is True and states[worker_id] is True
        assert states[unrelated_id] is True
        assert not (root/'state'/operations.WRITER_JOURNAL).exists()
        retry_events = events[before_retry:]
        assert retry_events.index('stop:' + worker_id) < retry_events.index('stop:' + main_id) < retry_events.index('compact')
        assert retry_events.index('start:' + main_id) < retry_events.index('start:' + worker_id)
        assert alert_state.call_args_list[-1].args[0] == root/'data/hello.db'
        states[worker_id] = False
        before_stopped_worker = len(events)
        completed = operations.operate(config)
        assert completed['ok'] is True and states[main_id] is True and states[worker_id] is False
        stopped_worker_events = events[before_stopped_worker:]
        assert 'start:' + main_id in stopped_worker_events and 'start:' + worker_id not in stopped_worker_events
    assert maintenance_runs[0] == 3
print('All pinned writers stop worker-first before compaction; failure leaves both stopped and a retry restores only their original running states.')

with tempfile.TemporaryDirectory() as directory:
    database = Path(directory) / 'hello.db'
    db = sqlite3.connect(str(database))
    db.execute('CREATE TABLE safety_alert_state (verified_at text, fingerprint text, heartbeat_at text)')
    db.execute("INSERT INTO safety_alert_state VALUES ('verified', 'fingerprint', 'old')")
    db.commit(); db.close()
    baseline = operations._database_alert_state(database)
    db = sqlite3.connect(str(database)); db.execute("UPDATE safety_alert_state SET heartbeat_at='new'"); db.commit(); db.close()
    with patch.object(operations.time, 'sleep'):
        operations._wait_worker_heartbeat(database, baseline, attempts=1)
print('Companion readiness requires a fresh database heartbeat while preserving verified alert identity.')

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    state = root / 'state'; state.mkdir()
    data = root / 'data'; data.mkdir()
    manifest = root / 'retention.json'
    main_name, worker_name = 'managed-main', 'managed-worker'
    generations = [
        ('d' * 64, 'e' * 64, '1' * 64),
        ('f' * 64, '0' * 64, '2' * 64),
        ('3' * 64, '4' * 64, '5' * 64),
    ]
    runtime = {'generation': 0}
    managed_config = {
        'container': main_name,
        'companionContainers': [{'name': worker_name}],
        'deploymentManifest': str(manifest),
        'dataDir': str(data),
    }
    def write_manifest(generation):
        main, worker, image = generations[generation]
        manifest.write_text(json.dumps({
            'schema': 1,
            'current': {
                'image': 'sha256:' + image,
                'tag': 'cfp-hello-agent:preview-test',
                'containers': [
                    {'id': main, 'name': main_name},
                    {'id': worker, 'name': worker_name},
                ],
            },
        }))
        runtime['generation'] = generation
    def managed_run(args):
        assert args[:2] == ['docker', 'inspect']
        main, worker, image = generations[runtime['generation']]
        by_name = {main_name: main, worker_name: worker}
        name = args[2]
        return json.dumps([{
            'Id': by_name[name], 'Name': '/' + name, 'Image': 'sha256:' + image,
            'Mounts': [{'Destination': '/data', 'Source': str(data)}],
            'State': {'Running': True},
        }])
    with patch.object(operations, 'run', managed_run):
        write_manifest(0)
        first = operations._writer_references(managed_config)
        assert [writer['id'] for writer in first] == list(generations[0][:2])

        # A completed normal release has no deployment journal. The next clean
        # maintenance run follows its newly committed immutable manifest IDs.
        write_manifest(1)
        second = operations._writer_references(managed_config)
        assert [writer['id'] for writer in second] == list(generations[1][:2])
        recovery, planned = operations._writer_plan(managed_config, state, second)
        pinned = recovery.read_text()
        pinned_writers = json.loads(pinned)['writers']
        assert [writer['id'] for writer in pinned_writers] == list(generations[1][:2])
        assert all(writer['wasRunning'] is True for writer in pinned_writers)
        assert [writer['id'] for writer in planned] == list(generations[1][:2])

        # If a maintenance recovery is pending, a later manifest generation
        # must fail closed rather than repinning the saved original states.
        write_manifest(2)
        try:
            operations._writer_plan(managed_config, state)
            raise AssertionError('stale maintenance recovery journal was repinned')
        except RuntimeError:
            pass
        assert recovery.read_text() == pinned

        (root / 'deployment-journal.json').write_text('{}')
        try:
            operations._writer_references(managed_config)
            raise AssertionError('pending deployment journal was accepted')
        except RuntimeError:
            pass
print('Managed manifest mode follows completed replacements, rejects deployment recovery, and never repins a pending maintenance recovery journal.')

try:
    operations._writer_references({'container': 'main', 'containerId': 'a' * 64})
    raise AssertionError('missing companion writer declaration was accepted')
except RuntimeError:
    pass
print('Writer configuration requires an explicit companion list and full pinned IDs.')


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
