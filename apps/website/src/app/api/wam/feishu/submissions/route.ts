import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { parseFeishuSubmissionWebhook } from '@/lib/wam/feishu-webhook'
import { getPayloadClient } from '@/lib/wam/payload-client'

function secretsMatch(provided: string, expected: string): boolean {
  if (!provided) {
    return false
  }

  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)

  if (providedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(providedBuffer, expectedBuffer)
}

function buildReviewNote({
  abilityArea,
  submissionType,
  softwareName,
}: {
  abilityArea?: string
  submissionType?: string
  softwareName?: string
}) {
  return [
    '来源：飞书自动化',
    abilityArea ? `被剥削的能力：${abilityArea}` : '',
    submissionType ? `被服务现状：${submissionType}` : '',
    softwareName ? `软件名称：${softwareName}` : '',
  ]
    .filter(Boolean)
    .join('；')
}

export async function POST(request: Request) {
  const expectedSecret = process.env.FEISHU_WEBHOOK_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Webhook secret is not configured.' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = parseFeishuSubmissionWebhook(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: parsed.status })
  }

  const headerSecret = request.headers.get('x-wam-webhook-secret') || ''
  const bodySecret = parsed.value.secret || ''
  if (!secretsMatch(headerSecret, expectedSecret) && !secretsMatch(bodySecret, expectedSecret)) {
    return NextResponse.json({ error: 'Unauthorized webhook request.' }, { status: 401 })
  }

  const payload = await getPayloadClient()
  const submission = await payload.create({
    collection: 'matrix-submissions',
    overrideAccess: true,
    data: {
      cellId: parsed.value.cellId,
      content: parsed.value.content,
      status: 'pending',
      authorName: parsed.value.authorName ?? null,
      contact: parsed.value.contact ?? null,
      reviewNote: buildReviewNote({
        abilityArea: parsed.value.abilityArea,
        submissionType: parsed.value.submissionType,
        softwareName: parsed.value.softwareName,
      }),
      userAgent: request.headers.get('user-agent') || undefined,
    },
  })

  return NextResponse.json(
    {
      id: submission.id,
      status: 'pending',
    },
    { status: 201 }
  )
}
