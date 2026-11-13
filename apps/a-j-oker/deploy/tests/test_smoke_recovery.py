import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import verify_runtime as smoke
import retention as r
import release


def candidate_fixture(working_dir):
    old = {
        'Id': 'old-container-id',
        'Name': '/cfp-hello-agent-full-preview',
        'Config': {
            'Hostname': 'old-hostname',
            'Image': 'sha256:old',
            'WorkingDir': '/app/apps/hello-agent',
            'Env': [
                'HELLO_RELEASE=preview-old',
                'HELLO_DATABASE_URI=file:/data/hello.db',
                'NODE_ENV=production',
            ],
            'Labels': {
                'cn.codeforpeople.service': 'hello-agent',
                'cn.codeforpeople.release': 'preview-old',
                'cfp.example/keep': 'yes',
            },
            'Entrypoint': ['node'],
            'Cmd': ['server.js'],
            'User': 'node',
        },
        'HostConfig': {
            'Binds': [
                '/opt/cfp-hello-agent/data:/data',
                '/opt/cfp-hello-agent/ledger:/privacy-ledger',
            ],
            'Mounts': [
                {'Type': 'bind', 'Source': '/opt/cfp-hello-agent/data',
                 'Target': '/data', 'RW': True},
                {'Type': 'bind', 'Source': '/opt/cfp-hello-agent/ledger',
                 'Target': '/privacy-ledger', 'RW': True},
            ],
            'PortBindings': {'3310/tcp': [{'HostPort': '3318'}]},
        },
    }
    metadata = {'Id': 'sha256:new', 'Config': {'WorkingDir': working_dir}}
    return old, metadata


class CandidateConfigTests(unittest.TestCase):
    def test_supports_legacy_and_renamed_image_working_directories(self):
        for working_dir in ('/app/apps/hello-agent', '/app/apps/a-j-oker'):
            with self.subTest(working_dir=working_dir):
                old, metadata = candidate_fixture(working_dir)
                before = copy.deepcopy(old)
                config = smoke.candidate_config(old, metadata, 'preview-new')

                self.assertEqual(config['WorkingDir'], working_dir)
                self.assertEqual(config['Image'], 'sha256:new')
                self.assertNotIn('Hostname', config)
                self.assertEqual(config['Env'], [
                    'HELLO_DATABASE_URI=file:/data/hello.db',
                    'NODE_ENV=production',
                    'HELLO_RELEASE=preview-new',
                ])
                self.assertEqual(config['Labels'], {
                    'cn.codeforpeople.service': 'hello-agent',
                    'cn.codeforpeople.release': 'preview-new',
                    'cfp.example/keep': 'yes',
                })
                self.assertEqual(config['Entrypoint'], ['node'])
                self.assertEqual(config['Cmd'], ['server.js'])
                self.assertEqual(config['User'], 'node')
                self.assertEqual(old, before)

    def test_rejects_candidate_images_outside_the_working_directory_allowlist(self):
        for working_dir in (None, '', '/app', '/app/apps/hello-agent/../a-j-oker',
                            '/app/apps/other-agent'):
            with self.subTest(working_dir=working_dir):
                old, metadata = candidate_fixture(working_dir)
                before = copy.deepcopy(old)
                with self.assertRaisesRegex(
                        RuntimeError, 'Unsupported candidate image WorkingDir'):
                    smoke.candidate_config(old, metadata, 'preview-new')
                self.assertEqual(old, before)

    def test_release_create_sends_candidate_config_with_original_host_mounts(self):
        class Response:
            status = 201

            def read(self):
                return b'{"Id":"new-container-id"}'

        class Connection:
            requests = []

            def __init__(self, host):
                self.request_data = None

            def request(self, method, path, body, headers=None):
                self.request_data = (method, path, json.loads(body), headers)
                Connection.requests.append(self.request_data)

            def getresponse(self):
                return Response()

            def close(self):
                pass

        old, metadata = candidate_fixture('/app/apps/a-j-oker')
        before = copy.deepcopy(old)
        Connection.requests = []
        with patch.object(smoke, 'run', return_value=json.dumps([metadata])) as inspect_image, \
                patch.object(release, 'UnixHTTP', Connection):
            container_id = release.create(
                'cfp-hello-agent-full-preview', old, 'sha256:new', 'preview-new')

        self.assertEqual(container_id, 'new-container-id')
        inspect_image.assert_called_once_with('docker', 'image', 'inspect', 'sha256:new')
        method, path, payload, headers = Connection.requests[0]
        self.assertEqual(method, 'POST')
        self.assertEqual(
            path, '/containers/create?name=cfp-hello-agent-full-preview')
        self.assertEqual(headers, {'Content-Type': 'application/json'})
        self.assertEqual(payload['WorkingDir'], '/app/apps/a-j-oker')
        self.assertEqual(payload['Image'], 'sha256:new')
        self.assertEqual(payload['Env'], [
            'HELLO_DATABASE_URI=file:/data/hello.db',
            'NODE_ENV=production',
            'HELLO_RELEASE=preview-new',
        ])
        self.assertEqual(payload['HostConfig'], old['HostConfig'])
        self.assertEqual(old, before)


