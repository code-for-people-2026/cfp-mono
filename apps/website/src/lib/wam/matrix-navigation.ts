import type { MatrixCell, MatrixColumn, MatrixRow } from './matrix'

export type MatrixDirection = 'up' | 'right' | 'down' | 'left'

type SwipeInput = {
  startX: number
  startY: number
  endX: number
  endY: number
  threshold?: number
}

const DEFAULT_SWIPE_THRESHOLD = 96
const DIAGONAL_DOMINANCE_RATIO = 1.35

export function resolveSwipeDirection({
  startX,
  startY,
  endX,
  endY,
  threshold = DEFAULT_SWIPE_THRESHOLD,
}: SwipeInput): MatrixDirection | null {
  const deltaX = endX - startX
  const deltaY = endY - startY
  const absoluteX = Math.abs(deltaX)
  const absoluteY = Math.abs(deltaY)

  if (absoluteX < threshold && absoluteY < threshold) {
    return null
  }

  if (absoluteX > absoluteY * DIAGONAL_DOMINANCE_RATIO) {
    return deltaX < 0 ? 'right' : 'left'
  }

  if (absoluteY > absoluteX * DIAGONAL_DOMINANCE_RATIO) {
    return deltaY < 0 ? 'down' : 'up'
  }

  return null
}

export function getAdjacentCellId(
  cellId: string,
  direction: MatrixDirection,
  rows: MatrixRow[],
  columns: MatrixColumn[],
  cells: MatrixCell[]
) {
  const cell = cells.find((item) => item.id === cellId)
  if (!cell) return null

  const rowIndex = rows.findIndex((row) => row.id === cell.rowId)
  const columnIndex = columns.findIndex((column) => column.id === cell.columnId)
  if (rowIndex < 0 || columnIndex < 0) return null

  const nextPosition = {
    up: [rowIndex - 1, columnIndex],
    right: [rowIndex, columnIndex + 1],
    down: [rowIndex + 1, columnIndex],
    left: [rowIndex, columnIndex - 1],
  } satisfies Record<MatrixDirection, [number, number]>

  const [nextRowIndex, nextColumnIndex] = nextPosition[direction]
  const nextRow = rows[nextRowIndex]
  const nextColumn = columns[nextColumnIndex]
  if (!nextRow || !nextColumn) return null

  return (
    cells.find((item) => item.rowId === nextRow.id && item.columnId === nextColumn.id)?.id ??
    null
  )
}
