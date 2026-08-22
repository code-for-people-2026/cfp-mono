import { describe, expect, it } from 'vitest'
import {
  parseMatrixScrollPosition,
  serializeMatrixScrollPosition,
} from './matrix-browser'

describe('matrix scroll position', () => {
  it('round-trips a return URL with its matrix-local scroll offset', () => {
    const serialized = serializeMatrixScrollPosition({
      href: '/wam?view=matrix&axis=people&item=primary-sector',
      scrollLeft: 486.5,
    })

    expect(parseMatrixScrollPosition(serialized)).toEqual({
      href: '/wam?view=matrix&axis=people&item=primary-sector',
      scrollLeft: 486.5,
    })
  })

  it('rejects malformed, external, and invalid scroll positions', () => {
    expect(parseMatrixScrollPosition(null)).toBeNull()
    expect(parseMatrixScrollPosition('{broken')).toBeNull()
    expect(
      parseMatrixScrollPosition(JSON.stringify({ href: 'https://example.com', scrollLeft: 12 }))
    ).toBeNull()
    expect(
      parseMatrixScrollPosition(JSON.stringify({ href: '/wam', scrollLeft: -1 }))
    ).toBeNull()
  })

  it('clamps a newly serialized negative offset to the matrix origin', () => {
    expect(
      parseMatrixScrollPosition(
        serializeMatrixScrollPosition({ href: '/wam', scrollLeft: -20 })
      )
    ).toEqual({ href: '/wam', scrollLeft: 0 })
  })
})
