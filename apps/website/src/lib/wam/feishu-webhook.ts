import { MATRIX_CELLS, MATRIX_COLUMNS, MATRIX_ROWS, type MatrixCellId } from './matrix'

const validCellIds = new Set(MATRIX_CELLS.map((cell) => cell.id))

type FeishuWebhookValue = {
  cellId: MatrixCellId
  content: string
  abilityArea?: string
  submissionType?: string
  softwareName?: string
  authorName?: string
  contact?: string
  secret?: string
}

type FeishuWebhookParseResult =
  | {
      ok: true
      value: FeishuWebhookValue
    }
  | {
      ok: false
      status: 400
      message: string
    }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyFieldValue(item)).join('')
  }

  const record = asRecord(value)
  if (!record) {
    return ''
  }

  for (const key of ['text', 'name', 'value']) {
    const nested = stringifyFieldValue(record[key])
    if (nested) {
      return nested
    }
  }

  return ''
}

function readField(body: Record<string, unknown>, names: string[]): string {
  const record = asRecord(body.record)
  const event = asRecord(body.event)
  const eventRecord = asRecord(event?.record)
  const fieldSources = [body, asRecord(body.fields), asRecord(record?.fields), asRecord(eventRecord?.fields)]

  for (const name of names) {
    for (const source of fieldSources) {
      const value = stringifyFieldValue(source?.[name]).trim()
      if (value) {
        return value
      }
    }
  }

  return ''
}

function isMatrixCellId(value: string): value is MatrixCellId {
  return validCellIds.has(value)
}

function normalizeMatrixChoice(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s:：,，.。·/／()（）\-_—]/g, '')
}

function matchesChoice(value: string, choices: string[]): boolean {
  const normalizedValue = normalizeMatrixChoice(value)
  // An empty value would make `normalizedChoice.includes(normalizedValue)` (substring of "")
  // true for every choice, so a payload missing this dimension would silently match the
  // first column/row (A1). Treat a blank value as "no match" so it gets rejected instead.
  if (!normalizedValue) {
    return false
  }
  return choices.some((choice) => {
    const normalizedChoice = normalizeMatrixChoice(choice)
    if (!normalizedChoice) {
      return false
    }
    return (
      normalizedValue === normalizedChoice ||
      normalizedValue.includes(normalizedChoice) ||
      normalizedChoice.includes(normalizedValue)
    )
  })
}

function resolveCellId({
  explicitCellId,
  productionPosition,
  abilityArea,
}: {
  explicitCellId: string
  productionPosition: string
  abilityArea: string
}): MatrixCellId | '' {
  if (isMatrixCellId(explicitCellId)) {
    return explicitCellId
  }

  const normalizedPosition = normalizeMatrixChoice(productionPosition)
  const column = MATRIX_COLUMNS.find((item) => {
    return (
      normalizedPosition === normalizeMatrixChoice(item.letter) ||
      matchesChoice(productionPosition, [item.title, `${item.letter}${item.title}`, item.subtitle])
    )
  })

  const normalizedAbility = normalizeMatrixChoice(abilityArea)
  const row = MATRIX_ROWS.find((item) => {
    return (
      normalizedAbility === String(item.index) ||
      matchesChoice(abilityArea, [item.title, `${item.index}${item.title}`, item.subtitle])
    )
  })

  const inferredCellId = column && row ? `${column.letter}${row.index}` : ''
  return isMatrixCellId(inferredCellId) ? inferredCellId : ''
}

export function parseFeishuSubmissionWebhook(body: unknown): FeishuWebhookParseResult {
  const record = asRecord(body)
  if (!record) {
    return {
      ok: false,
      status: 400,
      message: 'Invalid JSON body.',
    }
  }

  const explicitCellId = readField(record, ['所属格子', 'cellId', 'cell'])
  const productionPosition = readField(record, [
    '生产关系中的位置',
    '人在生产关系里的位置',
    '生产位置',
    'productionPosition',
    'positionInProduction',
    'column',
    'columnTitle',
  ])
  const content = readField(record, ['软件需求', '具体补充内容', 'content', 'submission'])
  const abilityArea = readField(record, [
    '被剥削的能力',
    '被剥夺的能力',
    '能力区域',
    'abilityArea',
    'topic',
    'row',
    'rowTitle',
  ])
  const submissionType = readField(record, [
    '该软件需求被服务现状',
    '补充类型',
    '内容类型',
    '投稿类型',
    'submissionType',
    'type',
    'category',
  ])
  const softwareName = readField(record, ['软件名称', 'softwareName', 'productName'])
  const authorName = readField(record, ['署名', '个人信息', '昵称', '姓名', 'authorName', 'name'])
  const contact = readField(record, ['联系方式', '电话号码', '联系信息', 'contact', 'phone', 'wechat', 'email'])
  const secret = readField(record, ['secret', 'webhookSecret'])
  const cellId = resolveCellId({ explicitCellId, productionPosition, abilityArea })

  if (!isMatrixCellId(cellId)) {
    return {
      ok: false,
      status: 400,
      message: 'Invalid matrix cell.',
    }
  }

  if (!content) {
    return {
      ok: false,
      status: 400,
      message: 'Missing submission content.',
    }
  }

  return {
    ok: true,
    value: {
      cellId,
      content,
      ...(abilityArea ? { abilityArea } : {}),
      ...(submissionType ? { submissionType } : {}),
      ...(softwareName ? { softwareName } : {}),
      ...(authorName ? { authorName } : {}),
      ...(contact ? { contact } : {}),
      ...(secret ? { secret } : {}),
    },
  }
}
