import contextlib
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock


DEPLOY_DIR = Path(__file__).resolve().parent.parent
REPO_APP_DIR = DEPLOY_DIR.parent
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

# The implementation filename deliberately uses the executable's hyphenated name.
# Import it through importlib instead of creating a second importable module.
_SPEC = importlib.util.spec_from_file_location(
    'migrate_a2a_under_test', DEPLOY_DIR / 'migrate-a2a.py')
migration = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(migration)

import release  # noqa: E402
import retention as r  # noqa: E402


MIGRATION_TS = (REPO_APP_DIR / 'src/cms/migrations/' /
                '20261113_120000_a2a_execution.ts')
MIGRATION_NAME = '20261113_120000_a2a_execution'


def make_candidate(labels=None):
    labels = {'cn.codeforpeople.service': 'hello-agent',
              'cn.codeforpeople.release': 'preview-a2a', **(labels or {})}
    return {'Id': 'sha256:candidate', 'Size': 1, 'Config': {
        'Labels': labels, 'WorkingDir': '/app/apps/a-j-oker'}}


def migration_statements():
    """Execute the actual TypeScript migration DDL, independently of the script."""
    source = MIGRATION_TS.read_text()
    tagged = re.findall(r'await db\.run\(sql`([^`]*)`\)', source)
    tables = []
    statements = []
    for statement in tagged:
        if statement.startswith('CREATE TABLE IF NOT EXISTS '):
            name = statement.split()[5]
            tables.append((name, statement))
            statements.append(statement)
        elif statement.startswith('CREATE UNIQUE INDEX IF NOT EXISTS '):
            statements.append(statement)
    if len(tables) != 2:
        raise AssertionError('could not independently find both migration tables')
    if sum(statement.startswith('CREATE UNIQUE INDEX IF NOT EXISTS ')
           for statement in statements) != 2:
        raise AssertionError('could not independently find both unique indexes')
    loops = re.findall(
        r'CREATE TABLE IF NOT EXISTS ([A-Za-z0-9_]+).*?'
        r'for \(const name of \[([^\]]+)\]\)', source, re.S)
    if len(loops) != 2:
        raise AssertionError('could not independently find both index loops')
    for table, columns in loops:
        for column in re.findall(r'"([^"]+)"', columns):
            statements.append(
                'CREATE INDEX IF NOT EXISTS %s_%s_idx ON %s(%s)' %
                (table, column, table, column))
    return tables, statements


def initialize_database(path):
    db = sqlite3.connect(str(path))
    try:
        db.executescript("""
          CREATE TABLE payload_migrations (
            id integer PRIMARY KEY NOT NULL,
            name text NOT NULL,
            batch numeric NOT NULL,
            updated_at text NOT NULL,
            created_at text NOT NULL
          );
          CREATE TABLE safety_alert_state (
            id integer PRIMARY KEY NOT NULL,
            verified_at text,
            fingerprint text,
            heartbeat_at text
          );
          CREATE TABLE private_legacy (
            id text PRIMARY KEY,
            value text NOT NULL
          );
          CREATE TRIGGER private_legacy_guard
            BEFORE UPDATE OF value ON private_legacy
            BEGIN
              SELECT RAISE(ABORT, 'private legacy value is immutable');
            END;
          INSERT INTO payload_migrations VALUES
            (1, '20261024_120000_feishu_alerts', 17,
             '2026-10-24T12:00:00.000Z', '2026-10-24T12:00:00.000Z');
          INSERT INTO safety_alert_state VALUES
            (1, 'verified', 'private-fingerprint', 'stopped-heartbeat');
        """)
        db.commit()
    finally:
        db.close()


def run_actual_migration(path):
    db = sqlite3.connect(str(path))
    try:
        for statement in migration_statements()[1]:
            db.execute(statement)
        db.execute(
            'INSERT INTO payload_migrations VALUES (?, ?, ?, ?, ?)',
            (2, MIGRATION_NAME, 18, '2026-11-13T12:00:00.000Z',
             '2026-11-13T12:00:00.000Z'))
        db.commit()
    finally:
        db.close()


class CandidateTests(unittest.TestCase):
    def test_accepts_official_label_and_pins_immutable_id(self):
        metadata = make_candidate()
        with mock.patch.object(migration.r, 'docker',
                               return_value=json.dumps([metadata])) as docker:
            self.assertEqual(migration.candidate_metadata('preview-a2a'), metadata)
        docker.assert_called_once_with('image', 'inspect',
                                       'cfp-hello-agent:preview-a2a')

    def test_rejects_wrong_label(self):
        metadata = make_candidate(
            {'cn.codeforpeople.release': 'preview-other'})
        with mock.patch.object(migration.r, 'docker',
                               return_value=json.dumps([metadata])):
            with self.assertRaisesRegex(RuntimeError, 'label'):
                migration.candidate_metadata('preview-a2a')

    def test_migration_runner_uses_payload_not_python_sql(self):
        self.assertIn("await import('./src/cms/client')",
                      migration.MIGRATION_SCRIPT)
        self.assertIn('payload.db.migrate', migration.MIGRATION_SCRIPT)
        self.assertNotIn('CREATE TABLE', migration.MIGRATION_SCRIPT)


class RealMigrationDeltaTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.before_db = self.root / 'before.db'
        self.after_db = self.root / 'after.db'
        initialize_database(self.before_db)
        shutil.copy2(str(self.before_db), str(self.after_db))
        run_actual_migration(self.after_db)
        self.before = migration.database_snapshot(self.before_db)
        self.after = migration.database_snapshot(self.after_db)

    def test_real_sqlite_migration_is_exact(self):
        result = migration.validate_delta(self.before['evidence'], self.after)
        self.assertEqual(result['newTables'],
                         ['a2a_execution_tasks', 'a2a_request_ledgers'])
        self.assertEqual(len(result['newIndexes']), 18)
        self.assertIn('a2a_request_ledgers_context_id_idx', result['newIndexes'])
        self.assertEqual(result['migrationRecord']['name'], MIGRATION_NAME)
        self.assertEqual(result['migrationRecord']['batch'], 18)

    def test_sqlite_master_if_not_exists_is_normalized_safely(self):
        actual = self.after['evidence']['tables']['a2a_execution_tasks']
        db = sqlite3.connect(str(self.after_db))
        try:
            stored_sql = db.execute(
                "select sql from sqlite_master where name='a2a_execution_tasks'"
            ).fetchone()[0]
            expected_hash = self.after['evidence']['tables'][
                'a2a_execution_tasks']['schemaSha256']
        finally:
            db.close()
        self.assertNotIn('IF NOT EXISTS', stored_sql)
        self.assertIn('IF NOT EXISTS', migration.TASKS_SQL)
        self.assertEqual(migration.normalize_sql(stored_sql),
                         migration.normalize_sql(migration.TASKS_SQL))
        self.assertEqual(actual['schemaSha256'], expected_hash)

    def test_rejects_data_change_while_stopped(self):
        db = sqlite3.connect(str(self.after_db))
        db.execute("update safety_alert_state set fingerprint='changed'")
        db.commit()
        db.close()
        changed = migration.database_snapshot(self.after_db)
        with self.assertRaisesRegex(RuntimeError, 'safety_alert_state'):
            migration.validate_delta(self.before['evidence'], changed)

    def test_rejects_previous_schema_change(self):
        db = sqlite3.connect(str(self.after_db))
        db.execute('alter table safety_alert_state add column extra text')
        db.commit()
        db.close()
        changed = migration.database_snapshot(self.after_db)
        with self.assertRaisesRegex(RuntimeError, 'Forbidden schema delta'):
            migration.validate_delta(self.before['evidence'], changed)

    def test_rejects_unknown_schema_object(self):
        db = sqlite3.connect(str(self.after_db))
        db.execute('create table unrelated(value text)')
        db.commit()
        db.close()
        changed = migration.database_snapshot(self.after_db)
        with self.assertRaisesRegex(RuntimeError, 'Forbidden schema delta'):
            migration.validate_delta(self.before['evidence'], changed)

    def test_rejects_rows_in_new_a2a_table(self):
        db = sqlite3.connect(str(self.after_db))
        db.execute(
            "insert into a2a_execution_tasks "
            "(id,owner,tenant,agent_id,key,task_id,context_id,state,"
            "status_timestamp,revision,snapshot) values "
            "(1,'o','t','a','k','task','ctx',1,NULL,1,'PRIVATE-SNAPSHOT')")
        db.commit()
        db.close()
        changed = migration.database_snapshot(self.after_db)
        with self.assertRaisesRegex(RuntimeError, 'unexpected rows'):
            migration.validate_delta(self.before['evidence'], changed)

    def test_rejects_unexpected_migration_record(self):
        db = sqlite3.connect(str(self.after_db))
        db.execute("update payload_migrations set name='wrong' where id=2")
        db.commit()
        db.close()
        changed = migration.database_snapshot(self.after_db)
        with self.assertRaisesRegex(RuntimeError, 'migration journal'):
            migration.validate_delta(self.before['evidence'], changed)

    def test_rejects_wrong_migration_batch(self):
        db = sqlite3.connect(str(self.after_db))
        db.execute('update payload_migrations set batch=99 where id=2')
        db.commit()
        db.close()
        changed = migration.database_snapshot(self.after_db)
        with self.assertRaisesRegex(RuntimeError, 'migration record'):
            migration.validate_delta(self.before['evidence'], changed)

    def test_integrity_values_may_be_loaded_lists(self):
        loaded = json.loads(json.dumps(self.after))
        loaded['integrity'] = [list(row) for row in loaded['integrity']]
        loaded['foreignKeys'] = []
        migration.validate_integrity(loaded)
        loaded['foreignKeys'] = [['table', 1, 'parent', 2, 0]]
        with self.assertRaisesRegex(RuntimeError, 'foreign_key_check'):
            migration.validate_integrity(loaded)


