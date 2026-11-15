import contextlib
import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release
import retention as r


def pair(version, suffix='', status='exited', mounts=None):
    return [{'Id': version + str(index), 'Image': 'sha256:' + version,
             'Name': '/' + name + suffix, 'State': {'Status': status},
             'Config': {'Image': 'cfp-hello-agent:preview-' + version},
             'Mounts': copy.deepcopy(mounts)} for index, name in enumerate(r.NAMES)]


class RollbackWorld:
    def __init__(self, root):
        self.root = Path(root)
        self.data = self.root / 'data'
        self.data.mkdir()
        self.database = self.data / 'hello.db'
        mounts = [{'Type': 'bind', 'Source': str(self.data), 'Destination': '/data',
                   'RW': True}]
        self.current = pair('current', status='running', mounts=mounts)
        self.rollback = pair('rollback', '-before-current', 'exited', mounts=mounts)
        self.rows = self.current + self.rollback
        self.state = {'schema': 1, 'current': r.record(self.current),
                      'rollback': r.record(self.rollback), 'retired': []}
        self.calls = []
        self.events = []
        self.worker_exits = False
        self.worker_exit_after_ready = False
        self.advance_heartbeat = False
        self.candidate_damage = None
        self.candidate_advance_heartbeat = False
        self.pre_stop_advance_heartbeat = False

        with sqlite3.connect(str(self.database)) as db:
            db.execute('CREATE TABLE safety_alert_state ('
                       'verified_at TEXT NOT NULL, fingerprint TEXT NOT NULL, '
                       'heartbeat_at TEXT)')
            db.execute('INSERT INTO safety_alert_state VALUES '
                       '(?,?,?)', ('2026-11-13T00:00:00Z', 'fingerprint', 'before'))

    def create(self, name, old, image, release_name):
        container = copy.deepcopy(old)
        container['Id'] = 'new-' + name
        container['Name'] = '/' + name
        container['Image'] = image
        container['Config']['Image'] = image
        container['Config']['Labels'] = {'cn.codeforpeople.release': release_name}
        self.rows.append(container)
        return container['Id']

    def _damage_candidate_database(self):
        if self.candidate_damage == 'integrity':
            self.database.write_bytes(b'this is not sqlite')
        elif self.candidate_damage == 'schema':
            db = sqlite3.connect(str(self.database))
            try:
                db.execute('DROP TABLE safety_alert_state')
                db.commit()
            finally:
                db.close()

    def _advance_database_heartbeat(self, value):
        db = sqlite3.connect(str(self.database))
        try:
            db.execute('UPDATE safety_alert_state SET heartbeat_at=?', (value,))
            db.commit()
        finally:
            db.close()

    def docker(self, *args):
        self.calls.append(args)
        self.events.append(('docker', args[0]))
        if args[:2] == ('image', 'inspect'):
            return json.dumps([{'Id': 'sha256:new',
                                'Config': {'Labels': {
                                    'cn.codeforpeople.release': 'preview-new'}}}])
        if args[0] == 'stop':
            next(c for c in self.rows if c['Id'] == args[-1])['State']['Status'] = 'exited'
            if args[-1] == self.current[1]['Id'] and self.pre_stop_advance_heartbeat:
                self._advance_database_heartbeat('before-stop')
        elif args[0] == 'rename':
            next(c for c in self.rows if c['Id'] == args[1])['Name'] = '/' + args[2]
        elif args[0] == 'start':
            cid = args[1]
            if cid in {container['Id'] for container in self.current}:
                self.events.append(('original-start', cid))
            if cid.startswith('new-'):
                self._damage_candidate_database()
                if self.candidate_advance_heartbeat:
                    self._advance_database_heartbeat('candidate')
            elif cid == self.current[1]['Id'] and self.advance_heartbeat:
                self._advance_database_heartbeat('restored')
            status = 'exited' if cid == self.current[1]['Id'] and self.worker_exits else 'running'
            next(c for c in self.rows if c['Id'] == cid)['State']['Status'] = status
        elif args[:3] == ('container', 'rm', '-f'):
            self.rows[:] = [c for c in self.rows if c['Id'] != args[3]]
        return ''


