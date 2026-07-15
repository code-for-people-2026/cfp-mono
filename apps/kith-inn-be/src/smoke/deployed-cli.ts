import {
  runDeployedSmokeCli,
  type DeployedSmokeDeps,
} from "./deployed";
import { issueToken } from "../lib/auth/jwt";
import { findOperatorByOpenid } from "../lib/cms/client";

const productionDeps: DeployedSmokeDeps = {
  findOperatorByOpenid: (openid, signal) => findOperatorByOpenid(openid, {
    fetch: (input, init) => fetch(input, { ...init, signal }),
  }),
  issueToken,
  fetch: (input, init) => fetch(input, init),
  timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
};

process.exitCode = await runDeployedSmokeCli(process.env, {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
}, productionDeps);
