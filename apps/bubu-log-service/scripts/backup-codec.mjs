import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
const magic = Buffer.from('BUBUBACKUP1\0');
const headerBytes = magic.length + 12;
async function keyAt(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077)) throw new Error('Invalid backup key file');
    return await file.readFile();
  } finally { await file.close(); }
}
/** Separate-key, authenticated backup container. The key is never an argument value or part of the backup. */
export async function encryptBackup(input, target, keyPath) {
  const key = await keyAt(keyPath), nonce = randomBytes(12), header = Buffer.concat([magic, nonce]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(header);
  let created = false;
  try {
    const file = await open(target, 'wx', 0o600); created = true;
    try {
      await file.write(header);
      const output = createWriteStream(target, { fd: file.fd, autoClose: false, start: headerBytes });
      await pipeline(input === '-' ? process.stdin : createReadStream(input, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), cipher, output);
      await file.write(cipher.getAuthTag(), 0, 16, (await file.stat()).size); await file.sync();
      const parent = await open(dirname(target), constants.O_RDONLY);
      try { await parent.sync(); } finally { await parent.close(); }
    } finally { await file.close(); }
  } catch (error) { if (created) await unlink(target).catch(() => {}); throw error; }
  finally { key.fill(0); }
}
export async function decryptBackup(input, target, keyPath, verifyOnly = false) {
  const key = await keyAt(keyPath), file = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW);
  let created = false;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= headerBytes + 16 || stat.size > 64 * 1024 ** 3) throw new Error('Invalid encrypted backup');
    const header = Buffer.alloc(headerBytes), tag = Buffer.alloc(16);
    await file.read(header, 0, header.length, 0); await file.read(tag, 0, 16, stat.size - 16);
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Invalid encrypted backup');
    const readPass = async output => {
      const cipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length)); cipher.setAAD(header); cipher.setAuthTag(tag);
      const source = createReadStream(input, { fd: file.fd, autoClose: false, start: headerBytes, end: stat.size - 17 });
      await pipeline(source, cipher, output);
    };
    // Authenticate the entire object before creating any plaintext restoration artifact.
    await readPass(new Writable({ write(_chunk, _encoding, next) { next(); } }));
    if (verifyOnly) return;
    const outputFile = await open(target, 'wx', 0o600); created = true;
    try {
      await readPass(createWriteStream(target, { fd: outputFile.fd, autoClose: false })); await outputFile.sync();
    } finally { await outputFile.close(); }
  } catch (error) { if (created) await unlink(target).catch(() => {}); throw error; }
  finally { key.fill(0); await file.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, input, target, keyPath] = process.argv.slice(2);
  try {
    if (!input || !target || !keyPath || !['encrypt', 'decrypt', 'verify'].includes(mode)) throw new Error('Usage: backup-codec.mjs encrypt|decrypt|verify INPUT OUTPUT KEY_FILE');
    if (mode === 'encrypt') await encryptBackup(input, target, keyPath);
    else await decryptBackup(input, target, keyPath, mode === 'verify');
  } catch { console.error('bubu_backup_codec_failed'); process.exitCode = 1; }
}
