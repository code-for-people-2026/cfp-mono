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
import re
import sqlite3
import stat
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import quote


RESULT_MARKER = 'HELLO_PRIVACY_MAINTENANCE_RESULT '
MAX_MAINTENANCE_OUTPUT = 1024 * 1024
MAX_MAINTENANCE_RESULT = 64 * 1024
RETENTION_DEFENSE_DAYS = 8
RETENTION_LEDGER_FIELDS = {
    'version', 'caseId', 'receiptDigest', 'revision', 'event', 'operationId',
    'recordedAt', 'retainUntil', 'retentionReviewNeeded', 'legalHold', 'holdReviewAt'
}
WRITER_JOURNAL = 'writer-recovery.json'
FINITE_RETENTION_MIGRATION = '20261114_090000_finite_safety_retention'
FINITE_RETENTION_COLUMNS = {
    'retention_review_needed', 'retention_purged_at', 'hold_review_at'
}


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


def unlink_durable(file):
    file.unlink()
    directory = os.open(str(file.parent), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _writer_names(config, managed):
    companions = config.get('companionContainers')
    if (not isinstance(config.get('container'), str) or not config['container'] or
            not isinstance(companions, list)):
        raise RuntimeError('container and explicit companionContainers are required')
    references = [{'role': 'main', 'name': config['container']}]
    expected_fields = {'name'} if managed else {'name', 'id'}
    for companion in companions:
        if (not isinstance(companion, dict) or set(companion) != expected_fields or
                not isinstance(companion.get('name'), str) or not companion['name']):
            if managed:
                raise RuntimeError('each managed companion writer requires exactly one allowlisted name')
            raise RuntimeError('each companion writer requires an exact name and pinned full container ID')
        references.append({'role': 'companion', 'name': companion['name']})
    if len({item['name'] for item in references}) != len(references):
        raise RuntimeError('writer container names must be unique')
    return references


def _managed_writer_references(config):
    if 'containerId' in config:
        raise RuntimeError('managed deployment mode cannot also pin containerId')
    names = _writer_names(config, True)
    value = config.get('deploymentManifest')
    if not isinstance(value, str) or not value:
        raise RuntimeError('managed deployment mode requires deploymentManifest')
    manifest = Path(value)
    if not manifest.is_absolute() or manifest.name != 'retention.json':
        raise RuntimeError('deploymentManifest must be an absolute retention.json path')
    deployment_journal = manifest.parent / 'deployment-journal.json'
    if os.path.lexists(str(deployment_journal)):
        raise RuntimeError('pending deployment journal blocks privacy maintenance')
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 1024 * 1024:
        raise RuntimeError('deployment manifest must be a bounded regular file')
    try:
        state = json.loads(manifest.read_text())
    except (OSError, UnicodeDecodeError, ValueError):
        raise RuntimeError('deployment manifest is unreadable or invalid')
    current = state.get('current') if isinstance(state, dict) and state.get('schema') == 1 else None
    image = current.get('image') if isinstance(current, dict) else None
    containers = current.get('containers') if isinstance(current, dict) else None
    if (not isinstance(image, str) or not re.match(r'^sha256:[0-9a-f]{64}$', image) or
            not isinstance(containers, list) or len(containers) != len(names)):
        raise RuntimeError('deployment manifest has no exact managed current release')
    expected_names = [item['name'] for item in names]
    if [item.get('name') if isinstance(item, dict) else None for item in containers] != expected_names:
        raise RuntimeError('deployment manifest current roles/names differ from the configured allowlist')
    references = []
    for named, container in zip(names, containers):
        container_id = container.get('id')
        if (set(container) != {'name', 'id'} or not isinstance(container_id, str) or
                not re.match(r'^[0-9a-f]{64}$', container_id)):
            raise RuntimeError('deployment manifest current container reference is invalid')
        references.append({'role': named['role'], 'name': named['name'],
                           'id': container_id, 'image': image})
    if len({item['id'] for item in references}) != len(references):
        raise RuntimeError('deployment manifest current container IDs must be unique')
    # The shared maintenance lock excludes release.py, but repeat the journal
    # guard so a pre-existing recovery cannot be raced by an external writer.
    if os.path.lexists(str(deployment_journal)):
        raise RuntimeError('pending deployment journal blocks privacy maintenance')
    return references


def _writer_references(config):
    if 'deploymentManifest' in config:
        return _managed_writer_references(config)
    names = _writer_names(config, False)
    container_id = config.get('containerId')
    if not isinstance(container_id, str) or not re.match(r'^[0-9a-f]{64}$', container_id):
        raise RuntimeError('static deployment mode requires a pinned full containerId')
    references = [{'role': 'main', 'name': config['container'], 'id': container_id}]
    for named, companion in zip(names[1:], config['companionContainers']):
        companion_id = companion.get('id')
        if not isinstance(companion_id, str) or not re.match(r'^[0-9a-f]{64}$', companion_id):
            raise RuntimeError('each companion writer requires an exact name and pinned full container ID')
        references.append({'role': named['role'], 'name': named['name'], 'id': companion_id})
    if len({item['name'] for item in references}) != len(references) or len({item['id'] for item in references}) != len(references):
        raise RuntimeError('writer container names and IDs must be unique')
    return references


def _inspect_writer(reference):
    values = json.loads(run(['docker', 'inspect', reference['name']]))
    if len(values) != 1:
        raise RuntimeError('configured writer container is unavailable')
    meta = values[0]
    if meta.get('Id') != reference['id'] or meta.get('Name', '').lstrip('/') != reference['name']:
        raise RuntimeError('configured writer container ID or name changed')
    return meta


def _validate_writers(config, references):
    writers = []
    expected_image = references[0].get('image') if references else None
    if any(reference.get('image') != expected_image for reference in references):
        raise RuntimeError('writer references do not share one expected image')
    main_image = expected_image
    for reference in references:
        meta = _inspect_writer(reference)
        mounts = {mount.get('Destination'): mount for mount in meta.get('Mounts', [])}
        if mounts.get('/data', {}).get('Source') != config['dataDir']:
            raise RuntimeError('configured writer data mount differs from deployment')
        if reference['role'] == 'main':
            if expected_image is not None and meta.get('Image') != expected_image:
                raise RuntimeError('main writer image differs from the deployment manifest')
            main_image = meta.get('Image')
        elif meta.get('Image') != main_image:
            raise RuntimeError('companion writer image differs from the main application image')
        state = meta.get('State') or {}
        if not isinstance(state.get('Running'), bool):
            raise RuntimeError('configured writer running state is unavailable')
        writers.append({'role': reference['role'], 'name': reference['name'], 'id': reference['id'],
                        'image': meta.get('Image'), 'wasRunning': state['Running'], 'meta': meta})
    return writers


def _writer_plan(config, state, references=None):
    references = references or _writer_references(config)
    current = _validate_writers(config, references)
    journal = state / WRITER_JOURNAL
    if journal.exists():
        if journal.is_symlink() or not journal.is_file():
            raise RuntimeError('writer recovery journal is not a regular file')
        value = json.loads(journal.read_text())
        expected = [{key: writer[key] for key in ('role', 'name', 'id')} for writer in current]
        if (not isinstance(value, dict) or value.get('version') != 1 or
                not isinstance(value.get('writers'), list) or
                [{key: writer.get(key) for key in ('role', 'name', 'id')} for writer in value['writers']] != expected or
                any(not isinstance(writer.get('wasRunning'), bool) for writer in value['writers'])):
            raise RuntimeError('writer recovery journal does not match configured pinned containers')
        original = value['writers']
    else:
        original = [{key: writer[key] for key in ('role', 'name', 'id', 'wasRunning')} for writer in current]
        atomic_json(journal, {'version': 1, 'writers': original})
    by_id = {writer['id']: writer for writer in current}
    return journal, [{**writer, 'image': by_id[writer['id']]['image'],
                      'meta': by_id[writer['id']]['meta']} for writer in original]


def _stop_writers(writers, verify=True):
    errors = []
    # Companions can write the shared database and independent ledgers. Stop
    # them before the request-serving application, never by a name-only scan.
    ordered = [writer for writer in writers if writer['role'] == 'companion'] + [writer for writer in writers if writer['role'] == 'main']
    for writer in ordered:
        try:
            run(['docker', 'stop', '--time', '120', writer['id']])
        except Exception as error:
            errors.append(error)
    if verify:
        for writer in ordered:
            try:
                meta = _inspect_writer(writer)
                if (meta.get('State') or {}).get('Running'):
                    errors.append(RuntimeError('configured writer remained running'))
            except Exception as error:
                errors.append(error)
    if errors:
        raise RuntimeError('failed to stop every configured writer')


def _database_alert_state(database):
    database = Path(database).resolve()
    if not database.is_file() or database.is_symlink():
        raise RuntimeError('shared application database is unavailable for worker readiness')
    connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=5)
    try:
        rows = connection.execute(
            'select rowid, verified_at, fingerprint, heartbeat_at from safety_alert_state order by rowid').fetchall()
    finally:
        connection.close()
    if not rows:
        raise RuntimeError('worker readiness state is unavailable')
    return rows


