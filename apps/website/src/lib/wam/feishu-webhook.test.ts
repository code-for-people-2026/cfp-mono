import { describe, expect, it } from 'vitest'
import { parseFeishuSubmissionWebhook } from './feishu-webhook'

describe('parseFeishuSubmissionWebhook', () => {
  it('parses Chinese field names from a Feishu automation body', () => {
    const parsed = parseFeishuSubmissionWebhook({
      secret: 'shared-secret',
      '生产关系中的位置': ' 服务业新蓝领 ',
      '被剥削的能力': '劳动议价',
      '该软件需求被服务现状': '蓝海：未被认真服务',
      '软件需求': '  外卖骑手希望有补贴规则截图工具  ',
      '软件名称': '  骑手补贴雷达  ',
      '署名': '  小王  ',
      '联系方式': '  wechat-id  ',
    })

    expect(parsed).toEqual({
      ok: true,
      value: {
        cellId: 'C1',
        content: '外卖骑手希望有补贴规则截图工具',
        abilityArea: '劳动议价',
        submissionType: '蓝海：未被认真服务',
        softwareName: '骑手补贴雷达',
        authorName: '小王',
        contact: 'wechat-id',
        secret: 'shared-secret',
      },
    })
  })

  it('parses nested fields from Feishu record-shaped payloads', () => {
    const parsed = parseFeishuSubmissionWebhook({
      fields: {
        '生产关系中的位置': [{ text: '二产' }],
        '被剥削的能力': '时间主权',
        '该软件需求被服务现状': [{ text: '黑化：站在平台/老板那边' }],
        '软件需求': [{ text: '排班工具要能解释调休逻辑' }],
        '软件名称': [{ text: '工时核对器' }],
        '个人信息': [{ text: '匿名工友' }],
        '联系方式': [{ text: '13800000000' }],
      },
    })

    expect(parsed).toEqual({
      ok: true,
      value: {
        cellId: 'B2',
        content: '排班工具要能解释调休逻辑',
        abilityArea: '时间主权',
        submissionType: '黑化：站在平台/老板那边',
        softwareName: '工时核对器',
        authorName: '匿名工友',
        contact: '13800000000',
      },
    })
  })

  it('parses fields from Feishu record envelopes', () => {
    const parsed = parseFeishuSubmissionWebhook({
      event: {
        record: {
          fields: {
            '生产关系中的位置': [{ text: '过渡·失业·待业' }],
            '被剥削的能力': '劳动议价',
            '软件需求': [{ text: '跨平台收入要能自动汇总' }],
          },
        },
      },
    })

    expect(parsed).toEqual({
      ok: true,
      value: {
        cellId: 'E1',
        content: '跨平台收入要能自动汇总',
        abilityArea: '劳动议价',
      },
    })
  })

  it('rejects invalid cell IDs and blank content', () => {
    expect(
      parseFeishuSubmissionWebhook({
        '生产关系中的位置': '不存在的位置',
        '被剥削的能力': '劳动议价',
        '软件需求': '有效内容',
      })
    ).toEqual({
      ok: false,
      status: 400,
      message: 'Invalid matrix cell.',
    })

    expect(
      parseFeishuSubmissionWebhook({
        '生产关系中的位置': '一产',
        '被剥削的能力': '劳动议价',
        '软件需求': ' ',
      })
    ).toEqual({
      ok: false,
      status: 400,
      message: 'Missing submission content.',
    })
  })

  it('rejects a payload missing a matrix dimension instead of defaulting to the first cell', () => {
    // Missing 生产关系中的位置 (column). A blank value used to be a substring of every
    // choice, silently filing the submission under column A; it must be rejected now.
    expect(
      parseFeishuSubmissionWebhook({
        '被剥削的能力': '劳动议价',
        '软件需求': '有效内容但缺少人群维度',
      })
    ).toEqual({
      ok: false,
      status: 400,
      message: 'Invalid matrix cell.',
    })

    // Missing 被剥削的能力 (row).
    expect(
      parseFeishuSubmissionWebhook({
        '生产关系中的位置': '二产',
        '软件需求': '有效内容但缺少能力维度',
      })
    ).toEqual({
      ok: false,
      status: 400,
      message: 'Invalid matrix cell.',
    })
  })
})
