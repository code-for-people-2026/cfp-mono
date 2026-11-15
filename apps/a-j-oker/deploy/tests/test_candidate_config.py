import json
import os
import sys
import unittest
from copy import deepcopy
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import verify_runtime
import release


def make_old_container():
    return {
        'Config': {
            'Image': 'old-image-id',
            'Hostname': 'old-hostname',
            'WorkingDir': '/app/apps/hello-agent',
            'Cmd': [
                '--import', 'tsx', 'scripts/feishu-alerts.ts', '--worker',
            ],
            'Entrypoint': ['node'],
            'Env': [
                'HELLO_RELEASE=old-release',
                'FEISHU_APP_ID=secret-placeholder',
                'FEISHU_APP_SECRET=secret-placeholder',
            ],
            'Labels': {
                'com.example.keep': 'yes',
            },
        },
        'HostConfig': {
            'Binds': ['production-data:/srv/data'],
            'RestartPolicy': {'Name': 'always'},
            'Privileged': True,
        },
    }


class CandidateConfigTests(unittest.TestCase):
    def test_accepts_candidate_and_legacy_working_dirs(self):
        for working_dir in ('/app/apps/a-j-oker', '/app/apps/hello-agent'):
            with self.subTest(working_dir=working_dir):
                old = make_old_container()
                image = {
                    'Id': 'candidate-image-id',
                    'Config': {'WorkingDir': working_dir},
                }

                config = verify_runtime.candidate_config(
                    old, image, release='new-release')

                self.assertEqual(config['WorkingDir'], working_dir)
                self.assertEqual(config['Image'], 'candidate-image-id')

    def test_rejects_unknown_and_missing_working_dirs(self):
        for working_dir in ('/app/apps/unknown-agent', None):
            with self.subTest(working_dir=working_dir):
                old = make_old_container()
                image = {
                    'Id': 'candidate-image-id',
                    'Config': ({'WorkingDir': working_dir}
                               if working_dir is not None else {}),
                }

                with self.assertRaises(RuntimeError) as raised:
                    verify_runtime.candidate_config(old, image)

                self.assertIn(repr(working_dir), str(raised.exception))

    def test_preserves_runtime_configuration_and_original_old_container(self):
        old = make_old_container()
        old_before = deepcopy(old)
        image = {
            'Id': 'candidate-image-id',
            'Config': {'WorkingDir': '/app/apps/a-j-oker'},
        }

        config = verify_runtime.candidate_config(
            old, image, release='new-release')

        self.assertEqual(config['Image'], 'candidate-image-id')
        self.assertEqual(
            config['Cmd'],
            ['--import', 'tsx', 'scripts/feishu-alerts.ts', '--worker'])
        self.assertEqual(config['Entrypoint'], ['node'])
        self.assertEqual(
            config['Env'],
            [
                'FEISHU_APP_ID=secret-placeholder',
                'FEISHU_APP_SECRET=secret-placeholder',
                'HELLO_RELEASE=new-release',
            ])
        self.assertEqual(
            config['Labels'],
            {
                'com.example.keep': 'yes',
                'cn.codeforpeople.service': 'hello-agent',
                'cn.codeforpeople.release': 'new-release',
            })
        self.assertNotIn('Hostname', config)
        self.assertEqual(old, old_before)


