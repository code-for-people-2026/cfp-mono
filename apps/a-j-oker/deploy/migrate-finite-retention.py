#!/usr/bin/env python3
"""Guarded additive expansion for the three finite-retention case columns.

This reuses the generic migration guard's locking, disposable-snapshot,
stopped app+worker, archive, journal, recovery, heartbeat, and readiness guards.
Only the reviewed safety_cases column/index delta is different.
"""

import argparse
import fcntl
import importlib.util
import json
from pathlib import Path
import sqlite3


_SPEC = importlib.util.spec_from_file_location(
    'finite_retention_migration_guard', Path(__file__).with_name('migration-guard.py'))
guard = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(guard)

MIGRATION_NAME = '20261114_090000_finite_safety_retention'
PROCEDURE_NAME = 'finite-retention-pre-expansion-v1'
ADDED_COLUMNS = (
    ('retention_review_needed', 'INTEGER', 0, '0', 0),
    ('retention_purged_at', 'TEXT', 0, None, 0),
    ('hold_review_at', 'TEXT', 0, None, 0),
)
INDEX_SQL = {
    'safety_cases_retention_review_needed_idx':
        'CREATE INDEX IF NOT EXISTS safety_cases_retention_review_needed_idx ON safety_cases(retention_review_needed)',
    'safety_cases_retention_purged_at_idx':
        'CREATE INDEX IF NOT EXISTS safety_cases_retention_purged_at_idx ON safety_cases(retention_purged_at)',
    'safety_cases_hold_review_at_idx':
        'CREATE INDEX IF NOT EXISTS safety_cases_hold_review_at_idx ON safety_cases(hold_review_at)',
}

MIGRATION_SCRIPT = """
const expected = %r;
const { cms } = await import('./src/cms/client');
const { migrations } = await import('./src/cms/migrations');
let payload;
try {
  payload = await cms();
  const selected = migrations.filter((migration) => migration.name === expected);
  if (selected.length !== 1) throw new Error('finite-retention migration is not uniquely bundled');
  await payload.db.migrate({ migrations: [selected[0]] });
} finally {
  if (payload) await payload.destroy();
}
console.log(JSON.stringify({ engine: 'payload-getPayload-prodMigrations', migration: expected }));
""".strip() % MIGRATION_NAME


def _expected_table_sql(before_sql):
    db = sqlite3.connect(':memory:')
    try:
        db.execute(before_sql)
        db.execute('ALTER TABLE safety_cases ADD COLUMN retention_review_needed integer DEFAULT 0')
        db.execute('ALTER TABLE safety_cases ADD COLUMN retention_purged_at text')
        db.execute('ALTER TABLE safety_cases ADD COLUMN hold_review_at text')
        return guard.normalize_sql(db.execute(
            "select sql from sqlite_master where type='table' and name='safety_cases'"
        ).fetchone()[0])
    finally:
        db.close()


def _migration_delta(before, after):
    names, records = guard._migration_record(after)
    old = before['migration']
    if len(records) != old['count'] + 1:
        raise RuntimeError('Payload migration journal delta is not exact')
    record = records[-1]
    if (record.get('name') != MIGRATION_NAME or
            guard._number(record.get('batch')) != old['latestBatch'] + 1 or
            not isinstance(record.get('id'), int) or
            not record.get('updated_at') or not record.get('created_at')):
        raise RuntimeError('Payload migration record is invalid')
    columns = [column[1] for column in after['columns']['payload_migrations']]
    record_hash = guard._row_hash(columns, after['rows']['payload_migrations'][-1])
    remaining = list(after['evidence']['tables']['payload_migrations']['rowHashes'])
    if record_hash not in remaining:
        raise RuntimeError('Payload migration record evidence is inconsistent')
    remaining.remove(record_hash)
    if remaining != old['rowHashes']:
        raise RuntimeError('An existing payload_migrations row changed')
    return names, record


def _validate_schema(before, after):
    old_names = set(before['schemaObjects'])
    expected_indexes = set(INDEX_SQL)
    schema = guard._schema_map(after)
    if expected_indexes & old_names:
        raise RuntimeError('Finite-retention indexes already exist before migration')
    if set(schema) != old_names | expected_indexes:
        raise RuntimeError('Forbidden schema delta')
    old_case = before['tables'].get('safety_cases')
    if not old_case or not isinstance(old_case.get('schemaSql'), str) or not isinstance(old_case.get('columns'), list):
        raise RuntimeError('safety_cases table is unavailable')
    if schema['safety_cases'] != ('table', _expected_table_sql(old_case['schemaSql'])):
        raise RuntimeError('safety_cases differs from the reviewed additive migration')
    for name, sql in INDEX_SQL.items():
        if schema.get(name) != ('index', guard.normalize_sql(sql)):
            raise RuntimeError('Finite-retention index differs from the reviewed migration: ' + name)
    for name, digest in before['schemaObjects'].items():
        if name == 'safety_cases':
            continue
        if after['evidence']['schemaObjects'].get(name) != digest:
            raise RuntimeError('Forbidden schema delta: ' + name)
    return schema


