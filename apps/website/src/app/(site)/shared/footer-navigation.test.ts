import { describe, expect, it } from 'vitest'
import { isLegacyPublicNavigationLink } from './footer-navigation'

describe('footer CMS navigation filtering', () => {
  it('preserves external origins even when their pathname matches a canonical route', () => {
    expect(isLegacyPublicNavigationLink('https://example.org/')).toBe(false)
    expect(isLegacyPublicNavigationLink('https://example.org/license')).toBe(false)
  })

  it('filters same-origin canonical routes with query strings and trailing slashes', () => {
    expect(
      isLegacyPublicNavigationLink(
        'https://www.codeforpeople.cn/license/?source=legacy-footer'
      )
    ).toBe(true)
  })

  it('filters relative canonical routes', () => {
    expect(isLegacyPublicNavigationLink('/')).toBe(true)
    expect(isLegacyPublicNavigationLink('/manifesto')).toBe(true)
    expect(isLegacyPublicNavigationLink('/wam/')).toBe(true)
  })

  it('preserves same-origin non-navigation policy routes', () => {
    expect(isLegacyPublicNavigationLink('/privacy')).toBe(false)
  })
})
