import profileConfiguration from "./weapp-profiles.json";

export const WEAPP_PROFILE_NAMES = ["development", "experience"] as const;
export type WeappProfileName = (typeof WEAPP_PROFILE_NAMES)[number];

export interface WeappProfile {
  name: WeappProfileName;
  apiOrigin: string;
  outputRoot: string;
}

interface ProfileConfiguration {
  appid: string;
  profiles: Record<WeappProfileName, { apiOrigin: string; outputRoot: string }>;
}

export const weappProfileConfiguration = profileConfiguration as ProfileConfiguration;
export const BUBU_WECHAT_APPID = weappProfileConfiguration.appid;

function isWeappProfileName(value: string): value is WeappProfileName {
  return WEAPP_PROFILE_NAMES.some((name) => name === value);
}

export function resolveWeappProfile(env: NodeJS.ProcessEnv = process.env): WeappProfile {
  const name = env.BUBU_API_PROFILE || "development";
  if (!isWeappProfileName(name)) {
    throw new Error(`未知小程序配置 BUBU_API_PROFILE=${name}；只允许 development 或 experience。`);
  }

  const configured = weappProfileConfiguration.profiles[name];
  const override = env.BUBU_API_ORIGIN;
  if (override !== undefined && override !== configured.apiOrigin) {
    throw new Error(
      `BUBU_API_ORIGIN=${override} 与 ${name} 配置冲突；请删除该覆盖或使用固定 profile。`,
    );
  }

  return { name, ...configured };
}

export function resolveH5DevProxy(env: NodeJS.ProcessEnv = process.env): string {
  const configured = weappProfileConfiguration.profiles.development;
  const target = env.BUBU_DEV_PROXY === undefined ? configured.apiOrigin : env.BUBU_DEV_PROXY;
  if (target !== configured.apiOrigin) {
    throw new Error(
      `H5 开发代理必须保持 ${configured.apiOrigin}；不要把体验云服务接入本地开发。`,
    );
  }
  return target;
}
