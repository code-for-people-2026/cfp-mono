'use client'

import { MessageSquarePlus, RefreshCcw } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { MatrixCell, MatrixColumn, MatrixRow, MatrixTagTone } from '@/lib/wam/matrix'
import { DEFAULT_EXTERNAL_FORM_URL } from '@/lib/wam/external-form-url'
import type { PublicSubmissionsByCell } from '@/lib/wam/public-submissions'

type MatrixPayload = {
  submissions?: PublicSubmissionsByCell
  meta?: {
    approvedCount?: number
    offline?: boolean
  }
}

type Props = {
  rows: MatrixRow[]
  columns: MatrixColumn[]
  cells: MatrixCell[]
}

const tagClass: Record<MatrixTagTone, string> = {
  red: 'tag tag-red',
  blue: 'tag tag-blue',
  empty: 'tag tag-empty',
  black: 'tag tag-black',
  gold: 'tag tag-gold',
  star: 'tag tag-star',
}

async function fetchMatrixPayload(): Promise<MatrixPayload> {
  const response = await fetch('/api/wam/matrix', { method: 'GET', cache: 'no-store' })
  return (await response.json()) as MatrixPayload
}

export function InteractiveMatrix({ rows, columns, cells }: Props) {
  const [submissions, setSubmissions] = useState<PublicSubmissionsByCell>({})
  const [approvedCount, setApprovedCount] = useState(0)
  const [dataOffline, setDataOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const supplementFormUrl =
    process.env.NEXT_PUBLIC_EXTERNAL_FORM_URL || DEFAULT_EXTERNAL_FORM_URL

  const loadSubmissions = async () => {
    setLoading(true)

    try {
      const payload = await fetchMatrixPayload()
      setSubmissions(payload.submissions ?? {})
      setApprovedCount(payload.meta?.approvedCount ?? 0)
      setDataOffline(Boolean(payload.meta?.offline))
    } catch {
      setSubmissions({})
      setApprovedCount(0)
      setDataOffline(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    void fetchMatrixPayload()
      .then((payload) => {
        if (!active) return
        setSubmissions(payload.submissions ?? {})
        setApprovedCount(payload.meta?.approvedCount ?? 0)
        setDataOffline(Boolean(payload.meta?.offline))
      })
      .catch(() => {
        if (!active) return
        setSubmissions({})
        setApprovedCount(0)
        setDataOffline(true)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="kicker">数据平权 · AI 下乡</div>
          <h1>牛马能力剥夺矩阵</h1>
          <p className="matrix-subtitle">
            7 类工友 × 7 样能力 = 49 个方向，看看你想在哪个方向实践。
            <br />
            <span>这不是&quot;做哪个最好&quot;，是&quot;哪些人、哪些被剥夺的能力，还没人认真看过&quot;。</span>
          </p>
        </div>
        <div className="topbar-side">
          <p className="matrix-axis-hint">
            横轴：人在生产关系里的位置
            <br />
            纵轴：被剥夺的能力
            <br />
            图例与说明见页底 ↓
          </p>
          <div className="stats">
            <span>{loading ? '同步中' : `${approvedCount} 条已上墙`}</span>
            <button type="button" onClick={() => void loadSubmissions()} aria-label="刷新投稿">
              <RefreshCcw size={16} />
            </button>
          </div>
        </div>
      </header>

      {dataOffline ? (
        <div className="notice notice-hidden" role="status">
          互动数据暂时没有连上，矩阵仍可浏览。
        </div>
      ) : null}

      <section className="matrix-frame" aria-label="互动矩阵">
        <div className="matrix-scroll" tabIndex={0} aria-label="横向滚动浏览完整矩阵">
          <table className="matrix-table">
            <thead>
              <tr>
                <th aria-label="矩阵说明">
                  <Link className="matrix-corner-link" href="/wam/guide">
                    矩阵说明
                  </Link>
                </th>
                {columns.map((column) => (
                  <th key={column.id} className={column.unsegmented ? 'unsegmented' : undefined}>
                    <b>{column.title}</b>
                    <small>{column.subtitle}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="matrix-row-heading">
                    <b>{row.title}</b>
                    <small>{row.subtitle}</small>
                  </th>
                  {columns.map((column) => {
                    const cell = cells.find((item) => item.rowId === row.id && item.columnId === column.id)
                    if (!cell) return null
                    const approvedItems = submissions[cell.id] ?? []
                    const previewItems = approvedItems.slice(0, 2)

                    return (
                      <td key={cell.id} className={column.unsegmented ? 'unsegmented' : undefined}>
                        <Link
                          className="matrix-cell-link"
                          href={`/wam/cell/${cell.id}`}
                          aria-label={`${cell.id} ${column.title} × ${row.title}`}
                        >
                          <span className="cell-id">{cell.id}</span>
                          <span className="cell-tags">
                            {cell.tags.slice(0, 2).map((tag) => (
                              <span key={`${cell.id}-${tag.text}`} className={tagClass[tag.tone]}>
                                {tag.tone === 'star' ? '★ ' : ''}
                                {tag.text}
                              </span>
                            ))}
                          </span>
                          {approvedItems.length > 0 ? (
                            <span className="cell-approved" aria-label={`${cell.id} 已上墙投稿`}>
                              {previewItems.map((item) => (
                                <span key={`${cell.id}-approved-${item.id}`} className="cell-approved-item">
                                  {item.content}
                                </span>
                              ))}
                            </span>
                          ) : null}
                          <span className="cell-footer" aria-hidden="true">
                            <MessageSquarePlus size={14} />
                          </span>
                        </Link>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="matrix-bottom" aria-label="图例与扫码说明">
        <div className="matrix-legend">
          <p>
            <span className="legend-demo legend-red">红底 = 红海</span>
            大公司已做成的对位产品（需求真实存在），目前倾向不明显。
          </p>
          <p>
            <span className="legend-demo legend-blue">蓝底 = 蓝海</span>
            还没人认真做的空白；虚线&quot;大厂未覆盖&quot; = 连巨头都没动力沾边的需求。
          </p>
          <p>
            <span className="legend-demo legend-black">黑底 = 黑化</span>
            产品成熟，但站在平台/老板那边，工友只是被管理、被抽成的对象。
          </p>
          <p>
            <span className="legend-demo legend-gold">金底 = 站到人民这边</span>
            把利让给人民也做成了的玩家（哪怕不彻底）-- 证明这条路走得通。
          </p>
          <p>
            <span className="legend-demo legend-manifesto">★ 我们的纲领</span>
            这张矩阵是我们的纲领 / 方向地图，面向同路人，把&quot;该往哪使劲&quot;交到每个马克思主义实践者手里（见 H7）--
            它是教材，不是给工友用的软件产品。
          </p>
          <p>
            <b>格子里特意留了空白：点一个格子，把你的痛点和点子补上去。</b>
          </p>
        </div>

        <a className="matrix-qrbox-link" href={supplementFormUrl} rel="noreferrer">
          <Image src="/qr-interactive.svg" alt="扫码打开补充表单" width={136} height={136} />
          <p>
            <b>扫码补充这张矩阵</b>
            点一个格子，写下你的痛点、观察或产品点子；我们现场审核后，会显示到互动矩阵里。
            <br />
            <span>联系方式可在飞书表单中自愿留下，只给审核人员看。</span>
          </p>
        </a>
      </section>

      <footer className="matrix-foot">
        <div>
          <b>Code For People</b>
          <span>一个为工友敲键盘的组织</span>
        </div>
        <span>WAM · Worker Ability Matrix</span>
      </footer>
    </main>
  )
}
