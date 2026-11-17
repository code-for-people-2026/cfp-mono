#!/usr/bin/env python3
"""Guarded, A2A-only additive database expansion before a normal release."""

import argparse
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import time

import release
import retention as r
import verify_runtime


MIGRATION_NAME = '20261113_120000_a2a_execution'
JOURNAL_NAME = 'deployment-journal.json'
PROCEDURE_NAME = 'a2a-pre-expansion-v1'
LOCK_PATH = '/var/lock/cfp-hello-agent-deploy.lock'
MINIMUM_FREE_DISK = 2 * 1024 ** 3
TASKS_TABLE = 'a2a_execution_tasks'
LEDGERS_TABLE = 'a2a_request_ledgers'

TASK_COLUMNS = ('owner', 'tenant', 'agent_id', 'task_id', 'context_id', 'state',
                'status_timestamp', 'updated_at', 'created_at')
LEDGER_COLUMNS = ('owner', 'tenant', 'agent_id', 'task_id', 'context_id',
                  'updated_at', 'created_at')

TASKS_SQL = """CREATE TABLE IF NOT EXISTS a2a_execution_tasks (
    id integer PRIMARY KEY NOT NULL,
    owner text NOT NULL,
    tenant text NOT NULL,
    agent_id text NOT NULL,
    key text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    state numeric NOT NULL,
    status_timestamp text,
    revision numeric NOT NULL,
    snapshot text NOT NULL,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )"""
LEDGERS_SQL = """CREATE TABLE IF NOT EXISTS a2a_request_ledgers (
    id integer PRIMARY KEY NOT NULL,
    owner text NOT NULL,
    tenant text NOT NULL,
    agent_id text NOT NULL,
    key text NOT NULL,
    request_identity text NOT NULL,
    fingerprint text NOT NULL,
    status text NOT NULL,
    task_id text,
    context_id text,
    revision numeric NOT NULL,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )"""


def _index(table, column, unique=False):
    verb = 'CREATE UNIQUE INDEX' if unique else 'CREATE INDEX'
    return verb + ' IF NOT EXISTS %s_%s_idx ON %s(%s)' % (table, column, table, column)


EXPECTED_SCHEMA = {
    TASKS_TABLE: ('table', TASKS_SQL),
    LEDGERS_TABLE: ('table', LEDGERS_SQL),
    TASKS_TABLE + '_key_idx': ('index', _index(TASKS_TABLE, 'key', True)),
    LEDGERS_TABLE + '_key_idx': ('index', _index(LEDGERS_TABLE, 'key', True)),
}
for _column in TASK_COLUMNS:
    EXPECTED_SCHEMA[TASKS_TABLE + '_' + _column + '_idx'] = (
        'index', _index(TASKS_TABLE, _column))
for _column in LEDGER_COLUMNS:
    EXPECTED_SCHEMA[LEDGERS_TABLE + '_' + _column + '_idx'] = (
        'index', _index(LEDGERS_TABLE, _column))


def _canonical_expected_schema():
    """Canonicalize reviewed DDL through SQLite without executing it live."""
    db = sqlite3.connect(':memory:')
    try:
        db.executescript(';\n'.join(sql for _, sql in EXPECTED_SCHEMA.values()))
        return {
            row[0]: (row[1], normalize_sql(row[2]))
            for row in db.execute(
                'select name,type,sql from sqlite_master order by name,type')
        }
    finally:
        db.close()


MIGRATION_SCRIPT = """
const expected = %r;
const { cms } = await import('./src/cms/client');
const { migrations } = await import('./src/cms/migrations');
let payload;
try {
  payload = await cms();
  const selected = migrations.filter((migration) => migration.name === expected);
  if (selected.length !== 1) throw new Error('A2A migration is not uniquely bundled');
  await payload.db.migrate({ migrations: [selected[0]] });
} finally {
  if (payload) await payload.destroy();
}
console.log(JSON.stringify({ engine: 'payload-getPayload-prodMigrations', migration: expected }));
""".strip() % MIGRATION_NAME


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(30)
        self.sock.connect('/var/run/docker.sock')


