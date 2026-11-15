#!/usr/bin/env python3
"""Explicit, fail-closed retention: current + one verified rollback, never volumes."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path('/opt/cfp-hello-agent/operations')
NAMES = ['cfp-hello-agent-full-preview', 'cfp-hello-agent-feishu-alerts']


def docker(*args):
    try:
        return subprocess.check_output(['docker'] + list(args), stderr=subprocess.PIPE,
                                       universal_newlines=True, timeout=180).strip()
    except subprocess.CalledProcessError:
        raise RuntimeError('Docker operation failed: ' + ' '.join(args[:2])) from None


def inventory():
    ids = docker('ps', '-aq').split()
    return json.loads(docker('inspect', *ids)) if ids else []


def stamp():
    return datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%S%fZ')


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w') as f:
        os.fchmod(f.fileno(), 0o600)
        json.dump(value, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(str(tmp), str(path))


def record(containers, tag=None):
    images = {c['Image'] for c in containers}
    if len(containers) != 2 or len(images) != 1:
        raise RuntimeError('A release must contain the app and worker using one image')
    tag = tag or containers[0]['Config']['Image']
    if not tag.startswith('cfp-hello-agent:preview-') or not all(
            c['Config']['Image'] in (tag, c['Image']) for c in containers):
        raise RuntimeError('Unmanaged image')
    return {'image': containers[0]['Image'], 'tag': tag,
            'containers': [{'id': c['Id'], 'name': c['Name'].lstrip('/')} for c in containers]}


def validate(state, containers):
    if state.get('schema') != 1:
        raise RuntimeError('Unsupported or missing retention state')
    by_id = {c['Id']: c for c in containers}
    if state['current']['image'] == state['rollback']['image']:
        raise RuntimeError('Current and rollback must be distinct versions')
    for role in ['current', 'rollback']:
        version = state[role]
        if len(version['containers']) != 2:
            raise RuntimeError('Incomplete protected release')
        for ref in version['containers']:
            c = by_id.get(ref['id'])
            if not c or c['Image'] != version['image'] or c['Name'].lstrip('/') != ref['name']:
                raise RuntimeError('Runtime changed outside the deployment workflow; no cleanup')
            expected = 'running' if role == 'current' else 'exited'
            if c['State']['Status'] != expected:
                raise RuntimeError('Protected release has unexpected container state')
    if [r['name'] for r in state['current']['containers']] != NAMES:
        raise RuntimeError('Unexpected current service names')


def plan(state, containers):
    validate(state, containers)
    protected = {state[r]['image'] for r in ['current', 'rollback']}
    by_id = {c['Id']: c for c in containers}
    result = []
    for retired in state.get('retired', []):
        if retired['image'] in protected:
            raise RuntimeError('A retired release refers to a protected image')
        expected = {ref['id'] for ref in retired['containers']}
        refs = [c for c in containers if c['Image'] == retired['image']]
        # Unknown containers/candidates sharing this image also protect it.
        if any(c['Id'] not in expected for c in refs):
            continue
        for ref in retired['containers']:
            c = by_id.get(ref['id'])
            if c and (c['Image'] != retired['image'] or
                      c['Name'].lstrip('/') != ref['name'] or
                      c['State']['Status'] != 'exited'):
                raise RuntimeError('Retired container changed; no cleanup')
        result.append(retired)
    return result


def ready(state):
    with urllib.request.urlopen('http://127.0.0.1:3318/api/ready', timeout=5) as r:
        value = json.load(r)
    if not value.get('ok') or value.get('release') != state['current']['tag'].split(':', 1)[1]:
        raise RuntimeError('Current release is not ready; no cleanup')


def cleanup(state, root=ROOT, apply=False):
    if (root / 'deployment-journal.json').exists():
        raise RuntimeError('An interrupted deployment must be recovered before cleanup')
    rows = inventory()
    candidates = plan(state, rows)
    ready(state)
    print(json.dumps({'action': 'apply' if apply else 'plan',
                      'retiredImages': [r['tag'] for r in candidates]}))
    if not apply:
        return
    archive = root / 'retired' / stamp()
    removed = []
    for retired in candidates:
        # Recheck the full protected state and candidate references before mutation.
        fresh = inventory()
        if retired not in plan(state, fresh):
            continue
        configs = [c for c in fresh if c['Id'] in {r['id'] for r in retired['containers']}]
        save(archive / (retired['image'].split(':')[-1] + '.json'), configs)
        for c in configs:
            # No --force and no --volumes. Docker refuses a concurrent restart.
            docker('container', 'rm', c['Id'])
        # Any concurrent candidate reference blocks image deletion.
        if any(c['Image'] == retired['image'] for c in inventory()):
            continue
        image_ids = set(docker('image', 'ls', '-q', '--no-trunc').split())
        if retired['image'] in image_ids:
            metadata = json.loads(docker('image', 'inspect', retired['image']))[0]
            tags = metadata.get('RepoTags') or []
            if any(not t.startswith('cfp-hello-agent:preview-') for t in tags):
                continue
            if tags:
                for tag in tags:
                    # Immutable ID check prevents deleting a tag reassigned meanwhile.
                    if json.loads(docker('image', 'inspect', tag))[0]['Id'] != retired['image']:
                        raise RuntimeError('Image tag moved during cleanup')
                    docker('image', 'rm', tag)
            else:
                docker('image', 'rm', retired['image'])
        removed.append(retired)
    state['retired'] = [r for r in state.get('retired', []) if r not in removed]
    save(root / 'retention.json', state)
    validate(state, inventory())
    ready(state)
    print(json.dumps({'removedVersions': len(removed), 'volumesRemoved': 0}))


def adopt(suffix, root=ROOT):
    if (root / 'retention.json').exists():
        raise RuntimeError('Retention state already exists')
    if not suffix.startswith('-before-'):
        raise RuntimeError('Explicit previous deployment suffix required')
    by_name = {c['Name'].lstrip('/'): c for c in inventory()}
    state = {'schema': 1, 'current': record([by_name[n] for n in NAMES]),
             'rollback': record([by_name[n + suffix] for n in NAMES]), 'retired': []}
    validate(state, list(by_name.values()))
    ready(state)
    save(root / 'retention.json', state)
    print(json.dumps({'adopted': True, 'current': state['current']['tag'],
                      'rollback': state['rollback']['tag']}))


def prune_builder():
    # Docker protects cache referenced by images and in-flight builds. This is
    # reproducible engine cache only, never containers, images, or data volumes.
    docker('builder', 'prune', '--all', '--force', '--keep-storage', '1GB')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['adopt', 'cleanup'])
    parser.add_argument('--rollback-suffix')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    with open('/var/lock/cfp-hello-agent-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'adopt':
            adopt(args.rollback_suffix or '')
        else:
            state = json.loads((ROOT / 'retention.json').read_text())
            cleanup(state, apply=args.apply)
            if args.apply:
                prune_builder()


if __name__ == '__main__':
    main()
