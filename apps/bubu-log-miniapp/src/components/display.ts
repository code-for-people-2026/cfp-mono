import Taro from '@tarojs/taro'

/** Match CSS's 375px design basis in both native mini programs and the H5 preview. */
export function designSize(value: number): string {
  const size = value / 2
  return process.env.TARO_ENV === 'h5' ? `${size}px` : Taro.pxTransform(size)
}

/**
 * Numeric fallback before the ScrollView geometry has been measured. H5 uses fixed
 * CSS pixels; native rpx shrinks with narrow screens, so use the 320px supported
 * floor to keep the initial one-line minimum conservative.
 */
export function designPixelsFloor(value: number): number {
  const basis = value / 2
  return process.env.TARO_ENV === 'h5' ? basis : basis * (320 / 375)
}
