import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import reconcile
import release
import retention as r
import verify_runtime


FULL_ID = 'sha256:' + 'a' * 64


def container(version, role_index, suffix, status, image_id, mounts=None):
    name = r.NAMES[role_index] + suffix
    cid = hashlib.sha256((version + name).encode()).hexdigest()
    if mounts is None:
        mounts = [
            {'Type': 'bind', 'Source': '/opt/test/data', 'Destination': '/data', 'RW': True},
        ]
        if role_index == 0:
            mounts.append({'Type': 'bind', 'Source': '/opt/test/ledger',
                           'Destination': '/privacy-ledger', 'RW': True})
    return {
        'Id': cid,
        'Image': image_id,
        'Name': '/' + name,
        'State': {'Status': status},
        'Config': {'Image': 'cfp-hello-agent:preview-' + version},
        'Mounts': mounts,
    }


def version(version, status='exited'):
    image_id = 'sha256:' + hashlib.sha256(version.encode()).hexdigest()
    suffix = '' if status == 'running' else '-before-' + version
    pair = [container(version, index, suffix, status, image_id)
            for index in range(len(r.NAMES))]
    return {'image': image_id, 'tag': 'cfp-hello-agent:preview-' + version,
            'containers': [{'id': item['Id'], 'name': item['Name'].lstrip('/')}
                           for item in pair]}, pair


def fixture():
    current, current_pair = version('new', 'running')
    rollback, rollback_pair = version('old')
    retired, retired_pair = version('older')
    state = {'schema': 1, 'current': current, 'rollback': rollback,
             'retired': [retired]}
    previous = {'schema': 1, 'current': copy.deepcopy(rollback),
                'rollback': copy.deepcopy(retired), 'retired': []}
    return state, previous, current_pair + rollback_pair + retired_pair


