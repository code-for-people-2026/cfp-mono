import { describe, expect, it } from 'vitest'
import { MATRIX_CELLS, getMatrixCell, MATRIX_COLUMNS, MATRIX_ROWS } from './matrix'

describe('matrix data', () => {
  it('contains the existing A1-H7 matrix cells with row and column labels', () => {
    expect(MATRIX_ROWS).toHaveLength(7)
    expect(MATRIX_COLUMNS).toHaveLength(8)
    expect(MATRIX_CELLS).toHaveLength(56)

    expect(getMatrixCell('A1')).toMatchObject({
      id: 'A1',
      rowId: 'labor-bargaining',
      columnId: 'primary-sector',
    })
    expect(getMatrixCell('H7')).toMatchObject({
      id: 'H7',
      rowId: 'education-skills',
      columnId: 'unsegmented',
    })
  })

  it('models poster items by semantic role instead of only by color', () => {
    expect(getMatrixCell('B1')?.tags[0]).toMatchObject({
      kind: 'product',
      tone: 'red',
      name: '鱼泡网',
      description: '工地招工记工',
      text: '鱼泡网：工地招工记工',
    })

    expect(getMatrixCell('B1')?.tags[1]).toMatchObject({
      kind: 'need',
      tone: 'blue',
      need: '电子厂工时工资自动核对',
      text: '电子厂工时工资自动核对',
    })

    expect(getMatrixCell('E1')?.tags[0]).toMatchObject({
      kind: 'coverageGap',
      tone: 'empty',
      label: '大厂未覆盖',
      text: '大厂未覆盖',
    })

    expect(getMatrixCell('H7')?.tags[0]).toMatchObject({
      kind: 'program',
      tone: 'star',
      title: '我们的纲领与方向地图',
      description: '这张 7×7 矩阵——给每个有马克思主义理想的同路人一份可上手的实践地图（是纲领/教材，不是给工友用的软件产品）',
    })
  })
})
