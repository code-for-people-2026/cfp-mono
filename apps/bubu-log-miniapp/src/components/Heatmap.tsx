import { useMemo, useState } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import { dateKey, dateLabel } from '../model/date'
import { coverageMessage } from '../model/records'
import { activityCategoryTone } from '../model/presentation'
import { buildCareMonthRings, type CareRingMetric } from '../model/care-rings'
import type { Activity, DailyStat } from '../model/types'
import type { CarePreferences } from '../preferences/care-preferences'
import circleHelpIcon from '../assets/icons/circle-help.png'
import { ActivityRings } from './ActivityRings'
import './visualizations.css'

export interface HeatmapProps {
  stats: DailyStat[]
  activities: Activity[]
  complete: boolean
  birthDate?: string | null
  preferences: CarePreferences
  /** Current Shanghai day from the page tick; keeps future-cell limits fresh after midnight. */
  today?: string
  endDate?: string
  profileError?: string
  preferencesError?: string
  onDateClick?: (date: string) => void
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

interface CareMetricStyle {
  key: CareRingMetric['key']
  label: string
  color: string
  meaning: string
}

const metricStyles: Record<CareRingMetric['key'], CareMetricStyle> = {
  sleep: { key: 'sleep', label: '睡', color: activityCategoryTone('sleep').color, meaning: '睡眠时长' },
  outdoor: { key: 'outdoor', label: '玩', color: activityCategoryTone('outdoor').color, meaning: '户外时长' },
  milk: { key: 'milk', label: '吃', color: activityCategoryTone('milk').color, meaning: '瓶喂奶量+亲喂估计/记录量' },
  diaper: { key: 'diaper', label: '便', color: activityCategoryTone('diaper').color, meaning: '尿布数量' },
}
const metricDisplayOrder: readonly CareMetricStyle[] = [
  metricStyles.sleep,
  metricStyles.outdoor,
  metricStyles.milk,
  metricStyles.diaper,
]

interface OrderedCareMetric {
  metric: CareRingMetric
  style: CareMetricStyle
}

function orderedCareMetrics(metrics: readonly CareRingMetric[]): OrderedCareMetric[] {
  const metricsByKey = new Map(metrics.map((metric) => [metric.key, metric]))
  return metricDisplayOrder.flatMap((style) => {
    const metric = metricsByKey.get(style.key)
    return metric ? [{ metric, style }] : []
  })
}

const dataStateLabels: Record<CareRingMetric['dataState'], string> = {
  known: '已记录',
  partial: '信息不完整',
  unknown: '缺少有效数据',
}

function plainReason(reason: string): string {
  return reason
    .replace(/Activity 月度列表不完整，亲喂可能缺失。/g, '本月部分记录尚未读取完整，亲喂可能缺失。')
    .replace(/Activity 月度列表不完整/g, '本月部分记录尚未读取完整')
    .replace(/研究启发区间/g, '默认参考区间')
}

function metricSource(metric: CareRingMetric, complete: boolean): string | null {
  if (metric.key === 'milk') {
    const breastfeed = metric.breastfeed
    if (metric.dataState === 'known' && breastfeed.state === 'known-zero') return '亲喂 0 次'
    if (breastfeed.reason) return plainReason(breastfeed.reason)
    if (!complete) return '本月部分记录尚未读取完整，亲喂可能缺失。'
    return metric.dataState === 'known' ? null : dataStateLabels[metric.dataState]
  }
  if (metric.dataState === 'known') return null
  if (!complete) return '本月部分记录尚未读取完整。'
  return metric.value.type === 'unknown' ? plainReason(metric.value.reason) : dataStateLabels[metric.dataState]
}

function referenceLabel(metric: CareRingMetric): string {
  if (metric.key === 'outdoor' && metric.reference) return '家庭目标：1小时合格、2小时良好、3小时优秀'
  return metric.reference?.label ?? '无可用参考'
}

export function Heatmap({
  stats, activities, complete, birthDate, preferences, today: todayProp,
  endDate, profileError, preferencesError, onDateClick,
}: HeatmapProps) {
  const [selectedDate, setSelectedDate] = useState('')
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const today = todayProp ?? endDate ?? ''
  const monthDate = endDate ?? today
  const statsByDate = useMemo(() => new Map(stats.map((stat) => [dateKey(stat.date), stat])), [stats])
  const calendar = useMemo(() => buildCareMonthRings({
    activities, activitiesComplete: complete, stats, monthDate, today, birthDate, preferences,
  }), [activities, complete, stats, monthDate, today, birthDate, preferences])
  const allDays = calendar.weeks.flatMap((week) => week.days)
  const selectedDay = allDays.find((day) => day.date === (selectedDate || monthDate) && day.inMonth && !day.isFuture)
    || [...allDays].reverse().find((day) => day.inMonth && !day.isFuture)
  const selectedCoverage = selectedDay ? coverageMessage(statsByDate.get(selectedDay.date)?.coverage) : ''
  const profileMessage = profileError || (!birthDate ? '出生日期未知，年龄参考不可用。' : '')

  return (
    <View className='bubu-viz-card bubu-heatmap-card'>
      {!complete && <View className='bubu-heatmap-notice'>本月部分记录尚未读取完整。</View>}
      {profileMessage && <View className='bubu-heatmap-notice'>{profileMessage}</View>}
      {preferencesError && <View className='bubu-heatmap-notice'>{preferencesError}</View>}
      <View className='bubu-heatmap-head'>
        {weekdays.map((day) => <Text className='bubu-heatmap-weekday' key={day}>{day}</Text>)}
      </View>
      {calendar.weeks.map((week) => <View className='bubu-heatmap-week' key={week.start}>
        {week.days.map((day) => {
          const interactive = day.inMonth && !day.isFuture
          const displayMetrics = orderedCareMetrics(day.metrics)
          return (
            <View
              key={day.date}
              className={`bubu-heatmap-cell${day.isPadding ? ' bubu-heatmap-padding' : ''}${day.isFuture ? ' bubu-heatmap-future' : ''}${day.isToday ? ' bubu-heatmap-today' : ''}${selectedDay?.date === day.date ? ' bubu-heatmap-selected' : ''}`}
              onClick={() => { if (interactive) setSelectedDate(day.date) }}
            >
              {day.inMonth && <Text className='bubu-heatmap-day-number'>{Number(day.date.slice(-2))}</Text>}
              {interactive && (
                <ActivityRings
                  rings={displayMetrics.map(({ metric, style }) => ({
                    key: metric.key, color: style.color, progress: metric.progress,
                  }))}
                  ariaLabel={`${day.date} ${displayMetrics.map(({ metric, style }) => `${style.label}（${style.meaning}）${metric.readableValue}`).join('，')}`}
                />
              )}
            </View>
          )
        })}
      </View>)}
      <View className='bubu-heatmap-guide'>
        <Text className='bubu-heatmap-guide-text'>由外到内：</Text>
        {metricDisplayOrder.map((style) => (
          <View className='bubu-legend-item bubu-legend-compact' key={style.key}>
            <View className='bubu-legend-dot' style={{ borderColor: style.color }} />
            <Text className='bubu-legend-label'>{style.label}</Text>
          </View>
        ))}
        <Button
          className='bubu-heatmap-legend-toggle'
          ariaLabel={legendOpen ? '收起四环图例' : '展开四环图例'}
          onClick={() => setLegendOpen((open) => !open)}
        >
          <Image
            className='bubu-heatmap-legend-icon'
            src={circleHelpIcon}
            mode='scaleToFill'
          />
        </Button>
      </View>
      {legendOpen && (
        <View className='bubu-heatmap-key'>
          {metricDisplayOrder.map((style) => (
            <View className='bubu-legend-item bubu-legend-expanded' key={style.key}>
              <View className='bubu-legend-dot' style={{ borderColor: style.color }} />
              <Text className='bubu-legend-label'>{style.label}</Text>
              <Text className='bubu-legend-meaning'>{style.meaning}</Text>
            </View>
          ))}
        </View>
      )}
      {selectedCoverage && <Text className='bubu-viz-footnote'>{selectedCoverage}</Text>}
      {selectedDay && (
        <View className='bubu-heatmap-reading'>
          <View className='bubu-heatmap-reading-head'>
            <View>
              <Text className='bubu-chart-reading-date'>{dateLabel(selectedDay.date)}</Text>
              <Text className='bubu-heatmap-reading-state'>{dataStateLabels[selectedDay.dataState]} · 虚线为缺失</Text>
            </View>
            {onDateClick && (
              <View className='bubu-text-action' onClick={() => onDateClick(selectedDay.date)}>查看当天 ›</View>
            )}
          </View>
          <View className='bubu-heatmap-metrics'>
            {orderedCareMetrics(selectedDay.metrics).map(({ metric, style }) => {
              const detail = metricSource(metric, complete)
              return (
                <View className='bubu-heatmap-metric' key={metric.key}>
                  <View className='bubu-heatmap-metric-head'>
                    <Text className='bubu-heatmap-metric-label' style={{ color: style.color }}>{style.label}</Text>
                    <Text className='bubu-heatmap-value'>{metric.readableValue}</Text>
                  </View>
                  {metric.key === 'milk' && <Text className='bubu-heatmap-detail'>{metric.readableComponents.join('；')}</Text>}
                  {detail && <Text className='bubu-heatmap-detail'>{detail}</Text>}
                  <Text className='bubu-heatmap-reference'>
                    {referenceLabel(metric)} · {metric.status.label}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>
      )}
      <View className='bubu-heatmap-reference-toggle'>
        <Text onClick={() => setReferenceOpen((open) => !open)}>{referenceOpen ? '收起参考说明' : '参考说明'}</Text>
      </View>
      {referenceOpen && (
        <View className='bubu-heatmap-reference-notes'>
          <Text className='bubu-heatmap-reference-note'>· 亲喂初始 5–10 ml/分钟只是可调整的估算，不是经验证的正常范围。</Text>
          <Text className='bubu-heatmap-reference-note'>· 年龄参考只帮助读环；满环或更多不代表更好。</Text>
          <Text className='bubu-heatmap-reference-note'>· 便环统计全部换尿布次数，不等于第5天起的6片明显湿尿片观察；湿尿片也不能直接推算奶量。</Text>
          <Text className='bubu-heatmap-reference-note'>· 玩环 1小时合格、2小时良好、3小时优秀是家庭目标，不是医学评价标准。</Text>
        </View>
      )}
      <Text className='bubu-viz-footnote'>满环仅作参考，实际数值仍完整显示。</Text>
    </View>
  )
}