def fsync_directory(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_durable(path, value):
    r.save(path, value)
    fsync_directory(path.parent)


def write_journal(path, value, overwrite=False):
    if path.exists() and not overwrite:
        raise RuntimeError('Deployment journal already exists; refusing to overwrite it')
    save_durable(path, value)


def read_journal(path):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        raise RuntimeError('Invalid or unreadable deployment journal')
    if not isinstance(value, dict) or value.get('procedure') != PROCEDURE_NAME:
        raise RuntimeError('Deployment journal belongs to another procedure')
    if value.get('schemaVersion') != 1 or value.get('migration') != MIGRATION_NAME:
        raise RuntimeError('Migration journal metadata is invalid')
    return value


def mark_phase(path, phase, extra=None):
    journal = read_journal(path)
    journal['phase'] = phase
    journal['phaseAt'] = time.time()
    if extra:
        journal.update(extra)
    save_durable(path, journal)
    return journal


def record_failure(path, phase, error):
    try:
        journal = json.loads(path.read_text()) if path.exists() else {}
        failures = journal.get('failures') if isinstance(journal.get('failures'), list) else []
        failures.append({'phase': phase,
                         'error': '%s: %s' % (type(error).__name__, error)})
        journal['phase'] = 'failed:' + phase
        journal['failures'] = failures
        save_durable(path, journal)
    except BaseException as journal_error:
        # Never replace the original actionable failure with a journaling error.
        print('migration failure was not journaled: %s' % journal_error)


def ensure_free_disk(root):
    """Use the official release floor before any copy or service stop."""
    if shutil.disk_usage(root).free < MINIMUM_FREE_DISK:
        raise RuntimeError('Less than 2 GiB free; running services were not stopped')


def candidate_metadata(release_name):
    if not re.fullmatch(r'preview-[a-zA-Z0-9_-]+', release_name):
        raise RuntimeError('Invalid release name')
    metadata = json.loads(r.docker('image', 'inspect', 'cfp-hello-agent:' + release_name))[0]
    labels = metadata.get('Config', {}).get('Labels') or {}
    if labels.get('cn.codeforpeople.release') != release_name:
        raise RuntimeError('Candidate image label does not match its official release tag')
    if labels.get('cn.codeforpeople.service') != 'hello-agent':
        raise RuntimeError('Candidate image is not from the managed service build')
    if metadata.get('Size', 0) >= 1900000000:
        raise RuntimeError('Candidate image exceeds the runtime size budget')
    if not metadata.get('Id'):
        raise RuntimeError('Candidate image has no immutable ID')
    return metadata


def env_map(config):
    return dict(item.split('=', 1) for item in config.get('Config', {}).get('Env', [])
                if '=' in item)


def database_relative_path(config):
    value = env_map(config).get('HELLO_DATABASE_URI', '')
    match = re.fullmatch(r'file:/data/([A-Za-z0-9_.-]+)', value)
    if not match or not match.group(1).endswith(('.db', '.sqlite', '.sqlite3')):
        raise RuntimeError('Production database URI is not a supported /data SQLite path')
    return match.group(1)


def data_mount(config):
    mounts = [mount for mount in config.get('Mounts', [])
              if mount.get('Type') == 'bind' and mount.get('Destination') == '/data']
    if len(mounts) != 1 or not mounts[0].get('Source', '').startswith('/opt/cfp-hello-agent/'):
        raise RuntimeError('Expected one managed live /data bind mount')
    return Path(mounts[0]['Source'])


def migration_environment(config, database_uri):
    environment = list(config.get('Config', {}).get('Env', []))

    def replace(key, value):
        found = False
        result = []
        for item in environment:
            if item.split('=', 1)[0] == key:
                if found:
                    raise RuntimeError('Duplicate environment key in live config')
                found = True
                result.append(key + '=' + value)
            else:
                result.append(item)
        if not found:
            result.append(key + '=' + value)
        return result

    environment = replace('NODE_ENV', 'production')
    environment = replace('HELLO_DEPLOYED', 'true')
    environment = replace('PAYLOAD_DROP_DATABASE', 'false')
    environment = replace('HELLO_DATABASE_URI', database_uri)
    return environment


def migration_container_config(metadata, config, name, source, database_uri):
    image_id = metadata['Id']
    working_dir = (metadata.get('Config') or {}).get('WorkingDir')
    if working_dir not in verify_runtime.ALLOWED_WORKING_DIRS:
        raise RuntimeError('Unsupported candidate image WorkingDir')
    return {
        'Image': image_id,
        'User': config.get('Config', {}).get('User') or 'node',
        'WorkingDir': working_dir,
        'Env': migration_environment(config, database_uri),
        'Entrypoint': ['node'],
        'Cmd': ['--import', 'tsx', '--input-type=module', '-e', MIGRATION_SCRIPT],
        'Labels': {
            'cn.codeforpeople.service': 'hello-agent',
            'cn.codeforpeople.release': metadata['Config']['Labels']['cn.codeforpeople.release'],
            'cn.codeforpeople.a2a-migration': MIGRATION_NAME,
        },
        'HostConfig': {
            'NetworkMode': 'none',
            'PortBindings': {},
            'Binds': [str(source) + ':/data'],
            'Mounts': [],
            'RestartPolicy': {'Name': 'no'},
            'VolumesFrom': None,
            'Links': None,
            'Privileged': False,
        },
        'Tty': False,
        'OpenStdin': False,
    }


def create_container(name, config):
    connection = UnixHTTP('localhost')
    try:
        connection.request('POST', '/containers/create?name=' + name,
                           json.dumps(config), {'Content-Type': 'application/json'})
        response = connection.getresponse()
        body = response.read()
        if response.status != 201:
            raise RuntimeError('Migration container creation failed: HTTP ' +
                               str(response.status))
        return json.loads(body)['Id']
    finally:
        connection.close()


def run_container(name, config, register, journal=None, phase=None):
    """Journal a named one-shot helper before creation, then wait for it."""
    planned = phase if journal is not None else None
    register(name, config['Image'], [config['HostConfig']['Binds'][0]], planned)
    if journal is not None:
        current = read_journal(journal)
        resource = current.setdefault('liveResources', {}).get(name)
        if (not isinstance(resource, dict) or
                resource.get('name', name) != name or
                resource.get('image') != config['Image'] or
                resource.get('bind') != config['HostConfig']['Binds'][0] or
                current.get('plannedLiveContainer') != name):
            raise RuntimeError('Live helper journal changed unexpectedly')
    container_id = create_container(name, config)
    if journal is not None:
        current = read_journal(journal)
        resources = current.setdefault('liveResources', {})
        resource = resources.get(name)
        if (not isinstance(resource, dict) or
                resource.get('name', name) != name or
                resource.get('image') != config['Image'] or
                resource.get('bind') != config['HostConfig']['Binds'][0]):
            raise RuntimeError('Live helper journal changed unexpectedly')
        resource['id'] = container_id
        save_durable(journal, current)
    r.docker('start', container_id)
    status = r.docker('wait', container_id)
    if status != '0':
        raise RuntimeError('Candidate Payload migration helper exited with status ' +
                           status)
    if journal is not None:
        remove_finished_live_helper(journal)
    else:
        remove_verified_helper(name, config['Image'],
                               config['HostConfig']['Binds'][0], container_id)


def normalize_sql(sql):
    """Normalize DDL headers and whitespace without editing SQL literal content."""
    if not isinstance(sql, str) or not sql.strip():
        raise RuntimeError('Invalid SQLite schema SQL')
    value = sql.lstrip()
    header = re.match(
        r'(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+)IF\s+NOT\s+EXISTS\s+',
        value, re.I)
    if header:
        value = header.group(1) + value[header.end():]
    output = []
    index = 0
    length = len(value)
    pending_space = False
    while index < length:
        char = value[index]
        if char.isspace():
            pending_space = bool(output)
            index += 1
            continue
        if pending_space:
            output.append(' ')
            pending_space = False
        if char in ('\'', '"', '`'):
            quote = char
            output.append(char)
            index += 1
            while index < length:
                output.append(value[index])
                if value[index] == quote:
                    if index + 1 < length and value[index + 1] == quote:
                        output.append(value[index + 1])
                        index += 2
                        continue
                    index += 1
                    break
                index += 1
            else:
                raise RuntimeError('Unterminated quote in SQLite schema SQL')
            continue
        if char == '[':
            output.append(char)
            index += 1
            while index < length:
                output.append(value[index])
                if value[index] == ']':
                    index += 1
                    break
                index += 1
            else:
                raise RuntimeError('Unterminated identifier in SQLite schema SQL')
            continue
        if value.startswith('--', index):
            output.append(' ')
            end = value.find('\n', index + 2)
            if end < 0:
                break
            index = end + 1
            pending_space = True
            continue
        if value.startswith('/*', index):
            output.append(' ')
            end = value.find('*/', index + 2)
            if end < 0:
                raise RuntimeError('Unterminated comment in SQLite schema SQL')
            index = end + 2
            pending_space = True
            continue
        output.append(char)
        index += 1
    result = ''.join(output).strip()
    if result.endswith(';'):
        result = result[:-1].rstrip()
    return result


EXPECTED_SCHEMA = _canonical_expected_schema()


def _encoded_value(value):
    if value is None:
        return ['null', '']
    if isinstance(value, bool):
        return ['bool', '1' if value else '0']
    if isinstance(value, int):
        return ['int', str(value)]
    if isinstance(value, float):
        return ['float', repr(value)]
    if isinstance(value, bytes):
        return ['bytes', value.hex()]
    if isinstance(value, str):
        return ['text', value]
    raise RuntimeError('Unsupported SQLite value type: ' + type(value).__name__)


def _digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _row_hash(column_names, row):
    if len(column_names) != len(row):
        raise RuntimeError('SQLite row does not match table metadata')
    encoded = json.dumps([_encoded_value(value) for value in row],
                         ensure_ascii=True, separators=(',', ':'))
    return _digest(json.dumps([list(column_names), json.loads(encoded)],
                              ensure_ascii=True, separators=(',', ':')))


def _schema_map(snapshot):
    result = {}
    for row in snapshot['schema']:
        if row[0] in result:
            raise RuntimeError('Duplicate SQLite schema object')
        sql = None if row[2] is None else normalize_sql(row[2])
        result[row[0]] = (row[1], sql)
    return result


def _migration_record(snapshot):
    columns = snapshot['columns'].get('payload_migrations')
    rows = snapshot['rows'].get('payload_migrations')
    if not columns or rows is None:
        raise RuntimeError('payload_migrations table is unavailable')
    names = [column[1] for column in columns]
    required = ('id', 'name', 'batch', 'updated_at', 'created_at')
    if any(name not in names for name in required):
        raise RuntimeError('payload_migrations columns are unexpected')
    return names, [dict(zip(names, row)) for row in rows]


def _migration_metadata(snapshot):
    names, records = _migration_record(snapshot)
    batches = [_number(record['batch']) for record in records]
    return {'count': len(records), 'latestBatch': max(batches or [0]),
            'rowHashes': list(snapshot['evidence']['tables']['payload_migrations']
                                                   ['rowHashes'])}


def database_snapshot(path):
    """Keep a full snapshot only in memory for exact stopped-state validation."""
    path = Path(path)
    if not path.is_file():
        raise RuntimeError('Database file is missing')
    db = sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True, timeout=10)
    try:
        db.execute('begin')
        if db.execute('pragma quick_check').fetchall() != [('ok',)]:
            raise RuntimeError('Database quick_check failed')
        foreign_keys = [tuple(row) for row in
                        db.execute('pragma foreign_key_check').fetchall()]
        schema = [tuple(row) for row in db.execute(
            'select name,type,sql from sqlite_master order by name,type').fetchall()]
        rows, columns = {}, {}
        names = [row[0] for row in schema
                 if row[1] == 'table' and not row[0].startswith('sqlite_')]
        for name in names:
            if not re.fullmatch(r'[A-Za-z0-9_]+', name):
                raise RuntimeError('Unsafe internal table name')
            info = [tuple(row) for row in
                    db.execute('pragma table_info("%s")' % name).fetchall()]
            if not info:
                raise RuntimeError('Table metadata is unavailable')
            columns[name] = info
            names_for_rows = [column[1] for column in info]
            order_by = ' order by id' if name == 'payload_migrations' else ''
            rows[name] = [tuple(row) for row in
                          db.execute('select * from "%s"%s' %
                                     (name, order_by)).fetchall()]
            for row in rows[name]:
                _row_hash(names_for_rows, row)
        snapshot = {'database': str(path), 'integrity': [('ok',)],
                    'foreignKeys': foreign_keys, 'schema': schema,
                    'columns': columns, 'rows': rows}
        snapshot['evidence'] = safe_database_evidence(snapshot)
        snapshot['evidence']['migration'] = _migration_metadata(snapshot)
        return snapshot
    finally:
        db.close()


