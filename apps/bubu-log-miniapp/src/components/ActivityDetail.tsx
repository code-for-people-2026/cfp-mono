import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import { activityDetails, activityTone, activityTypeLabel, dateTimeLabel, type Activity } from '../model'
import type { ActivityProvenance, AuditInputMethod } from '../api/provenance'
import './visualizations.css'

export type DetailProvenanceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; provenance: ActivityProvenance }
  | { status: 'absent' }
  | { status: 'incomplete' }
  /** The message is kept for diagnostics only; product copy stays stable. */
  | { status: 'error'; message: string }

export interface ActivityDetailProps {
  activity: Activity | null
  /** Owned by the page; the component only presents it and requests the first read. */
  provenance?: DetailProvenanceState
  onMoreInfoToggle?: (expanded: boolean) => void
  onRetryProvenance?: () => void
  onClose: () => void
}

interface MoreInfoRow {
  label: string
  value: string
}

const inputMethodLabel = (method: AuditInputMethod | null): string =>
  method === 'TEXT' ? '文本录入' : method === 'VOICE' ? '语音录入' : '未记录'

function moreInfoRows(activity: Activity, provenance: DetailProvenanceState): {
  rows: MoreInfoRow[]
  note: string
  canRetry: boolean
} {
  const fallbackAddedAt = activity.createdAt ? dateTimeLabel(activity.createdAt) : null
  const rowsFor = (account: string, method: string, added: string, original: string): MoreInfoRow[] => {
    const rows = [
      { label: '记录账号', value: account },
      { label: '录入方式', value: method },
      { label: '添加时间', value: added },
      { label: '原话', value: original },
    ]
    if (activity.updatedAt) rows.push({ label: '更新时间', value: dateTimeLabel(activity.updatedAt) })
    return rows
  }
  switch (provenance.status) {
    case 'found': {
      const value = provenance.provenance
      const rows = rowsFor(
        value.accountId ?? '未记录',
        inputMethodLabel(value.inputMethod),
        value.addedAt ? dateTimeLabel(value.addedAt) : fallbackAddedAt ?? '未记录',
        value.inputText && value.inputText.trim() ? value.inputText : '未记录原话',
      )
      return {
        rows,
        note: !value.addedAt && fallbackAddedAt ? '添加时间沿用活动记录的创建时间。' : '',
        canRetry: false,
      }
    }
    case 'absent':
      return {
        rows: rowsFor('未记录', '未记录', fallbackAddedAt ?? '未记录', '未记录原话'),
        note: '暂未找到这条记录的来源。',
        canRetry: false,
      }
    case 'incomplete':
      return {
        rows: rowsFor('暂无法读取', '暂无法读取', fallbackAddedAt ?? '暂无法读取', '暂无法读取'),
        note: '来源信息暂未读全，请稍后重试。',
        canRetry: true,
      }
    case 'error':
      return {
        rows: rowsFor('暂无法读取', '暂无法读取', fallbackAddedAt ?? '暂无法读取', '暂无法读取'),
        note: '来源信息暂时无法读取，请稍后重试。',
        canRetry: true,
      }
    default:
      return { rows: [], note: '', canRetry: false }
  }
}

export function ActivityDetail({ activity, provenance = { status: 'idle' }, onMoreInfoToggle, onRetryProvenance, onClose }: ActivityDetailProps) {
  const [failedImage, setFailedImage] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const activityId = activity?.id ?? ''

  // Closing the sheet, or changing activity/baby/session, always starts collapsed.
  useEffect(() => { setMoreOpen(false) }, [activityId])

  if (!activity) return null
  const tone = activityTone(activity.type)
  const details = activityDetails(activity)
  const image = activity.poopPhotoUrl
  const more = moreInfoRows(activity, provenance)
  const loading = provenance.status === 'idle' || provenance.status === 'loading'

  async function previewImage() {
    if (!image) return
    try {
      await Taro.previewImage({ current: image, urls: [image] })
    } catch {
      void Taro.showToast({ title: '图片暂时无法打开', icon: 'none' })
    }
  }

  function toggleMore() {
    const next = !moreOpen
    setMoreOpen(next)
    onMoreInfoToggle?.(next)
  }

  return (
    <View className='bubu-detail-backdrop' catchMove onClick={onClose}>
      <View className='bubu-detail-sheet' onClick={(event) => event.stopPropagation()}>
        <View className='bubu-detail-handle' />
        <View className='bubu-detail-heading'>
          <View className='bubu-detail-title-wrap'><View className='bubu-detail-type' style={{ backgroundColor: tone.background, color: tone.color }}><View className='bubu-legend-dot' style={{ backgroundColor: tone.border }} /><Text>{activityTypeLabel(activity.type)}</Text></View><Text className='bubu-detail-title'>记录详情</Text></View>
          <View className='bubu-detail-close' onClick={onClose}>关闭</View>
        </View>
        <ScrollView className='bubu-detail-body' scrollY enhanced>
          <View className='bubu-detail-fields'>
            {details.map((detail, index) => <View className='bubu-detail-row' key={`${detail.label}-${index}`}><Text className='bubu-detail-label'>{detail.label}</Text><Text className='bubu-detail-value' selectable>{detail.value}</Text></View>)}
          </View>
          {image && <View className='bubu-detail-photo-section'><Text className='bubu-detail-label'>记录照片</Text>{failedImage === image ? <View className='bubu-photo-error'>图片暂时无法加载</View> : <Image className='bubu-detail-photo' src={image} mode='aspectFill' onClick={() => void previewImage()} onError={() => setFailedImage(image)} />}<Text className='bubu-viz-caption'>点击图片可放大查看</Text></View>}
          <View className='bubu-provenance'>
            <View className='bubu-provenance-toggle' ariaLabel={moreOpen ? '收起更多信息' : '展开更多信息'} onClick={toggleMore}>
              <Text className='bubu-provenance-title'>更多信息</Text>
              <Text className='bubu-provenance-action'>{moreOpen ? '收起' : '展开'}</Text>
            </View>
            {moreOpen && <View className='bubu-provenance-content'>
              {loading
                ? <Text className='bubu-provenance-status'>正在读取更多信息…</Text>
                : <>
                  {more.rows.map((row) => <View className='bubu-provenance-row' key={row.label}><Text className='bubu-provenance-label'>{row.label}</Text><Text className='bubu-provenance-value' selectable>{row.value}</Text></View>)}
                  {more.note && <Text className='bubu-provenance-note'>{more.note}</Text>}
                  {more.canRetry && <View className='bubu-provenance-retry' onClick={onRetryProvenance}>重试</View>}
                </>}
            </View>}
          </View>
          <View className='bubu-detail-bottom-space' />
        </ScrollView>
      </View>
    </View>
  )
}
