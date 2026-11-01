import { mkdtemp, writeFile, readFile, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { it, expect } from 'vitest';
import { encryptBackup, decryptBackup } from '../scripts/backup-codec.mjs';
it('authenticates backups before plaintext creation and preserves an existing destination', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bubu-backup-'));
  const file = (name: string) => path.join(root, name);
  try {
    await writeFile(file('key'), randomBytes(32), { mode: 0o600 });
    const original = randomBytes(256 * 1024 + 51); await writeFile(file('input'), original);
    await encryptBackup(file('input'), file('backup'), file('key'));
    expect((await readFile(file('backup'))).includes(original.subarray(0, 100))).toBe(false);
    await decryptBackup(file('backup'), file('output'), file('key'));
    expect(await readFile(file('output'))).toEqual(original);
    expect((await stat(file('output'))).mode & 0o077).toBe(0);
    await expect(decryptBackup(file('backup'), file('output'), file('key'))).rejects.toThrow();
    expect(await readFile(file('output'))).toEqual(original);
    const damaged = await readFile(file('backup')); damaged[100] = damaged[100]! ^ 1; await writeFile(file('damaged'), damaged);
    await expect(decryptBackup(file('damaged'), file('must-not-exist'), file('key'))).rejects.toThrow();
    await expect(stat(file('must-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(file('truncated'), damaged.subarray(0, 30));
    await expect(decryptBackup(file('truncated'), file('must-not-exist'), file('key'))).rejects.toThrow();
    await chmod(file('key'), 0o644);
    await expect(encryptBackup(file('input'), file('unsafe'), file('key'))).rejects.toThrow('key');
  } finally { await rm(root, { recursive: true, force: true }); }
});
