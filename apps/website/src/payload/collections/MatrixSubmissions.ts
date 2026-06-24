import type { CollectionConfig } from 'payload'
import { MATRIX_CELLS } from '../../lib/wam/matrix'

const statusOptions = [
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' },
]

export const MatrixSubmissions: CollectionConfig = {
  slug: 'matrix-submissions',
  labels: {
    singular: '矩阵投稿',
    plural: '矩阵投稿审核',
  },
  admin: {
    useAsTitle: 'content',
    group: '互动矩阵',
    defaultColumns: ['cellId', 'status', 'content', 'authorName', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  timestamps: true,
  fields: [
    {
      name: 'cellId',
      label: '格子',
      type: 'select',
      required: true,
      index: true,
      options: MATRIX_CELLS.map((cell) => ({
        label: `${cell.id} · ${cell.columnTitle} × ${cell.rowTitle}`,
        value: cell.id,
      })),
    },
    {
      name: 'content',
      label: '投稿内容',
      type: 'textarea',
      required: true,
    },
    {
      name: 'authorName',
      label: '署名',
      type: 'text',
      required: false,
    },
    {
      name: 'contact',
      label: '联系方式',
      type: 'text',
      required: false,
      admin: {
        description: '只给审核人员查看，不会显示在公开页面。',
      },
    },
    {
      name: 'status',
      label: '审核状态',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: statusOptions,
      index: true,
    },
    {
      name: 'reviewNote',
      label: '审核备注',
      type: 'textarea',
      required: false,
    },
    {
      name: 'ipHash',
      label: 'IP 哈希',
      type: 'text',
      required: false,
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'userAgent',
      label: 'User Agent',
      type: 'textarea',
      required: false,
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
  ],
}