def safe_database_evidence(snapshot):
    """Return only hashes, counts and migration metadata for durable evidence."""
    tables = {}
    schema_map = _schema_map(snapshot)
    schema_objects = {}
    for name, (kind, sql) in schema_map.items():
        schema_objects[name] = _digest(json.dumps(
            [name, kind, sql], separators=(',', ':')))
    for name in sorted(snapshot['columns']):
        columns = snapshot['columns'][name]
        rows = snapshot['rows'][name]
        column_names = [column[1] for column in columns]
        hashes = sorted(_row_hash(column_names, row) for row in rows)
        kind, sql = schema_map[name]
        tables[name] = {
            'rowCount': len(rows),
            'rowHashes': hashes,
            'schemaSha256': schema_objects[name],
            'columnsSha256': _digest(json.dumps(
                [list(column) for column in columns], separators=(',', ':'))),
        }
    return {
        'schemaVersion': 1,
        'database': snapshot.get('database'),
        'integrityOk': True,
        'foreignKeyCount': len(snapshot.get('foreignKeys', [])),
        'migration': snapshot.get('evidence', {}).get(
            'migration', {'count': 0, 'latestBatch': 0, 'rowHashes': []}),
        'tables': tables,
        'schemaObjects': schema_objects,
    }


def load_safe_evidence(path):
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        raise RuntimeError('Invalid durable database evidence')
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise RuntimeError('Unsupported durable database evidence')
    tables = value.get('tables')
    migration = value.get('migration')
    schema_objects = value.get('schemaObjects')
    if (not isinstance(tables, dict) or not isinstance(migration, dict) or
            not isinstance(schema_objects, dict)):
        raise RuntimeError('Durable database evidence is incomplete')
    for name, evidence in tables.items():
        if (not re.fullmatch(r'[0-9A-Za-z_]+', name) or
                not isinstance(evidence, dict) or
                not isinstance(evidence.get('rowCount'), int) or
                evidence['rowCount'] < 0 or
                not isinstance(evidence.get('rowHashes'), list) or
                len(evidence['rowHashes']) != evidence['rowCount'] or
                not isinstance(evidence.get('schemaSha256'), str) or
                not isinstance(evidence.get('columnsSha256'), str)):
            raise RuntimeError('Durable database table evidence is invalid')
        for digest in evidence['rowHashes']:
            if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
                raise RuntimeError('Durable database row hash is invalid')
    for name, digest in schema_objects.items():
        if (not re.fullmatch(r'[0-9A-Za-z_]+', name) or
                not isinstance(digest, str) or
                not re.fullmatch(r'[0-9a-f]{64}', digest)):
            raise RuntimeError('Durable database schema evidence is invalid')
    if (not isinstance(migration.get('count'), int) or migration['count'] < 0 or
            not isinstance(migration.get('latestBatch'), int) or
            not isinstance(migration.get('rowHashes'), list) or
            len(migration['rowHashes']) != migration['count']):
        raise RuntimeError('Durable migration metadata is invalid')
    return value


