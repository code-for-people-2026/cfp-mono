import Taro from "@tarojs/taro";
/** Remove only exports created by this app, including files left by an interrupted share. */
export function clearPrivacyExports() {
  if (process.env.TARO_ENV !== "weapp") return;
  const fs = Taro.getFileSystemManager(), directory = Taro.env.USER_DATA_PATH;
  if (!directory) return;
  try { for (const name of fs.readdirSync(directory)) if (/^bubu-(?:family|account)-[0-9]+\.json$/.test(name)) { try { fs.unlinkSync(`${directory}/${name}`); } catch { /* Retry this exact app-owned file at the next launch. */ } } } catch { /* No exports exist on a fresh install. */ }
}
