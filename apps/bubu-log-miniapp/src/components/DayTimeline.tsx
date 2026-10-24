import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import {
  activityTone,
  formatDuration,
  layoutDayTimeline,
  timeSinceLatest,
  timeLabel,
  todayKey,
  type Activity,
} from '../model'
import { designSize } from './display'
import './visualizations.css'

export interface DayTimelineProps {
  activities: Activity[]
  date: string
  onActivityClick?: (activity: Activity) => void
  showCurrentTime?: boolean
  latestActivities?: Activity[]
}

const HOUR_HEIGHT = 116
const hours = Array.from({ length: 25 }, (_, index) => index)

function clockMinutes(): number {
  const [hour, minute] = timeLabel(new Date().toISOString()).split(':').map(Number)
  return hour * 60 + minute
}

export function DayTimeline({ activities, date, onActivityClick, showCurrentTime = true, latestActivities }: DayTimelineProps) {
  const blocks = useMemo(() => layoutDayTimeline(activities, date), [activities, date])
  const [minutes, setMinutes] = useState(clockMinutes)
  const [scrollTarget, setScrollTarget] = useState('')
  const isToday = date === todayKey()
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

  return (
    <View className='bubu-viz-card bubu-day-card'>
      <View className='bubu-viz-heading'>
        <View>
          <Text className='bubu-viz-title'>一天的节奏</Text>
          <Text className='bubu-viz-caption'>点击记录，查看详情</Text>
        </View>
        {isToday && showCurrentTime && <View className='bubu-text-action' onClick={goToNow}>此刻</View>}
      </View>
      <View className='bubu-viz-legend'>
        {[['睡眠', '#83a8b9'], ['吃奶', '#d29c9a'], ['尿布', '#c0aa6d'], ['其他', '#aba18f']].map(([label, color]) => (
          <View className='bubu-legend-item' key={label}><View className='bubu-legend-dot' style={{ backgroundColor: color }} /><Text>{label}</Text></View>
        ))}
      </View>
      {isToday && showCurrentTime && (sinceLatest.sleep != null || sinceLatest.feed != null) && <View className='bubu-latest-gaps'>
        {sinceLatest.sleep != null && <View className='bubu-latest-gap'><View className='bubu-legend-dot' style={{ backgroundColor: '#83a8b9' }} /><Text>距上次睡眠 {formatDuration(sinceLatest.sleep)}</Text></View>}
        {sinceLatest.feed != null && <View className='bubu-latest-gap'><View className='bubu-legend-dot' style={{ backgroundColor: '#d29c9a' }} /><Text>距上次吃奶 {formatDuration(sinceLatest.feed)}</Text></View>}
      </View>}
      {blocks.length === 0 && <View className='bubu-empty-inline'>这一天还没有记录</View>}
      <ScrollView className='bubu-day-scroll' scrollY enhanced scrollIntoView={scrollTarget} scrollWithAnimation>
        <View className='bubu-day-canvas' style={{ height: designSize(24 * HOUR_HEIGHT) }}>
          {hours.map((hour) => (
            <View id={`timeline-hour-${hour}`} className='bubu-hour-row' style={{ top: designSize(hour * HOUR_HEIGHT) }} key={hour}>
              <Text className='bubu-hour-label'>{String(hour).padStart(2, '0')}:00</Text>
              <View className='bubu-hour-rule' />
              {hour < 24 && <View className='bubu-half-hour-rule' style={{ top: designSize(HOUR_HEIGHT / 2) }} />}
            </View>
          ))}
          <View className='bubu-day-events'>
            {blocks.map((block) => {
              const tone = activityTone(block.activity.type)
              const top = block.top / 60 * HOUR_HEIGHT
              const height = Math.max(block.height / 60 * HOUR_HEIGHT, block.isLine ? 2 : 30)
              return (
                <View
                  key={block.activity.id}
                  className={block.isLine ? 'bubu-timeline-instant' : 'bubu-timeline-position'}
                  style={{ top: designSize(top), height: designSize(height), left: `${block.left}%`, width: `${block.width}%`, color: tone.color }}
                  onClick={() => onActivityClick?.(block.activity)}
                >
                  {block.isLine ? <>
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
            })}
          </View>
          {isToday && showCurrentTime && <View className='bubu-now-line' style={{ top: designSize(minutes / 60 * HOUR_HEIGHT) }}><View className='bubu-now-dot' /><Text className='bubu-now-label'>{timeLabel(new Date().toISOString())}</Text></View>}
        </View>
      </ScrollView>
      <Text className='bubu-viz-footnote'>时间范围 00:00–24:00 · 跨日记录按当天显示</Text>
    </View>
  )
}