def _wait_main_health(url, attempts=30):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                value = json.load(response)
            if response.status == 200 and value.get('ok') is True:
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError('main application readiness check failed')


def _wait_worker_heartbeat(database, baseline, attempts=30):
    for attempt in range(attempts):
        try:
            current = _database_alert_state(database)
            if (len(current) == len(baseline) and
                    [row[:3] for row in current] == [row[:3] for row in baseline] and
                    any(new[3] and new[3] != old[3] for old, new in zip(baseline, current))):
                return
        except (OSError, RuntimeError, sqlite3.Error):
            pass
        time.sleep(2)
    raise RuntimeError('companion writer heartbeat did not advance')


def _restore_writer_states(config, writers, database_name):
    main = next(writer for writer in writers if writer['role'] == 'main')
    companions = [writer for writer in writers if writer['role'] == 'companion']
    if main['wasRunning']:
        run(['docker', 'start', main['id']])
        _wait_main_health(config['healthUrl'])
    baseline = None
    running_companions = [writer for writer in companions if writer['wasRunning']]
    if running_companions:
        database = Path(config['dataDir']) / database_name
        baseline = _database_alert_state(database)
        for writer in running_companions:
            run(['docker', 'start', writer['id']])
        _wait_worker_heartbeat(database, baseline)
    current = _validate_writers(
        config, [{key: writer[key] for key in ('role', 'name', 'id', 'image')} for writer in writers])
    current_by_id = {writer['id']: writer for writer in current}
    if any(current_by_id[writer['id']]['wasRunning'] != writer['wasRunning'] for writer in writers):
        raise RuntimeError('writer container state was not restored exactly')
    if main['wasRunning']:
        _wait_main_health(config['healthUrl'], attempts=5)


