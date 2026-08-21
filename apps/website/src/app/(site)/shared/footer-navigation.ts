import { siteNavigation } from '@/components/site/navigation'

const publicSiteOrigin = new URL('https://www.codeforpeople.cn')

function toSameOriginPublicPathname(href: string) {
  try {
    const url = new URL(href, publicSiteOrigin)
    if (url.origin !== publicSiteOrigin.origin) return null

    return url.pathname.replace(/\/+$/, '') || '/'
  } catch {
    return null
  }
}

const legacyPublicNavigationPaths = new Set<string>([
  '/',
  ...siteNavigation.flatMap((item) => {
    const pathname = toSameOriginPublicPathname(item.href)
    return pathname ? [pathname] : []
  }),
])

export function isLegacyPublicNavigationLink(href: string) {
  const pathname = toSameOriginPublicPathname(href)
  return pathname ? legacyPublicNavigationPaths.has(pathname) : false
}
