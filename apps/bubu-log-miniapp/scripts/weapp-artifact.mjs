import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const appRoot = fileURLToPath(new URL('../', import.meta.url));
const configuration = JSON.parse(readFileSync(new URL('../config/weapp-profiles.json', import.meta.url), 'utf8'));
const manifestName = 'bubu-build.json';
export function profile(name) {
  if (!['development', 'experience'].includes(name)) throw new Error('未知构建环境');
  return { name, appid: configuration.appid, ...configuration.profiles[name] };
}
export function buildEnvironment(name, env) {
  const p = profile(name);
  if (env.BUBU_API_PROFILE !== undefined && env.BUBU_API_PROFILE !== name) throw new Error('BUBU_API_PROFILE 与命令冲突');
  if (env.BUBU_API_ORIGIN !== undefined && env.BUBU_API_ORIGIN !== p.apiOrigin) throw new Error('BUBU_API_ORIGIN 与固定地址冲突');
  return { ...env, BUBU_API_PROFILE: name, BUBU_API_ORIGIN: p.apiOrigin };
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function files(root, prefix = '') {
  return readdirSync(path.join(root, prefix)).sort().flatMap(name => {
    const relative = path.join(prefix, name);
    const stat = lstatSync(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error(`不允许符号链接：${relative}`);
    if (stat.isDirectory()) return files(root, relative);
    if (!stat.isFile()) throw new Error(`不支持的文件：${relative}`);
    return [relative];
  });
}
function artifactHashes(directory) {
  return Object.fromEntries(files(directory).filter(f => f !== manifestName).map(f => [f, hash(readFileSync(path.join(directory, f)))]));
}
export function sourceHash(root = appRoot) {
  // Only public build inputs; never scan .env files or credentials.
  const inputs = ['src', 'config', 'scripts', 'types'].flatMap(dir => files(path.join(root, dir)).map(f => `${dir}/${f}`));
  inputs.push('package.json', 'project.config.json');
  const digest = createHash('sha256');
  for (const f of inputs.sort()) digest.update(f).update('\0').update(readFileSync(path.join(root, f))).update('\0');
  for (const f of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) digest.update(f).update(readFileSync(path.resolve(root, '../..', f)));
  return digest.digest('hex');
}
function validateContents(directory, expected) {
  for (const file of ['app.js', 'app.json', 'app.wxss', 'project.config.json']) readFileSync(path.join(directory, file));
  const project = JSON.parse(readFileSync(path.join(directory, 'project.config.json'), 'utf8'));
  if (project.appid !== expected.appid || project.miniprogramRoot !== './' || project.compileType !== 'miniprogram') throw new Error('AppID 或小程序根目录不匹配');
  if (expected.name === 'experience' && project.setting?.urlCheck !== true) throw new Error('体验包必须开启域名检查');
  const js = files(directory).filter(f => f.endsWith('.js')).map(f => readFileSync(path.join(directory, f), 'utf8')).join('\n');
  if (!js.includes(JSON.stringify(expected.apiOrigin))) throw new Error('编译产物缺少固定接口地址');
  const other = profile(expected.name === 'experience' ? 'development' : 'experience');
  if (js.includes(other.apiOrigin)) throw new Error('编译产物混入另一环境地址');
}
export function sealBuild(name, root = appRoot, inputHash = sourceHash(root)) {
  const p = profile(name), directory = path.join(root, p.outputRoot);
  validateContents(directory, p);
  if (sourceHash(root) !== inputHash) throw new Error('构建期间源码发生变化，请重新构建');
  const manifest = { schema: 1, profile: name, origin: p.apiOrigin, appid: p.appid, sourceHash: inputHash, builtAt: new Date().toISOString(), files: artifactHashes(directory) };
  writeFileSync(path.join(directory, manifestName), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export function validateExperience(root = appRoot) {
  const p = profile('experience'), directory = path.join(root, p.outputRoot);
  const manifest = JSON.parse(readFileSync(path.join(directory, manifestName), 'utf8'));
  if (manifest.schema !== 1 || manifest.profile !== p.name || manifest.origin !== p.apiOrigin || manifest.appid !== p.appid) throw new Error('不是已完成的固定云端体验包');
  if (manifest.sourceHash !== sourceHash(root)) throw new Error('构建已过期：源码变化后必须重新构建');
  if (JSON.stringify(manifest.files) !== JSON.stringify(artifactHashes(directory))) throw new Error('构建文件被修改、增删或不完整');
  validateContents(directory, p);
  return { directory, manifest };
}