def maintenance_result(output):
    encoded = output.encode('utf-8')
    if len(encoded) > MAX_MAINTENANCE_OUTPUT:
        raise RuntimeError('maintenance output exceeded bounded parser limit')
    matches = [line[len(RESULT_MARKER):] for line in output.splitlines()
               if line.startswith(RESULT_MARKER)]
    if len(matches) != 1 or len(matches[0].encode('utf-8')) > MAX_MAINTENANCE_RESULT:
        raise RuntimeError('maintenance result marker missing, repeated or oversized')
    try:
        value = json.loads(matches[0])
    except (TypeError, ValueError):
        raise RuntimeError('maintenance result marker is invalid')
    if not isinstance(value, dict):
        raise RuntimeError('maintenance result marker must contain an object')
    return value


def retention_compatibility(config, metadata, database):
    """Read-only gate for the image ABI and already-expanded live schema."""
    expected_image = config.get('retentionRuntimeImage')
    if (not isinstance(expected_image, str) or
            not re.match(r'^sha256:[0-9a-f]{64}$', expected_image)):
        raise RuntimeError('retentionRuntimeImage must pin one reviewed immutable image')
    if metadata.get('Image') != expected_image:
        raise RuntimeError('running image is not the reviewed retention-compatible image')
    labels = (metadata.get('Config') or {}).get('Labels') or {}
    if labels.get('cn.codeforpeople.service') != 'hello-agent':
        raise RuntimeError('running image is not a managed Hello Agent image')
    if labels.get('cn.codeforpeople.retention-runtime') != 'v1':
        raise RuntimeError('running image does not declare the reviewed retention runtime ABI')
    if not database.is_file() or database.is_symlink():
        raise RuntimeError('live SQLite database is unavailable for compatibility preflight')
    uri = 'file:' + quote(str(database), safe='/') + '?mode=ro'
    connection = sqlite3.connect(uri, uri=True)
    try:
        connection.execute('PRAGMA query_only = ON')
        columns = {row[1] for row in connection.execute(
            'PRAGMA table_info(safety_cases)').fetchall()}
        if not FINITE_RETENTION_COLUMNS.issubset(columns):
            raise RuntimeError('finite-retention SQLite columns are not installed')
        migration = connection.execute(
            'SELECT COUNT(*) FROM payload_migrations WHERE name = ?',
            (FINITE_RETENTION_MIGRATION,)).fetchone()
        if not migration or migration[0] != 1:
            raise RuntimeError('finite-retention migration identity is missing or ambiguous')
    except sqlite3.Error as error:
        raise RuntimeError('read-only finite-retention schema preflight failed') from error
    finally:
        connection.close()


