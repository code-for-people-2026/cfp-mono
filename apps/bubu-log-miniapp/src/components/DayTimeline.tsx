import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import {
  activityCategoryTone,
  activityTone,
  formatDuration,
  layoutDayTimeline,
  timeSinceLatest,
  timeLabel,
  todayKey,
  type Activity,
  type TimelineItem,
} from '../model'
import { useTimelineGestures } from '../gestures/useTimelineGestures'
import { designPixelsFloor, designSize } from './display'
import './visualizations.css'

export interface DayTimelineProps {
  activities: Activity[]
  date: string
  onActivityClick?: (activity: Activity) => void
  showCurrentTime?: boolean
  latestActivities?: Activity[]
  /** Shared day/week time-axis scale; parent state keeps it across view switches. */
  scale?: number
  onScaleChange?: (scale: number) => void
  /** Overlay/menu/detail open: axis gestures are cancelled and ignored. */
  gesturesDisabled?: boolean
  /** Date/baby changes terminate a pending gesture. */
  gestureResetKey?: string
  /** Current Shanghai day, refreshed at midnight and on app return. */
  today?: string
  /** A completed horizontal/boundary gesture; the page owns date state. */
  onNavigate?: (direction: "prev" | "next") => void
}

const HOUR_HEIGHT = 116
/** Physical CSS pixels for one readable foreground line. */
const MIN_FOREGROUND_HEIGHT = 30
const hours = Array.from({ length: 25 }, (_, index) => index)

function clockMinutes(): number {
  const [hour, minute] = timeLabel(new Date().toISOString()).split(':').map(Number)
  return hour * 60 + minute
}

