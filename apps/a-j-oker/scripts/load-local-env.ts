import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// 只读取本项目被 Git 忽略的配置；显式传入的进程环境变量优先。
const file = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(file)) loadEnvFile(file);