class PrivacyEvidenceTests(unittest.TestCase):
    def test_durable_evidence_contains_hashes_and_counts_not_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'private.db'
            initialize_database(database)
            snapshot = migration.database_snapshot(database)
            evidence = snapshot['evidence']
            encoded = json.dumps(evidence)
            self.assertNotIn('private-fingerprint', encoded)
            self.assertNotIn('stopped-heartbeat', encoded)
            self.assertNotIn('20261024_120000_feishu_alerts', encoded)
            self.assertEqual(evidence['tables']['safety_alert_state']['rowCount'], 1)
            self.assertEqual(len(evidence['tables']['safety_alert_state']
                                  ['rowHashes']), 1)
            path = Path(directory) / 'evidence.json'
            path.write_text(encoded)
            self.assertEqual(migration.load_safe_evidence(path), evidence)

    def test_official_backup_raw_sidecar_is_removed_and_archive_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            (destination / 'database-state.json').write_text('{"rows":["RAW"]}')
            (destination / 'data.tar.gz').write_text('managed archive')
            with mock.patch.object(
                    migration.release, 'backup',
                    side_effect=lambda configs, dest, baseline:
                    (dest / 'data.tar.gz').exists()) as backup:
                migration.create_verified_backup([], destination, {'schema': []})
            backup.assert_called_once()
            self.assertFalse((destination / 'database-state.json').exists())
            self.assertTrue((destination / 'data.tar.gz').is_file())


