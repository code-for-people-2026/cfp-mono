import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath } from 'node:url';
import { appRoot, validateExperience } from './weapp-artifact.mjs';

export function uploadExperience(args, { root = appRoot, run = spawnSync } = {}) {
  const checkOnly = args.length === 1 && args[0] === '--check-only';
  if (!checkOnly && (args.length !== 2 || args[0] !== '--version' || !/^\d+\.\d+\.\d+$/.test(args[1]))) throw new Error('用法：upload:experience --check-only 或 --version x.y.z');
  const { directory, manifest } = validateExperience(root);
  const styles = run(process.execPath, [path.join(root, 'scripts/check-wxss.mjs'), 'experience'], { cwd: root, stdio: 'inherit' });
  if (styles.error) throw styles.error;
  if (styles.status !== 0) throw new Error('WXSS 检查失败，禁止上传');
  validateExperience(root);
  if (!checkOnly) {
    const result = run('/Applications/wechatwebdevtools.app/Contents/MacOS/cli', ['upload', '--project', directory, '--version', args[1], '--desc', `卜卜体验版 ${args[1]} ${manifest.sourceHash.slice(0, 12)}`], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('微信上传失败');
  }
  return { checkOnly, origin: manifest.origin };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = uploadExperience(process.argv.slice(2));
  console.log(result.checkOnly ? `上传前检查通过（未上传）：${result.origin}` : `上传命令成功：${result.origin}`);
}