export function DayTimeline({
  activities, date, onActivityClick, showCurrentTime = true, latestActivities,
  scale = 1, onScaleChange, gesturesDisabled, gestureResetKey, today: todayProp, onNavigate,
}: DayTimelineProps) {
  const today = todayProp ?? todayKey()
  const isToday = date === today
  const gestures = useTimelineGestures({
    scale,
    onScaleChange,
    onNavigate,
    canNext: date < today,
    previousLabel: '前一天',
    nextLabel: '后一天',
    currentLabel: '今天',
    disabled: gesturesDisabled,
    resetKey: gestureResetKey ?? date,
  })
  const canvasHeight = gestures.canvasHeight || designPixelsFloor(24 * HOUR_HEIGHT) * scale
  const minBlockHeightMinutes = Math.max(15, Math.ceil(MIN_FOREGROUND_HEIGHT * 1440 / Math.max(1, canvasHeight)))
  const blocks = useMemo(
    () => layoutDayTimeline(activities, date, { minBlockHeightMinutes }),
    [activities, date, minBlockHeightMinutes],
  )
  const [minutes, setMinutes] = useState(clockMinutes)
  const [scrollTarget, setScrollTarget] = useState('')
  const sinceLatest = useMemo(() => timeSinceLatest(latestActivities ?? activities, new Date()), [latestActivities, activities, minutes])

  useEffect(() => {
    if (!showCurrentTime || !isToday) return
    const timer = setInterval(() => setMinutes(clockMinutes()), 60_000)
    return () => clearInterval(timer)
  }, [showCurrentTime, isToday])

  function goToNow() {
    setMinutes(clockMinutes())
    setScrollTarget('')
    setTimeout(() => setScrollTarget(`timeline-hour-${Math.max(0, Math.floor(clockMinutes() / 60) - 2)}`), 0)
  }

  const openActivity = (activity: Activity) => {
    if (gestures.consumeClickSuppression()) return
    onActivityClick?.(activity)
  }

  const renderBlock = (block: TimelineItem) => {
    const tone = activityTone(block.activity.type)
    const top = block.top / 60 * HOUR_HEIGHT * scale
    const height = block.isLine ? Math.max(block.height / 60 * HOUR_HEIGHT * scale, 2) : block.height / 60 * HOUR_HEIGHT * scale
    return (
      <View
        key={block.activity.id}
        className={block.isBackground ? 'bubu-timeline-background' : block.isLine ? 'bubu-timeline-instant' : 'bubu-timeline-position'}
        style={{ top: designSize(top), height: designSize(height), left: `${block.left}%`, width: `${block.width}%`, color: tone.color }}
        ariaLabel={`${block.label}，${timeLabel(block.activity.startTime)}`}
        onClick={() => openActivity(block.activity)}
      >
        {block.isBackground ? <>
          {block.gapMinutes != null && <Text className='bubu-event-gap'>距上次 {formatDuration(block.gapMinutes)}</Text>}
          <View className='bubu-timeline-band' style={{ backgroundColor: tone.background }}>
            <Text className='bubu-event-label'>{block.label}</Text>
          </View>
        </> : block.isLine ? <>
          <View className='bubu-instant-rule' style={{ backgroundColor: tone.border }} />
          <View className='bubu-instant-label' style={{ backgroundColor: tone.background, borderColor: tone.border }}>
            <Text>{block.label}</Text><Text className='bubu-instant-time'>{timeLabel(block.activity.startTime)}</Text>
          </View>
        </> : <>
          {block.gapMinutes != null && <Text className='bubu-event-gap'>距上次 {formatDuration(block.gapMinutes)}</Text>}
          <View className='bubu-timeline-event' style={{ backgroundColor: tone.background, borderColor: tone.border }}>
            <Text className='bubu-event-label'>{block.label}</Text>
            {height > 76 && <Text className='bubu-event-time'>{timeLabel(block.activity.startTime)}{block.activity.endTime ? ` — ${timeLabel(block.activity.endTime)}` : ''}</Text>}
          </View>
        </>}
      </View>
    )
  }

  return (
    <View className='bubu-viz-card bubu-day-card'>
      {isToday && showCurrentTime && <View className='bubu-day-actions'><View className='bubu-text-action' onClick={goToNow}>此刻</View></View>}
      {isToday && showCurrentTime && (sinceLatest.sleep != null || sinceLatest.feed != null) && <View className='bubu-latest-gaps'>
        {sinceLatest.sleep != null && <View className='bubu-latest-gap'><View className='bubu-legend-dot' style={{ backgroundColor: activityCategoryTone('sleep').color }} /><Text>距上次睡眠 {formatDuration(sinceLatest.sleep)}</Text></View>}
        {sinceLatest.feed != null && <View className='bubu-latest-gap'><View className='bubu-legend-dot' style={{ backgroundColor: activityCategoryTone('milk').color }} /><Text>距上次吃奶 {formatDuration(sinceLatest.feed)}</Text></View>}
      </View>}
      {blocks.length === 0 && <View className='bubu-empty-inline'>这一天还没有记录</View>}
      <View className='bubu-timeline-viewport'>
        <ScrollView
          id={gestures.scrollId}
          className='bubu-day-scroll'
          scrollY
          enhanced
          bounces={false}
          scrollIntoView={scrollTarget}
          scrollWithAnimation={!gestures.isPinching}
          {...(process.env.TARO_ENV === 'h5' ? {} : { scrollTop: gestures.scrollTop })}
          onScroll={gestures.onScroll}
        >
          <View
            id={gestures.canvasId}
            className='bubu-day-canvas'
            style={{ height: designSize(24 * HOUR_HEIGHT * scale) }}
            catchMove={process.env.TARO_ENV !== 'h5' && gestures.isPinching ? true : undefined}
            {...gestures.nativeTouchProps}
          >
            {hours.map((hour) => (
              <View id={`timeline-hour-${hour}`} className='bubu-hour-row' style={{ top: designSize(hour * HOUR_HEIGHT * scale) }} key={hour}>
                <Text className='bubu-hour-label'>{String(hour).padStart(2, '0')}:00</Text>
                <View className='bubu-hour-rule' />
                {hour < 24 && <View className='bubu-half-hour-rule' style={{ top: designSize(HOUR_HEIGHT / 2 * scale) }} />}
              </View>
            ))}
            <View className='bubu-day-backgrounds'>
              {blocks.filter((block) => block.isBackground).map(renderBlock)}
            </View>
            <View className='bubu-day-events'>
              {blocks.filter((block) => !block.isBackground).map(renderBlock)}
            </View>
            {isToday && showCurrentTime && <View className='bubu-now-line' style={{ top: designSize(minutes / 60 * HOUR_HEIGHT * scale) }}><View className='bubu-now-dot' /><Text className='bubu-now-label'>{timeLabel(new Date().toISOString())}</Text></View>}
          </View>
        </ScrollView>
        {gestures.feedback && <View className={`bubu-gesture-feedback bubu-gesture-feedback-${gestures.feedbackPlacement}`} role='status' ariaLabel={gestures.feedback}><Text>{gestures.feedback}</Text></View>}
      </View>
    </View>
  )
}
