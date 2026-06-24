import { describe, expect, it } from 'vitest'
import { MATRIX_CELLS, MATRIX_COLUMNS, MATRIX_ROWS } from './matrix'
import { getAdjacentCellId, resolveSwipeDirection } from './matrix-navigation'

describe('getAdjacentCellId', () => {
  it('moves across columns and rows from a matrix cell', () => {
    expect(getAdjacentCellId('A1', 'right', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBe('B1')
    expect(getAdjacentCellId('A1', 'down', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBe('A2')
    expect(getAdjacentCellId('E3', 'left', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBe('D3')
    expect(getAdjacentCellId('E3', 'up', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBe('E2')
  })

  it('returns null at matrix edges or for unknown cells', () => {
    expect(getAdjacentCellId('A1', 'left', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBeNull()
    expect(getAdjacentCellId('A1', 'up', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBeNull()
    expect(getAdjacentCellId('H7', 'right', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBeNull()
    expect(getAdjacentCellId('H7', 'down', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBeNull()
    expect(getAdjacentCellId('Z9', 'right', MATRIX_ROWS, MATRIX_COLUMNS, MATRIX_CELLS)).toBeNull()
  })

  it('resolves one dominant swipe direction per gesture', () => {
    expect(resolveSwipeDirection({ startX: 220, startY: 100, endX: 80, endY: 112 })).toBe('right')
    expect(resolveSwipeDirection({ startX: 80, startY: 100, endX: 220, endY: 88 })).toBe('left')
    expect(resolveSwipeDirection({ startX: 100, startY: 220, endX: 108, endY: 80 })).toBe('down')
    expect(resolveSwipeDirection({ startX: 100, startY: 80, endX: 108, endY: 220 })).toBe('up')
  })

  it('ignores short or ambiguous diagonal swipes', () => {
    expect(resolveSwipeDirection({ startX: 100, startY: 100, endX: 124, endY: 102 })).toBeNull()
    expect(resolveSwipeDirection({ startX: 100, startY: 100, endX: 100, endY: 20 })).toBeNull()
    expect(resolveSwipeDirection({ startX: 100, startY: 100, endX: 180, endY: 100 })).toBeNull()
    expect(resolveSwipeDirection({ startX: 100, startY: 100, endX: 170, endY: 164 })).toBeNull()
  })
})
