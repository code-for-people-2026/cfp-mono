import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import {
  activityLabel,
  activityTimeRange,
  activityTone,
  addDays,
  buildWeek,
  mondayOfWeek,
  todayKey,
  weekBlockLabelParts,
  WEEKLY_FILTERS,
  type Activity,
  type WeeklyFilter,
} from '../model'
import type { TimelineLoaded } from '../api/timeline'
import { useTimelineGestures } from '../gestures/useTimelineGestures'
import { PaperTurnViewport } from './PaperTurnViewport'
import { designPixelsFloor, designSize } from './display'
import './visualizations.css'

type NativeTimelineTouchProps = ReturnType<typeof useTimelineGestures>['nativeTouchProps']

export interface WeekCalendarProps {
  activities: Activity[]
  weekStart: string
  onActivityClick?: (activity: Activity) => void
  onDateClick?: (date: string) => void
  scale?: number
  onScaleChange?: (scale: number) => void
  gesturesDisabled?: boolean
  gestureResetKey?: string
  today?: string
  onNavigate?: (direction: 'prev' | 'next') => void
  onNavigateReady?: (direction: 'prev' | 'next') => boolean
  adjacentPages?: Partial<Record<'prev' | 'next', TimelineLoaded>>
  foldAvatarUrl?: string | null
}

const HOUR_HEIGHT = 78
const MIN_WEEK_EVENT_HEIGHT = 24
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const hours = Array.from({ length: 13 }, (_, index) => index * 2)

function WeekCanvas({
  canvasId, week, scale, preview = false, nativeTouchProps, nativeCatchMove = false, onActivityClick,
}: {
  canvasId: string
  week: ReturnType<typeof buildWeek>
  scale: number
  preview?: boolean
  nativeTouchProps?: NativeTimelineTouchProps
  nativeCatchMove?: boolean
  onActivityClick?: (activity: Activity) => void
}) {
  const canvas = (
    <View
      id={canvasId}
      className={preview ? 'bubu-week-preview-canvas' : 'bubu-week-canvas'}
      style={{ height: designSize(24 * HOUR_HEIGHT * scale) }}
      {...(preview ? {} : { ...nativeTouchProps, catchMove: nativeCatchMove })}
    >
      {hours.map((hour) => <View className='bubu-week-hour' style={{ top: designSize(hour * HOUR_HEIGHT * scale) }} key={hour}><Text className='bubu-week-hour-label'>{String(hour).padStart(2, '0')}</Text><View className='bubu-week-hour-rule' /></View>)}
      <View className='bubu-week-columns'>
        {week.map((day) => (
          <View className={`bubu-week-column${day.isToday ? ' bubu-week-column-today' : ''}`} key={day.date}>
            {day.blocks.map((block) => {
              const tone = activityTone(block.activity.type)
              const parts = block.lanes > 1 ? weekBlockLabelParts(block.label) : null
              return <View key={block.activity.id} className={`bubu-week-event${block.isBackground ? ' bubu-week-event-bg' : ''}${block.lanes >= 3 ? ' bubu-week-event-dense' : ''}`} style={{ top: `${block.top}%`, height: `${block.height}%`, left: `${block.left}%`, width: `${block.width}%`, backgroundColor: tone.background, borderColor: tone.border, color: tone.color }} ariaLabel={`${activityLabel(block.activity)}，${activityTimeRange(block.activity)}`} {...(preview ? {} : { onClick: () => onActivityClick?.(block.activity) })}>
                <View className={`bubu-week-event-label${parts ? ' bubu-week-event-label-stacked' : ' bubu-week-event-label-inline'}`}>
                  {parts ? <><View className='bubu-week-event-value'>{parts.value}</View><View className='bubu-week-event-unit'>{parts.unit}</View></> : <Text>{block.label}</Text>}
                </View>
              </View>
            })}
          </View>
        ))}
      </View>
    </View>
  )
  if (!preview) return canvas
  return <View className='bubu-paper-preview-scroll'>{canvas}</View>
}

