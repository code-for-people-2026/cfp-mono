import Taro from "@tarojs/taro";
import type { Attachment, Input, Mode } from "./model";
import {
  settingsSchema,
  sessionsSchema,
  sessionSchema,
  historySchema,
  submissionResultSchema,
  memoryStatusSchema,
  adTicketSchema,
  completedSchema,
  turnResultSchema,
  credentialSchema,
  revokedSchema,
  identitySchema,
  uploadResultSchema,
  errorSchema,
  type Decoder,
} from "@cfp/hello-agent-contracts";

const native = process.env.TARO_ENV === "weapp";
const origin = native ? HELLO_API_ORIGIN.replace(/\/$/, "") : "";
// 调试与远程环境有独立数据库，不能把本机设备凭证误发到另一个服务。
const storageKey = `hello-miniapp-identity:${origin}`;
let deviceToken = "";
let identityPromise: Promise<void> | undefined;
let activeDownloads = 0;
const waitingDownloads: (() => void)[] = [];

export const IDENTITY_EXPIRED_MESSAGE =
  "设备凭证无效或已过期。旧聊天记录不会删除，但新身份无法访问旧记录。请确认后重新开始。";
export class IdentityExpiredError extends Error {
  constructor() {
    super(IDENTITY_EXPIRED_MESSAGE);
  }
}

