'use client'

import { MessageSquarePlus, RefreshCcw } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  getMatrixBrowseCells,
  getMatrixBrowseHref,
  getMatrixCellHref,
  MATRIX_RETURN_STORAGE_KEY,
  MATRIX_SCROLL_STORAGE_KEY,
  parseMatrixScrollPosition,
  resolveMatrixBrowseState,
  serializeMatrixScrollPosition,
  type MatrixBrowseState,
} from '@/lib/wam/matrix-browser'
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
  initialBrowseState: MatrixBrowseState
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

type MatrixTableProps = {
  rows: MatrixRow[]
  columns: MatrixColumn[]
  cells: MatrixCell[]
  submissions: PublicSubmissionsByCell
  rememberReturnState: () => void
}

function MatrixTable({ rows, columns, cells, submissions, rememberReturnState }: MatrixTableProps) {
  const cellsByCoordinate = useMemo(
    () => new Map(cells.map((cell) => [`${cell.rowId}:${cell.columnId}`, cell])),
    [cells]
  )

  return (
    <table className="matrix-table" aria-label="牛马能力剥夺矩阵完整表格">
      <thead>
        <tr>
          <th aria-label="矩阵说明">
            <Link className="matrix-corner-link" href="/wam/guide">
              矩阵说明
            </Link>
          </th>
          {columns.map((column) => (
            <th key={column.id} scope="col" className={column.unsegmented ? 'unsegmented' : undefined}>
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
              const cell = cellsByCoordinate.get(`${row.id}:${column.id}`)
              if (!cell) return null
              const approvedItems = submissions[cell.id] ?? []
              const previewItems = approvedItems.slice(0, 2)

              return (
                <td key={cell.id} className={column.unsegmented ? 'unsegmented' : undefined}>
                  <Link
                    className="matrix-cell-link"
                    href={getMatrixCellHref(cell.id)}
                    aria-label={`${cell.id} ${column.title} × ${row.title}`}
                    onClick={rememberReturnState}
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
  )
}

export function InteractiveMatrix({ rows, columns, cells, initialBrowseState }: Props) {
  const router = useRouter()
  const [submissions, setSubmissions] = useState<PublicSubmissionsByCell>({})
  const [approvedCount, setApprovedCount] = useState(0)
  const [dataOffline, setDataOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [browseState, setBrowseState] = useState(initialBrowseState)
  const matrixScrollRef = useRef<HTMLDivElement>(null)
  const restoredMatrixScrollRef = useRef(false)
  const supplementFormUrl =
    process.env.NEXT_PUBLIC_EXTERNAL_FORM_URL || DEFAULT_EXTERNAL_FORM_URL

  const browseCells = useMemo(
    () => getMatrixBrowseCells(browseState, cells),
    [browseState, cells]
  )
  const selectedAxisItem =
    browseState.axis === 'people'
      ? columns.find((column) => column.id === browseState.itemId)
      : rows.find((row) => row.id === browseState.itemId)
  const browseListLabel = `${selectedAxisItem?.title ?? ''}的${
    browseState.axis === 'people' ? '能力' : '人群'
  }格子`

  const rememberReturnState = () => {
    const href = getMatrixBrowseHref(browseState)
    window.sessionStorage.setItem(MATRIX_RETURN_STORAGE_KEY, href)
    window.sessionStorage.setItem(
      MATRIX_SCROLL_STORAGE_KEY,
      serializeMatrixScrollPosition({
        href,
        scrollLeft: matrixScrollRef.current?.scrollLeft ?? 0,
      })
    )
  }

  const updateBrowseState = (input: Partial<MatrixBrowseState>) => {
    const nextState = resolveMatrixBrowseState(
      {
        view: input.view ?? browseState.view,
        axis: input.axis ?? browseState.axis,
        itemId: Object.hasOwn(input, 'itemId') ? input.itemId : browseState.itemId,
      },
      rows,
      columns
    )
    setBrowseState(nextState)
    const href = getMatrixBrowseHref(nextState)
    window.sessionStorage.setItem(MATRIX_RETURN_STORAGE_KEY, href)
    router.replace(href, { scroll: false })
  }

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

  useEffect(() => {
    window.sessionStorage.setItem(MATRIX_RETURN_STORAGE_KEY, getMatrixBrowseHref(browseState))
  }, [browseState])

  useLayoutEffect(() => {
    if (restoredMatrixScrollRef.current) return
    restoredMatrixScrollRef.current = true

    const scrollContainer = matrixScrollRef.current
    if (!scrollContainer || browseState.view !== 'matrix') return

    const href = getMatrixBrowseHref(browseState)
    const position = parseMatrixScrollPosition(
      window.sessionStorage.getItem(MATRIX_SCROLL_STORAGE_KEY)
    )
    if (!position || position.href !== href) return

    const maximumScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth)
    scrollContainer.scrollLeft = Math.min(position.scrollLeft, maximumScrollLeft)
  }, [browseState])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="kicker">码成仝 · 如何选题</div>
          <h1>牛马能力剥夺矩阵</h1>
          <p className="matrix-scope">7×7 核心矩阵 + H 未细分补充列</p>
          <p className="matrix-subtitle">
            7 类工友 × 7 样能力构成核心矩阵；H 列补充尚未按人群细分、但同样需要被认真看见的方向。
            <br />
            <span>这不是“做哪个最好”，而是检查哪些人、哪些被剥夺的能力还没有被认真看见。</span>
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

      <section className="matrix-context" aria-label="矩阵用途与上下文">
        <p>
          这是一份发现能力缺口的方向检查表与公共教材，不等同于产品路线图；矩阵中的每个格子并不都已进入产品计划。
        </p>
        <nav aria-label="矩阵上下文入口">
          <Link href="/wam/guide">为什么是这个矩阵</Link>
        </nav>
      </section>

      {dataOffline ? (
        <div className="notice notice-hidden" role="status">
          互动数据暂时没有连上，矩阵仍可浏览。
        </div>
      ) : null}

      <section
        className="matrix-frame"
        aria-label="互动矩阵"
        data-mobile-view={browseState.view}
      >
        <section className="matrix-mobile-browser" aria-label="移动矩阵浏览">
          <div className="matrix-view-switch" aria-label="矩阵视图">
            <button
              type="button"
              aria-pressed={browseState.view === 'list'}
              onClick={() => updateBrowseState({ view: 'list' })}
            >
              列表浏览
            </button>
            <button
              type="button"
              aria-pressed={browseState.view === 'matrix'}
              onClick={() => updateBrowseState({ view: 'matrix' })}
            >
              完整矩阵
            </button>
          </div>

          {browseState.view === 'list' ? (
            <div className="matrix-list-browser">
              <div className="matrix-axis-switch" aria-label="浏览轴向">
                <button
                  type="button"
                  aria-pressed={browseState.axis === 'people'}
                  onClick={() => updateBrowseState({ axis: 'people', itemId: '' })}
                >
                  按人群
                </button>
                <button
                  type="button"
                  aria-pressed={browseState.axis === 'ability'}
                  onClick={() => updateBrowseState({ axis: 'ability', itemId: '' })}
                >
                  按能力
                </button>
              </div>

              <label className="matrix-axis-select">
                <span>{browseState.axis === 'people' ? '选择人群' : '选择能力'}</span>
                <select
                  aria-label={browseState.axis === 'people' ? '选择人群' : '选择能力'}
                  value={browseState.itemId}
                  onChange={(event) => updateBrowseState({ itemId: event.target.value })}
                >
                  {(browseState.axis === 'people' ? columns : rows).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title} · {item.subtitle}
                    </option>
                  ))}
                </select>
              </label>

              <ul className="matrix-mobile-list" aria-label={browseListLabel}>
                {browseCells.map((cell) => {
                  const approvedItems = submissions[cell.id] ?? []
                  return (
                    <li key={cell.id}>
                      <article className="matrix-mobile-item">
                        <div className="matrix-mobile-item-head">
                          <span className="selected-id">{cell.id}</span>
                          <div>
                            <h2>{cell.columnTitle} × {cell.rowTitle}</h2>
                            <p>{approvedItems.length} 条已上墙</p>
                          </div>
                        </div>
                        <div className="matrix-mobile-tags" aria-label={`${cell.id} 主要标签`}>
                          {cell.tags.slice(0, 2).map((tag) => (
                            <span key={`${cell.id}-mobile-${tag.text}`} className={tagClass[tag.tone]}>
                              {tag.tone === 'star' ? '★ ' : ''}
                              {tag.text}
                            </span>
                          ))}
                        </div>
                        <Link
                          className="matrix-mobile-detail-link"
                          href={getMatrixCellHref(cell.id)}
                          aria-label={`${cell.id} ${cell.columnTitle} × ${cell.rowTitle}，查看详情`}
                          onClick={rememberReturnState}
                        >
                          查看详情
                        </Link>
                      </article>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <p className="matrix-scroll-hint">完整矩阵可在下方容器内横向滚动；行列标题和格子文字均保留。</p>
          )}
        </section>

        <div
          ref={matrixScrollRef}
          className="matrix-scroll"
          tabIndex={0}
          aria-label="横向滚动浏览完整矩阵"
        >
          <MatrixTable
            rows={rows}
            columns={columns}
            cells={cells}
            submissions={submissions}
            rememberReturnState={rememberReturnState}
          />
        </div>
      </section>

      <section className="matrix-bottom" aria-label="图例与投稿说明">
        <div className="matrix-legend">
          <p>
            <span className="legend-demo legend-red">红底 = 红海</span>
            大公司已做成的对位产品（需求真实存在），目前倾向不明显。
          </p>
          <p>
            <span className="legend-demo legend-blue">蓝底 = 蓝海</span>
            还没人认真做的空白；虚线“大厂未覆盖”表示连巨头都没动力沾边的需求。
          </p>
          <p>
            <span className="legend-demo legend-black">黑底 = 黑化</span>
            产品成熟，但站在平台或老板一边，工友只是被管理、被抽成的对象。
          </p>
          <p>
            <span className="legend-demo legend-gold">金底 = 站到人民这边</span>
            把利让给人民也做成了的玩家（哪怕不彻底），证明这条路走得通。
          </p>
          <p>
            <span className="legend-demo legend-manifesto">★ 我们的纲领</span>
            这张矩阵是面向同路人的方向地图与教材，不是给工友使用的软件产品。
          </p>
          <p>
            <b>格子里特意留了空白：点一个格子，把你的痛点和点子补上去。</b>
          </p>
        </div>

        <a
          className="matrix-qrbox-link"
          href={supplementFormUrl}
          target="_blank"
          rel="noreferrer"
        >
          <Image src="/qr-interactive.svg" alt="扫码打开补充表单" width={136} height={136} />
          <p>
            <b>扫码补充这张矩阵</b>
            点一个格子，写下你的痛点、观察或产品点子；审核通过后，内容与可选署名会显示在互动矩阵中。
            <br />
            <span>
              将在新标签页离开官网。提交内容和可选联系方式在审核前仅供码成仝审核人员查看；联系方式不会公开。
            </span>
          </p>
        </a>
      </section>

      <div className="matrix-foot" aria-label="矩阵版本信息">
        <div>
          <b>码成仝</b>
          <span>一个为工友敲键盘的组织</span>
        </div>
        <span>WAM · Worker Ability Matrix</span>
      </div>
    </main>
  )
}