class SmokeRecoveryTests(unittest.TestCase):
    def test_recovers_interrupted_container_and_sidecars_preserving_business_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve() / 'smoke' / '20261101T000000000000Z'
            target = root / 'mount-0'; target.mkdir(parents=True)
            (target / 'hello.db').write_bytes(b'SQLite format 3\0fixture')
            (target / 'hello.db-wal').write_text('pending')
            business = Path(tmp) / 'live.db'; business.write_text('keep')
            name = 'cfp-hello-agent-smoke-' + root.name.lower()
            mounts = [{'Source': str(target), 'Destination': '/data', 'RW': True}]
            smoke.register_resource(root, name, 'sha256:test', mounts)
            container = {'Id': 'owned', 'Name': '/' + name, 'Image': 'sha256:test',
                         'Mounts': mounts, 'HostConfig': {'NetworkMode': 'none'}}
            rows = [container]
            def run(*args):
                self.assertEqual(args, ('docker', 'rm', '-f', 'owned'))
                rows.clear()
            with patch.object(r, 'inventory', side_effect=lambda: copy.deepcopy(rows)), patch.object(smoke, 'run', side_effect=run):
                smoke.recover(root.parent)
                smoke.recover(root.parent)
            self.assertFalse(target.exists())
            self.assertFalse((root / 'resources.json').exists())
            self.assertEqual(business.read_text(), 'keep')

    def test_failed_docker_removal_retains_journal_then_next_run_recovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve() / 'smoke' / '20261101T000000000000Z'
            target = root / 'mount-0'; target.mkdir(parents=True)
            (target / 'hello.db').write_text('snapshot')
            name = 'cfp-hello-agent-smoke-' + root.name.lower()
            mounts = [{'Source': str(target), 'Destination': '/snapshot', 'RW': True}]
            smoke.register_resource(root, name, 'sha256:test', mounts)
            rows = [{'Id': 'owned', 'Name': '/' + name, 'Image': 'sha256:test', 'Mounts': mounts, 'HostConfig': {'NetworkMode': 'none'}}]
            with patch.object(r, 'inventory', return_value=rows), patch.object(smoke, 'run', side_effect=RuntimeError('docker unavailable')):
                with self.assertRaises(RuntimeError): smoke.recover(root.parent)
            self.assertTrue(target.exists())
            self.assertTrue((root / 'resources.json').exists())
            with patch.object(r, 'inventory', return_value=[]): smoke.recover(root.parent)
            self.assertFalse(target.exists())

    def test_foreign_reference_blocks_snapshot_deletion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve() / 'smoke' / '20261101T000000000000Z'
            target = root / 'mount-0'; target.mkdir(parents=True)
            rows = [{'Id': 'foreign', 'Name': '/business', 'Image': 'sha256:other',
                     'Mounts': [{'Source': str(target), 'Destination': '/data', 'RW': True}]}]
            with patch.object(r, 'inventory', return_value=rows), patch.object(smoke, 'run') as run:
                with self.assertRaises(RuntimeError): smoke.recover(root.parent)
                run.assert_not_called()
            self.assertTrue(target.exists())

    def test_legacy_orphan_without_journal_is_removed_only_when_unreferenced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve() / 'smoke' / '20261101T000000000000Z'
            target = root / 'mount-0'; target.mkdir(parents=True)
            (target / 'ledger').write_text('disposable copy')
            (root / 'receipt.json').write_text('{}')
            with patch.object(r, 'inventory', return_value=[]): smoke.recover(root.parent)
            self.assertFalse(target.exists())
            self.assertTrue((root / 'receipt.json').exists())

    def test_symlinked_session_never_traversed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve() / 'smoke'; root.mkdir()
            live = Path(tmp) / 'live'; live.mkdir()
            (root / '20261101T000000000000Z').symlink_to(live, target_is_directory=True)
            with patch.object(r, 'inventory', return_value=[]):
                with self.assertRaises(RuntimeError): smoke.recover(root)
            self.assertTrue(live.exists())

    def test_privacy_job_recovery_failure_blocks_expiration_and_service_stop(self):
        spec = importlib.util.spec_from_file_location('privacy_operations', str(Path(__file__).resolve().parents[2] / 'scripts/privacy-operations.py'))
        privacy = importlib.util.module_from_spec(spec); spec.loader.exec_module(privacy)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('data', 'ledger', 'state', 'backups'):
                (root / name).mkdir()
            (root / 'ledger/deletions.ndjson').touch()
            config = {'container': 'web', 'dataDir': str(root / 'data'),
                      'ledgerDir': str(root / 'ledger'), 'stateDir': str(root / 'state'),
                      'backupDir': str(root / 'backups'), 'smokeCleanupScript': '/approved/verify_runtime.py'}
            meta = {'Mounts': [{'Destination': '/data', 'Source': config['dataDir']},
                              {'Destination': '/privacy-ledger', 'Source': config['ledgerDir']}],
                    'Config': {'Env': ['HELLO_DATABASE_URI=file:/data/hello.db',
                                      'HELLO_PRIVACY_DELETION_LEDGER=/privacy-ledger/deletions.ndjson',
                                      'HELLO_PRIVACY_BACKUP_DAYS=7']}}
            calls = []
            def run(args):
                calls.append(args)
                if args[:2] == ['docker', 'inspect']: return json.dumps([meta])
                if args == ['python3', config['smokeCleanupScript'], '--cleanup']:
                    raise RuntimeError('recovery failed')
                self.fail('privacy job continued after failed recovery')
            with patch.object(privacy, 'run', side_effect=run), patch.object(privacy, 'prune_backups') as prune:
                with self.assertRaisesRegex(RuntimeError, 'recovery failed'):
                    privacy.operate(config)
                prune.assert_not_called()
            self.assertEqual(json.loads((root / 'state/status.json').read_text())['stage'], 'recover-smoke-snapshots')
            self.assertFalse(any(c[:2] == ['docker', 'stop'] for c in calls))

if __name__ == '__main__':
    unittest.main()
