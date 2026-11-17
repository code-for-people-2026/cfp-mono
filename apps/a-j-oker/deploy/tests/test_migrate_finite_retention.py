import importlib.util
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
import unittest


DEPLOY_DIR = Path(__file__).resolve().parent.parent
APP_DIR = DEPLOY_DIR.parent
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))
_SPEC = importlib.util.spec_from_file_location(
    'finite_retention_under_test', DEPLOY_DIR / 'migrate-finite-retention.py')
migration = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(migration)

MIGRATION_TS = APP_DIR / 'src/cms/migrations/20261114_090000_finite_safety_retention.ts'


def actual_statements():
    source = MIGRATION_TS.read_text()
    columns = re.findall(r'\["([a-z_]+)", "([^"]+)"\]', source)
    indexes = re.findall(r'await db\.run\(sql`(CREATE INDEX IF NOT EXISTS [^`]*)`\)', source)
    if len(columns) != 3 or len(indexes) != 3:
        raise AssertionError('could not recover the reviewed migration allowlist')
    return ['ALTER TABLE safety_cases ADD COLUMN %s %s' % item for item in columns] + indexes


def initialize(path):
    db = sqlite3.connect(str(path))
    try:
        db.executescript("""
          CREATE TABLE payload_migrations (
            id integer PRIMARY KEY NOT NULL, name text NOT NULL, batch numeric NOT NULL,
            updated_at text NOT NULL, created_at text NOT NULL);
          CREATE TABLE safety_cases (
            id integer PRIMARY KEY NOT NULL, receipt text NOT NULL, owner text NOT NULL,
            revision numeric NOT NULL, retain_until text, legal_hold integer DEFAULT 0,
            reason text, updated_at text, created_at text);
          CREATE INDEX safety_cases_owner_idx ON safety_cases(owner);
          CREATE TABLE safety_alert_state (
            id integer PRIMARY KEY NOT NULL, verified_at text, fingerprint text, heartbeat_at text);
          INSERT INTO payload_migrations VALUES
            (1, '20261024_120000_feishu_alerts', 18, 'old', 'old');
          INSERT INTO safety_cases VALUES
            (1, 'receipt-1', 'owner-1', 4, '2026-11-20', 0, 'private-text', 'u', 'c'),
            (2, 'receipt-2', 'owner-2', 2, NULL, 1, 'held-text', 'u', 'c');
          INSERT INTO safety_alert_state VALUES
            (1, 'verified', 'private-fingerprint', 'stopped-heartbeat');
        """)
        db.commit()
    finally:
        db.close()


def apply_actual(path):
    db = sqlite3.connect(str(path))
    try:
        for statement in actual_statements():
            db.execute(statement)
        db.execute("INSERT INTO payload_migrations VALUES (2, ?, 19, 'new', 'new')",
                   (migration.MIGRATION_NAME,))
        db.commit()
    finally:
        db.close()


class FiniteRetentionMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.before_path = root / 'before.db'
        self.after_path = root / 'after.db'
        initialize(self.before_path)
        shutil.copy2(self.before_path, self.after_path)
        apply_actual(self.after_path)
        self.before = migration.database_snapshot(self.before_path)

    def snapshot(self):
        return migration.database_snapshot(self.after_path)

    def test_actual_migration_is_exact_allowlisted_delta(self):
        self.assertEqual(
            [item[0] for item in migration.ADDED_COLUMNS],
            ['retention_review_needed', 'retention_purged_at', 'hold_review_at'])
        result = migration.validate_delta(self.before['evidence'], self.snapshot())
        self.assertEqual(result['alteredTable'], 'safety_cases')
        self.assertEqual(result['newColumns'], [item[0] for item in migration.ADDED_COLUMNS])
        self.assertEqual(result['newIndexes'], sorted(migration.INDEX_SQL))

    def test_accepts_lowercase_added_column_types(self):
        after = self.snapshot()
        old_count = len(self.before['evidence']['tables']['safety_cases']['columns'])
        for index, column in enumerate(
                after['columns']['safety_cases'][old_count:], old_count):
            column = list(column)
            column[2] = column[2].lower()
            after['columns']['safety_cases'][index] = tuple(column)
        migration.validate_delta(self.before['evidence'], after)

    def test_rejects_incompatible_added_column_type_or_default(self):
        old_count = len(self.before['evidence']['tables']['safety_cases']['columns'])
        for field, value in ((2, 'blob'), (4, '1')):
            with self.subTest(field=field, value=value):
                after = self.snapshot()
                column = list(after['columns']['safety_cases'][old_count])
                column[field] = value
                after['columns']['safety_cases'][old_count] = tuple(column)
                with self.assertRaisesRegex(RuntimeError, 'column delta'):
                    migration.validate_delta(self.before['evidence'], after)

    def test_rejects_old_case_or_alert_data_changes(self):
        for statement in (
                "UPDATE safety_cases SET reason='changed' WHERE id=1",
                "UPDATE safety_alert_state SET fingerprint='changed'"):
            with self.subTest(statement=statement):
                copy = Path(self.temporary.name) / ('changed-%s.db' % abs(hash(statement)))
                shutil.copy2(self.after_path, copy)
                db = sqlite3.connect(str(copy)); db.execute(statement); db.commit(); db.close()
                with self.assertRaisesRegex(RuntimeError, 'changed'):
                    migration.validate_delta(self.before['evidence'], migration.database_snapshot(copy))

    def test_rejects_populated_new_fields_or_extra_schema(self):
        db = sqlite3.connect(str(self.after_path))
        db.execute("UPDATE safety_cases SET retention_purged_at='unexpected' WHERE id=1")
        db.commit(); db.close()
        with self.assertRaisesRegex(RuntimeError, 'populated'):
            migration.validate_delta(self.before['evidence'], self.snapshot())

        shutil.copy2(self.before_path, self.after_path)
        apply_actual(self.after_path)
        db = sqlite3.connect(str(self.after_path)); db.execute('CREATE TABLE unrelated(value text)'); db.commit(); db.close()
        with self.assertRaisesRegex(RuntimeError, 'Forbidden schema delta'):
            migration.validate_delta(self.before['evidence'], self.snapshot())

    def test_rejects_wrong_migration_journal(self):
        db = sqlite3.connect(str(self.after_path))
        db.execute("UPDATE payload_migrations SET name='wrong' WHERE id=2")
        db.commit(); db.close()
        with self.assertRaisesRegex(RuntimeError, 'migration'):
            migration.validate_delta(self.before['evidence'], self.snapshot())

    def test_helper_config_and_verifier_share_finite_retention_label(self):
        guard = migration.guard
        name = guard.HELPER_PREFIX + 'helper'
        source = '/opt/cfp-hello-agent/live-data'
        config = guard.migration_container_config(
            {'Id': 'sha256:candidate', 'Config': {
                'Labels': {'cn.codeforpeople.release': 'preview-retention'},
                'WorkingDir': '/app/apps/a-j-oker',
            }},
            {'Config': {'Env': []}}, name, Path(source),
            'file:/data/hello.db')
        self.assertEqual(
            config['Labels'][guard.MIGRATION_LABEL], guard.MIGRATION_NAME)

        resource = {
            'name': name,
            'image': config['Image'],
            'bind': config['HostConfig']['Binds'][0],
            'id': 'helper-id',
        }
        container = {
            'Id': 'helper-id',
            'Name': '/' + name,
            'Image': config['Image'],
            'Config': {'Labels': dict(config['Labels'])},
            'Mounts': [{'Type': 'bind', 'Source': source,
                        'Destination': '/data', 'RW': True}],
            'HostConfig': config['HostConfig'],
            'NetworkSettings': {'Networks': {'none': {}}, 'Ports': {}},
            'State': {'Status': 'exited'},
        }
        self.assertEqual(
            guard._verify_helper_container(container, name, resource, set()),
            'helper-id')

        container['Config']['Labels'][guard.MIGRATION_LABEL] = 'wrong'
        with self.assertRaisesRegex(RuntimeError, 'migration label'):
            guard._verify_helper_container(container, name, resource, set())


if __name__ == '__main__':
    unittest.main()
