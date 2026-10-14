import { ageStatusSchema, ageChallengeResultSchema, wechatLoginResultSchema } from "@cfp/hello-agent-contracts";
import type { AgeDeclaration } from "@cfp/hello-agent-protocol";
import { labeledAiText } from "./ai-copy";
import { privacyPolicySchema, privacyStatusSchema, recoveryCodeSchema, recoveredIdentitySchema, logoutSchema, deletionSchema, type PrivacyStatus } from "@cfp/hello-agent-contracts";
import Taro from "@tarojs/taro";
import {
  CATALOG_ID,
  createRunReader,
  textResponseSchema,
  type RunProgress,
} from "@cfp/hello-agent-protocol";
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
const temporaryFilesKey = `hello-private-files:${origin}`;
function rememberTemporaryFile(file: string) {
  if (!native) return;
  const saved: unknown = Taro.getStorageSync(temporaryFilesKey);
  const files = Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string") : [];
  Taro.setStorageSync(temporaryFilesKey, [...new Set([...files, file])]);
}
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
  dataType: "json" | "text" = "json",
): Promise<T> {
  const response = await Taro.request<unknown>({
    url: `${origin}/api/hello/${path}`,
    method,
    data,
    dataType,
    timeout: path === "ag-ui" || path === "image-resume" ? 240_000 : 90_000,
    header: {
      "Content-Type": "application/json",
      ...(native && deviceToken && path !== "miniapp-identity"
        ? { Authorization: `Bearer ${deviceToken}` }
        : {}),
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (response.statusCode === 401) throw new IdentityExpiredError();
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

// 只在用户确认影响后调用；普通重试保留原身份，不能静默跳过确认换发 Cookie。
export async function restartIdentity() {
  if (native) {
    const identity = await request(
      "miniapp-identity",
      credentialSchema,
      "POST",
    );
    Taro.setStorageSync(storageKey, identity.token);
    deviceToken = identity.token;
  } else {
    // 浏览器接收服务端的 HttpOnly Cookie，不把凭证写入脚本可读的存储。
    await request("identity", identitySchema, "POST");
  }
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
export const getAge = () => request("age", ageStatusSchema);
export const beginAge = (body: { declaration: AgeDeclaration; noticeVersion: string; consent: true }) => request("age/challenge", ageChallengeResultSchema, "POST", body);
export const submitAge = (body: { challenge: string; name: string; idCard: string }) => request("age/submit", ageStatusSchema, "POST", body);
export const cancelAge = () => request("age/cancel", ageStatusSchema, "POST", {});
export async function loginWechat(migrateCurrent: boolean, noticeVersion: string) {
  if (!native) throw new Error("请在微信小程序中完成微信登录");
  if (typeof Taro.requirePrivacyAuthorize !== "function") throw new Error("请更新微信后再试，当前版本不支持所需隐私授权交互");
  await new Promise<void>((resolve, reject) => Taro.requirePrivacyAuthorize({ success: () => resolve(), fail: () => reject(new Error("已取消或拒绝微信隐私授权，可以阅读政策后再次尝试")) }));
  const login = await Taro.login();
  if (!login.code) throw new Error("微信登录未完成，请重新点击登录");
  const result = await request("wechat-login", wechatLoginResultSchema, "POST", { code: login.code, consent: true, noticeVersion, migrateCurrent });
  await forgetIdentity();
  deviceToken = result.token; Taro.setStorageSync(storageKey, result.token);
  identityPromise = undefined;
  return result;
}
export const getSettings = () => request("config", settingsSchema);
export const getSessions = () => request("sessions", sessionsSchema);
export const newSession = () =>
  request("sessions", sessionSchema, "POST", {
    title: "新对话",
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
export async function generate(
  sessionId: number,
  id: string,
  mode: Exclude<Mode, "external">,
  input: Input,
  apiKey?: string,
  onProgress?: (progress: RunProgress) => void,
) {
  const body = {
    protocolVersion: "1.0",
    threadId: String(sessionId),
    runId: id,
    tools: [],
    context: [],
    messages: [{ id: `user_${id}`, role: "user", content: input.text }],
    forwardedProps: {
      mode,
      mediaIds: input.mediaIds,
      ...(mode === "byok" ? { apiKey } : {}),
      clientEvent: input.formResponse
        ? {
            version: "v0.9.1",
            action: {
              name: "submit_form",
              surfaceId: `turn_${input.formResponse.turnId}_${input.formResponse.artifactId}`,
              sourceComponentId: "submit",
              timestamp: new Date().toISOString(),
              context: { values: input.formResponse.values },
            },
          }
        : undefined,
      a2uiClientCapabilities: { supportedCatalogIds: [CATALOG_ID] },
    },
  };
  await consumeRun("ag-ui", body, id, onProgress);
  const { turn } = await getSubmission(sessionId, id);
  if (!turn || turn.status !== "completed")
    throw new Error("回复尚未确认保存，请稍后确认上次发送");
  return turn;
}
export function resumeImage(turnId: number, id: string, apiKey?: string, onProgress?: (progress: RunProgress) => void) {
  return consumeRun("image-resume", { turnId, requestId: id, ...(apiKey ? { apiKey } : {}) }, id, onProgress);
}
async function consumeRun(path: "ag-ui" | "image-resume", body: unknown, id: string, onProgress?: (progress: RunProgress) => void) {
  const reader = createRunReader(id, onProgress);
  if (native) {
    // Native Taro buffers SSE; it consumes exactly the same AG-UI/A2UI events as H5.
    reader.push(
      await request(path, textResponseSchema, "POST", body, "text"),
    );
  } else {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240_000);
    try {
      const response = await fetch(`/api/hello/${path}`, {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (response.status === 401) throw new IdentityExpiredError();
        const failure = errorSchema.safeParse(await response.json());
        throw new Error(
          failure.success ? failure.data.error : "暂时连接不上，请稍后重试",
        );
      }
      if (!response.body) throw new Error("回复没有内容");
      const stream = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await stream.read();
          if (chunk.done) break;
          reader.push(decoder.decode(chunk.value, { stream: true }));
        }
        reader.push(decoder.decode());
      } finally {
        await stream.cancel();
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  reader.finish();
}
export const mintMcpToken = () => request("token", credentialSchema, "POST");
export const revokeMcpTokens = () =>
  request("token/revoke", revokedSchema, "POST");

export async function imageSource(id: number): Promise<string> {
  return privateImageSource(`/api/hello/media/${id}`);
}

export async function privateImageSource(path: string): Promise<string> {
  if (
    !/^\/api\/hello\/(media\/[1-9]\d*|artifact-image\/[1-9]\d*\/[a-z][a-z0-9_]{0,39})$/.test(
      path,
    )
  )
    throw new Error("图片地址不受支持");
  const url = `${origin}${path}`;
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
    rememberTemporaryFile(result.tempFilePath);
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
  if (native) {
    await Taro.setClipboardData({ data: value });
    return;
  }
  // Taro H5 忽略 execCommand 的 false 返回值；使用浏览器实际写入结果。
  // 不额外把聊天原文存入 Taro 的剪贴板 localStorage 缓存。
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  const previous = document.activeElement;
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.left = "-10000px";
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, value.length);
    if (!document.execCommand("copy"))
      throw new Error("复制失败，请长按文字复制");
  } finally {
    field.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
}
export function openCms() {
  if (native) Taro.setClipboardData({ data: `${HELLO_API_ORIGIN}/admin` });
  else window.open("/admin", "_blank", "noopener,noreferrer");
}

export const getLegal = () => request("legal", privacyPolicySchema);
export const getPrivacy = () => request("privacy", privacyStatusSchema);
export const updateConsent = (value: NonNullable<PrivacyStatus["consent"]>) => request("privacy/consent", privacyStatusSchema, "POST", value);
export const withdrawConsent = () => request("privacy/withdraw", privacyStatusSchema, "POST");
export const createRecoveryCode = () => request("privacy/recovery-code", recoveryCodeSchema, "POST");
async function forgetIdentity() {
  if (native) {
    const paths: unknown = Taro.getStorageSync(temporaryFilesKey);
    if (Array.isArray(paths)) await Promise.all(paths.filter((file): file is string => typeof file === "string").map((filePath) => new Promise<void>((resolve) => { Taro.getFileSystemManager().unlink({ filePath, complete: () => resolve() }); })));
    Taro.removeStorageSync(temporaryFilesKey);
  }
  deviceToken = ""; identityPromise = undefined;
  if (native) { Taro.removeStorageSync(storageKey); Taro.removeStorageSync("hello-miniapp-identity"); }
}
export async function recoverIdentity(code: string) {
  const result = await request("privacy-recover", recoveredIdentitySchema, "POST", { code, native });
  await forgetIdentity();
  if (native && result.token) { deviceToken = result.token; Taro.setStorageSync(storageKey, result.token); }
}
export async function logoutIdentity() { await request("privacy/logout", logoutSchema, "POST"); await forgetIdentity(); }
export async function deletePersonalData(confirmation: string) {
  const result = await request("privacy/delete", deletionSchema, "POST", { confirmation });
  await forgetIdentity(); return result;
}
export async function exportPersonalData() {
  if (!native) {
    const response = await fetch("/api/hello/privacy/export", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) throw new IdentityExpiredError();
    if (!response.ok) {
      const failure = errorSchema.safeParse(await response.json());
      throw new Error(failure.success ? failure.data.error : "导出未完成，请稍后重试");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url; link.download = "hello-personal-data.json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const result = await Taro.downloadFile({ url: `${origin}/api/hello/privacy/export`, header: { Authorization: `Bearer ${deviceToken}` } });
  if (result.statusCode === 401) throw new IdentityExpiredError();
  if (result.statusCode === 413) throw new Error("数据超过自助导出上限（8 MB 或 1000 条），请通过隐私政策中的联系渠道申请完整副本");
  if (result.statusCode === 429) throw new Error("导出较频繁或服务正忙，请一分钟后再试");
  if (result.statusCode !== 200) throw new Error("导出未完成，请稍后重试");
  rememberTemporaryFile(result.tempFilePath);
  await Taro.shareFileMessage({ filePath: result.tempFilePath, fileName: "hello-personal-data.json" });
}
export async function copyAiReply(value: string, external = false) { return copy(labeledAiText(value, external)); }
