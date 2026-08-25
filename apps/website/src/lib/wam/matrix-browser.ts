import type { MatrixCell, MatrixColumn, MatrixRow } from './matrix'

export type MatrixBrowseView = 'list' | 'matrix'
export type MatrixBrowseAxis = 'people' | 'ability'

export type MatrixBrowseState = {
  view: MatrixBrowseView
  axis: MatrixBrowseAxis
  itemId: string
}

export type MatrixScrollPosition = {
  href: string
  scrollLeft: number
}

type MatrixBrowseStateInput = {
  view?: string | null
  axis?: string | null
  itemId?: string | null
}

export const MATRIX_RETURN_STORAGE_KEY = 'wam:return-href'
export const MATRIX_SCROLL_STORAGE_KEY = 'wam:return-scroll'

export function resolveMatrixBrowseState(
  input: MatrixBrowseStateInput,
  rows: MatrixRow[],
  columns: MatrixColumn[]
): MatrixBrowseState {
  const view: MatrixBrowseView = input.view === 'matrix' ? 'matrix' : 'list'
  const axis: MatrixBrowseAxis = input.axis === 'ability' ? 'ability' : 'people'
  const candidates = axis === 'people' ? columns : rows
  const itemId = candidates.some((item) => item.id === input.itemId)
    ? (input.itemId as string)
    : candidates[0]?.id ?? ''

  return { view, axis, itemId }
}

export function getMatrixBrowseCells(
  state: MatrixBrowseState,
  cells: MatrixCell[]
): MatrixCell[] {
  return cells.filter((cell) =>
    state.axis === 'people' ? cell.columnId === state.itemId : cell.rowId === state.itemId
  )
}

export function getMatrixBrowseHref(state: MatrixBrowseState) {
  const params = new URLSearchParams({
    view: state.view,
    axis: state.axis,
    item: state.itemId,
  })

  return `/wam?${params.toString()}`
}

export function getMatrixCellHref(cellId: string) {
  return `/wam/cell/${cellId}`
}

export function isMatrixReturnHref(value: string | null): value is string {
  return value === '/wam' || Boolean(value?.startsWith('/wam?'))
}

export function serializeMatrixScrollPosition(position: MatrixScrollPosition) {
  return JSON.stringify({
    href: position.href,
    scrollLeft: Math.max(0, position.scrollLeft),
  })
}

export function parseMatrixScrollPosition(value: string | null): MatrixScrollPosition | null {
  if (!value) return null

  try {
    const position = JSON.parse(value) as Partial<MatrixScrollPosition>
    const href = typeof position.href === 'string' ? position.href : null
    const scrollLeft = position.scrollLeft
    if (
      !isMatrixReturnHref(href) ||
      typeof scrollLeft !== 'number' ||
      !Number.isFinite(scrollLeft) ||
      scrollLeft < 0
    ) {
      return null
    }

    return { href, scrollLeft }
  } catch {
    return null
  }
}
