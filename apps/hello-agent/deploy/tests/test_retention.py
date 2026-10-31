import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import retention as r
import release


def pair(version, suffix='', status='exited'):
    return [{'Id': version + str(i), 'Image': 'sha256:' + version,
             'Name': '/' + name + suffix, 'State': {'Status': status},
             'Config': {'Image': 'cfp-hello-agent:preview-' + version},
             'Mounts': []} for i, name in enumerate(r.NAMES)]


def fixture():
    current = pair('current', status='running')
    rollback = pair('rollback', '-before-current')
    old = pair('old', '-before-rollback')
    state = {'schema': 1, 'current': r.record(current), 'rollback': r.record(rollback),
             'retired': [r.record(old)]}
    return state, current + rollback + old


class RetentionTests(unittest.TestCase):
    def test_only_explicitly_retired_versions_are_candidates(self):
        state, rows = fixture()
        rows += pair('pending', '-pending', 'created') + pair('foreign', '-other', 'exited')
        self.assertEqual(r.plan(state, rows), state['retired'])

    def test_runtime_drift_or_missing_rollback_fails_closed(self):
        for position in [0, 1, 2, 3]:
            state, rows = fixture()
            rows[position]['Image'] = 'sha256:changed'
            with self.assertRaises(RuntimeError):
                r.plan(state, rows)
        state, rows = fixture()
        with self.assertRaises(RuntimeError):
            r.plan(state, rows[1:])

    def test_restarted_retired_container_is_not_deleted(self):
        state, rows = fixture()
        rows[-1]['State']['Status'] = 'running'
        with self.assertRaises(RuntimeError):
            r.plan(state, rows)

    def test_unknown_reference_protects_even_retired_image(self):
        state, rows = fixture()
        other = copy.deepcopy(rows[-1]); other['Id'] = 'unknown'; rows.append(other)
        self.assertEqual(r.plan(state, rows), [])

    def test_protected_image_cannot_be_marked_retired(self):
        state, rows = fixture()
        state['retired'].append(state['rollback'])
        with self.assertRaises(RuntimeError):
            r.plan(state, rows)

    def test_partial_cleanup_is_idempotent(self):
        state, rows = fixture()
        self.assertEqual(r.plan(state, rows[:-2]), state['retired'])

    def test_apply_only_removes_recorded_ids_and_never_volumes(self):
        state, rows = fixture()
        calls = []
        def docker(*args):
            calls.append(args)
            if args[:2] == ('container', 'rm'):
                rows[:] = [x for x in rows if x['Id'] != args[2]]
            if args[:2] == ('image', 'ls'):
                return 'sha256:old'
            if args[:2] == ('image', 'inspect'):
                return json.dumps([{'Id': 'sha256:old', 'RepoTags': ['cfp-hello-agent:preview-old']}])
            return ''
        with tempfile.TemporaryDirectory() as tmp, patch.object(r, 'inventory', side_effect=lambda: copy.deepcopy(rows)), patch.object(r, 'ready'), patch.object(r, 'docker', side_effect=docker):
            root = Path(tmp)
            sentinel = root / 'business-data'; sentinel.write_text('must survive')
            r.cleanup(state, root, apply=True)
            self.assertEqual(sentinel.read_text(), 'must survive')
            self.assertEqual(len(rows), 4)
            self.assertEqual(json.loads((root / 'retention.json').read_text())['retired'], [])
        self.assertEqual([c for c in calls if c[0] == 'container'], [('container', 'rm', 'old0'), ('container', 'rm', 'old1')])
        self.assertFalse(any('--force' in c or '-f' in c or '--volumes' in c or '-v' in c or c[0] == 'volume' for c in calls))

    def test_interrupted_deployment_blocks_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'deployment-journal.json').write_text('{}')
            with patch.object(r, 'inventory') as inspect, self.assertRaises(RuntimeError):
                r.cleanup(fixture()[0], Path(tmp), True)
            inspect.assert_not_called()

    def test_failed_readiness_prevents_all_mutations(self):
        state, rows = fixture()
        with patch.object(r, 'inventory', return_value=rows), patch.object(r, 'ready', side_effect=RuntimeError('down')), patch.object(r, 'docker') as docker, tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(RuntimeError):
                r.cleanup(state, Path(tmp), True)
            docker.assert_not_called()

    def test_worker_confirmation_and_schema_must_survive(self):
        before = {'db': {'schema': [('a',)], 'state': [(1, 'verified', 'fingerprint', 'old')]}}
        after = copy.deepcopy(before); after['db']['state'][0] = (1, 'verified', 'fingerprint', 'new')
        self.assertTrue(release.check_worker(before, after))
        after['db']['state'][0] = (1, 'changed', 'fingerprint', 'new')
        with self.assertRaises(RuntimeError):
            release.check_worker(before, after)

    def test_failed_candidate_restores_current_without_removing_rollback(self):
        state, rows = fixture()
        calls = []
        def docker(*args):
            calls.append(args)
            if args[:2] == ('image', 'inspect'):
                return json.dumps([{'Id': 'sha256:new', 'Config': {'Labels': {'cn.codeforpeople.release': 'preview-new'}}}])
            if args[0] == 'stop':
                next(c for c in rows if c['Id'] == args[-1])['State']['Status'] = 'exited'
            if args[0] == 'rename':
                next(c for c in rows if c['Id'] == args[1])['Name'] = '/' + args[2]
            return ''
        with tempfile.TemporaryDirectory() as tmp, patch.object(r, 'inventory', side_effect=lambda: copy.deepcopy(rows)), patch.object(r, 'ready'), patch.object(r, 'docker', side_effect=docker), patch.object(release.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 10 * 1024 ** 3})()), patch.object(release, 'backup', return_value={}), patch.object(release.verify_runtime, 'verify'), patch.object(release, 'create', side_effect=RuntimeError('candidate create failed')):
            root = Path(tmp); r.save(root / 'retention.json', state)
            with self.assertRaisesRegex(RuntimeError, 'candidate create failed'):
                release.deploy('preview-new', root)
            self.assertEqual(json.loads((root / 'retention.json').read_text()), state)
            self.assertFalse((root / 'deployment-journal.json').exists())
            self.assertEqual([c['Name'] for c in rows[:2]], ['/' + n for n in r.NAMES])
        self.assertFalse(any('rollback0' in c or 'rollback1' in c for c in calls))
        self.assertIn(('start', 'current0'), calls)
        self.assertIn(('start', 'current1'), calls)

    def test_verified_digest_release_promotes_then_cleans_previous_rollback(self):
        state, rows = fixture()
        state['retired'] = []
        rows = rows[:4]
        def docker(*args):
            if args[:2] == ('image', 'inspect'):
                return json.dumps([{'Id': 'sha256:new', 'Config': {'Labels': {'cn.codeforpeople.release': 'preview-new'}}}])
            if args[0] == 'stop':
                next(c for c in rows if c['Id'] == args[-1])['State']['Status'] = 'exited'
            if args[0] == 'rename':
                next(c for c in rows if c['Id'] == args[1])['Name'] = '/' + args[2]
            if args[0] == 'start':
                next(c for c in rows if c['Id'] == args[1])['State']['Status'] = 'running'
            return ''
        def create(name, old, image, release_name):
            c = copy.deepcopy(old); c['Id'] = 'new' + name; c['Name'] = '/' + name
            c['Image'] = image; c['Config']['Image'] = image
            rows.append(c); return c['Id']
        class Response:
            def __enter__(self):
                import io
                return io.StringIO('{"ok":true,"release":"preview-new"}')
            def __exit__(self, *args): pass
        with tempfile.TemporaryDirectory() as tmp, patch.object(r, 'inventory', side_effect=lambda: copy.deepcopy(rows)), patch.object(r, 'ready'), patch.object(r, 'docker', side_effect=docker), patch.object(release.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 10 * 1024 ** 3})()), patch.object(release, 'backup', return_value={}), patch.object(release.verify_runtime, 'verify'), patch.object(release, 'create', side_effect=create), patch.object(release.urllib.request, 'urlopen', return_value=Response()), patch.object(release, 'database_state', return_value={}), patch.object(release, 'check_worker', return_value=True), patch.object(r, 'cleanup') as cleanup:
            root = Path(tmp); r.save(root / 'retention.json', state)
            release.deploy('preview-new', root)
            saved = json.loads((root / 'retention.json').read_text())
            self.assertEqual(saved['current']['image'], 'sha256:new')
            self.assertEqual(saved['rollback']['image'], 'sha256:current')
            self.assertEqual(saved['retired'], [state['rollback']])
            self.assertFalse((root / 'deployment-journal.json').exists())
            cleanup.assert_called_once_with(saved, root=root, apply=True)

    def test_offline_smoke_failure_never_stops_live_services(self):
        state, rows = fixture()
        def docker(*args):
            if args[:2] == ('image', 'inspect'):
                return json.dumps([{'Id': 'sha256:new', 'Config': {'Labels': {'cn.codeforpeople.release': 'preview-new'}}}])
            raise AssertionError('Unexpected mutation before offline smoke passed: ' + str(args))
        with tempfile.TemporaryDirectory() as tmp, patch.object(r, 'inventory', return_value=rows), patch.object(r, 'ready'), patch.object(r, 'docker', side_effect=docker), patch.object(release.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 10 * 1024 ** 3})()), patch.object(release.verify_runtime, 'verify', side_effect=RuntimeError('offline snapshot failed')):
            root = Path(tmp); r.save(root / 'retention.json', state)
            with self.assertRaisesRegex(RuntimeError, 'offline snapshot failed'):
                release.deploy('preview-new', root)
            self.assertEqual(json.loads((root / 'retention.json').read_text()), state)
            self.assertFalse((root / 'deployment-journal.json').exists())


if __name__ == '__main__':
    unittest.main()
