import Taro from "@tarojs/taro";

export function completedVideo(result: { isEnded?: boolean } | undefined) {
  // 不把缺失回调或老版本的 undefined 当作已看完。
  return result?.isEnded === true;
}
export async function watchWechatAd(adUnitId: string) {
  if (process.env.TARO_ENV !== "weapp" || !adUnitId)
    throw new Error("微信激励广告仅能在配置了广告位的小程序中播放");
  const ad = Taro.createRewardedVideoAd({ adUnitId });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error("广告等待超时，未获得整理资格")),
      180_000,
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ad.offClose(onClose);
      ad.offError(onError);
      ad.destroy();
      if (error) reject(error);
      else resolve();
    };
    const onClose = (result: { isEnded?: boolean }) =>
      finish(
        completedVideo(result)
          ? undefined
          : new Error("广告未看完，记忆没有变化"),
      );
    const onError = () =>
      finish(new Error("广告暂时加载不了，没有消耗整理资格"));
    ad.onClose(onClose);
    ad.onError(onError);
    ad.load()
      .then(() => {
        if (!settled) return ad.show();
      })
      .catch(onError);
  });
}
