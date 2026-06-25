'use client'

import { MessageSquarePlus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import type { MatrixCell, MatrixColumn, MatrixRow, MatrixTagTone } from '@/lib/wam/matrix'
import { getAdjacentCellId, resolveSwipeDirection } from '@/lib/wam/matrix-navigation'
import type { PublicSubmissionsByCell } from '@/lib/wam/public-submissions'
import { buildExternalFormUrl, DEFAULT_EXTERNAL_FORM_URL } from '@/lib/wam/external-form-url'

type MatrixPayload = {
  submissions?: PublicSubmissionsByCell
}

type Props = {
  rows: MatrixRow[]
  columns: MatrixColumn[]
  cells: MatrixCell[]
  initialCellId: string
}

type SwipePoint = {
  x: number
  y: number
  startedInScrollableContent: boolean
}

const SWIPE_NAVIGATION_COOLDOWN_MS = 320
let lastSwipeNavigationAt = 0

const tagClass: Record<MatrixTagTone, string> = {
  red: 'tag tag-red',
  blue: 'tag tag-blue',
  empty: 'tag tag-empty',
  black: 'tag tag-black',
  gold: 'tag tag-gold',
  star: 'tag tag-star',
}

function shouldIgnoreSwipeTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('a, button'))
}

function isScrollableReadingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('.approved-list'))
}

async function fetchSubmissions(): Promise<PublicSubmissionsByCell> {
  try {
    const response = await fetch('/api/wam/matrix', { method: 'GET', cache: 'no-store' })
    const payload = (await response.json()) as MatrixPayload
    return payload.submissions ?? {}
  } catch {
    return {}
  }
}

export function CellDetailView({ rows, columns, cells, initialCellId }: Props) {
  const router = useRouter()
  const swipeStartRef = useRef<SwipePoint | null>(null)
  const [submissions, setSubmissions] = useState<PublicSubmissionsByCell>({})
  const [activeCellId, setActiveCellId] = useState(initialCellId)

  const initialCell = useMemo(
    () => cells.find((cell) => cell.id === initialCellId) ?? cells[0],
    [cells, initialCellId]
  )

  const activeCell = useMemo(
    () => cells.find((cell) => cell.id === activeCellId) ?? initialCell,
    [activeCellId, cells, initialCell]
  )

  useEffect(() => {
    void fetchSubmissions().then(setSubmissions)
  }, [])

  const goToAdjacentCell = useCallback(
    (direction: 'up' | 'right' | 'down' | 'left') => {
      const now = Date.now()
      if (now - lastSwipeNavigationAt < SWIPE_NAVIGATION_COOLDOWN_MS) return

      const nextCellId = getAdjacentCellId(activeCellId, direction, rows, columns, cells)
      if (!nextCellId) return

      lastSwipeNavigationAt = now
      setActiveCellId(nextCellId)
      router.replace(`/wam/cell/${nextCellId}`, { scroll: false })
    },
    [activeCellId, cells, columns, rows, router]
  )

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (shouldIgnoreSwipeTarget(event.target)) {
      swipeStartRef.current = null
      return
    }

    const touch = event.touches[0]
    if (!touch) return

    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startedInScrollableContent: isScrollableReadingTarget(event.target),
    }
  }

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start) return

    const touch = event.changedTouches[0]
    if (!touch) return

    const direction = resolveSwipeDirection({
      startX: start.x,
      startY: start.y,
      endX: touch.clientX,
      endY: touch.clientY,
    })
    if (!direction) return

    if (start.startedInScrollableContent && (direction === 'up' || direction === 'down')) return

    goToAdjacentCell(direction)
  }

  return (
    <main className="cell-page">
      <header className="cell-page-topbar">
        <Link href="/wam" className="back-link">
          矩阵
        </Link>
        <div>
          <div className="kicker">上下翻能力项，左右切人群</div>
          <h1>牛马能力剥夺矩阵</h1>
        </div>
      </header>

      <div className="cell-position-strip" aria-label="当前位置">
        <span>
          {activeCell?.id} / {activeCell?.columnTitle} × {activeCell?.rowTitle}
        </span>
        <div className="cell-position-map" aria-hidden="true">
          {rows.map((row) =>
            columns.map((column) => {
              const cell = cells.find((item) => item.rowId === row.id && item.columnId === column.id)
              return (
                <i
                  key={`${row.id}-${column.id}`}
                  className={cell?.id === activeCell?.id ? 'active' : ''}
                />
              )
            })
          )}
        </div>
      </div>

      <div
        className="cell-detail-carousel"
        aria-label="格子详情滑动区"
        onTouchCancel={() => {
          swipeStartRef.current = null
        }}
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
      >
        {cells.map((cell) => {
          const approvedItems = submissions[cell.id] ?? []
          const row = rows.find((item) => item.id === cell.rowId)
          const column = columns.find((item) => item.id === cell.columnId)
          const externalFormUrl = buildExternalFormUrl({
            baseUrl: process.env.NEXT_PUBLIC_EXTERNAL_FORM_URL || DEFAULT_EXTERNAL_FORM_URL,
            productionPosition: column?.title ?? cell.columnTitle,
            abilityArea: row?.title ?? cell.rowTitle,
          })

          return (
            <article
              key={cell.id}
              className={
                cell.id === activeCell?.id ? 'cell-detail-slide active' : 'cell-detail-slide'
              }
              aria-label={`${cell.id} 格子详情`}
            >
              <div className="cell-detail-card">
                <div className="panel-head">
                  <div>
                    <span className="selected-id">{cell.id}</span>
                    <h2>
                      {column?.title ?? cell.columnTitle} × {row?.title ?? cell.rowTitle}
                    </h2>
                    <p className="cell-detail-subtitle">
                      {column?.subtitle}
                      {column?.subtitle && row?.subtitle ? ' / ' : ''}
                      {row?.subtitle}
                    </p>
                  </div>
                </div>

                <div className="cell-detail-tags" aria-label="格子现有内容">
                  {cell.tags.map((tag) => (
                    <span key={`${cell.id}-tag-${tag.text}`} className={tagClass[tag.tone]}>
                      {tag.tone === 'star' ? '★ ' : ''}
                      {tag.text}
                    </span>
                  ))}
                </div>

                <section className="approved-list">
                  <h3>已上墙</h3>
                  {approvedItems.length > 0 ? (
                    approvedItems.map((item) => (
                      <article key={`${cell.id}-approved-${item.id}`} className="submission-item">
                        <p>{item.content}</p>
                        <span>{item.authorName ? item.authorName : '现场补充'}</span>
                      </article>
                    ))
                  ) : (
                    <p>这个格子还在等第一条现场补充。</p>
                  )}
                </section>

                <a
                  href={externalFormUrl}
                  className="detail-submit-link"
                  rel="noreferrer"
                >
                  补一条
                  <MessageSquarePlus size={16} />
                </a>
              </div>
            </article>
          )
        })}
      </div>
    </main>
  )
}
