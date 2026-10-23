import Taro from "@tarojs/taro";
const native = process.env.TARO_ENV === "weapp";
const filesKey = `bubu-chat-files:${BUBU_API_ORIGIN}`;
function paths(): string[] { const value: unknown = Taro.getStorageSync(filesKey); return Array.isArray(value) ? value.filter((value): value is string => typeof value === "string") : []; }
export function trackImageFile(path: string): void { if (native) Taro.setStorageSync(filesKey, [...new Set([...paths(), path])]); }
export function removeImageFile(filePath: string): void {
  if (!native) return;
  Taro.getFileSystemManager().unlink({ filePath, fail: () => {} });
  Taro.setStorageSync(filesKey, paths().filter(path => path !== filePath));
}
export function clearImageFiles(): void { if (native) { for (const path of paths()) removeImageFile(path); Taro.removeStorageSync(filesKey); } }
