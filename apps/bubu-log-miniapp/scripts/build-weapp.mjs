import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { appRoot, profile, buildEnvironment, sourceHash, sealBuild } from './weapp-artifact.mjs';
const [name = 'development', ...args] = process.argv.slice(2);
if (args.some(arg => arg !== '--watch') || args.length > 1) throw new Error('只支持环境名及 --watch');
if (args.length && name !== 'development') throw new Error('体验包不允许 watch');
const env = buildEnvironment(name, process.env);
const p = profile(name), destination = path.join(appRoot, p.outputRoot);
const inputHash = sourceHash();
// Only remove this profile's generated directory; stale manifests cannot survive a failed build.
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
const require = createRequire(import.meta.url);
const cli = require.resolve('@tarojs/cli/bin/taro');
const result = spawnSync(process.execPath, [cli, 'build', '--type', 'weapp', ...args], { cwd: appRoot, env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (!args.length) {
  copyFileSync(path.join(appRoot, `config/project.${name}.json`), path.join(destination, 'project.config.json'));
  sealBuild(name, appRoot, inputHash);
  console.log(`构建完成：${name} → ${p.apiOrigin} → ${destination}`);
}
