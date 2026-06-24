import { describe, expect, it } from 'vitest'
import { groupApprovedSubmissions, type MatrixSubmissionRecord } from './public-submissions'

describe('groupApprovedSubmissions', () => {
  it('groups only approved submissions and strips private fields', () => {
    const rows: MatrixSubmissionRecord[] = [
      {
        id: '1',
        cellId: 'A1',
        content: '公开想法',
        authorName: '小李',
        contact: 'private-wechat',
        status: 'approved',
        createdAt: '2026-06-13T10:00:00.000Z',
      },
      {
        id: '2',
        cellId: 'A1',
        content: '待审想法',
        authorName: null,
        contact: null,
        status: 'pending',
        createdAt: '2026-06-13T11:00:00.000Z',
      },
      {
        id: '3',
        cellId: 'B2',
        content: '驳回想法',
        authorName: '匿名',
        contact: null,
        status: 'rejected',
        createdAt: '2026-06-13T12:00:00.000Z',
      },
    ]

    expect(groupApprovedSubmissions(rows)).toEqual({
      A1: [
        {
          id: '1',
          cellId: 'A1',
          content: '公开想法',
          authorName: '小李',
          createdAt: '2026-06-13T10:00:00.000Z',
        },
      ],
    })
  })
})
