import { afterEach, describe, expect, it, vi } from 'vitest'

const createSubmission = vi.fn()

vi.mock('@/lib/wam/payload-client', () => ({
  getPayloadClient: vi.fn(async () => ({
    create: createSubmission,
  })),
}))

import { POST } from './route'

describe('POST /api/feishu/submissions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    createSubmission.mockReset()
    delete process.env.FEISHU_WEBHOOK_SECRET
  })

  it('creates a pending Payload submission from an authorized Feishu request', async () => {
    process.env.FEISHU_WEBHOOK_SECRET = 'shared-secret'
    createSubmission.mockResolvedValueOnce({ id: 'submission-1' })

    const response = await POST(
      new Request('http://localhost/api/wam/feishu/submissions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wam-webhook-secret': 'shared-secret',
          'user-agent': 'feishu-automation',
        },
        body: JSON.stringify({
          '生产关系中的位置': '二产',
          '被剥削的能力': '时间主权',
          '该软件需求被服务现状': '黑化：站在平台/老板那边',
          '软件需求': '排班工具要能解释调休逻辑',
          '软件名称': '工时核对器',
          '署名': '工友 A',
          '联系方式': 'wechat-a',
        }),
      })
    )

    await expect(response.json()).resolves.toEqual({
      id: 'submission-1',
      status: 'pending',
    })
    expect(response.status).toBe(201)
    expect(createSubmission).toHaveBeenCalledWith({
      collection: 'matrix-submissions',
      overrideAccess: true,
      data: {
        cellId: 'B2',
        content: '排班工具要能解释调休逻辑',
        status: 'pending',
        authorName: '工友 A',
        contact: 'wechat-a',
        reviewNote: '来源：飞书自动化；被剥削的能力：时间主权；被服务现状：黑化：站在平台/老板那边；软件名称：工时核对器',
        userAgent: 'feishu-automation',
      },
    })
  })

  it('rejects requests with the wrong shared secret', async () => {
    process.env.FEISHU_WEBHOOK_SECRET = 'shared-secret'

    const response = await POST(
      new Request('http://localhost/api/wam/feishu/submissions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wam-webhook-secret': 'wrong-secret',
        },
        body: JSON.stringify({
          '所属格子': 'B2',
          '具体补充内容': '排班工具要能解释调休逻辑',
        }),
      })
    )

    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized webhook request.',
    })
    expect(response.status).toBe(401)
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it('accepts a matching body secret when a wrong header is present', async () => {
    process.env.FEISHU_WEBHOOK_SECRET = 'shared-secret'
    createSubmission.mockResolvedValueOnce({ id: 'submission-2' })

    const response = await POST(
      new Request('http://localhost/api/wam/feishu/submissions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wam-webhook-secret': 'wrong-secret',
        },
        body: JSON.stringify({
          secret: 'shared-secret',
          '所属格子': 'C1',
          '具体补充内容': '骑手补贴规则需要可解释',
        }),
      })
    )

    await expect(response.json()).resolves.toEqual({
      id: 'submission-2',
      status: 'pending',
    })
    expect(response.status).toBe(201)
  })
})
