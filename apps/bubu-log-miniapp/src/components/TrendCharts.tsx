import { useEffect, useId, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { buildTrendRows, dateLabel, formatDuration, todayKey, type DailyStat } from '../model'
import './visualizations.css'

export interface TrendChartsProps {
  stats: DailyStat[]
  days?: 7 | 14 | 30
  endDate?: string
  onDaysChange?: (days: 7 | 14 | 30) => void
}

type TrendRow = ReturnType<typeof buildTrendRows>[number]
type Metric = 'sleep' | 'milk' | 'pump' | 'diapers'
interface Series { key: Metric; label: string; color: string }

const CHART_HEIGHT = 150
const chartGroups: { title: string; unit: string; series: Series[] }[] = [
  { title: '睡眠', unit: '小时', series: [{ key: 'sleep', label: '睡眠时长', color: '#739caf' }] },
  { title: '奶量与吸奶', unit: '毫升', series: [{ key: 'milk', label: '瓶喂奶量', color: '#c48c8f' }, { key: 'pump', label: '吸奶量', color: '#a391b9' }] },
  { title: '换尿布', unit: '次', series: [{ key: 'diapers', label: '换尿布', color: '#b5a160' }] },
]

function formatValue(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1) }

function LineChart({ rows, title, unit, series }: { rows: TrendRow[]; title: string; unit: string; series: Series[] }) {
  const reactId = useId()
  const chartId = `bubu-chart-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`
  const [width, setWidth] = useState(0)
  const [measurementFailed, setMeasurementFailed] = useState(false)
  const [measurementVersion, setMeasurementVersion] = useState(0)
  const [selectedDate, setSelectedDate] = useState('')
  const selected = rows.findIndex((row) => row.date === selectedDate)
  const selectedRow = rows[selected >= 0 ? selected : rows.length - 1]
  const hasData = rows.some((row) => row.hasData)
  const maximum = Math.max(1, ...rows.flatMap((row) => row.hasData ? series.map((item) => row[item.key]) : []))
  const scaleMax = maximum <= 5 ? Math.ceil(maximum) : Math.ceil(maximum / 5) * 5
  const plotHeight = CHART_HEIGHT - 18
  const pointX = (index: number) => (index + 0.5) / rows.length * width
  const pointY = (value: number) => 8 + plotHeight - value / scaleMax * plotHeight

  useEffect(() => {
    let active = true
    let attempts = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const measure = () => Taro.nextTick(() => {
      if (!active) return
      Taro.createSelectorQuery().select(`#${chartId}`).boundingClientRect((rect) => {
        if (!active) return
        if (rect && !Array.isArray(rect) && rect.width > 0) {
          setWidth(rect.width)
          setMeasurementFailed(false)
          attempts = 0
        } else if (attempts < 3) {
          // A newly mounted native view may not have its layout when nextTick first runs.
          attempts += 1
          retry = setTimeout(measure, 50)
        } else {
          setMeasurementFailed(true)
        }
      }).exec()
    })
    setMeasurementFailed(false)
    measure()
    Taro.onWindowResize(measure)
    return () => { active = false; clearTimeout(retry); Taro.offWindowResize(measure) }
  }, [chartId, rows.length, hasData, measurementVersion])

  return (
    <View className='bubu-viz-card bubu-trend-card'>
      <View className='bubu-viz-heading'><Text className='bubu-viz-title'>{title}</Text><Text className='bubu-viz-count'>{unit}</Text></View>
      <View className='bubu-viz-legend'>{series.map((item) => <View className='bubu-legend-item' key={item.key}><View className='bubu-legend-dot' style={{ backgroundColor: item.color }} /><Text>{item.label}</Text></View>)}</View>
      {hasData ? <>
        <View className='bubu-chart-area'>
          <View className='bubu-chart-y-axis' style={{ height: `${CHART_HEIGHT}px`, visibility: width > 0 ? 'visible' : 'hidden' }}>{[scaleMax, scaleMax / 2, 0].map((value, index) => <Text className='bubu-chart-y-tick' key={index} style={{ top: `${8 + index * plotHeight / 2}px` }}>{formatValue(value)}</Text>)}</View>
          <View id={chartId} className='bubu-chart-plot' style={{ height: `${CHART_HEIGHT}px` }}>
            {width > 0 && [0, 1, 2].map((index) => <View className='bubu-chart-grid' key={index} style={{ top: `${8 + index * plotHeight / 2}px` }} />)}
            {selected >= 0 && <View className='bubu-chart-selection' style={{ left: `${(selected + 0.5) / rows.length * 100}%` }} />}
            {width > 0 && series.map((item) => <View className='bubu-chart-series' key={item.key}>
              {rows.map((row, index) => {
                if (!row.hasData) return null
                const previous = rows[index - 1]
                const x = pointX(index)
                const y = pointY(row[item.key])
                const fromX = pointX(index - 1)
                const fromY = previous ? pointY(previous[item.key]) : 0
                const length = Math.hypot(x - fromX, y - fromY)
                const angle = Math.atan2(y - fromY, x - fromX) * 180 / Math.PI
                return <View key={row.date}>
                  {previous?.hasData && <View className='bubu-chart-line' style={{ left: `${fromX}px`, top: `${fromY}px`, width: `${length}px`, backgroundColor: item.color, transform: `rotate(${angle}deg)` }} />}
                  <View className={`bubu-chart-point${selected === index ? ' bubu-chart-point-selected' : ''}`} style={{ left: `${x}px`, top: `${y}px`, backgroundColor: item.color }} />
                </View>
              })}
            </View>)}
            <View className='bubu-chart-hit-columns'>{rows.map((row) => <View className='bubu-chart-hit-column' key={row.date} onClick={() => setSelectedDate(row.date)} />)}</View>
            {width <= 0 && <View className='bubu-chart-preparing'><Text>{measurementFailed ? '图表暂时无法显示' : '正在绘制图表…'}</Text>{measurementFailed && <View className='bubu-text-action' onClick={() => setMeasurementVersion((value) => value + 1)}>重新绘制</View>}</View>}
          </View>
        </View>
        {width > 0 && <View className='bubu-chart-x-axis'>{rows.map((row, index) => <View className='bubu-chart-x-cell' key={row.date}><Text className='bubu-chart-x-label'>{index === 0 || index === rows.length - 1 || index === Math.floor(rows.length / 2) ? row.label : ''}</Text></View>)}</View>}
        {selectedRow && <View className='bubu-chart-reading'><Text className='bubu-chart-reading-date'>{dateLabel(selectedRow.date)}</Text>{selectedRow.hasData ? series.map((item) => <Text key={item.key} style={{ color: item.color }}>{item.label} {item.key === 'sleep' ? formatDuration(Math.round(selectedRow.sleep * 60)) : `${formatValue(selectedRow[item.key])} ${unit}`}</Text>) : <Text className='bubu-viz-caption'>暂无统计</Text>}</View>}
        <Text className='bubu-viz-footnote'>点击图表查看每日数据 · 暂无统计的日期留空</Text>
      </> : <View id={chartId} className='bubu-chart-empty'><View className='bubu-chart-empty-mark' /><Text>这段时间还没有统计</Text><Text className='bubu-viz-caption'>有统计的日子会在这里连成线</Text></View>}
    </View>
  )
}

export function TrendCharts({ stats, days, endDate = todayKey(), onDaysChange }: TrendChartsProps) {
  const [localDays, setLocalDays] = useState<7 | 14 | 30>(7)
  const visibleDays = days ?? localDays
  const rows = useMemo(() => buildTrendRows(stats, visibleDays, endDate).map((row) => ({ ...row, sleep: row.sleep / 60 })), [stats, visibleDays, endDate])

  function changeDays(value: 7 | 14 | 30) {
    setLocalDays(value)
    onDaysChange?.(value)
  }

  return <View className='bubu-trends'>
    <View className='bubu-trend-toolbar'><Text className='bubu-section-title'>慢慢长大的每一天</Text><View className='bubu-range-switch'>{([7, 14, 30] as const).map((value) => <View key={value} className={`bubu-range-option${visibleDays === value ? ' bubu-range-option-active' : ''}`} onClick={() => changeDays(value)}>{value} 天</View>)}</View></View>
    {chartGroups.map((group) => <LineChart key={group.title} rows={rows} {...group} />)}
  </View>
}
