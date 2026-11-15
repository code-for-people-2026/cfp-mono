#!/usr/bin/env python3
"""Recover an explicit retention manifest after deployment cutover."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path

import retention as r
import release
import verify_runtime


LOCK_PATH = '/var/lock/cfp-hello-agent-deploy.lock'


def _load_json(path, description):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        raise RuntimeError('Cannot read ' + description + ': ' + str(path)) from None
    return value


def _version_list(state):
    return [state['current'], state['rollback']] + list(state.get('retired', []))


def _explicit_ids(version):
    image = version.get('image', '')
    if (not isinstance(image, str) or not image.startswith('sha256:') or
            len(image) != len('sha256:') + 64):
        raise RuntimeError('Retention version does not use a full image ID')
    ids = [ref.get('id', '') for ref in version.get('containers', [])]
    if any(not isinstance(value, str) or len(value) != 64 for value in ids):
        raise RuntimeError('Retention version does not use full container IDs')
    if len(ids) != 2 or len(set(ids)) != 2:
        raise RuntimeError('Retention version does not contain two distinct containers')


def _expected_names(version, role):
    refs = version['containers']
    names = [ref['name'] for ref in refs]
    if role == 'current':
        if names != r.NAMES:
            raise RuntimeError('Unexpected current service names')
        return
    suffixes = []
    for expected, actual in zip(r.NAMES, names):
        if not actual.startswith(expected):
            raise RuntimeError('Unexpected protected service name')
        suffixes.append(actual[len(expected):])
    if not suffixes[0] or any(suffix != suffixes[0] for suffix in suffixes):
        raise RuntimeError('Protected version does not use one name suffix')
    if not (suffixes[0].startswith('-before-') or suffixes[0].startswith('-rollback-')):
        raise RuntimeError('Unexpected protected version name suffix')


def _bind_mounts(container):
    mounts = container.get('Mounts', [])
    if any(mount.get('Type') != 'bind' for mount in mounts):
        raise RuntimeError('Protected containers may use only bind mounts')
    result = []
    for mount in mounts:
        source = mount.get('Source')
        destination = mount.get('Destination')
        if not isinstance(source, str) or not source or not isinstance(destination, str):
            raise RuntimeError('Protected container has an incomplete mount')
        result.append((source, destination, bool(mount.get('RW'))))
    if len(result) != len(set(destination for _, destination, _ in result)):
        raise RuntimeError('Protected container has duplicate mount destinations')
    return tuple(sorted(result))


def _validate_mounts(state, containers):
    by_id = {container['Id']: container for container in containers}
    expected = []
    for index, name in enumerate(r.NAMES):
        current = by_id[state['current']['containers'][index]['id']]
        mounts = _bind_mounts(current)
        destinations = {destination for _, destination, _ in mounts}
        wanted = {'/data', '/privacy-ledger'} if index == 0 else {'/data'}
        if destinations != wanted:
            raise RuntimeError('Current service has unexpected mounts')
        expected.append(mounts)

    for version in _version_list(state):
        for index, ref in enumerate(version['containers']):
            if _bind_mounts(by_id[ref['id']]) != expected[index]:
                raise RuntimeError('Protected version has mounts that differ from current')


def _inspect_tags(state):
    for version in _version_list(state):
        try:
            metadata = json.loads(r.docker('image', 'inspect', version['tag']))
            actual = metadata[0]['Id']
        except (RuntimeError, ValueError, IndexError, KeyError, TypeError):
            raise RuntimeError('Cannot inspect protected image tag: ' + version.get('tag', '')) from None
        if actual != version['image']:
            raise RuntimeError('Protected image tag moved: ' + version['tag'])


def _validate_runtime(state, rows):
    r.validate(state, rows)
    by_id = {container['Id']: container for container in rows}
    versions = _version_list(state)
    images = []
    container_ids = []

    for version, role in zip(versions, ['current', 'rollback'] + ['retired'] * len(state['retired'])):
        _explicit_ids(version)
        _expected_names(version, role)
        pair = [by_id[ref['id']] for ref in version['containers']]
        expected_status = 'running' if role == 'current' else 'exited'
        if any(item['State']['Status'] != expected_status for item in pair):
            raise RuntimeError('Protected release has unexpected runtime status')
        try:
            recorded = r.record(pair, version.get('tag'))
        except (KeyError, RuntimeError, TypeError):
            raise RuntimeError('Protected runtime does not match its retention record') from None
        if recorded != version:
            raise RuntimeError('Protected runtime does not match its retention record')
        images.append(version['image'])
        container_ids.extend(ref['id'] for ref in version['containers'])

    if len(images) != len(set(images)):
        raise RuntimeError('Retention state contains duplicate versions')
    if len(container_ids) != len(set(container_ids)):
        raise RuntimeError('Retention state contains duplicate container IDs')
    for retired in state.get('retired', []):
        known = {ref['id'] for ref in retired['containers']}
        if any(container['Image'] == retired['image'] and container['Id'] not in known
               for container in rows):
            raise RuntimeError('Unknown container references a retired image')

    _validate_mounts(state, rows)
    _inspect_tags(state)


def _validate(plan_path, root):
    if (root / 'deployment-journal.json').exists():
        raise RuntimeError('An interrupted deployment must be recovered before reconcile')
    manifest_path = root / 'retention.json'
    try:
        digest = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    except OSError:
        raise RuntimeError('Retention manifest is missing: ' + str(manifest_path)) from None
    plan = _load_json(plan_path, 'reconcile plan')
    if not isinstance(plan, dict) or plan.get('expectedManifestSha256') != digest:
        raise RuntimeError('Reconcile plan expects a different retention manifest')
    previous = _load_json(manifest_path, 'retention manifest')
    state = plan.get('state')
    if not isinstance(state, dict) or set(state) != {'schema', 'current', 'rollback', 'retired'}:
        raise RuntimeError('Invalid reconcile state')
    if not isinstance(previous, dict) or previous.get('schema') != 1:
        raise RuntimeError('Invalid previous retention state')
    try:
        old_images = {version['image'] for version in _version_list(previous)}
        new_images = {version['image'] for version in _version_list(state)}
    except (KeyError, TypeError):
        raise RuntimeError('Invalid retention image references') from None
    if not old_images.issubset(new_images):
        raise RuntimeError('Reconcile plan omits a prior protected image')
    _validate_runtime(state, r.inventory())
    return previous, state


def reconcile(plan_path, root=r.ROOT, apply=False):
    plan_path = Path(plan_path)
    previous, proposed = _validate(plan_path, root)
    r.ready(proposed)
    print(json.dumps({
        'action': 'apply' if apply else 'plan',
        'tags': [version['tag'] for version in _version_list(proposed)],
    }))
    if not apply:
        return

    current_ids = [ref['id'] for ref in proposed['current']['containers']]
    rows = r.inventory()
    by_id = {container['Id']: container for container in rows}
    current_configs = [by_id[current_id] for current_id in current_ids]
    with release.backup_policy(root, current_configs):
        smoke = verify_runtime.verify(proposed['rollback']['tag'])
        previous_again, checked = _validate(plan_path, root)
        if previous_again != previous or checked != proposed:
            raise RuntimeError('Reconcile inputs changed during apply')
        r.ready(proposed)
        receipt = {
            'schema': 1,
            'previous': previous,
            'proposed': proposed,
            'smoke': smoke,
        }
        r.save(root / 'reconciliations' / (r.stamp() + '.json'), receipt)
        r.save(root / 'retention.json', proposed)
        r.ready(proposed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan_json', metavar='PLAN_JSON')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    with open(LOCK_PATH, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        reconcile(args.plan_json, r.ROOT, args.apply)


if __name__ == '__main__':
    main()