def write_plan(root, state, previous=None):
    root.mkdir(parents=True)
    previous = previous or fixture()[1]
    r.save(root / 'retention.json', previous)
    digest = hashlib.sha256((root / 'retention.json').read_bytes()).hexdigest()
    plan = root / 'plan.json'
    plan.write_text(json.dumps({'expectedManifestSha256': digest, 'state': state}))
    return plan


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'operations'
        self.state, self.previous, self.rows = fixture()
        self.plan = write_plan(self.root, self.state, self.previous)

    def tearDown(self):
        self.tmp.cleanup()

    def docker(self, *args):
        if args[:2] != ('image', 'inspect'):
            raise AssertionError('unexpected docker command: ' + str(args))
        if args[2].endswith('new'):
            image = self.state['current']['image']
        elif args[2].endswith('old'):
            image = self.state['rollback']['image']
        else:
            image = self.state['retired'][0]['image']
        return json.dumps([{'Id': image}])

    def test_dry_run_validates_and_does_not_smoke_or_mutate(self):
        with patch.object(r, 'inventory', return_value=copy.deepcopy(self.rows)), \
                patch.object(r, 'ready'), patch.object(r, 'docker', side_effect=self.docker), \
                patch.object(release, 'backup_policy') as policy, \
                patch.object(verify_runtime, 'verify') as verify:
            reconcile.reconcile(self.plan, self.root, False)
        policy.assert_not_called()
        verify.assert_not_called()
        self.assertEqual(json.loads((self.root / 'retention.json').read_text()), self.previous)

    def test_apply_verifies_rollback_then_saves_private_receipt_and_state(self):
        seen = {}
        @contextlib.contextmanager
        def policy(root, configs):
            seen['root'] = root
            seen['configs'] = configs
            yield
        smoke = {'image': self.state['rollback']['image'], 'checks': {'ready': True}}
        with patch.object(r, 'inventory', return_value=copy.deepcopy(self.rows)), \
                patch.object(r, 'ready'), patch.object(r, 'docker', side_effect=self.docker), \
                patch.object(r, 'stamp', return_value='fixed'), \
                patch.object(release, 'backup_policy', side_effect=policy), \
                patch.object(verify_runtime, 'verify', return_value=smoke) as verify:
            reconcile.reconcile(self.plan, self.root, True)
        verify.assert_called_once_with(self.state['rollback']['tag'])
        self.assertEqual(seen['root'], self.root)
        self.assertEqual([item['Id'] for item in seen['configs']],
                         [item['id'] for item in self.state['current']['containers']])
        self.assertEqual(json.loads((self.root / 'retention.json').read_text()), self.state)
        receipt = json.loads((self.root / 'reconciliations/fixed.json').read_text())
        self.assertEqual(receipt, {'schema': 1, 'previous': self.previous,
                                   'proposed': self.state, 'smoke': smoke})
        self.assertEqual(receipt['previous']['current']['image'],
                         receipt['proposed']['rollback']['image'])

    def test_stale_manifest_digest_fails_before_inventory(self):
        plan = self.root / 'stale.json'
        plan.write_text(json.dumps({'expectedManifestSha256': '0' * 64, 'state': self.state}))
        with patch.object(r, 'inventory') as inventory:
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(plan, self.root, False)
        inventory.assert_not_called()

    def test_deployment_journal_blocks_reconcile(self):
        (self.root / 'deployment-journal.json').write_text('{}')
        with patch.object(r, 'inventory') as inventory:
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(self.plan, self.root, False)
        inventory.assert_not_called()

    def test_unknown_reference_to_retired_image_fails(self):
        unknown = copy.deepcopy(self.rows[-1])
        unknown['Id'] = 'f' * 64
        unknown['Name'] = '/unknown'
        rows = self.rows + [unknown]
        with patch.object(r, 'inventory', return_value=rows), patch.object(r, 'ready'):
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(self.plan, self.root, False)

    def test_version_mount_must_match_current_role(self):
        rows = copy.deepcopy(self.rows)
        rows[2]['Mounts'].append({'Type': 'bind', 'Source': '/opt/test/foreign',
                                  'Destination': '/foreign', 'RW': False})
        with patch.object(r, 'inventory', return_value=rows), patch.object(r, 'ready'):
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(self.plan, self.root, False)

    def test_prior_version_cannot_be_omitted(self):
        omitted = copy.deepcopy(self.state)
        omitted['retired'] = []
        plan = self.root / 'omitted.json'
        digest = hashlib.sha256((self.root / 'retention.json').read_bytes()).hexdigest()
        plan.write_text(json.dumps({'expectedManifestSha256': digest, 'state': omitted}))
        with patch.object(r, 'inventory', return_value=self.rows), patch.object(r, 'ready'):
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(plan, self.root, False)

    def test_retired_running_release_is_rejected(self):
        rows = copy.deepcopy(self.rows)
        rows[-2]['State']['Status'] = 'running'
        rows[-1]['State']['Status'] = 'running'
        with patch.object(r, 'inventory', return_value=rows), patch.object(r, 'ready'):
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(self.plan, self.root, False)

    def test_failed_post_smoke_readiness_preserves_manifest_and_writes_no_receipt(self):
        smoke = {'image': self.state['rollback']['image'], 'checks': {'ready': True}}
        with patch.object(r, 'inventory', return_value=copy.deepcopy(self.rows)), \
                patch.object(r, 'ready', side_effect=[None, RuntimeError('down')]), \
                patch.object(r, 'docker', side_effect=self.docker), \
                patch.object(release, 'backup_policy'), \
                patch.object(verify_runtime, 'verify', return_value=smoke):
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(self.plan, self.root, True)
        self.assertEqual(json.loads((self.root / 'retention.json').read_text()),
                         self.previous)
        self.assertFalse((self.root / 'reconciliations').exists())

    def test_image_tag_drift_fails(self):
        def docker(*args):
            if args[:2] == ('image', 'inspect'):
                tag = args[2]
                image = self.state['current' if tag.endswith('new') else 'rollback']['image']
                if tag.endswith('new'):
                    image = 'sha256:' + 'b' * 64
                return json.dumps([{'Id': image}])
            raise AssertionError('unexpected docker command: ' + str(args))
        with patch.object(r, 'inventory', return_value=copy.deepcopy(self.rows)), \
                patch.object(r, 'ready'), patch.object(r, 'docker', side_effect=docker):
            with self.assertRaises(RuntimeError):
                reconcile.reconcile(self.plan, self.root, False)


if __name__ == '__main__':
    unittest.main()