def _retention_record(value):
    if not isinstance(value, dict) or set(value) != RETENTION_LEDGER_FIELDS:
        raise RuntimeError('safety retention ledger contains unknown fields')
    event = value.get('event')
    operation = value.get('operationId')
    case_id = value.get('caseId')
    valid_id = ((isinstance(case_id, int) and not isinstance(case_id, bool) and case_id > 0) or
                (isinstance(case_id, str) and re.match(r'^[1-9][0-9]*$', case_id)))
    if (value.get('version') != 1 or event not in ('purge', 'state_intent', 'state_commit') or not valid_id or
            not isinstance(value.get('receiptDigest'), str) or not re.match(r'^[0-9a-f]{64}$', value['receiptDigest']) or
            not isinstance(value.get('revision'), int) or value['revision'] < 0 or
            not isinstance(value.get('retentionReviewNeeded'), bool) or
            not isinstance(value.get('legalHold'), bool) or
            (event == 'purge') != (operation is None) or
            (event != 'purge' and (not isinstance(operation, str) or not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', operation)))):
        raise RuntimeError('safety retention ledger record is invalid')
    try:
        recorded = datetime.datetime.strptime(value['recordedAt'], '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=datetime.timezone.utc).timestamp()
        retain = None if value['retainUntil'] is None else datetime.datetime.strptime(value['retainUntil'], '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=datetime.timezone.utc).timestamp()
        if value['holdReviewAt'] is not None:
            datetime.datetime.strptime(value['holdReviewAt'], '%Y-%m-%dT%H:%M:%S.%fZ')
    except (AttributeError, TypeError, ValueError):
        raise RuntimeError('safety retention ledger date is invalid')
    return event, operation, recorded, retain


def compact_retention_ledger(file, now=None):
    """Retain the eight-day backup-defense window and unresolved/unexpired state.

    Call only after every managed seven-day backup root has been pruned
    successfully. Unknown records fail closed and leave the original untouched.
    """
    now = time.time() if now is None else now
    cutoff = now - RETENTION_DEFENSE_DAYS * 86400
    metadata = file.stat()
    mode = stat.S_IMODE(metadata.st_mode)
    if mode != 0o600:
        raise RuntimeError('safety retention ledger permissions must be 0600')
    records, parsed, size = [], [], 0
    with file.open('rb') as handle:
        for raw in handle:
            size += len(raw)
            if size > 32 * 1024 * 1024 or len(raw) > 4097 or not raw.endswith(b'\n'):
                raise RuntimeError('safety retention ledger is oversized or incomplete')
            try:
                value = json.loads(raw.decode('utf-8'))
            except (UnicodeDecodeError, ValueError):
                raise RuntimeError('safety retention ledger JSON is invalid')
            records.append(value)
            parsed.append(_retention_record(value))
    intents, keep, confirmed_pairs = {}, set(), []
    for index, ((event, operation, recorded, retain), value) in enumerate(zip(parsed, records)):
        if event == 'purge':
            if recorded >= cutoff:
                keep.add(index)
            continue
        if event == 'state_intent':
            if operation in intents:
                raise RuntimeError('duplicate safety retention state intent')
            intents[operation] = index
            continue
        intent_index = intents.pop(operation, None)
        if intent_index is None:
            raise RuntimeError('safety retention state confirmation has no intent')
        intent = dict(records[intent_index]); confirmation = dict(value)
        intent.pop('event'); confirmation.pop('event')
        intent.pop('recordedAt'); confirmation.pop('recordedAt')
        if intent != confirmation:
            raise RuntimeError('safety retention state confirmation mismatch')
        unexpired = (retain is not None and retain > now) or value['retentionReviewNeeded'] or value['legalHold']
        confirmed_pairs.append((intent_index, index, value['caseId'], unexpired,
                                recorded >= cutoff or parsed[intent_index][2] >= cutoff))
    latest_confirmed = {}
    for pair in confirmed_pairs:
        latest_confirmed[str(pair[2])] = pair
    for pair in confirmed_pairs:
        intent_index, confirmation_index, case_id, unexpired, in_window = pair
        # All records in the backup-defense window remain replayable. Beyond
        # it, only the latest still-live state for a case is needed; a later
        # release supersedes an older hold and lets that old pair expire.
        if in_window or (latest_confirmed[str(case_id)] is pair and unexpired):
            keep.update((intent_index, confirmation_index))
    keep.update(intents.values())  # unresolved means ambiguous; preserve so restore stays closed
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=str(file.parent), delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), mode)
            os.fchown(handle.fileno(), metadata.st_uid, metadata.st_gid)
            for index, value in enumerate(records):
                if index in keep:
                    handle.write(json.dumps(value, separators=(',', ':')) + '\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(file))
        directory = os.open(str(file.parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return {'before': len(records), 'after': len(keep), 'unresolved': len(intents)}


def operate(config, restore=None):
    state = Path(config['stateDir'])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (state / 'maintenance.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    status = {'ok': False, 'startedAt': datetime.datetime.utcnow().isoformat() + 'Z', 'stage': 'validate'}
    atomic_json(state / 'status.json', status)
    environment_file = None
    writer_journal = None
    writers = None
    try:
        references = _writer_references(config)
        initial_writers = _validate_writers(config, references)
        meta = next(writer['meta'] for writer in initial_writers if writer['role'] == 'main')
        # An interrupted run's pinned IDs and original states take precedence
        # over every new mutation, including backup pruning.
        if (state / WRITER_JOURNAL).exists():
            writer_journal, writers = _writer_plan(config, state, references)
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
        retention_ledger = Path(config['ledgerDir']) / 'safety-retention.ndjson'
        if env.get('HELLO_SAFETY_RETENTION_LEDGER', '/privacy-ledger/safety-retention.ndjson') != '/privacy-ledger/safety-retention.ndjson' or not retention_ledger.is_file() or retention_ledger.is_symlink():
            raise RuntimeError('independent safety retention ledger unavailable')
        days = int(env['HELLO_PRIVACY_BACKUP_DAYS'])
        if days != 7:
            raise RuntimeError('this deployment requires the approved seven-day backup policy')
        if config.get('safetyRetentionApply', False) not in (True, False):
            raise RuntimeError('safetyRetentionApply must be a boolean')
        # This must precede smoke cleanup, backup pruning, writer journaling and
        # service stops. It opens SQLite in mode=ro and identifies the exact
        # reviewed runtime image; it never initializes Payload or imports env.
        status['stage'] = 'retention-compatibility-preflight'
        retention_compatibility(
            config, meta,
            Path(config['dataDir']) / db[len('file:/data/'):])
        source = Path(config['sourceDir'])
        reviewed_sources = {
            'maintenance.ts': meta['Config']['WorkingDir'] + '/src/privacy/maintenance.ts',
            'privacy-maintenance.ts': meta['Config']['WorkingDir'] + '/scripts/privacy-maintenance.ts',
            'safety-retention.ts': meta['Config']['WorkingDir'] + '/src/operations/retention.ts',
            'safety-retention-ledger.ts': meta['Config']['WorkingDir'] + '/src/operations/retention-ledger.ts',
        }
        for name in reviewed_sources:
            file = source / name
            if not file.is_file() or file.is_symlink():
                raise RuntimeError('reviewed maintenance source is incomplete')
        backups = Path(config['backupDir'])
        if not backups.is_dir() or backups.is_symlink():
            raise RuntimeError('backup directory must be prepared first')
        # Configuration may include legacy deployment snapshots; never the live data directory.
        roots = [backups] + [Path(value) for value in config.get('legacyBackupDirs', [])]
        for root in roots:
            if not root.is_dir() or root.is_symlink() or root.resolve() == Path(config['dataDir']).resolve() or root.resolve() in Path(config['dataDir']).resolve().parents:
                raise RuntimeError('invalid backup root')
        # Recover disposable smoke containers before scanning copied databases,
        # including WAL/SHM and ledger copies. Failure blocks guard retirement.
        if config.get('smokeCleanupScript'):
            status['stage'] = 'recover-smoke-snapshots'
            run(['python3', config['smokeCleanupScript'], '--cleanup'])
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
        for mount_source, target, mode in [(config['dataDir'], '/data', 'rw'), (config['ledgerDir'], '/privacy-ledger', 'rw'), (config['backupDir'], '/privacy-backups', 'rw'), (config['sourceDir'], '/privacy-ops', 'ro')]:
            common += ['-v', mount_source + ':' + target + ':' + mode]
        # These reviewed entrypoints may only overlay the explicitly pinned
        # compatible runtime above; copying four files cannot upgrade an old
        # image that lacks transaction.ts or the finite schema.
        for name, target in reviewed_sources.items():
            common += ['-v', str(source / name) + ':' + target + ':ro']
        common += ['--entrypoint', 'node', meta['Image']]
        if writer_journal is None:
            writer_journal, writers = _writer_plan(config, state, references)
        status['stage'] = 'stop-traffic'
        _stop_writers(writers)
        status['writersStopped'] = [writer['name'] for writer in writers]
        # Compaction is safe only after every pinned database/ledger writer is
        # proven stopped and every managed seven-day backup root was pruned.
        status['stage'] = 'compact-retention-ledger'
        status['retentionLedger'] = compact_retention_ledger(retention_ledger)
        # From here any failure leaves all managed writers stopped. The durable
        # original-state journal lets an hourly retry recover exact prior state.
        stamp = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%S%fZ')
        status['stage'] = 'backup'
        run(common + ['/privacy-ops/privacy-snapshot.mjs', 'backup', db[5:], '/privacy-backups/' + stamp + '.db'])
        pending_restore = state / 'restore-pending.json'
        if selected:
            atomic_json(pending_restore, {'pending': True})
            status['stage'] = 'restore'
            run(common + ['/privacy-ops/privacy-snapshot.mjs', 'restore', '/privacy-backups/' + selected.name, db[5:]])
        status['stage'] = 'delete-expired-and-replay-ledger'
        maintenance_args = common + ['--import', 'tsx', 'scripts/privacy-maintenance.ts', '--apply']
        if config.get('safetyRetentionApply', False):
            maintenance_args.append('--apply-safety-retention')
        if pending_restore.exists():
            maintenance_args.append('--restore')
        maintenance = maintenance_result(run(maintenance_args))
        safety = maintenance.get('safetyRetention')
        allowed_counts = ('dryRun', 'eligible', 'expiredExisting', 'legacyNullExpiry',
                          'overdueHolds', 'holdsMissingReviewDate', 'reviewNeeded',
                          'reviewDueSoon', 'releasedReferenceSweeps',
                          'activeRestrictionReferences', 'activeRestrictionReviewsOverdue')
        if not isinstance(safety, dict) or any(key not in safety for key in allowed_counts):
            raise RuntimeError('finite evidence maintenance did not return required counts')
        status['safetyRetention'] = {key: safety[key] for key in allowed_counts}
        status['stage'] = 'retire-deletion-guards'
        run(common + ['/privacy-ops/privacy-snapshot.mjs', 'retire', db[5:], '/privacy-ledger/deletions.ndjson'])
        status['stage'] = 'restore-writers-and-readiness'
        _restore_writer_states(config, writers, db[len('file:/data/'):])
        if pending_restore.exists():
            pending_restore.unlink()
        unlink_durable(writer_journal)
        writer_journal = None
        status.update(ok=True, stage='complete', backup=stamp + '.db', completedAt=datetime.datetime.utcnow().isoformat() + 'Z')
    except BaseException:
        if writer_journal is not None and writers is not None:
            try:
                _stop_writers(writers)
                status['failureClosed'] = True
            except Exception:
                status['failureClosed'] = False
        raise
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