async function request<T>(
  path: string,
  decoder: Decoder<T>,
  method: "GET" | "POST" = "GET",
  data?: unknown,
): Promise<T> {
  const response = await Taro.request<unknown>({
    url: `${origin}/api/hello/${path}`,
    method,
    data,
    timeout: 90_000,
    header: {
      "Content-Type": "application/json",
      ...(native && deviceToken && path !== "miniapp-identity"
        ? { Authorization: `Bearer ${deviceToken}` }
        : {}),
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (native && response.statusCode === 401) throw new IdentityExpiredError();
    const failure = errorSchema.safeParse(response.data, { jitless: native });
    throw new Error(
      failure.success ? failure.data.error : "暂时连接不上，请稍后重试",
    );
  }
  try {
    // 微信的 Function 构造器可能返回不可调用的对象，不能依赖 Zod 的动态编译探测。
    // 只关闭微信端的编译优化，仍完整校验成功响应、嵌套字段与错误响应。
    return decoder.parse(response.data, { jitless: native });
  } catch {
    throw new Error("服务返回的数据格式不符合约定，请稍后重试");
  }
}

// 只在用户确认影响后调用；新凭证成功获得并写入本机后才替换内存身份。
export async function restartIdentity() {
  if (!native) throw new Error("此入口仅用于小程序设备身份");
  const identity = await request("miniapp-identity", credentialSchema, "POST");
  Taro.setStorageSync(storageKey, identity.token);
  deviceToken = identity.token;
  identityPromise = Promise.resolve();
}

export function establishIdentity(): Promise<void> {
  if (identityPromise) return identityPromise;
  identityPromise = (async () => {
    if (!native) {
      await request("identity", identitySchema, "POST");
      return;
    }
    deviceToken = Taro.getStorageSync<string>(storageKey) || "";
    if (!deviceToken && origin === "http://127.0.0.1:3310") {
      // 兼容首版本机身份，避免升级后丢失原有聊天入口。
      deviceToken = Taro.getStorageSync<string>("hello-miniapp-identity") || "";
      if (deviceToken) Taro.setStorageSync(storageKey, deviceToken);
    }
    if (!deviceToken) {
      const identity = await request(
        "miniapp-identity",
        credentialSchema,
        "POST",
      );
      deviceToken = identity.token;
      Taro.setStorageSync(storageKey, deviceToken);
    }
  })().catch((error) => {
    identityPromise = undefined;
    throw error;
  });
  return identityPromise;
}
export const getSettings = () => request("config", settingsSchema);
export const getSessions = () => request("sessions", sessionsSchema);
export const newSession = () =>
  request("sessions", sessionSchema, "POST", {
    title: "与阿 J 的日常",
  });
export const getHistory = (id: number) =>
  request(`sessions/${id}`, historySchema);
export const getSubmission = (sessionId: number, requestId: string) =>
  request(
    `sessions/${sessionId}/requests/${requestId}`,
    submissionResultSchema,
  );
export const getMemory = (id: number) =>
  request(`context/${id}`, memoryStatusSchema);
export const startAd = (sessionId: number) =>
  request("context/ad-start", adTicketSchema, "POST", { sessionId });
export const completeAd = (sessionId: number, rewardId: string) =>
  request("context/ad-complete", completedSchema, "POST", {
    sessionId,
    rewardId,
    completed: true,
  });
export const compactMemory = (
  sessionId: number,
  rewardId: string,
  mode: Mode,
  apiKey?: string,
) =>
  request("context/compact", memoryStatusSchema, "POST", {
    sessionId,
    rewardId,
    mode: mode === "byok" ? "byok" : "platform",
    ...(mode === "byok" ? { apiKey } : {}),
  });
export const compactPreview = (
  sessionId: number,
  requestId: string,
  revision: number,
  mode: Mode,
  apiKey?: string,
) =>
  request("context/preview-compact", memoryStatusSchema, "POST", {
    sessionId,
    requestId,
    revision,
    mode: mode === "byok" ? "byok" : "platform",
    ...(mode === "byok" ? { apiKey } : {}),
  });
export const generate = (
  sessionId: number,
  id: string,
  mode: Exclude<Mode, "external">,
  input: Input,
  apiKey?: string,
) =>
  request("greet", turnResultSchema, "POST", {
    sessionId,
    requestId: id,
    mode,
    input,
    ...(mode === "byok" ? { apiKey } : {}),
  });
export const mintMcpToken = () => request("token", credentialSchema, "POST");
export const revokeMcpTokens = () =>
  request("token/revoke", revokedSchema, "POST");

export async function imageSource(id: number): Promise<string> {
  const url = `${origin}/api/hello/media/${id}`;
  if (!native) return url;
  // 与新上传预览共用三个下载位，为聊天及血条请求保留连接；失败也必须释放。
  await new Promise<void>((resolve) => {
    const start = () => {
      activeDownloads++;
      resolve();
    };
    if (activeDownloads < 3) start();
    else waitingDownloads.push(start);
  });
  try {
    const result = await Taro.downloadFile({
      url,
      header: { Authorization: `Bearer ${deviceToken}` },
    });
    if (result.statusCode === 401) throw new IdentityExpiredError();
    if (result.statusCode !== 200) throw new Error("图片读取失败");
    return result.tempFilePath;
  } finally {
    activeDownloads--;
    waitingDownloads.shift()?.();
  }
}

export async function addImage(
  source?: "camera" | "album",
): Promise<Attachment> {
  const selected = await Taro.chooseImage({
    count: 1,
    sizeType: ["compressed"],
    sourceType: source ? [source] : ["album", "camera"],
  });
  const file = selected.tempFilePaths[0];
  let base64: string;
  if (native) {
    base64 = await new Promise<string>((resolve, reject) => {
      Taro.getFileSystemManager().readFile({
        filePath: file,
        encoding: "base64",
        success: (res) => resolve(String(res.data)),
        fail: () => reject(new Error("无法读取这张图片")),
      });
    });
  } else {
    const blob = await (await fetch(file)).blob();
    if (blob.size > 5 * 1024 * 1024) throw new Error("单张图片不能超过 5 MB");
    base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("无法读取这张图片"));
      reader.readAsDataURL(blob);
    });
  }
  if (base64.length > 7_000_000) throw new Error("单张图片不能超过 5 MB");
  const result = await request("upload", uploadResultSchema, "POST", {
    base64,
  });
  return { id: result.id, src: await imageSource(result.id) };
}

export async function copy(value: string) {
  await Taro.setClipboardData({ data: value });
}
export function openCms() {
  if (native) Taro.setClipboardData({ data: `${HELLO_API_ORIGIN}/admin` });
  else window.open("/admin", "_blank", "noopener,noreferrer");
}
