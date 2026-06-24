import { describe, expect, it } from 'vitest'
import { buildExternalFormUrl } from './external-form-url'

describe('buildExternalFormUrl', () => {
  it('prefills visible matrix context on the Feishu form URL', () => {
    const url = buildExternalFormUrl({
      baseUrl: 'https://qcng630f2p1h.feishu.cn/share/base/form/shrcnWYQXZRpgUhfBhYDSMSjVUg',
      productionPosition: '服务业新蓝领',
      abilityArea: '劳动议价',
    })

    expect(url).toBe(
      'https://qcng630f2p1h.feishu.cn/share/base/form/shrcnWYQXZRpgUhfBhYDSMSjVUg?prefill_%E7%94%9F%E4%BA%A7%E5%85%B3%E7%B3%BB%E4%B8%AD%E7%9A%84%E4%BD%8D%E7%BD%AE=%E6%9C%8D%E5%8A%A1%E4%B8%9A%E6%96%B0%E8%93%9D%E9%A2%86&prefill_%E8%A2%AB%E5%89%A5%E5%89%8A%E7%9A%84%E8%83%BD%E5%8A%9B=%E5%8A%B3%E5%8A%A8%E8%AE%AE%E4%BB%B7'
    )
  })

  it('preserves existing query parameters on the external form URL', () => {
    const url = buildExternalFormUrl({
      baseUrl: 'https://qcng630f2p1h.feishu.cn/share/base/form/shrcnWYQXZRpgUhfBhYDSMSjVUg?source=wam',
      productionPosition: '过渡·失业·待业',
      abilityArea: '劳动议价',
    })

    expect(url).toContain('source=wam')
    expect(url).toContain(
      'prefill_%E7%94%9F%E4%BA%A7%E5%85%B3%E7%B3%BB%E4%B8%AD%E7%9A%84%E4%BD%8D%E7%BD%AE=%E8%BF%87%E6%B8%A1%C2%B7%E5%A4%B1%E4%B8%9A%C2%B7%E5%BE%85%E4%B8%9A'
    )
    expect(url).not.toContain('prefill_%E6%89%80%E5%B1%9E%E6%A0%BC%E5%AD%90')
    expect(url).not.toContain('prefill_%E8%A2%AB%E5%89%A5%E5%A4%BA%E7%9A%84%E8%83%BD%E5%8A%9B')
    expect(url).not.toContain('hide_%E6%89%80%E5%B1%9E%E6%A0%BC%E5%AD%90')
    expect(url).not.toContain('hide_%E8%83%BD%E5%8A%9B%E5%8C%BA%E5%9F%9F')
  })
})