export function WeekCalendar({
  activities, weekStart, onActivityClick, onDateClick,
  scale = 1, onScaleChange, gesturesDisabled, gestureResetKey, today: todayProp, onNavigate, onNavigateReady, adjacentPages,
  foldAvatarUrl,
}: WeekCalendarProps) {
  const today = todayProp ?? todayKey()
  const gestures = useTimelineGestures({
    scale, onScaleChange, onNavigate, onNavigateReady,
    canNext: weekStart < mondayOfWeek(today),
    previousLabel: '前一周', nextLabel: '后一周', currentLabel: '本周',
    disabled: gesturesDisabled, resetKey: gestureResetKey ?? weekStart,
  })
  const [filters, setFilters] = useState<WeeklyFilter[]>(WEEKLY_FILTERS.map((filter) => filter.key))
  const restoredWeek = useRef<string | null>(null)
  const canvasHeight = gestures.canvasHeight || designPixelsFloor(24 * HOUR_HEIGHT) * scale
  const minBlockHeightPercent = MIN_WEEK_EVENT_HEIGHT / Math.max(1, canvasHeight) * 100
  const week = useMemo(() => buildWeek(activities, weekStart, filters, today, { minBlockHeightPercent }), [activities, weekStart, filters, today, minBlockHeightPercent])
  const recordCount = new Set(week.flatMap((day) => day.blocks.map((block) => block.activity.id))).size
  useEffect(() => {
    const previous = restoredWeek.current
    restoredWeek.current = weekStart
    if (previous && previous !== weekStart) gestures.applyScrollTop(gestures.gestureScrollTop)
  }, [weekStart, gestures])
  const openActivity = (activity: Activity) => {
    if (gestures.consumeClickSuppression()) return
    onActivityClick?.(activity)
  }
  const turn = gestures.paperTurn
  const previousPage = adjacentPages?.prev
  const nextPage = adjacentPages?.next
  const previousWeekStart = addDays(weekStart, -7)
  const nextWeekStart = addDays(weekStart, 7)
  const previousWeek = useMemo(
    () => previousPage ? buildWeek(previousPage.activities, previousWeekStart, filters, today, { minBlockHeightPercent }) : [],
    [previousPage, previousWeekStart, filters, today, minBlockHeightPercent],
  )
  const nextWeek = useMemo(
    () => nextPage ? buildWeek(nextPage.activities, nextWeekStart, filters, today, { minBlockHeightPercent }) : [],
    [nextPage, nextWeekStart, filters, today, minBlockHeightPercent],
  )
  const nativeCatchMove = gestures.isPinching || turn.phase !== 'idle'
  const weekHead = (targetWeek: ReturnType<typeof buildWeek>, preview = false) => (
    <View className='bubu-week-head'>
      <View className='bubu-week-gutter' />
      {targetWeek.map((day, index) => (
        <View className={`bubu-week-day${day.isToday ? ' bubu-week-day-today' : ''}${day.isFuture ? ' bubu-week-day-future' : ''}`} key={day.date} onClick={() => { if (!preview && !day.isFuture) onDateClick?.(day.date) }}>
          <Text className='bubu-week-weekday'>{weekdays[index]}</Text><Text className='bubu-week-date'>{Number(day.date.slice(-2))}</Text>
        </View>
      ))}
    </View>
  )

  return (
    <View className='bubu-viz-card bubu-week-card bubu-paper-turn'>
      <View className='bubu-week-filters'>{WEEKLY_FILTERS.map((filter) => <View key={filter.key} className={`bubu-week-filter${filters.includes(filter.key) ? ' bubu-week-filter-active' : ''}`} onClick={() => setFilters((current) => current.includes(filter.key) ? current.filter((key) => key !== filter.key) : [...current, filter.key])}><View className='bubu-legend-dot' style={{ backgroundColor: filter.color }} /><Text>{filter.label}</Text></View>)}</View>
      {weekHead(week)}
      {recordCount === 0 && <View className='bubu-empty-inline'>{filters.length ? '这一周没有所选类型的记录' : '选择活动类型，查看一周记录'}</View>}
      <PaperTurnViewport
        paperTurn={turn}
        viewportWidth={gestures.viewportWidth}
        viewportHeight={gestures.viewportHeight}
        gestureScrollTop={gestures.gestureScrollTop}
        foldAvatarUrl={foldAvatarUrl}
        previous={previousPage ? (
          <WeekCanvas canvasId={`${gestures.canvasId}-preview-prev`} week={previousWeek} scale={scale} preview />
        ) : undefined}
        next={nextPage ? (
          <WeekCanvas canvasId={`${gestures.canvasId}-preview-next`} week={nextWeek} scale={scale} preview />
        ) : undefined}
        current={
          <ScrollView id={gestures.scrollId} className='bubu-week-scroll' scrollY enhanced bounces={false}
            {...(process.env.TARO_ENV === 'h5' ? {} : { scrollTop: gestures.scrollTop })} onScroll={gestures.onScroll}>
            <WeekCanvas canvasId={gestures.canvasId} week={week} scale={scale}
              nativeTouchProps={gestures.nativeTouchProps} nativeCatchMove={nativeCatchMove} onActivityClick={openActivity} />
          </ScrollView>
        }
      >
        {gestures.feedback && <View className={`bubu-gesture-feedback bubu-gesture-feedback-${gestures.feedbackPlacement}`} role='status' ariaLabel={gestures.feedback}><Text>{gestures.feedback}</Text></View>}
      </PaperTurnViewport>
    </View>
  )
}
