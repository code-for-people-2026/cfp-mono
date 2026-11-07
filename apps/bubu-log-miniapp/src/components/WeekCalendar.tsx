import { useMemo, useState } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import {
  activityLabel,
  activityTimeRange,
  activityTone,
  buildWeek,
  mondayOfWeek,
  todayKey,
  weekBlockLabelParts,
  WEEKLY_FILTERS,
  type Activity,
  type WeeklyFilter,
} from '../model'
import { useTimelineGestures } from '../gestures/useTimelineGestures'
import { designPixelsFloor, designSize } from './display'
import './visualizations.css'

export interface WeekCalendarProps {
  activities: Activity[]
  weekStart: string
  onActivityClick?: (activity: Activity) => void
  onDateClick?: (date: string) => void
  /** Shared day/week time-axis scale; parent state keeps it across view switches. */
  scale?: number
  onScaleChange?: (scale: number) => void
  /** Overlay/menu/detail open: axis gestures are cancelled and ignored. */
  gesturesDisabled?: boolean
  /** Date/baby changes terminate a pending gesture. */
  gestureResetKey?: string
  /** Current Shanghai day, refreshed at midnight and on app return. */
  today?: string
  /** A completed horizontal/boundary gesture; the page owns week state. */
  onNavigate?: (direction: 'prev' | 'next') => void
}

const HOUR_HEIGHT = 78
/** Physical CSS pixels for a readable stacked number+unit label; layout reserves it. */
const MIN_WEEK_EVENT_HEIGHT = 24
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const hours = Array.from({ length: 13 }, (_, index) => index * 2)

export function WeekCalendar({
  activities, weekStart, onActivityClick, onDateClick,
  scale = 1, onScaleChange, gesturesDisabled, gestureResetKey, today: todayProp, onNavigate,
}: WeekCalendarProps) {
  const today = todayProp ?? todayKey()
  const gestures = useTimelineGestures({
    scale,
    onScaleChange,
    onNavigate,
    canNext: weekStart < mondayOfWeek(today),
    previousLabel: '前一周',
    nextLabel: '后一周',
    currentLabel: '本周',
    disabled: gesturesDisabled,
    resetKey: gestureResetKey ?? weekStart,
  })
  const [filters, setFilters] = useState<WeeklyFilter[]>(WEEKLY_FILTERS.map((filter) => filter.key))
  const canvasHeight = gestures.canvasHeight || designPixelsFloor(24 * HOUR_HEIGHT) * scale
  const minBlockHeightPercent = MIN_WEEK_EVENT_HEIGHT / Math.max(1, canvasHeight) * 100
  const week = useMemo(
    () => buildWeek(activities, weekStart, filters, today, { minBlockHeightPercent }),
    [activities, weekStart, filters, today, minBlockHeightPercent],
  )
  const recordCount = new Set(week.flatMap((day) => day.blocks.map((block) => block.activity.id))).size

  const openActivity = (activity: Activity) => {
    if (gestures.consumeClickSuppression()) return
    onActivityClick?.(activity)
  }

  return (
    <View className='bubu-viz-card bubu-week-card'>
      <View className='bubu-week-filters'>{WEEKLY_FILTERS.map((filter) => <View key={filter.key} className={`bubu-week-filter${filters.includes(filter.key) ? ' bubu-week-filter-active' : ''}`} onClick={() => setFilters((current) => current.includes(filter.key) ? current.filter((key) => key !== filter.key) : [...current, filter.key])}><View className='bubu-legend-dot' style={{ backgroundColor: filter.color }} /><Text>{filter.label}</Text></View>)}</View>
      <View className='bubu-week-head'>
        <View className='bubu-week-gutter' />
        {week.map((day, index) => (
          <View className={`bubu-week-day${day.isToday ? ' bubu-week-day-today' : ''}${day.isFuture ? ' bubu-week-day-future' : ''}`} key={day.date} onClick={() => !day.isFuture && onDateClick?.(day.date)}>
            <Text className='bubu-week-weekday'>{weekdays[index]}</Text><Text className='bubu-week-date'>{Number(day.date.slice(-2))}</Text>
          </View>
        ))}
      </View>
      {recordCount === 0 && <View className='bubu-empty-inline'>{filters.length ? '这一周没有所选类型的记录' : '选择活动类型，查看一周记录'}</View>}
      <View className='bubu-timeline-viewport'>
        <ScrollView
          id={gestures.scrollId}
          className='bubu-week-scroll'
          scrollY
          enhanced
          bounces={false}
          {...(process.env.TARO_ENV === 'h5' ? {} : { scrollTop: gestures.scrollTop })}
          onScroll={gestures.onScroll}
        >
          <View
            id={gestures.canvasId}
            className='bubu-week-canvas'
            style={{ height: designSize(24 * HOUR_HEIGHT * scale) }}
            catchMove={process.env.TARO_ENV !== 'h5' && gestures.isPinching ? true : undefined}
            {...gestures.nativeTouchProps}
          >
            {hours.map((hour) => <View className='bubu-week-hour' style={{ top: designSize(hour * HOUR_HEIGHT * scale) }} key={hour}><Text className='bubu-week-hour-label'>{String(hour).padStart(2, '0')}</Text><View className='bubu-week-hour-rule' /></View>)}
            <View className='bubu-week-columns'>
              {week.map((day) => (
                <View className={`bubu-week-column${day.isToday ? ' bubu-week-column-today' : ''}`} key={day.date}>
                  {day.blocks.map((block) => {
                    const tone = activityTone(block.activity.type)
                    // A narrow lane stacks the number and unit instead of truncating `120ml`.
                    const parts = block.lanes > 1 ? weekBlockLabelParts(block.label) : null
                    return <View key={block.activity.id} className={`bubu-week-event${block.isBackground ? ' bubu-week-event-bg' : ''}${block.lanes >= 3 ? ' bubu-week-event-dense' : ''}`} style={{ top: `${block.top}%`, height: `${block.height}%`, left: `${block.left}%`, width: `${block.width}%`, backgroundColor: tone.background, borderColor: tone.border, color: tone.color }} ariaLabel={`${activityLabel(block.activity)}，${activityTimeRange(block.activity)}`} onClick={() => openActivity(block.activity)}>
                      <View className={`bubu-week-event-label${parts ? ' bubu-week-event-label-stacked' : ' bubu-week-event-label-inline'}`}>
                        {parts
                          ? <><View className='bubu-week-event-value'>{parts.value}</View><View className='bubu-week-event-unit'>{parts.unit}</View></>
                          : <Text>{block.label}</Text>}
                      </View>
                    </View>
                  })}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
        {gestures.feedback && <View className={`bubu-gesture-feedback bubu-gesture-feedback-${gestures.feedbackPlacement}`} role='status' ariaLabel={gestures.feedback}><Text>{gestures.feedback}</Text></View>}
      </View>
    </View>
  )
}
