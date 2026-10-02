import Taro from "@tarojs/taro";
import type {
  Attachment,
  Input,
  Mode,
  Session,
  Settings,
  Turn,
  MemoryStatus,
  AdTicket,
} from "./model";

const native = process.env.TARO_ENV === "weapp";
const origin = native ? HELLO_API_ORIGIN.replace(/\/$/, "") : "";
// 调试与远程环境有独立数据库，不能把本机设备凭证误发到另一个服务。
const storageKey = `hello-miniapp-identity:${origin}`;
let deviceToken = "";
let identityPromise: Promise<void> | undefined;

async function request<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  data?: unknown,
): Promise<T> {
  const response = await Taro.request<T & { error?: string }>({
    url: `${origin}/api/hello/${path}`,
    method,
    data,
    timeout: 90_000,
    header: {
      "Content-Type": "application/json",
      ...(native && deviceToken
        ? { Authorization: `Bearer ${deviceToken}` }
        : {}),
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.data?.error || "暂时连接不上，请稍后重试");
  }
  return response.data;
}

export function establishIdentity(): Promise<void> {
  if (identityPromise) return identityPromise;
  identityPromise = (async () => {
    if (!native) {
      await request("identity", "POST");
      return;
    }
    deviceToken = Taro.getStorageSync<string>(storageKey) || "";
    if (!deviceToken && origin === "http://127.0.0.1:3310") {
      // 兼容首版本机身份，避免升级后丢失原有聊天入口。
      deviceToken = Taro.getStorageSync<string>("hello-miniapp-identity") || "";
      if (deviceToken) Taro.setStorageSync(storageKey, deviceToken);
    }
    if (!deviceToken) {
      const identity = await request<{ token: string }>(
        "miniapp-identity",
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
export const getSettings = () => request<Settings>("config");
export const getSessions = () => request<Session[]>("sessions");
export const newSession = () =>
  request<Session>("sessions", "POST", {
    title: "与阿J的日常",
  });
export const getHistory = (id: number) => request<Turn[]>(`sessions/${id}`);
export const getMemory = (id: number) => request<MemoryStatus>(`context/${id}`);
export const startAd = (sessionId: number) =>
  request<AdTicket>("context/ad-start", "POST", { sessionId });
export const completeAd = (sessionId: number, rewardId: string) =>
  request("context/ad-complete", "POST", {
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
  request<MemoryStatus>("context/compact", "POST", {
    sessionId,
    rewardId,
    mode: mode === "byok" ? "byok" : "platform",
    ...(mode === "byok" ? { apiKey } : {}),
  });
export const generate = (
  sessionId: number,
  id: string,
  mode: Mode,
  input: Input,
  apiKey?: string,
) =>
  request<Turn>("greet", "POST", {
    sessionId,
    requestId: id,
    mode,
    input,
    ...(mode === "byok" ? { apiKey } : {}),
  });
export const mintMcpToken = () =>
  request<{ token: string; expiresAt: string }>("token", "POST");
export const revokeMcpTokens = () => request("token/revoke", "POST");

export async function imageSource(id: number): Promise<string> {
  const url = `${origin}/api/hello/media/${id}`;
  if (!native) return url;
  const result = await Taro.downloadFile({
    url,
    header: { Authorization: `Bearer ${deviceToken}` },
  });
  if (result.statusCode !== 200) throw new Error("图片读取失败");
  return result.tempFilePath;
}

export async function addImage(): Promise<Attachment> {
  const selected = await Taro.chooseImage({
    count: 1,
    sizeType: ["compressed"],
    sourceType: ["album", "camera"],
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
  const result = await request<{ id: number }>("upload", "POST", { base64 });
  return { id: result.id, src: await imageSource(result.id) };
}

export async function copy(value: string) {
  await Taro.setClipboardData({ data: value });
}
export function openCms() {
  if (native) Taro.setClipboardData({ data: `${HELLO_API_ORIGIN}/admin` });
  else window.open("/admin", "_blank", "noopener,noreferrer");
}