def snapshot_from_json(path):
    """Load safe evidence; deliberately never reconstruct raw database rows."""
    return load_safe_evidence(path)


def validate_integrity(snapshot):
    integrity = [tuple(row) for row in snapshot.get('integrity', [])]
    if integrity != [('ok',)]:
        raise RuntimeError('Database integrity check failed')
    if [tuple(row) for row in snapshot.get('foreignKeys', [])]:
        raise RuntimeError('Database foreign_key_check failed')
    return True


def _require_evidence(value):
    if (not isinstance(value, dict) or not isinstance(value.get('tables'), dict) or
            not isinstance(value.get('schemaObjects'), dict)):
        raise RuntimeError('Database evidence is unavailable')


def validate_unchanged(before, after):
    """Require exact schema and row-hash equality while the original pair is stopped."""
    validate_integrity(after)
    _require_evidence(before)
    if not before.get('integrityOk') or before.get('foreignKeyCount') != 0:
        raise RuntimeError('Database baseline integrity evidence failed')
    after_evidence = after['evidence'] if 'rows' in after else after
    _require_evidence(after_evidence)
    if (before['schemaObjects'].keys() !=
            after_evidence['schemaObjects'].keys()):
        raise RuntimeError('Database schema objects changed unexpectedly')
    for name, digest in before['schemaObjects'].items():
        if after_evidence['schemaObjects'][name] != digest:
            raise RuntimeError('Database schema changed unexpectedly in ' + name)
    if before['tables'].keys() != after_evidence['tables'].keys():
        raise RuntimeError('Database tables changed unexpectedly')
    for name in before['tables']:
        if before['tables'][name] != after_evidence['tables'][name]:
            raise RuntimeError('Database schema or rows changed unexpectedly in ' + name)
    return True


