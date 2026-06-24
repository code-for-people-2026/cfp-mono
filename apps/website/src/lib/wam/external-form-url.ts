type ExternalFormUrlInput = {
  baseUrl: string
  productionPosition: string
  abilityArea: string
}

export const DEFAULT_EXTERNAL_FORM_URL =
  'https://qcng630f2p1h.feishu.cn/share/base/form/shrcnWYQXZRpgUhfBhYDSMSjVUg'

export function buildExternalFormUrl({
  baseUrl,
  productionPosition,
  abilityArea,
}: ExternalFormUrlInput) {
  const url = new URL(baseUrl)
  url.searchParams.set('prefill_生产关系中的位置', productionPosition)
  url.searchParams.set('prefill_被剥削的能力', abilityArea)
  return url.toString()
}