@mock.patch.object(verify_runtime, 'register_resource', return_value='snapshot-id')
@mock.patch.object(verify_runtime, 'copy_mount', return_value={'schema': 'resource'})
class SmokeConfigTests(unittest.TestCase):
    def test_smoke_uses_candidate_config_and_isolates_host_config(
            self, copy_mount, register_resource):
        old = make_old_container()
        old['NetworkSettings'] = {'Networks': {}}
        old['Mounts'] = [{
            'Type': 'bind',
            'Source': '/opt/cfp-hello-agent/database',
            'Destination': '/var/lib/mysql',
        }]
        old['HostConfig'].update({
            'ReadonlyRootfs': True,
            'SecurityOpt': ['no-new-privileges'],
        })
        image = 'candidate-image'
        metadata = {
            'Id': 'candidate-image-id',
            'Size': 1,
            'Config': {'WorkingDir': '/app/apps/a-j-oker'},
        }
        candidate_config = {
            'Image': 'candidate-image-id',
            'WorkingDir': '/app/apps/a-j-oker',
            'Cmd': ['candidate-command'],
            'Entrypoint': ['node'],
            'Env': ['HELLO_RELEASE=runtime-smoke'],
            'Labels': {'candidate': 'config'},
        }

        def fake_run(*args):
            if args[:3] == ('docker', 'image', 'inspect'):
                return json.dumps([metadata])
            if args[:2] == ('docker', 'inspect'):
                return json.dumps([old])
            if args[:2] == ('docker', 'exec'):
                raise RuntimeError('stop after container creation')
            return ''

        unix_http = mock.MagicMock()
        connection = unix_http.return_value
        connection.getresponse.return_value.status = 201
        connection.getresponse.return_value.read.return_value = (
            b'{"Id": "candidate-container-id"}')

        with mock.patch.object(verify_runtime, 'run', side_effect=fake_run), \
                mock.patch.object(
                    verify_runtime, 'candidate_config',
                    return_value=candidate_config) as candidate, \
                mock.patch.object(verify_runtime, 'UnixHTTP', unix_http), \
                mock.patch('pathlib.Path.mkdir'):
            with self.assertRaises(RuntimeError) as raised:
                verify_runtime.verify(image, same_source=True)

        self.assertEqual(str(raised.exception), 'stop after container creation')
        self.assertEqual(candidate.call_count, 1)
        self.assertEqual(candidate.call_args[0][0], old)
        self.assertEqual(candidate.call_args[0][1], metadata)
        self.assertEqual(candidate.call_args[0][2], 'runtime-smoke')

        create_calls = [
            call for call in connection.request.call_args_list
            if (call[0][0] == 'POST' and
                call[0][1].startswith('/containers/create?name='))
        ]
        self.assertEqual(len(create_calls), 1)
        create_call = create_calls[0]
        self.assertIn('name=cfp-hello-agent-smoke-', create_call[0][1])
        body = json.loads(create_call[0][2])
        self.assertEqual(
            {key: body[key] for key in candidate_config},
            candidate_config)

        host_config = body['HostConfig']
        self.assertEqual(host_config['Binds'][0].split(':', 1)[1],
                         '/var/lib/mysql')
        self.assertEqual(host_config['RestartPolicy'], {'Name': 'no'})
        self.assertEqual(host_config['NetworkMode'], 'none')
        self.assertEqual(host_config['PortBindings'], {})
        self.assertEqual(host_config['Mounts'], [])
        self.assertIsNone(host_config['VolumesFrom'])
        self.assertIsNone(host_config['Links'])
        for field, value in old['HostConfig'].items():
            if field not in ('Binds', 'RestartPolicy'):
                self.assertEqual(host_config[field], value)

        headers = create_call[0][3]
        self.assertEqual(headers, {'Content-Type': 'application/json'})
        self.assertTrue(unix_http.called)
        self.assertTrue(copy_mount.called)
        self.assertTrue(register_resource.called)


class ReleaseCreateTests(unittest.TestCase):
    def test_release_create_uses_candidate_config_and_preserves_host_config(self):
        old = make_old_container()
        old_before = deepcopy(old)
        metadata = {
            'Id': 'candidate-image-id',
            'Config': {'WorkingDir': '/app/apps/a-j-oker'},
        }
        unix_http = mock.MagicMock()
        connection = unix_http.return_value
        connection.getresponse.return_value.status = 201
        connection.getresponse.return_value.read.return_value = (
            b'{"Id": "candidate-container-id"}')

        with mock.patch.object(
                    verify_runtime, 'run',
                    return_value=json.dumps([metadata])) as run, \
                mock.patch.object(release, 'UnixHTTP', unix_http):
            created_id = release.create(
                'cfp-hello-agent-full', old, 'candidate-image-id', 'preview-new')

        self.assertEqual(created_id, 'candidate-container-id')
        run.assert_called_once_with(
            'docker', 'image', 'inspect', 'candidate-image-id')
        connection.request.assert_called_once_with(
            'POST', '/containers/create?name=cfp-hello-agent-full',
            mock.ANY, {'Content-Type': 'application/json'})
        request = json.loads(connection.request.call_args[0][2])
        self.assertEqual(request['Image'], 'candidate-image-id')
        self.assertEqual(request['WorkingDir'], '/app/apps/a-j-oker')
        self.assertEqual(
            request['Cmd'],
            ['--import', 'tsx', 'scripts/feishu-alerts.ts', '--worker'])
        self.assertEqual(request['Entrypoint'], ['node'])
        self.assertIn('HELLO_RELEASE=preview-new', request['Env'])
        self.assertNotIn('HELLO_RELEASE=old-release', request['Env'])
        self.assertEqual(request['HostConfig'], old['HostConfig'])
        self.assertEqual(old, old_before)


if __name__ == '__main__':
    unittest.main()
