export const carePreferencesUpdatedEvent = "bubu:care-preferences-updated";

export function carePreferencesScope(babyId: string): { backendOrigin: string; babyId: string } {
  const cleanBabyId = babyId.trim();
  if (!cleanBabyId) throw new Error("照护环设置必须指定宝宝。");

  if (process.env.TARO_ENV === "h5" && typeof window !== "undefined" && window.location?.origin) {
    return { backendOrigin: window.location.origin, babyId: cleanBabyId };
  }
  if (process.env.TARO_ENV === "weapp" && BUBU_API_ORIGIN.trim()) {
    return { backendOrigin: BUBU_API_ORIGIN, babyId: cleanBabyId };
  }
  throw new Error("无法确定照护环设置的本机范围。");
}
