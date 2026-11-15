import Taro from "@tarojs/taro";
import { api } from "../api";
import { newRequestId } from "./drafts";
const native = process.env.TARO_ENV === "weapp";
import { trackImageFile, removeImageFile } from "./files";
export function imageMime(bytes: ArrayBuffer): "image/png" | "image/jpeg" | "image/webp" {
  const data = new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((value, index) => data[index] === value)) return "image/png";
  if (String.fromCharCode(...data.slice(0,4)) === "RIFF" && String.fromCharCode(...data.slice(8,12)) === "WEBP") return "image/webp";
  throw new Error("请选择 JPG、PNG 或 WebP 照片；其他格式请先在相册中转换。");
}
export async function chooseChatImage(babyId: string, source?: "camera" | "album", active: () => boolean = () => true) {
  const selected = await Taro.chooseImage({ count: 1, sizeType: ["original"], sourceType: source ? [source] : ["camera", "album"] });
  const path = selected.tempFilePaths[0]; if (!path) throw new Error("没有选中照片。");
  trackImageFile(path);
  try {
    const bytes = native ? await new Promise<ArrayBuffer>((resolve, reject) => Taro.getFileSystemManager().readFile({ filePath: path, success: result => typeof result.data === "string" ? reject(new Error("照片读取失败。")) : resolve(result.data), fail: () => reject(new Error("照片读取失败。")) })) : await (await fetch(path)).arrayBuffer();
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("单张照片不能超过 10 MB。");
    if (!active()) throw new Error("宝宝或登录状态已变化，已取消添加照片。");
    return await api.uploadAttachment(babyId, newRequestId(), bytes, imageMime(bytes));
  } finally { removeImageFile(path); }
}