class SharedJournalTests(unittest.TestCase):
    def test_migration_uses_distinct_procedure_in_shared_journal(self):
        self.assertEqual(migration.JOURNAL_NAME, 'deployment-journal.json')
        self.assertEqual(migration.PROCEDURE_NAME, 'a2a-pre-expansion-v1')

    def test_shared_journal_fails_official_release_and_retention_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'deployment-journal.json').write_text(json.dumps({
                'procedure': migration.PROCEDURE_NAME,
                'schemaVersion': 1,
                'migration': MIGRATION_NAME,
            }))
            with self.assertRaisesRegex(RuntimeError, 'interrupted deployment'):
                release.deploy('preview-new', root=root)
            with self.assertRaisesRegex(RuntimeError, 'interrupted deployment'):
                r.cleanup({'schema': 1}, root=root, apply=False)

    def test_migration_recovery_does_not_process_foreign_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / migration.JOURNAL_NAME).write_text(json.dumps({
                'procedure': 'official-release'}))
            with mock.patch.object(migration, 'recover_interrupted') as recover:
                with mock.patch.object(migration, 'migrate') as migrate:
                    with self.assertRaisesRegex(RuntimeError, 'another procedure'):
                        migration.dispatch('preview-new', root)
            recover.assert_not_called()
            migrate.assert_not_called()

    def test_dispatch_recognizes_only_migration_journal_under_lock(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'deploy.lock'
            (root / migration.JOURNAL_NAME).write_text(json.dumps({
                'procedure': migration.PROCEDURE_NAME,
                'schemaVersion': 1,
                'migration': MIGRATION_NAME,
            }))
            with mock.patch.object(
                    migration, 'recover_interrupted',
                    side_effect=lambda *args, **kwargs: events.append('recover')
            ) as recover:
                with mock.patch.object(
                        migration, 'migrate',
                        side_effect=lambda *args, **kwargs: events.append('migrate')
                ) as migrate:
                    migration.run_with_lock('preview-new', root, lock)
            self.assertEqual(events, ['recover'])
            recover.assert_called_once()
            migrate.assert_not_called()
            self.assertTrue(lock.exists())

    def test_lock_is_held_while_dispatch_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'deploy.lock'
            observed = []

            def dispatch(*args, **kwargs):
                with open(str(lock), 'a') as second:
                    try:
                        fcntl.flock(second, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        observed.append('locked')
                    else:
                        fcntl.flock(second, fcntl.LOCK_UN)
                        observed.append('unlocked')

            with mock.patch.object(migration, 'dispatch', side_effect=dispatch):
                migration.run_with_lock('preview-new', root, lock)
            self.assertEqual(observed, ['locked'])


class LiveHelperCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'operations'
        self.root.mkdir()
        self.journal_path = self.root / migration.JOURNAL_NAME
        self.source = '/opt/cfp-hello-agent/live-data'
        self.state = {
            'schema': 1,
            'current': {'image': 'sha256:current', 'containers': [
                {'id': 'current-app', 'name': 'cfp-hello-agent-full-preview'},
                {'id': 'current-worker', 'name': 'cfp-hello-agent-feishu-alerts'},
            ]},
            'rollback': {'image': 'sha256:rollback', 'containers': [
                {'id': 'rollback-app', 'name': 'rollback-app'},
                {'id': 'rollback-worker', 'name': 'rollback-worker'},
            ]},
        }

    def helper_inspect(self, status='exited', container_id='helper-id'):
        bind = self.source + ':/data'
        return {
            'Id': container_id,
            'Name': '/cfp-hello-agent-a2a-migrate-helper',
            'Image': 'sha256:candidate',
            'Config': {'Labels': {
                'cn.codeforpeople.service': 'hello-agent',
                'cn.codeforpeople.release': 'preview-a2a',
                'cn.codeforpeople.a2a-migration': MIGRATION_NAME,
            }},
            'Mounts': [{'Type': 'bind', 'Source': self.source,
                        'Destination': '/data', 'RW': True}],
            'HostConfig': {'Binds': [bind], 'NetworkMode': 'none',
                           'PortBindings': {}},
            'NetworkSettings': {'Networks': {'none': {}}, 'Ports': {}},
            'State': {'Status': status},
        }

    def write_journal(self, resource):
        self.journal_path.write_text(json.dumps({
            'schemaVersion': 1,
            'procedure': migration.PROCEDURE_NAME,
            'migration': MIGRATION_NAME,
            'phase': 'running-live-payload-migration',
            'plannedLiveContainer': 'cfp-hello-agent-a2a-migrate-helper',
            'previousState': self.state,
            'liveResources': {
                'cfp-hello-agent-a2a-migrate-helper': resource,
            },
        }))

    def resource(self, container_id='helper-id'):
        return {
            'name': 'cfp-hello-agent-a2a-migrate-helper',
            'image': 'sha256:candidate',
            'bind': self.source + ':/data',
            'id': container_id,
            'disposableMount': False,
        }

    def test_removes_created_helper_without_force_or_volumes(self):
        helper = self.helper_inspect(status='created')
        self.write_journal(self.resource())
        with mock.patch.object(migration.r, 'inventory',
                               return_value=[helper]) as inventory, \
                mock.patch.object(migration.r, 'docker') as docker:
            migration.remove_finished_live_helper(self.journal_path)
        inventory.assert_called_once_with()
        docker.assert_called_once_with('container', 'rm', 'helper-id')
        journal = json.loads(self.journal_path.read_text())
        self.assertTrue(journal['liveResources'][
            'cfp-hello-agent-a2a-migrate-helper']['removed'])

    def test_protected_container_id_is_never_removed(self):
        helper = self.helper_inspect(container_id='current-app')
        self.write_journal(self.resource(container_id='current-app'))
        with mock.patch.object(migration.r, 'inventory',
                               return_value=[helper]), \
                mock.patch.object(migration.r, 'docker') as docker:
            with self.assertRaisesRegex(
                    RuntimeError, 'protected container'):
                migration.remove_finished_live_helper(self.journal_path)
        docker.assert_not_called()

    def test_different_id_at_recorded_name_refuses_removal(self):
        helper = self.helper_inspect(container_id='other-id')
        self.write_journal(self.resource(container_id='helper-id'))
        with mock.patch.object(migration.r, 'inventory',
                               return_value=[helper]), \
                mock.patch.object(migration.r, 'docker') as docker:
            with self.assertRaisesRegex(RuntimeError, 'ID does not match'):
                migration.remove_finished_live_helper(self.journal_path)
        docker.assert_not_called()

    def test_helper_identity_mismatch_refuses_removal(self):
        cases = []
        helper = self.helper_inspect()
        helper['Name'] = '/other-helper'
        cases.append(('name', helper))
        helper = self.helper_inspect()
        helper['Image'] = 'sha256:other'
        cases.append(('image', helper))
        helper = self.helper_inspect()
        helper['Mounts'][0]['Source'] = '/opt/cfp-hello-agent/other'
        helper['HostConfig']['Binds'] = ['/opt/cfp-hello-agent/other:/data']
        cases.append(('mount', helper))
        helper = self.helper_inspect()
        helper['HostConfig']['NetworkMode'] = 'bridge'
        helper['NetworkSettings']['Networks'] = {'bridge': {}}
        cases.append(('network', helper))
        helper = self.helper_inspect()
        helper['Config']['Labels']['cn.codeforpeople.a2a-migration'] = 'other'
        cases.append(('label', helper))
        helper = self.helper_inspect()
        helper['HostConfig']['PortBindings'] = {'3318/tcp': []}
        helper['NetworkSettings']['Ports'] = {'3318/tcp': []}
        cases.append(('ports', helper))

        for kind, inventory_helper in cases:
            with self.subTest(kind=kind):
                self.write_journal(self.resource())
                with mock.patch.object(
                        migration.r, 'inventory',
                        return_value=[inventory_helper]), \
                        mock.patch.object(migration.r, 'docker') as docker:
                    with self.assertRaisesRegex(RuntimeError, 'helper'):
                        migration.remove_finished_live_helper(self.journal_path)
                docker.assert_not_called()

    def test_create_before_id_resolves_then_persists_before_removal(self):
        helper = self.helper_inspect()
        resource = self.resource()
        del resource['id']
        self.write_journal(resource)
        containers = [helper]
        journal_before_rm = []

        def inventory():
            return list(containers)

        def docker(*args):
            if args == ('container', 'rm', 'helper-id'):
                journal_before_rm.append(json.loads(self.journal_path.read_text()))
                containers.remove(helper)
            return ''

        with mock.patch.object(migration.r, 'inventory',
                               side_effect=inventory), \
                mock.patch.object(migration.r, 'docker', side_effect=docker):
            migration.remove_finished_live_helper(self.journal_path)
        self.assertEqual(journal_before_rm[-1]['liveResources'][
            'cfp-hello-agent-a2a-migrate-helper']['id'], 'helper-id')
        self.assertTrue(json.loads(self.journal_path.read_text())[
            'liveResources']['cfp-hello-agent-a2a-migrate-helper']['removed'])

    def test_removal_before_journal_marker_is_idempotent(self):
        self.write_journal(self.resource())
        with mock.patch.object(migration.r, 'inventory',
                               return_value=[]), \
                mock.patch.object(migration.r, 'docker') as docker:
            migration.remove_finished_live_helper(self.journal_path)
        docker.assert_not_called()

    def test_accepts_real_docker_network_none_metadata_shapes(self):
        exposed = self.helper_inspect(status='created')
        exposed['NetworkSettings']['Networks'] = {}
        exposed['NetworkSettings']['Ports'] = {'3310/tcp': None}
        self.write_journal(self.resource())

        with mock.patch.object(migration.r, 'inventory',
                               return_value=[exposed]), \
                mock.patch.object(migration.r, 'docker') as docker:
            migration.remove_finished_live_helper(self.journal_path)
        docker.assert_called_once_with('container', 'rm', 'helper-id')

    def test_rejects_external_network_and_actual_port_binding(self):
        external = self.helper_inspect(status='created')
        external['NetworkSettings']['Networks'] = {
            'none': {}, 'bridge': {}}
        published = self.helper_inspect(status='created')
        published['NetworkSettings']['Ports'] = {
            '3310/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '3310'}]}

        for kind, inventory_helper in (
                ('external-network', external), ('published-port', published)):
            with self.subTest(kind=kind):
                self.write_journal(self.resource())
                with mock.patch.object(
                        migration.r, 'inventory',
                        return_value=[inventory_helper]), \
                        mock.patch.object(migration.r, 'docker') as docker:
                    with self.assertRaisesRegex(
                            RuntimeError, 'network-isolated|published ports'):
                        migration.remove_finished_live_helper(self.journal_path)
                docker.assert_not_called()

    def test_full_inventory_failure_never_removes(self):
        self.write_journal(self.resource())
        with mock.patch.object(
                migration.r, 'inventory',
                side_effect=RuntimeError('Docker operation failed: ps')), \
                mock.patch.object(migration.r, 'docker') as docker:
            with self.assertRaisesRegex(RuntimeError, 'Docker operation failed'):
                migration.remove_finished_live_helper(self.journal_path)
        docker.assert_not_called()
        self.assertFalse(json.loads(self.journal_path.read_text())[
            'liveResources']['cfp-hello-agent-a2a-migrate-helper'].get('removed'))

    def test_run_container_routes_removal_through_strict_ownership_check(self):
        name = 'cfp-hello-agent-a2a-migrate-helper'
        metadata = make_candidate()
        config = migration.migration_container_config(
            metadata, {'Config': {'Env': []}}, name, Path(self.source),
            'file:/data/hello.db')
        helper = self.helper_inspect()
        containers = [helper]
        calls = []

        def inventory():
            return list(containers)

        def docker(*args):
            calls.append(args)
            if args == ('container', 'rm', 'helper-id'):
                containers.remove(helper)
            elif args == ('wait', 'helper-id'):
                return '0'
            return ''

        def register(helper_name, image, binds, planned=None):
            current = json.loads(self.journal_path.read_text())
            current.setdefault('liveResources', {})[helper_name] = {
                'name': helper_name, 'image': image, 'bind': binds[0],
                'mountDeletion': False,
            }
            current['plannedLiveContainer'] = helper_name
            current['phase'] = planned
            self.journal_path.write_text(json.dumps(current))

        self.journal_path.write_text(json.dumps({
            'schemaVersion': 1,
            'procedure': migration.PROCEDURE_NAME,
            'migration': MIGRATION_NAME,
            'phase': 'verified-backup-complete',
            'previousState': self.state,
            'liveResources': {},
        }))
        with mock.patch.object(migration, 'create_container',
                               return_value='helper-id'), \
                mock.patch.object(migration.r, 'inventory',
                                  side_effect=inventory), \
                mock.patch.object(migration.r, 'docker', side_effect=docker):
            migration.run_container(
                name, config, register, self.journal_path,
                'running-live-payload-migration')
        self.assertIn(('container', 'rm', 'helper-id'), calls)
        self.assertTrue(json.loads(self.journal_path.read_text())[
            'liveResources'][name]['removed'])

    def test_registration_and_planned_marker_survive_create_interruption(self):
        name = 'cfp-hello-agent-a2a-migrate-helper'
        metadata = make_candidate()
        config = migration.migration_container_config(
            metadata, {'Config': {'Env': []}}, name, Path(self.source),
            'file:/data/hello.db')
        self.journal_path.write_text(json.dumps({
            'schemaVersion': 1,
            'procedure': migration.PROCEDURE_NAME,
            'migration': MIGRATION_NAME,
            'phase': 'verified-backup-complete',
            'previousState': self.state,
            'liveResources': {},
        }))

        def register(helper_name, image, binds, planned):
            migration.register_live_resource(
                self.journal_path, helper_name, image, binds, planned)

        with mock.patch.object(
                migration, 'create_container',
                side_effect=RuntimeError('Docker create interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'Docker create interrupted'):
                migration.run_container(
                    name, config, register, self.journal_path,
                    'running-live-payload-migration')
        journal = json.loads(self.journal_path.read_text())
        self.assertEqual(journal['phase'], 'running-live-payload-migration')
        self.assertEqual(journal['plannedLiveContainer'], name)
        self.assertEqual(journal['liveResources'][name]['bind'],
                         self.source + ':/data')

    def test_run_container_requires_durable_metadata_before_create(self):
        name = 'cfp-hello-agent-a2a-migrate-helper'
        metadata = make_candidate()
        config = migration.migration_container_config(
            metadata, {'Config': {'Env': []}}, name, Path(self.source),
            'file:/data/hello.db')
        self.journal_path.write_text(json.dumps({
            'schemaVersion': 1,
            'procedure': migration.PROCEDURE_NAME,
            'migration': MIGRATION_NAME,
            'phase': 'verified-backup-complete',
            'previousState': self.state,
            'liveResources': {},
        }))
        with mock.patch.object(migration, 'create_container') as create:
            with self.assertRaisesRegex(RuntimeError, 'journal changed'):
                migration.run_container(
                    name, config, lambda *args: None, self.journal_path,
                    'running-live-payload-migration')
        create.assert_not_called()


class IncompleteBaselineRecoveryTests(unittest.TestCase):
    def make_root(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = (Path(temporary.name) / 'operations').resolve()
        root.mkdir(parents=True)
        live_data = root.parent / (root.name + '-live-data')
        live_data.mkdir(parents=True)
        database = live_data / 'hello.db'
        initialize_database(database)
        self.configs = [
            {'Id': 'app-id', 'Name': '/app', 'Image': 'sha256:old',
             'Mounts': [{'Type': 'bind', 'Source': str(live_data),
                         'Destination': '/data', 'RW': True}],
             'Config': {'Env': ['HELLO_DATABASE_URI=file:/data/hello.db']}},
            {'Id': 'worker-id', 'Name': '/worker', 'Image': 'sha256:old',
             'Mounts': [{'Type': 'bind', 'Source': str(live_data),
                         'Destination': '/data', 'RW': True}],
             'Config': {'Env': ['HELLO_DATABASE_URI=file:/data/hello.db']}},
        ]
        self.state = {'schema': 1, 'current': {
            'image': 'sha256:old',
            'containers': [{'id': 'app-id', 'name': 'app'},
                           {'id': 'worker-id', 'name': 'worker'}]}}
        self.state['rollback'] = {'image': 'sha256:rollback',
                                  'containers': []}
        (root / 'retention.json').write_text(json.dumps(self.state))
        self.root = root
        self.live_data = live_data
        self.database = database
        self.statuses = {'app-id': 'running', 'worker-id': 'running'}
        self.starts = []
        self.stops = []
        return root

    def docker(self, fail_stop=None):
        def command(*args):
            if args[:2] == ('container', 'inspect'):
                return json.dumps(
                    [{'State': {'Status': self.statuses[args[2]]}}])
            if args[0] == 'stop':
                container_id = args[3]
                self.stops.append(container_id)
                if fail_stop == container_id:
                    raise RuntimeError('Docker stop failed')
                self.statuses[container_id] = 'exited'
                return ''
            if args[0] == 'start':
                container_id = args[1]
                self.starts.append(container_id)
                self.statuses[container_id] = 'running'
                return ''
            raise AssertionError('unexpected Docker operation: %r' % (args,))
        return command

    @contextlib.contextmanager
    def migration_patches(self, fail_stop=None):
        @contextlib.contextmanager
        def policy(root, configs):
            yield

        with mock.patch.object(migration.r, 'inventory',
                               return_value=self.configs), \
                mock.patch.object(migration.r, 'validate', return_value=True), \
                mock.patch.object(migration.r, 'ready', return_value=True), \
                mock.patch.object(
                    migration, 'candidate_metadata',
                    return_value=make_candidate()), \
                mock.patch.object(migration, 'data_mount',
                                  return_value=self.live_data), \
                mock.patch.object(migration, 'preflight'), \
                mock.patch.object(migration.r, 'stamp', return_value='TEST'), \
                mock.patch.object(migration.release, 'backup_policy', policy), \
                mock.patch.object(
                    migration.shutil, 'disk_usage',
                    return_value=type('Disk', (), {'free': 3 * 1024 ** 3})()), \
                mock.patch.object(migration.r, 'docker',
                                  side_effect=self.docker(fail_stop)), \
                mock.patch.object(migration, '_wait_original_ready'), \
                mock.patch.object(migration.release, 'check_worker',
                                  return_value=True), \
                mock.patch.object(migration.release, 'check_database',
                                  return_value=True):
            yield

    def test_partial_stop_failure_restarts_from_pre_stop_baseline(self):
        root = self.make_root()
        with self.migration_patches(fail_stop='app-id'):
            with self.assertRaisesRegex(RuntimeError, 'Docker stop failed'):
                migration.migrate('preview-a2a', root)
        self.assertEqual(self.stops, ['worker-id', 'app-id'])
        self.assertEqual(self.starts, ['worker-id'])
        baseline_path = (root / 'deployments' / 'a2a-TEST' /
                         'database-state-before-stop.json')
        baseline = baseline_path.read_text()
        self.assertIn('safety_alert_state', baseline)
        self.assertIn('"schema"', baseline)
        self.assertIn('"state"', baseline)
        journal = json.loads((root / migration.JOURNAL_NAME).read_text())
        self.assertTrue(journal['exposureAttempted'])
        self.assertEqual(journal['failures'][0]['phase'],
                         'stopping-original-pair')
        self.assertEqual(
            journal['phase'],
            'original-pair-running-after-pre-stop-baseline-checks')

    def test_stopped_snapshot_failure_restarts_from_pre_stop_baseline(self):
        root = self.make_root()
        real_snapshot = migration.database_snapshot
        snapshot_calls = []

        def snapshot(path):
            snapshot_calls.append(path)
            if len(snapshot_calls) == 1:
                raise RuntimeError('Database quick_check failed')
            return real_snapshot(path)

        with self.migration_patches(), \
                mock.patch.object(migration, 'database_snapshot',
                                  side_effect=snapshot):
            with self.assertRaisesRegex(RuntimeError, 'quick_check failed'):
                migration.migrate('preview-a2a', root)
        self.assertEqual(self.stops, ['worker-id', 'app-id'])
        self.assertEqual(self.starts, ['app-id', 'worker-id'])
        journal = json.loads((root / migration.JOURNAL_NAME).read_text())
        self.assertTrue(journal['exposureAttempted'])
        self.assertTrue(journal['failures'])
        self.assertFalse((root / 'deployments' / 'a2a-TEST' /
                          'database-evidence-before-stop.json').exists())

    def test_invalid_stopped_database_refuses_restart(self):
        root = self.make_root()
        valid_state = release.database_state(self.configs)
        self.database.write_bytes(b'this is not SQLite')
        with self.migration_patches(), \
                mock.patch.object(migration.release, 'database_state',
                                  return_value=valid_state), \
                mock.patch.object(
                    migration, 'database_snapshot',
                    side_effect=RuntimeError('Database quick_check failed')):
            with self.assertRaisesRegex(RuntimeError, 'quick_check failed'):
                migration.migrate('preview-a2a', root)
        self.assertEqual(self.stops, ['worker-id', 'app-id'])
        self.assertEqual(self.starts, [])
        journal = json.loads((root / migration.JOURNAL_NAME).read_text())
        self.assertEqual(len(journal['failures']), 2)
        self.assertFalse(journal.get('exposureAttempted'))

    def test_low_disk_refuses_before_preflight_and_again_before_stop(self):
        high = type('Disk', (), {'free': 3 * 1024 ** 3})()
        low = type('Disk', (), {'free': 1 * 1024 ** 3})()
        for readings, expected_preflight in (([low], False), ([high, low], True)):
            with self.subTest(after_preflight=expected_preflight):
                self.make_root()
                with self.migration_patches(), \
                        mock.patch.object(migration.shutil, 'disk_usage',
                                          side_effect=readings), \
                        mock.patch.object(migration, 'preflight') as preflight:
                    with self.assertRaisesRegex(
                            RuntimeError, 'Less than 2 GiB free'):
                        migration.migrate('preview-a2a', self.root)
                self.assertEqual(preflight.called, expected_preflight)
                self.assertEqual(self.stops, [])


class InterruptionRecoveryTests(unittest.TestCase):
    def make_root(self, directory):
        root = (Path(directory) / 'operations').resolve()
        destination = root / 'deployments' / 'a2a-test'
        destination.mkdir(parents=True)
        state = {'schema': 1, 'current': {
            'image': 'sha256:old',
            'containers': [{'id': 'container-id', 'name': 'app'}]}}
        live_data = root.parent / (root.name + '-live-data')
        live_data.mkdir(exist_ok=True)
        database = live_data / 'hello.db'
        initialize_database(database)
        evidence = migration.database_snapshot(database)['evidence']
        evidence_path = destination / 'evidence.json'
        evidence_path.write_text(json.dumps(evidence))
        configs_path = destination / 'containers.json'
        configs_path.write_text(json.dumps([
            {'Id': 'container-id', 'Name': '/app', 'Image': 'sha256:old'}]))
        journal = {
            'schemaVersion': 1, 'procedure': migration.PROCEDURE_NAME,
            'migration': MIGRATION_NAME,
            'phase': 'verified-backup-complete',
            'previousState': state,
            'originalContainers': str(configs_path),
            'databaseEvidence': str(evidence_path),
            'database': {'hostPath': str(database), 'dataMount': str(live_data)},
            'liveResources': {},
        }
        journal_path = root / migration.JOURNAL_NAME
        journal_path.write_text(json.dumps(journal))
        (root / 'retention.json').write_text(json.dumps(state))
        return root, journal_path, destination, evidence_path, live_data

    def test_recovery_takes_privacy_lock_before_validation_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root, journal_path, destination, evidence_path, live_data = self.make_root(directory)
            events = []
            starts = []

            @contextlib.contextmanager
            def policy(operation_root, configs):
                events.append('policy-enter')
                yield
                events.append('policy-exit')

            def docker(*args):
                if args[:2] == ('container', 'inspect'):
                    return json.dumps([{'State': {'Status': 'exited'}}])
                if args[0] == 'start':
                    starts.append(args[1])
                    return ''
                raise AssertionError('unexpected Docker operation: %r' % (args,))

            with mock.patch.object(migration.release, 'backup_policy', policy), \
                    mock.patch.object(migration, '_validate_original_configs'), \
                    mock.patch.object(migration, 'data_mount',
                                      return_value=live_data), \
                    mock.patch.object(migration, 'database_relative_path',
                                      return_value='hello.db'), \
                    mock.patch.object(migration.r, 'docker', side_effect=docker), \
                    mock.patch.object(migration.r, 'inventory',
                                      return_value=[{'Id': 'container-id',
                                                     'Name': '/app'}]), \
                    mock.patch.object(migration.r, 'validate', return_value=True), \
                    mock.patch.object(migration.r, 'ready', return_value=True), \
                    mock.patch.object(migration.release, 'database_state',
                                      return_value={'database': {}}), \
                    mock.patch.object(migration.release, 'check_worker',
                                      return_value=True), \
                    mock.patch.object(migration.release, 'check_database',
                                      return_value=True):
                migration.recover_interrupted(journal_path, root)
            self.assertEqual(events, ['policy-enter', 'policy-exit'])
            self.assertEqual(starts, ['container-id'])
            self.assertIn('original-pair-running-after-invariant-checks',
                          json.loads((destination / 'interruption-recovery.json')
                                     .read_text())['phase'])
            self.assertEqual(events[-1], 'policy-exit')
            self.assertFalse(journal_path.exists())
            recovered = json.loads(
                (destination / 'interruption-recovery.json').read_text())
            self.assertTrue(recovered['recovery']['validated'])
            self.assertFalse(recovered['recovery']['databaseRestored'])

    def test_exposed_interruption_is_never_automatically_recovered(self):
        with tempfile.TemporaryDirectory() as directory:
            root, journal_path, destination, evidence_path, live_data = self.make_root(directory)
            journal = json.loads(journal_path.read_text())
            journal['exposureAttempted'] = True
            journal_path.write_text(json.dumps(journal))
            with mock.patch.object(migration.release, 'backup_policy') as policy:
                with self.assertRaisesRegex(RuntimeError, 'exposed live writes'):
                    migration.recover_interrupted(journal_path, root)
            policy.assert_not_called()
            self.assertTrue(journal_path.exists())

    def test_partial_stop_interruption_uses_pre_stop_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            root, journal_path, destination, evidence_path, live_data = self.make_root(directory)
            baseline_path = destination / 'database-state-before-stop.json'
            baseline_path.write_text(json.dumps({'database': {}}))
            journal = json.loads(journal_path.read_text())
            del journal['databaseEvidence']
            journal['databaseBaseline'] = str(baseline_path)
            journal_path.write_text(json.dumps(journal))
            starts = []

            def docker(*args):
                if args[:2] == ('container', 'inspect'):
                    return json.dumps([{'State': {'Status': 'exited'}}])
                if args[0] == 'start':
                    starts.append(args[1])
                    return ''
                raise AssertionError('unexpected Docker operation: %r' % (args,))

            with mock.patch.object(migration.release, 'backup_policy'), \
                    mock.patch.object(migration, '_validate_original_configs'), \
                    mock.patch.object(migration, 'data_mount',
                                      return_value=live_data), \
                    mock.patch.object(migration, 'database_relative_path',
                                      return_value='hello.db'), \
                    mock.patch.object(migration.r, 'docker', side_effect=docker), \
                    mock.patch.object(migration.r, 'inventory',
                                      return_value=[{'Id': 'container-id',
                                                     'Name': '/app'}]), \
                    mock.patch.object(migration.r, 'validate', return_value=True), \
                    mock.patch.object(migration.r, 'ready', return_value=True), \
                    mock.patch.object(migration.release, 'database_state',
                                      return_value={'database': {}}), \
                    mock.patch.object(migration.release,
                                      'database_state_from_json',
                                      return_value={'database': {}}), \
                    mock.patch.object(migration.release, 'check_worker',
                                      return_value=True), \
                    mock.patch.object(migration.release, 'check_database',
                                      return_value=True):
                migration.recover_interrupted(journal_path, root)
            self.assertEqual(starts, ['container-id'])
            self.assertFalse(journal_path.exists())
            recovered = json.loads((baseline_path.parent /
                                    'interruption-recovery.json').read_text())
            self.assertIsNone(recovered['recovery']['expectedDelta'])
            self.assertTrue(recovered['recovery']['validated'])


if __name__ == '__main__':
    unittest.main()