class RollbackTests(unittest.TestCase):
    maxDiff = None

    @contextlib.contextmanager
    def deployment(self, world, ready_failure=False, backup_failure=False):
        real_save = r.save
        real_validate = r.validate
        real_check_worker = release.check_worker
        ready_calls = []

        def save(path, value):
            real_save(path, value)
            world.events.append(('save', path.name))

        def validate(state, rows):
            result = real_validate(state, rows)
            world.events.append(('exact', state is world.state))
            return result

        def ready(state):
            ready_calls.append(state)
            world.events.append(('ready', state is world.state))
            if world.worker_exit_after_ready and len(ready_calls) == 2:
                next(c for c in world.rows if c['Id'] == world.current[1]['Id'])['State']['Status'] = 'exited'
            if ready_failure:
                if len(ready_calls) > 2:
                    raise RuntimeError('restored endpoint unavailable')

        def checked(before, after):
            result = real_check_worker(before, after)
            world.events.append(('worker', result))
            return result

        with patch.object(r, 'inventory', side_effect=lambda: copy.deepcopy(world.rows)), \
                patch.object(r, 'validate', side_effect=validate), \
                patch.object(r, 'ready', side_effect=ready), \
                patch.object(r, 'save', side_effect=save), \
                patch.object(r, 'docker', side_effect=world.docker), \
                patch.object(r, 'cleanup') as cleanup, \
                patch.object(release.shutil, 'disk_usage',
                             return_value=type('Disk', (), {'free': 10 * 1024 ** 3})()), \
                patch.object(release, 'backup_policy'), \
                patch.object(release, 'backup',
                             side_effect=(RuntimeError('early backup failed')
                                          if backup_failure else None)), \
                patch.object(release.verify_runtime, 'verify'), \
                patch.object(release, 'create', side_effect=world.create), \
                patch.object(release.urllib.request, 'urlopen',
                             side_effect=OSError('candidate not ready')), \
                patch.object(release, 'check_worker', side_effect=checked), \
                patch.object(release.time, 'sleep'):
            world.cleanup = cleanup
            root = world.root / 'operations'
            real_save(root / 'retention.json', world.state)
            yield root

    def assert_failed_recovery(self, world, root, message, recovery_started=True):
        with self.deployment(world):
            with self.assertRaisesRegex(RuntimeError, message):
                release.deploy('preview-new', root)
            self.assertTrue((root / 'deployment-journal.json').exists())
            self.assertEqual(json.loads((root / 'retention.json').read_text()), world.state)
            world.cleanup.assert_not_called()
            self.assertFalse(any('--volumes' in call or '-v' in call or
                                 call[0] == 'volume' for call in world.calls))
            if recovery_started:
                self.assertEqual([c['Id'] for c in world.rows[:2]],
                                 [c['Id'] for c in world.current])
        return root

    def test_worker_exit_after_restore_retains_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            world.worker_exits = True
            world.advance_heartbeat = True
            self.assert_failed_recovery(
                world, Path(tmp) / 'operations',
                'original app and worker are exact and running')
            self.assertEqual([c['State']['Status'] for c in world.rows[:2]],
                             ['running', 'exited'])
            self.assertFalse(any(c['Id'].startswith('new-') for c in world.rows))

    def test_worker_stuck_after_restore_retains_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            self.assert_failed_recovery(
                world, Path(tmp) / 'operations',
                'original worker heartbeat advanced after recovery snapshot')
            self.assertEqual([c['State']['Status'] for c in world.rows[:2]],
                             ['running', 'running'])
            self.assertEqual(world.events.count(('worker', False)), 25)

    def test_candidate_heartbeat_does_not_satisfy_restored_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            world.candidate_advance_heartbeat = True
            self.assert_failed_recovery(
                world, Path(tmp) / 'operations',
                'original worker heartbeat advanced after recovery snapshot')
            self.assertEqual([c['State']['Status'] for c in world.rows[:2]],
                             ['running', 'running'])
            session = next((Path(tmp) / 'operations' / 'deployments').iterdir())
            recovery = json.loads((session / 'database-state-recovery.json').read_text())
            heartbeat = next(iter(recovery.values()))['state'][0][3]
            self.assertEqual(heartbeat, 'candidate')
            self.assertLess(
                world.events.index(('save', 'database-state-recovery.json')),
                world.events.index(('original-start', world.current[1]['Id'])))
            self.assertEqual(world.events.count(('worker', False)), 25)

    def test_database_integrity_or_schema_failure_retains_journal(self):
        for damage in ('integrity', 'schema'):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as tmp:
                world = RollbackWorld(tmp)
                world.candidate_damage = damage
                self.assert_failed_recovery(
                    world, Path(tmp) / 'operations',
                    'Rollback recovery heartbeat snapshot failed')
                self.assertEqual([c['State']['Status'] for c in world.rows[:2]],
                                 ['running', 'running'])

    def test_ready_failure_retains_journal_without_manifest_update(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            world.advance_heartbeat = True
            with self.deployment(world, ready_failure=True):
                with self.assertRaisesRegex(RuntimeError, 'original HTTP readiness'):
                    release.deploy('preview-new', Path(tmp) / 'operations')
                root = Path(tmp) / 'operations'
                self.assertTrue((root / 'deployment-journal.json').exists())
                self.assertEqual(json.loads((root / 'retention.json').read_text()), world.state)
                self.assertEqual([event for event in world.events
                                  if event[0] == 'save' and event[1] == 'retention.json'],
                                 [])
                self.assertTrue(any(event == ('worker', True) for event in world.events))
                world.cleanup.assert_not_called()

    def test_worker_exit_after_earlier_recovery_readiness_retains_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            world.advance_heartbeat = True
            world.worker_exit_after_ready = True
            with self.deployment(world):
                root = Path(tmp) / 'operations'
                with self.assertRaisesRegex(
                        RuntimeError,
                        'original app and worker remained exact and running'):
                    release.deploy('preview-new', root)
                self.assertTrue((root / 'deployment-journal.json').exists())
                self.assertEqual(json.loads((root / 'retention.json').read_text()), world.state)
                self.assertEqual([c['State']['Status'] for c in world.rows[:2]],
                                 ['running', 'exited'])
                self.assertEqual([event for event in world.events
                                  if event[0] == 'save' and event[1] == 'retention.json'],
                                 [])
                world.cleanup.assert_not_called()

    def test_successful_rollback_verifies_before_manifest_and_journal_clear(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            world.advance_heartbeat = True
            with self.deployment(world):
                root = Path(tmp) / 'operations'
                with self.assertRaisesRegex(RuntimeError, 'Candidate readiness failed'):
                    release.deploy('preview-new', root)

                self.assertFalse((root / 'deployment-journal.json').exists())
                self.assertEqual(json.loads((root / 'retention.json').read_text()), world.state)
                self.assertEqual([(c['Id'], c['Name'].lstrip('/'), c['Image'],
                                   c['State']['Status']) for c in world.rows[:2]],
                                 [(c['Id'], c['Name'].lstrip('/'), c['Image'], 'running')
                                  for c in world.current])
                self.assertFalse(any(c['Id'].startswith('new-') for c in world.rows))
                world.cleanup.assert_not_called()

                manifest_events = [index for index, event in enumerate(world.events)
                                   if event == ('save', 'retention.json')]
                self.assertEqual(len(manifest_events), 1)
                exact = [index for index, event in enumerate(world.events)
                         if event[0] == 'exact']
                ready = [index for index, event in enumerate(world.events)
                         if event[0] == 'ready']
                workers = [index for index, event in enumerate(world.events)
                           if event == ('worker', True)]
                self.assertLess(workers[-1], exact[-1])
                self.assertLess(exact[-1], ready[-1])
                self.assertLess(ready[-1], manifest_events[-1])

    def test_old_worker_heartbeat_before_stop_requires_new_progress_after_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            world.pre_stop_advance_heartbeat = True
            world.advance_heartbeat = True
            with self.deployment(world):
                root = Path(tmp) / 'operations'
                with self.assertRaisesRegex(RuntimeError, 'Candidate readiness failed'):
                    release.deploy('preview-new', root)

                self.assertFalse((root / 'deployment-journal.json').exists())
                session = next((root / 'deployments').iterdir())
                before_stop = json.loads(
                    (session / 'database-state-before-stop.json').read_text())
                recovery = json.loads(
                    (session / 'database-state-recovery.json').read_text())
                self.assertEqual(next(iter(before_stop.values()))['state'][0][3], 'before')
                self.assertEqual(next(iter(recovery.values()))['state'][0][3], 'before-stop')
                current = sqlite3.connect(str(world.database))
                try:
                    heartbeat = current.execute(
                        'select heartbeat_at from safety_alert_state').fetchone()[0]
                finally:
                    current.close()
                self.assertEqual(heartbeat, 'restored')

    def test_early_backup_failure_has_pre_stop_baseline_and_fail_closed_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = RollbackWorld(tmp)
            root = Path(tmp) / 'operations'
            with self.deployment(world, backup_failure=True):
                with self.assertRaisesRegex(RuntimeError,
                                            'original worker heartbeat advanced after recovery snapshot'):
                    release.deploy('preview-new', root)
                self.assertTrue((root / 'deployment-journal.json').exists())
                session = next((root / 'deployments').iterdir())
                baseline = session / 'database-state-before-stop.json'
                self.assertTrue(baseline.exists())
                self.assertIn('database-state-before-stop.json',
                              json.loads((root / 'deployment-journal.json').read_text())['databaseBaseline'])
                self.assertLess(world.events.index(('save', 'database-state-before-stop.json')),
                                world.events.index(('docker', 'stop')))
                self.assertEqual(json.loads((root / 'retention.json').read_text()), world.state)
                self.assertEqual([c['State']['Status'] for c in world.rows[:2]],
                                 ['running', 'running'])
                world.cleanup.assert_not_called()


if __name__ == '__main__':
    unittest.main()
