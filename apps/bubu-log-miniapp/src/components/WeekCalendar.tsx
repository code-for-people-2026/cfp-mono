import { useMemo, useState } from 'react'
import { ScrollView, Text, View } from '@tarojs/components'
import { activityTone, buildWeek, timeLabel, WEEKLY_FILTERS, type Activity, type WeeklyFilter } from '../model'
import { designSize } from './display'
import './visualizations.css'

export interface WeekCalendarProps {
  activities: Activity[]
  weekStart: string
  onActivityClick?: (activity: Activity) => void
  onDateClick?: (date: string) => void
}

const HOUR_HEIGHT = 78
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const hours = Array.from({ length: 13 }, (_, index) => index * 2)

export function WeekCalendar({ activities, weekStart, onActivityClick, onDateClick }: WeekCalendarProps) {
  const [filters, setFilters] = useState<WeeklyFilter[]>(WEEKLY_FILTERS.map((filter) => filter.key))
  const week = useMemo(() => buildWeek(activities, weekStart, filters), [activities, weekStart, filters])
  const recordCount = new Set(week.flatMap((day) => day.blocks.map((block) => block.activity.id))).size

  return (
    <View className='bubu-viz-card bubu-week-card'>
      <View className='bubu-viz-heading'>
        <View><Text className='bubu-viz-title'>一周的日常</Text><Text className='bubu-viz-caption'>纵向看作息，横向看变化</Text></View>
        <Text className='bubu-viz-count'>{recordCount} 条记录</Text>
      </View>
      <View className='bubu-week-filters'>{WEEKLY_FILTERS.map((filter) => <View key={filter.key} className={`bubu-week-filter${filters.includes(filter.key) ? ' bubu-week-filter-active' : ''}`} onClick={() => setFilters((current) => current.includes(filter.key) ? current.filter((key) => key !== filter.key) : [...current, filter.key])}><View className='bubu-legend-dot' style={{ backgroundColor: filter.color }} /><Text>{filter.label}</Text></View>)}</View>
      <View className='bubu-week-head'>
        <View className='bubu-week-gutter' />
        {week.map((day, index) => (
          <View className={`bubu-week-day${day.isToday ? ' bubu-week-day-today' : ''}${day.isFuture ? ' bubu-week-day-future' : ''}`} key={day.date} onClick={() => onDateClick?.(day.date)}>
            <Text className='bubu-week-weekday'>{weekdays[index]}</Text><Text className='bubu-week-date'>{Number(day.date.slice(-2))}</Text>
          </View>
        ))}
      </View>
      {recordCount === 0 && <View className='bubu-empty-inline'>{filters.length ? '这一周没有所选类型的记录' : '选择活动类型，查看一周记录'}</View>}
      <ScrollView className='bubu-week-scroll' scrollY enhanced>
        <View className='bubu-week-canvas' style={{ height: designSize(24 * HOUR_HEIGHT) }}>
          {hours.map((hour) => <View className='bubu-week-hour' style={{ top: designSize(hour * HOUR_HEIGHT) }} key={hour}><Text className='bubu-week-hour-label'>{String(hour).padStart(2, '0')}</Text><View className='bubu-week-hour-rule' /></View>)}
          <View className='bubu-week-columns'>
            {week.map((day) => (
              <View className={`bubu-week-column${day.isToday ? ' bubu-week-column-today' : ''}`} key={day.date}>
                {day.blocks.map((block) => {
                  const tone = activityTone(block.activity.type)
                  return <View key={block.activity.id} className='bubu-week-event' style={{ top: `${block.top}%`, height: `${block.height}%`, backgroundColor: tone.background, borderColor: tone.border, color: tone.color }} onClick={() => onActivityClick?.(block.activity)}><Text className='bubu-week-event-label'>{timeLabel(block.activity.startTime)}</Text></View>
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <Text className='bubu-viz-footnote'>点击色块查看记录 · 点击日期查看当天</Text>
    </View>
  )
}