def _number(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise RuntimeError('Payload migration batch is not numeric')


def _validate_expected_schema(snapshot):
    schema = _schema_map(snapshot)
    for name, expected in EXPECTED_SCHEMA.items():
        if name not in schema:
            raise RuntimeError('A2A schema object is missing: ' + name)
        if schema[name] != (expected[0], normalize_sql(expected[1])):
            raise RuntimeError('A2A schema differs from the reviewed migration: ' + name)
    return schema


def validate_delta(before, after):
    """Accept only the reviewed A2A objects and one Payload migration append."""
    validate_integrity(after)
    before_evidence = before['evidence'] if 'rows' in before else before
    _require_evidence(before_evidence)
    if not before_evidence.get('integrityOk') or before_evidence.get(
            'foreignKeyCount') != 0:
        raise RuntimeError('Database baseline integrity evidence failed')
    after_schema = _schema_map(after)
    expected_names = set(EXPECTED_SCHEMA)
    old_names = set(before_evidence['schemaObjects'])
    if set(after_schema) != old_names | expected_names:
        raise RuntimeError('Forbidden schema delta')
    _validate_expected_schema(after)
    for name in old_names:
        if name in expected_names:
            raise RuntimeError('A2A tables already exist before migration')
        if (after['evidence']['schemaObjects'][name] !=
                before_evidence['schemaObjects'][name]):
            raise RuntimeError('Forbidden schema delta: ' + name)
        if name not in after['evidence']['tables']:
            continue
        if name == 'payload_migrations':
            old_table = before_evidence['tables'][name]
            new_table = after['evidence']['tables'][name]
            if (old_table['schemaSha256'] != new_table['schemaSha256'] or
                    old_table['columnsSha256'] != new_table['columnsSha256']):
                raise RuntimeError('payload_migrations schema changed')
            continue
        if after['evidence']['tables'][name] != before_evidence['tables'][name]:
            raise RuntimeError('Existing schema or data changed in ' + name)

    names, records = _migration_record(after)
    old_migration = before_evidence['migration']
    if len(records) != old_migration['count'] + 1:
        raise RuntimeError('Payload migration journal delta is not exact')
    record = records[-1]
    if record.get('name') != MIGRATION_NAME:
        raise RuntimeError('Payload migration journal delta is not exact')
    if (_number(record.get('batch')) != old_migration['latestBatch'] + 1 or
            not isinstance(record.get('id'), int) or
            not record.get('updated_at') or not record.get('created_at')):
        raise RuntimeError('Payload migration record is invalid')
    payload_columns = [column[1] for column in after['columns']['payload_migrations']]
    record_hash = _row_hash(payload_columns, after['rows']['payload_migrations'][-1])
    remaining = list(after['evidence']['tables']['payload_migrations']['rowHashes'])
    if record_hash not in remaining:
        raise RuntimeError('Payload migration record evidence is inconsistent')
    remaining.remove(record_hash)
    if remaining != old_migration['rowHashes']:
        raise RuntimeError('An existing payload_migrations row changed')

    for table in (TASKS_TABLE, LEDGERS_TABLE):
        if after['evidence']['tables'][table]['rowCount'] != 0:
            raise RuntimeError('New A2A table contains unexpected rows')
    return {
        'migrationRecord': {name: record[name] for name in names
                            if name in ('id', 'name', 'batch')},
        'previousMigrationCount': old_migration['count'],
        'newTables': sorted((TASKS_TABLE, LEDGERS_TABLE)),
        'newIndexes': sorted(expected_names - {TASKS_TABLE, LEDGERS_TABLE}),
    }


def validate_post_restart(baseline, current, expanded):
    """Check integrity/schema/migration invariants, never all business rows."""
    validate_integrity(current)
    _require_evidence(baseline)
    current_schema = _schema_map(current)
    expected = set(EXPECTED_SCHEMA) if expanded else set()
    if set(current_schema) != set(baseline['schemaObjects']) | expected:
        raise RuntimeError('Database schema set changed after restart')
    if expanded:
        _validate_expected_schema(current)
    for name, digest in baseline['schemaObjects'].items():
        if current['evidence']['schemaObjects'][name] != digest:
            raise RuntimeError('Database schema changed after restart in ' + name)
    if expanded:
        _, records = _migration_record(current)
        if (len(records) != baseline['migration']['count'] + 1 or
                records[-1].get('name') != MIGRATION_NAME or
                _number(records[-1].get('batch')) !=
                baseline['migration']['latestBatch'] + 1):
            raise RuntimeError('Payload migration metadata changed after restart')
    return True


def create_verified_backup(configs, destination, stopped_baseline):
    """Use the official archive, then remove its non-managed raw JSON sidecar."""
    release.backup(configs, destination, stopped_baseline)
    raw_state = destination / 'database-state.json'
    if raw_state.exists():
        raw_state.unlink()
        fsync_directory(destination)
    if not (destination / 'data.tar.gz').is_file():
        raise RuntimeError('Managed database archive is missing')


def register_live_resource(journal_path, name, image, binds, phase):
    """Persist helper ownership and planned phase in one durable journal write."""
    current = read_journal(journal_path)
    resources = current.setdefault('liveResources', {})
    resources[name] = {'name': name, 'image': image,
                       'bind': binds[0], 'mountDeletion': False}
    current['plannedLiveContainer'] = name
    current['phase'] = phase
    current['phaseAt'] = time.time()
    save_durable(journal_path, current)


def preflight(configs, metadata, destination):
    app = configs[0]
    source = data_mount(app)
    relative = database_relative_path(app)
    verify_runtime.recover(r.ROOT / 'smoke')
    token = r.stamp()
    root = r.ROOT / 'smoke' / token
    root.mkdir(parents=True, mode=0o700)
    name = 'cfp-hello-agent-smoke-' + token.lower() + '-snapshot-run'
    try:
        target = root / 'mount-0'
        schemas = verify_runtime.copy_mount(source, target, '/data', metadata['Id'])
        if len(schemas) != 1:
            raise RuntimeError('Expected exactly one application database snapshot')
        copied = next(iter(schemas))
        expected_copy = target / relative
        if copied != str(expected_copy):
            raise RuntimeError('Snapshot database path differs from production URI')
        before = database_snapshot(expected_copy)
        config = migration_container_config(
            metadata, app, name, target, 'file:/data/' + relative)
        mounts = [{'Source': str(target), 'Destination': '/data', 'RW': True}]
        run_container(name, config,
                      lambda helper, image, binds, planned=None:
                      verify_runtime.register_resource(root, helper, image, mounts))
        after = database_snapshot(expected_copy)
        result = validate_delta(before['evidence'], after)
        save_durable(destination / 'preflight.json', {
            'image': metadata['Id'],
            'release': metadata['Config']['Labels']['cn.codeforpeople.release'],
            'network': 'none', 'consistentSnapshot': True, 'delta': result})
        return result
    finally:
        verify_runtime.recover(r.ROOT / 'smoke')


def running_container(container_id):
    try:
        value = json.loads(r.docker('container', 'inspect', container_id))[0]
        return value['State']['Status']
    except RuntimeError:
        return 'unknown'


def _protected_container_ids(journal):
    state = journal.get('previousState')
    if not isinstance(state, dict):
        raise RuntimeError('Migration journal has invalid protected state')
    protected = set()
    for role in ('current', 'rollback'):
        version = state.get(role)
        if not isinstance(version, dict):
            raise RuntimeError('Migration journal has invalid protected state')
        references = version.get('containers')
        if not isinstance(references, list):
            raise RuntimeError('Migration journal has invalid protected state')
        for reference in references:
            if not isinstance(reference, dict) or not reference.get('id'):
                raise RuntimeError('Migration journal has invalid protected state')
            protected.add(reference['id'])
    return protected


def _inventory_maps(containers):
    if not isinstance(containers, list):
        raise RuntimeError('Docker returned an invalid full inventory')
    by_id = {}
    by_name = {}
    for container in containers:
        if not isinstance(container, dict) or not container.get('Id'):
            raise RuntimeError('Docker returned an invalid full inventory')
        container_id = container['Id']
        name = container.get('Name')
        if not isinstance(name, str) or not name.startswith('/'):
            raise RuntimeError('Docker returned an invalid container name')
        name = name[1:]
        if container_id in by_id or name in by_name:
            raise RuntimeError('Docker full inventory has duplicate containers')
        by_id[container_id] = container
        by_name[name] = container
    return by_id, by_name


def _helper_resource_identity(name, resource):
    if (not isinstance(name, str) or not name or not isinstance(resource, dict) or
            resource.get('name', name) != name or
            not isinstance(resource.get('image'), str) or not resource['image'] or
            not isinstance(resource.get('bind'), str) or not resource['bind']):
        raise RuntimeError('Live migration helper journal metadata is invalid')
    source, separator, destination = resource['bind'].rpartition(':')
    if not separator or not source.startswith('/') or destination != '/data':
        raise RuntimeError('Live migration helper has an unexpected /data bind')


def _verify_helper_container(container, name, resource, protected_ids):
    container_id = container['Id']
    if container_id in protected_ids:
        raise RuntimeError('Live migration helper refers to a protected container')
    if container.get('Name') != '/' + name:
        raise RuntimeError('Live migration helper name does not match its journal')
    if container.get('Image') != resource['image']:
        raise RuntimeError('Live migration helper image does not match its journal')

    labels = (container.get('Config') or {}).get('Labels') or {}
    if labels.get('cn.codeforpeople.a2a-migration') != MIGRATION_NAME:
        raise RuntimeError('Live migration helper has an unexpected migration label')

    mounts = container.get('Mounts')
    expected_source = resource['bind'].rsplit(':', 1)[0]
    if (not isinstance(mounts, list) or len(mounts) != 1 or
            mounts[0].get('Type') != 'bind' or
            mounts[0].get('Source') != expected_source or
            mounts[0].get('Destination') != '/data' or
            mounts[0].get('RW') is not True):
        raise RuntimeError('Live migration helper has an unexpected mount')
    host_config = container.get('HostConfig') or {}
    if host_config.get('Binds') != [resource['bind']]:
        raise RuntimeError('Live migration helper has an unexpected bind')
    if host_config.get('NetworkMode') != 'none':
        raise RuntimeError('Live migration helper is not network-isolated')
    networks = (container.get('NetworkSettings') or {}).get('Networks')
    # A created-but-not-started Docker container can have no realized Networks
    # mapping even though HostConfig requested --network none.  Once connected,
    # only Docker's synthetic 'none' endpoint is allowed.
    if (not isinstance(networks, dict) or
            any(network != 'none' for network in networks)):
        raise RuntimeError('Live migration helper is not network-isolated')
    ports = (container.get('NetworkSettings') or {}).get('Ports')
    if (host_config.get('PortBindings') or not isinstance(ports, dict) or
            any(binding for binding in ports.values())):
        raise RuntimeError('Live migration helper has published ports')
    status = (container.get('State') or {}).get('Status')
    if status not in ('created', 'exited'):
        raise RuntimeError('Live migration helper is still active or unknown')
    return container_id


def _resolve_verified_helper(name, resource, containers, protected_ids):
    """Resolve one helper only from a successful full inventory."""
    _helper_resource_identity(name, resource)
    by_id, by_name = _inventory_maps(containers)
    recorded_id = resource.get('id')
    if recorded_id is not None and (not isinstance(recorded_id, str) or not recorded_id):
        raise RuntimeError('Live migration helper journal has an invalid ID')
    if recorded_id in protected_ids:
        raise RuntimeError('Live migration helper refers to a protected container')

    container = by_id.get(recorded_id) if recorded_id else by_name.get(name)
    same_name = by_name.get(name)
    if container is None:
        if same_name is not None:
            raise RuntimeError('Live migration helper ID does not match its name')
        return None
    if same_name is not container:
        raise RuntimeError('Live migration helper ID does not match its name')
    container_id = _verify_helper_container(container, name, resource, protected_ids)
    resource['id'] = container_id
    return container_id


def remove_verified_helper(name, image, bind, container_id):
    """Remove an unjournaled helper only after the same ownership checks."""
    containers = r.inventory()
    resource = {'name': name, 'image': image, 'bind': bind, 'id': container_id}
    resolved = _resolve_verified_helper(name, resource, containers, set())
    if resolved is not None:
        r.docker('container', 'rm', resolved)


def remove_finished_live_helper(journal_path):
    journal = read_journal(journal_path)
    resources = journal.get('liveResources')
    if not isinstance(resources, dict):
        raise RuntimeError('Live migration helper journal is invalid')
    protected_ids = _protected_container_ids(journal)
    inventory = None
    for name, resource in resources.items():
        if (not isinstance(resource, dict) or resource.get('removed') or
                resource.get('disposableMount')):
            continue
        if journal.get('plannedLiveContainer') != name:
            raise RuntimeError('Live helper journal changed unexpectedly')
        if inventory is None:
            inventory = r.inventory()
        resolved = _resolve_verified_helper(name, resource, inventory, protected_ids)
        if resolved is None:
            resource['removed'] = True
            save_durable(journal_path, journal)
            continue

        # A helper discovered by name after create-before-ID must be durable
        # before Docker deletion can begin.
        resource['id'] = resolved
        save_durable(journal_path, journal)
        r.docker('container', 'rm', resolved)
        current = read_journal(journal_path)
        current_resource = current.get('liveResources', {}).get(name)
        if (not isinstance(current_resource, dict) or
                current_resource.get('name', name) != name or
                current_resource.get('image') != resource['image'] or
                current_resource.get('bind') != resource['bind'] or
                current_resource.get('id') != resolved):
            raise RuntimeError('Live helper journal changed unexpectedly')
        current_resource['removed'] = True
        save_durable(journal_path, current)
        journal = current


def _wait_original_ready(state):
    release.bounded_wait(lambda: r.validate(state, r.inventory()),
                         'exact original app and worker after migration', 30)
    release.bounded_wait(lambda: r.ready(state),
                         'original HTTP readiness after migration', 30)
    release.bounded_wait(lambda: r.validate(state, r.inventory()),
                         'original app and worker remained exact', 5)
    release.bounded_wait(lambda: r.ready(state),
                         'original HTTP readiness remained', 5)


def restart_originals(journal_path, state, configs, database_path, baseline,
                      expected_delta, validated_callback=None):
    """Validate exact stopped state before exposure, then normal runtime checks."""
    baseline_evidence = baseline['evidence'] if 'rows' in baseline else baseline
    current = database_snapshot(database_path)
    if expected_delta:
        validate_delta(baseline_evidence, current)
    else:
        validate_unchanged(baseline_evidence, current)
    if validated_callback is not None:
        validated_callback()
    mark_phase(journal_path, 'starting-same-original-pair',
               {'exactPreRestartValidation': 'expanded' if expected_delta else 'unchanged',
                'exposureAttempted': True})
    for container in configs:
        r.docker('start', container['Id'])
    recovery = release.database_state(configs)
    release.bounded_wait(lambda: release.check_worker(
        recovery, release.database_state(configs)),
        'old worker heartbeat advanced after migration', 25)
    final = database_snapshot(database_path)
    validate_post_restart(baseline_evidence, final, expected_delta)
    release.bounded_wait(lambda: release.check_database(
        recovery, release.database_state(configs)),
        'original schema and security alert state after migration', 25)
    _wait_original_ready(state)
    mark_phase(journal_path, 'original-pair-running-after-invariant-checks')


def _recover_originals_without_full_baseline(journal_path, state, configs,
                                             database_path, baseline_path):
    """Restart safely when stopping or the full private snapshot never completed.

    The official pre-stop schema/alert baseline is much smaller than row-level
    evidence, but it is enough to prove that an unmodified database is safe to
    expose to the exact original containers.  No database is ever restored.
    """
    journal = read_journal(journal_path)
    resources = journal.get('liveResources')
    if not isinstance(resources, dict):
        raise RuntimeError('Live migration helper journal is invalid')
    if any(not isinstance(resource, dict) or not resource.get('removed')
           for resource in resources.values()):
        raise RuntimeError(
            'A live migration helper may have started without full evidence')
    prestop = release.database_state_from_json(baseline_path)
    statuses = [(container['Id'], running_container(container['Id']))
                for container in configs]
    if any(status not in ('running', 'exited') for _, status in statuses):
        raise RuntimeError('Original container status is unknown; journal retained')

    # Both reads must succeed before either original is started.
    database_snapshot(database_path)
    release.check_database(prestop, release.database_state(configs))
    mark_phase(journal_path, 'starting-same-original-pair-from-pre-stop-baseline',
               {'preStopBaselineOnly': True, 'exposureAttempted': True})
    for container_id, status in statuses:
        if status == 'exited':
            r.docker('start', container_id)

    # This heartbeat baseline is deliberately captured only after both originals
    # are running; a stale pre-stop heartbeat cannot masquerade as recovery.
    fresh = release.database_state(configs)
    release.bounded_wait(lambda: release.check_worker(
        fresh, release.database_state(configs)),
        'old worker heartbeat after incomplete baseline recovery', 25)
    current = release.database_state(configs)
    release.check_database(fresh, current)
    release.check_database(prestop, current)
    _wait_original_ready(state)
    mark_phase(journal_path,
               'original-pair-running-after-pre-stop-baseline-checks')


def _validate_original_configs(state, configs):
    rows = r.inventory()
    by_id = {container.get('Id'): container for container in rows}
    expected = state['current']
    if len(configs) != len(expected['containers']):
        raise RuntimeError('Journal original container count differs from retention state')
    for config, reference in zip(configs, expected['containers']):
        live = by_id.get(reference['id'], {})
        if (config.get('Id') != reference['id'] or
                config.get('Name', '').lstrip('/') != reference['name'] or
                config.get('Image') != expected['image'] or
                live.get('Image') != expected['image'] or
                live.get('Name', '').lstrip('/') != reference['name']):
            raise RuntimeError('Original containers do not match the retention manifest')


def _path_inside(root, value, field):
    root = Path(root).resolve()
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    path = path.resolve()
    if path == root or root not in path.parents:
        raise RuntimeError('Migration journal ' + field + ' escapes the operations root')
    return path


def _journal_database_path(root, app, journal):
    """Resolve the exact configured live database and reject symlinked paths."""
    database = journal.get('database', {})
    configured_mount = database.get('dataMount')
    configured_path = database.get('hostPath')
    mount = data_mount(app)
    relative = database_relative_path(app)
    expected = mount / relative
    if (not isinstance(configured_mount, str) or not isinstance(configured_path, str) or
            Path(configured_mount) != mount or Path(configured_path) != expected):
        raise RuntimeError('Journal database path differs from the original container mount')

    operations_root = Path(root).resolve()
    live_root = operations_root.parent
    try:
        live_root_resolved = live_root.resolve(strict=True)
        expected_resolved = expected.resolve(strict=True)
    except OSError:
        raise RuntimeError('Journal live database path is unavailable')
    if (live_root != live_root_resolved or expected != expected_resolved or
            live_root_resolved == expected_resolved or
            live_root_resolved not in expected_resolved.parents or
            operations_root == expected_resolved or
            operations_root in expected_resolved.parents):
        raise RuntimeError('Journal database path is outside the managed live root')
    return expected


def recover_interrupted(journal_path, root):
    """Recover only an unexposed migration journal under both existing locks."""
    journal = read_journal(journal_path)
    if journal.get('exposureAttempted'):
        raise RuntimeError('Migration interruption may have exposed live writes; journal retained')
    state = journal.get('previousState')
    manifest = json.loads((Path(root) / 'retention.json').read_text())
    if state != manifest:
        raise RuntimeError('Retention manifest changed during migration; manual recovery required')
    configs_path = _path_inside(root, journal.get('originalContainers'),
                                'originalContainers reference')
    has_full_evidence = isinstance(journal.get('databaseEvidence'), str)
    evidence_path = (_path_inside(root, journal.get('databaseEvidence'),
                                  'databaseEvidence reference')
                     if has_full_evidence else None)
    configs = json.loads(configs_path.read_text())
    _validate_original_configs(state, configs)
    app = configs[0]
    database_path = _journal_database_path(root, app, journal)
    with release.backup_policy(Path(root), configs):
        if journal.get('liveResources'):
            remove_finished_live_helper(journal_path)
        expected_delta = None
        if has_full_evidence and evidence_path.exists():
            baseline = load_safe_evidence(evidence_path)
            statuses = [running_container(container['Id']) for container in configs]
            if any(status != 'exited' for status in statuses):
                raise RuntimeError(
                    'Original pair is not fully stopped; journal retained')
            current = database_snapshot(database_path)
            expected_delta = False
            try:
                validate_delta(baseline, current)
                expected_delta = True
            except RuntimeError:
                validate_unchanged(baseline, current)
            restart_originals(journal_path, state, configs, database_path,
                              baseline, expected_delta)
        else:
            baseline_path = _path_inside(root, journal.get('databaseBaseline'),
                                         'databaseBaseline reference')
            _recover_originals_without_full_baseline(
                journal_path, state, configs, database_path, baseline_path)
        recovered = read_journal(journal_path)
        recovered['recovery'] = {'validated': True, 'expectedDelta': expected_delta,
                                 'databaseRestored': False, 'retentionChanged': False}
        save_durable(journal_path, recovered)
        recovery_path = ((evidence_path.parent if evidence_path is not None
                          else baseline_path.parent) /
                         'interruption-recovery.json')
        save_durable(recovery_path, recovered)
        journal_path.unlink()
        fsync_directory(Path(root))


def migrate(release_name, root=r.ROOT):
    root = Path(root)
    journal = root / JOURNAL_NAME
    if journal.exists():
        raise RuntimeError('An interrupted migration or deployment requires recovery first')

    state = json.loads((root / 'retention.json').read_text())
    rows = r.inventory()
    r.validate(state, rows)
    r.ready(state)
    metadata = candidate_metadata(release_name)
    protected = {state['current']['image'], state['rollback']['image']}
    if metadata['Id'] in protected:
        raise RuntimeError('Candidate image is already protected by retention')
    configs = [next(container for container in rows
                    if container['Id'] == reference['id'])
               for reference in state['current']['containers']]
    app = configs[0]
    data_root = data_mount(app)
    relative = database_relative_path(app)
    database_path = data_root / relative
    token = r.stamp()
    destination = root / 'deployments' / ('a2a-' + token)
    evidence_path = destination / 'database-evidence-before-stop.json'
    stopped = False
    prestart_validated = False
    completed = False
    baseline = None

    # Keep failure handling inside the privacy/maintenance lock. Recovery must not
    # inspect or restart the private data mount after that lock has been released.
    with release.backup_policy(root, configs):
        try:
            ensure_free_disk(root)
            destination.mkdir(parents=True, mode=0o700)
            fsync_directory(destination)
            preflight(configs, metadata, destination)

            save_durable(destination / 'previous-containers.json', configs)
            prestop_baseline_path = destination / 'database-state-before-stop.json'
            prestop_baseline = release.database_state(configs)
            save_durable(prestop_baseline_path, prestop_baseline)
            progress = {
                'schemaVersion': 1, 'procedure': PROCEDURE_NAME,
                'migration': MIGRATION_NAME,
                'phase': 'candidate-preflight-validated-before-stop',
                'candidate': {'tag': 'cfp-hello-agent:' + release_name,
                              'image': metadata['Id'], 'officialLabel': release_name},
                'previousState': state,
                'originalContainers': str(destination / 'previous-containers.json'),
                'databaseEvidence': str(evidence_path),
                'databaseBaseline': str(prestop_baseline_path),
                'backup': str(destination / 'data.tar.gz'),
                'database': {'hostPath': str(database_path),
                             'dataMount': str(data_root)},
                'liveResources': {}, 'renamed': [], 'created': [],
            }
            write_journal(journal, progress)

            ensure_free_disk(root)
            mark_phase(journal, 'stopping-original-pair')
            stopped = True
            for container in reversed(configs):
                r.docker('stop', '-t', '30', container['Id'])

            # This is the authoritative baseline: it is captured only after every
            # writer is stopped, so an offline snapshot need not equal live data.
            baseline = database_snapshot(database_path)
            release_baseline = release.database_state(configs)
            save_durable(evidence_path, baseline['evidence'])
            mark_phase(journal, 'authoritative-stopped-baseline-captured',
                       {'migrationBaseline': baseline['evidence']['migration']})

            mark_phase(journal, 'creating-verified-backup')
            create_verified_backup(configs, destination, release_baseline)
            mark_phase(journal, 'verified-backup-complete')

            before_live = database_snapshot(database_path)
            validate_unchanged(baseline['evidence'], before_live)
            helper_name = 'cfp-hello-agent-a2a-migrate-' + token.lower()
            helper_config = migration_container_config(
                metadata, app, helper_name, data_root, 'file:/data/' + relative)

            def register_live(name, image, binds, phase):
                register_live_resource(journal, name, image, binds, phase)

            run_container(helper_name, helper_config, register_live, journal,
                          'running-live-payload-migration')
            after_live = database_snapshot(database_path)
            delta = validate_delta(baseline['evidence'], after_live)
            save_durable(destination / 'migration.json', {
                'image': metadata['Id'],
                'engine': 'payload-getPayload-prodMigrations',
                'network': 'none', 'delta': delta})
            mark_phase(journal, 'live-additive-delta-validated')
            remove_finished_live_helper(journal)

            def mark_prestart_validated():
                nonlocal prestart_validated
                prestart_validated = True

            restart_originals(journal, state, configs, database_path, baseline,
                              True, mark_prestart_validated)
            save_durable(destination / 'receipt.json', {
                'migration': MIGRATION_NAME, 'candidateImage': metadata['Id'],
                'retentionChanged': False, 'databaseRestored': False,
                'oldAppAndWorkerStarted': True, 'ready': True,
                'workerHeartbeatAdvanced': True, 'additiveDeltaValidated': True,
                'backup': str(destination / 'data.tar.gz')})
            completed = True
        except BaseException as error:
            failure_phase = 'migration'
            try:
                if journal.exists():
                    failure_phase = read_journal(journal).get('phase', failure_phase)
            except Exception:
                pass
            if journal.exists():
                record_failure(journal, failure_phase, error)
            try:
                if journal.exists() and read_journal(journal).get('liveResources'):
                    remove_finished_live_helper(journal)
                if stopped and baseline is None:
                    baseline_path = _path_inside(
                        root, read_journal(journal).get('databaseBaseline'),
                        'databaseBaseline reference')
                    _validate_original_configs(state, configs)
                    _recover_originals_without_full_baseline(
                        journal, state, configs, database_path, baseline_path)
                if stopped and baseline is not None and not prestart_validated:
                    current = database_snapshot(database_path)
                    expected_delta = False
                    try:
                        validate_delta(baseline['evidence'], current)
                        expected_delta = True
                    except RuntimeError:
                        if read_journal(journal).get('exposureAttempted'):
                            raise RuntimeError(
                                'Exposure was journaled without prestart validation')
                        validate_unchanged(baseline['evidence'], current)
                    restart_originals(journal, state, configs, database_path,
                                      baseline, expected_delta)
                elif stopped and baseline is not None and prestart_validated:
                    for container in configs:
                        if running_container(container['Id']) != 'running':
                            r.docker('start', container['Id'])
                    recovery = release.database_state(configs)
                    release.bounded_wait(lambda: release.check_worker(
                        recovery, release.database_state(configs)),
                        'old worker heartbeat after migration failure', 25)
                    current = database_snapshot(database_path)
                    validate_post_restart(baseline['evidence'], current, True)
                    release.bounded_wait(lambda: release.check_database(
                        recovery, release.database_state(configs)),
                        'original schema and alerts after migration failure', 25)
                    _wait_original_ready(state)
                    mark_phase(journal, 'original-pair-running-after-failure-checks')
            except BaseException as recovery_error:
                if journal.exists():
                    record_failure(journal, failure_phase, recovery_error)
                raise
            raise

    journal.unlink()
    fsync_directory(root)
    print(json.dumps({'migration': MIGRATION_NAME, 'release': release_name,
                      'candidateImage': metadata['Id'], 'backup': str(destination)}))

def dispatch(release_name, root=r.ROOT):
    root = Path(root)
    journal = root / JOURNAL_NAME
    if journal.exists():
        read_journal(journal)
        recover_interrupted(journal, root)
        return
    migrate(release_name, root)


def run_with_lock(release_name, root=r.ROOT, lock_path=LOCK_PATH):
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        dispatch(release_name, root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release', help='official preview-... candidate image tag')
    args = parser.parse_args()
    os.umask(0o077)
    run_with_lock(args.release)


if __name__ == '__main__':
    main()
