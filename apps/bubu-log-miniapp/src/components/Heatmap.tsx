import { useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { buildHeatmap, dateLabel, formatDuration, todayKey, type DailyStat } from '../model'
import './visualizations.css'

export interface HeatmapProps {
  stats: DailyStat[]
  endDate?: string
  /** Current Shanghai day from the page tick; keeps future-cell limits fresh after midnight. */
  today?: string
  onDateClick?: (date: string, metric: 'sleep' | 'milk') => void
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const palettes = {
  sleep: ['#f3f0e9', '#e2ebef', '#bfd4dd', '#96b6c5', '#7298ab'],
  milk: ['#f3f0e9', '#f3e2df', '#e5c3be', '#d4a4a0', '#b9807d'],
}

export function Heatmap({ stats, endDate = todayKey(), today: todayProp, onDateClick }: HeatmapProps) {
  const [metric, setMetric] = useState<'sleep' | 'milk'>('sleep')
  const [selectedDate, setSelectedDate] = useState('')
  const today = todayProp ?? todayKey()
  const heatmap = useMemo(() => buildHeatmap(stats, endDate, today), [stats, endDate, today])
  const allDays = heatmap.weeks.flatMap((week) => week.days)
  const selectedDay = allDays.find((day) => day.date === (selectedDate || endDate) && day.inMonth && !day.isFuture)
    || [...allDays].reverse().find((day) => day.inMonth && !day.isFuture)
  const palette = palettes[metric]

  return (
    <View className='bubu-viz-card bubu-heatmap-card'>
      <View className='bubu-viz-heading'>
        <View><Text className='bubu-viz-title'>{heatmap.month}月</Text><Text className='bubu-viz-caption'>自然月 · 睡眠与瓶喂奶量</Text></View>
        <View className='bubu-range-switch'><View className={`bubu-range-option${metric === 'sleep' ? ' bubu-range-option-active' : ''}`} onClick={() => setMetric('sleep')}>睡眠</View><View className={`bubu-range-option${metric === 'milk' ? ' bubu-range-option-active' : ''}`} onClick={() => setMetric('milk')}>奶量</View></View>
      </View>
      <View className='bubu-heatmap-head'><View className='bubu-heatmap-week-label' />{weekdays.map((day) => <Text className='bubu-heatmap-weekday' key={day}>{day}</Text>)}</View>
      {heatmap.weeks.map((week) => <View className='bubu-heatmap-week' key={week.start}>
        <Text className='bubu-heatmap-week-label'>{Number(week.start.slice(5, 7))}/{Number(week.start.slice(-2))}</Text>
        {week.days.map((day) => {
          const intensity = metric === 'sleep' ? day.sleepIntensity : day.milkIntensity
          const interactive = day.inMonth && !day.isFuture
          return <View key={day.date} className={`bubu-heatmap-cell${day.isPadding ? ' bubu-heatmap-padding' : ''}${day.isToday ? ' bubu-heatmap-today' : ''}${day.isFuture ? ' bubu-heatmap-future' : ''}${day.inMonth && !day.hasData && !day.isFuture ? ' bubu-heatmap-missing' : ''}${selectedDay?.date === day.date ? ' bubu-heatmap-selected' : ''}`} style={{ backgroundColor: !interactive ? 'transparent' : palette[day.hasData ? intensity : 0], color: day.hasData && intensity >= 3 ? '#fffaf3' : '#766c60' }} onClick={() => { if (interactive) setSelectedDate(day.date) }}>{day.inMonth && <Text className='bubu-heatmap-day-number'>{Number(day.date.slice(-2))}</Text>}</View>
        })}
      </View>)}
      <View className='bubu-heatmap-key'><Text>少</Text>{palette.map((color) => <View className='bubu-heatmap-key-cell' key={color} style={{ backgroundColor: color }} />)}<Text>多</Text><Text className='bubu-heatmap-key-spacer'>虚线：暂无统计</Text></View>
      {selectedDay && <View className='bubu-heatmap-reading'><View><Text className='bubu-chart-reading-date'>{dateLabel(selectedDay.date)}</Text><Text className='bubu-heatmap-value'>{selectedDay.hasData ? metric === 'sleep' ? `睡眠 ${formatDuration(selectedDay.sleep)}` : `瓶喂 ${selectedDay.milk} 毫升` : '暂无统计'}</Text></View>{onDateClick && <View className='bubu-text-action' onClick={() => onDateClick(selectedDay.date, metric)}>查看当天 ›</View>}</View>}
      <Text className='bubu-viz-footnote'>颜色深浅按本月已保存的统计比较</Text>
    </View>
  )
}
