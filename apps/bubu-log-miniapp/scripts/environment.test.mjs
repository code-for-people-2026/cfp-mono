import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { profile, buildEnvironment, sealBuild, validateExperience } from './weapp-artifact.mjs';
import { uploadExperience } from './upload-experience.mjs';

function fixture(t, name = 'experience') {
  const temp = mkdtempSync(path.join(tmpdir(), 'bubu-build-check-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'apps/app');
  for (const d of ['src', 'config', 'scripts', 'types']) mkdirSync(path.join(root, d), { recursive: true });
  for (const f of ['package.json', 'project.config.json', 'tsconfig.json']) writeFileSync(path.join(root, f), '{}');
  for (const f of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) writeFileSync(path.join(temp, f), 'test');
  mkdirSync(path.join(temp, 'packages/typescript-config'), { recursive: true });
  writeFileSync(path.join(temp, 'packages/typescript-config/react-library.json'), '{}');
  writeFileSync(path.join(root, 'src/app.ts'), 'test');
  const p = profile(name), directory = path.join(root, p.outputRoot);
  mkdirSync(directory, { recursive: true });
  for (const [f, data] of Object.entries({
    'app.js': `const origin = ${JSON.stringify(p.apiOrigin)};`, 'app.json': '{}', 'app.wxss': '',
    'project.config.json': JSON.stringify({ appid: p.appid, compileType: 'miniprogram', miniprogramRoot: './', setting: { urlCheck: true } }),
  })) writeFileSync(path.join(directory, f), data);
  return { root, directory };
}

test('profiles pin local and cloud origins and reject contradictory environment', () => {
  assert.equal(buildEnvironment('development', {}).BUBU_API_ORIGIN, 'http://127.0.0.1:3320');
  assert.equal(buildEnvironment('experience', {}).BUBU_API_ORIGIN, 'https://bubu-preview.codeforpeople.cn');
  assert.throws(() => profile('production'));
  assert.throws(() => buildEnvironment('experience', { BUBU_API_PROFILE: 'development' }));
  assert.throws(() => buildEnvironment('experience', { BUBU_API_ORIGIN: 'http://localhost:3320' }));
  assert.throws(() => buildEnvironment('development', { BUBU_API_ORIGIN: profile('experience').apiOrigin }));
});
test('valid build passes check-only without upload and explicit upload uses fixed project', t => {
  const { root, directory } = fixture(t); sealBuild('experience', root);
  const calls = [], run = (...args) => { calls.push(args); return { status: 0 }; };
  assert.equal(uploadExperience(['--check-only'], { root, run }).checkOnly, true);
  assert.equal(calls.length, 1); // WXSS only; no WeChat uploader.
  uploadExperience(['--version', '0.2.4'], { root, run });
  assert.equal(calls.length, 3);
  assert.equal(calls[2][1][2], directory);
  assert.throws(() => uploadExperience(['--version', '0.2.4', '--project', '/tmp'], { root, run }));
});
test('missing build receipt blocks every subprocess', t => {
  const { root } = fixture(t);
  assert.throws(() => uploadExperience(['--version', '1.0.0'], { root, run() { assert.fail('must not invoke'); } }));
});
test('development artifacts cannot upload', t => {
  const { root, directory } = fixture(t, 'development'); sealBuild('development', root);
  assert.throws(() => validateExperience(root));
  const target = path.join(root, profile('experience').outputRoot); mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'bubu-build.json'), readFileSync(path.join(directory, 'bubu-build.json')));
  assert.throws(() => validateExperience(root), /不是/);
});
for (const mutation of ['modify', 'add', 'delete', 'source', 'tsconfig', 'shared-tsconfig']) test(`${mutation} after build invalidates receipt`, t => {
  const { root, directory } = fixture(t); sealBuild('experience', root);
  if (mutation === 'modify') writeFileSync(path.join(directory, 'app.js'), 'modified');
  if (mutation === 'add') writeFileSync(path.join(directory, 'extra.js'), 'extra');
  if (mutation === 'delete') rmSync(path.join(directory, 'app.json'));
  if (mutation === 'source') writeFileSync(path.join(root, 'src/app.ts'), 'changed');
  if (mutation === 'tsconfig') writeFileSync(path.join(root, 'tsconfig.json'), '{} changed');
  if (mutation === 'shared-tsconfig') writeFileSync(path.resolve(root, '../../packages/typescript-config/react-library.json'), '{} changed');
  assert.throws(() => uploadExperience(['--version', '1.0.0'], { root, run() { assert.fail('must not invoke'); } }));
});
for (const mutation of ['origin', 'appid', 'root', 'domainCheck']) test(`cannot seal wrong ${mutation}`, t => {
  const { root, directory } = fixture(t);
  if (mutation === 'origin') writeFileSync(path.join(directory, 'app.js'), JSON.stringify(profile('development').apiOrigin));
  else {
    const f = path.join(directory, 'project.config.json'), p = JSON.parse(readFileSync(f));
    if (mutation === 'appid') p.appid = 'wrong';
    if (mutation === 'root') p.miniprogramRoot = '../';
    if (mutation === 'domainCheck') p.setting.urlCheck = false;
    writeFileSync(f, JSON.stringify(p));
  }
  assert.throws(() => sealBuild('experience', root));
});
test('failed style check prevents uploader', t => {
  const { root } = fixture(t); sealBuild('experience', root); let calls = 0;
  assert.throws(() => uploadExperience(['--version', '1.0.0'], { root, run() { calls++; return { status: 1 }; } }), /WXSS/);
  assert.equal(calls, 1);
});
test('artifact change during preflight prevents uploader', t => {
  const { root, directory } = fixture(t); sealBuild('experience', root); let calls = 0;
  assert.throws(() => uploadExperience(['--version', '1.0.0'], { root, run() { calls++; writeFileSync(path.join(directory, 'app.js'), 'changed'); return { status: 0 }; } }));
  assert.equal(calls, 1);
});
