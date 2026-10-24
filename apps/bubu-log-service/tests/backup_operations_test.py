"""Archive and host failure tests; Docker effects are mocked, SQLite/codec tests run separately."""
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('operations', str(Path(__file__).resolve().parents[1] / 'scripts/backup-operations.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class BackupOperationsTest(unittest.TestCase):
    def test_archive_escape_links_duplicates_and_corruption_leave_no_partial_restore(self):
        for kind in ['escape', 'symlink', 'hardlink', 'duplicate', 'unknown', 'oversized']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); archive = root / 'input.tar'
                with tarfile.open(str(archive), 'w') as output:
                    member = tarfile.TarInfo('../outside' if kind == 'escape' else 'manifest.json')
                    if kind in ['symlink', 'hardlink']:
                        member.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
                        member.linkname = '/etc/passwd'
                    if kind == 'unknown': member.name = 'deletion-ledger.ndjson'
                    if kind == 'oversized': member.size = 65 * 1024 ** 3
                    output.addfile(member)
                    if kind == 'duplicate': output.addfile(member)
                with self.assertRaises((ValueError, tarfile.ReadError)):
                    ops.unpack(archive, root / 'restored')
                self.assertFalse((root / 'restored').exists())
                self.assertFalse((root / 'outside').exists())

    def test_unpack_never_overwrites_existing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); target = root / 'existing'; target.mkdir()
            (target / 'preserve').write_text('keep')
            with self.assertRaises(FileExistsError): ops.unpack(root / 'missing', target)
            self.assertEqual((target / 'preserve').read_text(), 'keep')

    def test_host_report_preserves_previous_verified_backup_after_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {'reportDirectory': directory}
            ops.write_report(config, 'backup', {'state': 'verified', 'at': '2026-10-24T00:00:00Z', 'lastVerifiedAt': '2026-10-24T00:00:00Z'})
            ops.write_report(config, 'certificate', {'state': 'failed', 'at': '2026-10-24T00:01:00Z'})
            ops.write_report(config, 'backup', {'state': 'failed', 'at': '2026-10-24T00:02:00Z'})
            result = json.loads((Path(directory) / 'status.json').read_text())
            self.assertEqual(result['backup']['lastVerifiedAt'], '2026-10-24T00:00:00Z')
            self.assertEqual(result['certificate']['state'], 'failed')
            self.assertEqual(os.stat(str(Path(directory) / 'status.json')).st_mode & 0o022, 0)

    def test_retention_only_prunes_expired_owned_regular_archives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); old = root / ('bubu-20261020T000000Z-' + 'a' * 32 + '.enc')
            old.write_bytes(b'old'); old.chmod(0o600)
            current = root / ('bubu-20261024T000000Z-' + 'b' * 32 + '.enc'); current.write_bytes(b'new'); current.chmod(0o600)
            unrelated = root / 'foreign.enc'; unrelated.write_bytes(b'keep')
            stamp = time.time() - 3 * 86400; os.utime(str(old), (stamp, stamp))
            ops.prune({'backupDirectory': directory, 'retentionDays': 2})
            self.assertFalse(old.exists()); self.assertTrue(current.exists()); self.assertTrue(unrelated.exists())

    def test_snapshot_failure_restarts_only_original_stopped_containers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'data'; source.mkdir(); backups = root / 'backups'; backups.mkdir()
            app = {'Id': 'synthetic-app'}; core = {'Id': 'synthetic-core'}; pg = {'Id': 'synthetic-pg'}
            config = {'sourceDirectory': str(source), 'backupDirectory': str(backups), 'reportDirectory': directory, 'retentionDays': 1}
            calls, running = [], {'synthetic-app': True, 'synthetic-core': True}
            def command(args, **kwargs):
                calls.append(args)
                if args[:2] == ['docker', 'stop']: running[args[-1]] = False
                if args[:2] == ['docker', 'start']: running[args[-1]] = True
                return b'100'
            def inspect(identifier): return {'State': {'Running': running[identifier]}}
            def dump(*args, **kwargs): kwargs['stdout'].write(b'synthetic pg dump')
            with patch.object(ops, 'preflight', return_value=(app, core, pg, 'synthetic', 'synthetic', 'private')), patch.object(ops, 'run', side_effect=command), patch.object(ops, 'inspect', side_effect=inspect), patch.object(ops.subprocess, 'run', side_effect=dump), patch.object(ops, 'node', side_effect=RuntimeError('synthetic capture failure')):
                with self.assertRaises(RuntimeError): ops.backup(config)
            starts = [args[-1] for args in calls if args[:2] == ['docker', 'start']]
            self.assertEqual(starts, ['synthetic-core', 'synthetic-app'])
            self.assertTrue(all(running.values()))
            self.assertEqual(list(backups.iterdir()), [])
            self.assertNotEqual(json.loads((root / 'status.json').read_text())['backup']['state'], 'verified')


if __name__ == '__main__': unittest.main()