def validate_delta(before, after):
    """Accept three appended columns, their indexes, and one journal row only."""
    guard.validate_integrity(after)
    before = before['evidence'] if 'rows' in before else before
    guard._require_evidence(before)
    if not before.get('integrityOk') or before.get('foreignKeyCount') != 0:
        raise RuntimeError('Database baseline integrity evidence failed')
    _validate_schema(before, after)
    for name, old_table in before['tables'].items():
        if name == 'payload_migrations':
            new_table = after['evidence']['tables'][name]
            if (old_table['schemaSha256'] != new_table['schemaSha256'] or
                    old_table['columnsSha256'] != new_table['columnsSha256']):
                raise RuntimeError('payload_migrations schema changed')
            continue
        if name == 'safety_cases':
            old_columns = old_table['columns']
            new_columns = [list(column) for column in after['columns'][name]]
            if new_columns[:len(old_columns)] != old_columns:
                raise RuntimeError('An existing safety_cases column changed')
            added = [tuple(column[1:]) for column in new_columns[len(old_columns):]]
            normalized_added = tuple(
                (column[0], column[1].upper()) + column[2:]
                if isinstance(column[1], str) else column
                for column in added)
            if normalized_added != ADDED_COLUMNS:
                raise RuntimeError('Unexpected safety_cases column delta')
            old_names = [column[1] for column in old_columns]
            projected = []
            for row in after['rows'][name]:
                if tuple(row[len(old_columns):]) != (0, None, None):
                    raise RuntimeError('Migration populated existing safety case retention fields')
                projected.append(guard._row_hash(old_names, row[:len(old_columns)]))
            if sorted(projected) != old_table['rowHashes']:
                raise RuntimeError('Existing safety_cases data changed')
            continue
        if after['evidence']['tables'].get(name) != old_table:
            raise RuntimeError('Existing schema or data changed in ' + name)
    names, record = _migration_delta(before, after)
    return {
        'migrationRecord': {name: record[name] for name in names
                            if name in ('id', 'name', 'batch')},
        'previousMigrationCount': before['migration']['count'],
        'alteredTable': 'safety_cases',
        'newColumns': [column[0] for column in ADDED_COLUMNS],
        'newIndexes': sorted(INDEX_SQL),
    }


def validate_post_restart(baseline, current, expanded):
    guard.validate_integrity(current)
    guard._require_evidence(baseline)
    if not expanded:
        return guard.validate_unchanged(baseline, current)
    _validate_schema(baseline, current)
    _, records = guard._migration_record(current)
    if (len(records) != baseline['migration']['count'] + 1 or
            records[-1].get('name') != MIGRATION_NAME or
            guard._number(records[-1].get('batch')) != baseline['migration']['latestBatch'] + 1):
        raise RuntimeError('Payload migration metadata changed after restart')
    return True


# The shared runner resolves these globals dynamically; it has no schema or
# migration defaults of its own.
guard.MIGRATION_NAME = MIGRATION_NAME
guard.PROCEDURE_NAME = PROCEDURE_NAME
guard.MIGRATION_LABEL = 'cn.codeforpeople.finite-retention-migration'
guard.DESTINATION_PREFIX = 'finite-retention-'
guard.HELPER_PREFIX = 'cfp-hello-agent-finite-retention-migrate-'
guard.MIGRATION_SCRIPT = MIGRATION_SCRIPT
guard.validate_delta = validate_delta
guard.validate_post_restart = validate_post_restart

database_snapshot = guard.database_snapshot
run_with_lock = guard.run_with_lock


def preflight_only(release_name, root=guard.r.ROOT):
    """Run the real candidate migration against a disposable copied snapshot."""
    root = Path(root)
    journal = root / guard.JOURNAL_NAME
    if journal.exists():
        raise RuntimeError('An interrupted migration or deployment requires recovery first')
    state = json.loads((root / 'retention.json').read_text())
    rows = guard.r.inventory()
    guard.r.validate(state, rows)
    guard.r.ready(state)
    metadata = guard.candidate_metadata(release_name)
    configs = [next(container for container in rows
                    if container['Id'] == reference['id'])
               for reference in state['current']['containers']]
    destination = root / 'deployments' / ('finite-retention-preflight-' + guard.r.stamp())
    with guard.release.backup_policy(root, configs):
        guard.ensure_free_disk(root)
        destination.mkdir(parents=True, mode=0o700)
        guard.fsync_directory(destination)
        result = guard.preflight(configs, metadata, destination)
        guard.save_durable(destination / 'preflight-only-receipt.json', {
            'migration': MIGRATION_NAME, 'candidateImage': metadata['Id'],
            'liveDatabaseChanged': False, 'servicesStopped': False,
            'retentionManifestChanged': False, 'delta': result})
    print(json.dumps({'migration': MIGRATION_NAME, 'release': release_name,
                      'preflightOnly': True, 'evidence': str(destination)}))


def run_preflight_with_lock(release_name, root=guard.r.ROOT,
                            lock_path=guard.LOCK_PATH):
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        preflight_only(release_name, root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release', help='official preview-... candidate image tag')
    parser.add_argument('--preflight-only', action='store_true',
                        help='migrate only a disposable copied snapshot; do not stop services or change the live database')
    args = parser.parse_args()
    guard.os.umask(0o077)
    if args.preflight_only:
        run_preflight_with_lock(args.release)
    else:
        run_with_lock(args.release)


if __name__ == '__main__':
    main()
