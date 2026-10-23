import Taro from '@tarojs/taro'

/** Match CSS's 375px design basis in both native mini programs and the H5 preview. */
export function designSize(value: number): string {
  const size = value / 2
  return process.env.TARO_ENV === 'h5' ? `${size}px` : Taro.pxTransform(size)
}
