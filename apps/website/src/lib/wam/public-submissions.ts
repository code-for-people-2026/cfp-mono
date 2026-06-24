export type MatrixSubmissionStatus = 'pending' | 'approved' | 'rejected'

export type MatrixSubmissionRecord = {
  id: string
  cellId: string
  content: string
  authorName: string | null
  contact: string | null
  status: MatrixSubmissionStatus
  createdAt: string
}

export type PublicMatrixSubmission = {
  id: string
  cellId: string
  content: string
  authorName: string | null
  createdAt: string
}

export type PublicSubmissionsByCell = Record<string, PublicMatrixSubmission[]>

export function groupApprovedSubmissions(rows: MatrixSubmissionRecord[]): PublicSubmissionsByCell {
  return rows.reduce<PublicSubmissionsByCell>((grouped, row) => {
    if (row.status !== 'approved') {
      return grouped
    }

    grouped[row.cellId] ??= []
    grouped[row.cellId].push({
      id: row.id,
      cellId: row.cellId,
      content: row.content,
      authorName: row.authorName,
      createdAt: row.createdAt,
    })

    return grouped
  }, {})
}
