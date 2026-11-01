import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Image, ScrollView, Text, View } from '@tarojs/components'
import { activityDetails, recordDetailFields, activityTone, activityTypeLabel, type Activity, type RecordEvent } from '../model'
import './visualizations.css'

export interface ActivityDetailProps {
  activity: Activity | null
  onClose: () => void
  onChat?: () => void
  photoUrl?: string | null
  photoLoading?: boolean
  photoUrls?: string[]
  photoCount?: number
  recordEvent?: RecordEvent | null
}

export function ActivityDetail({ activity, onClose, photoUrl, photoLoading, photoUrls, photoCount, recordEvent, onChat }: ActivityDetailProps) {
  const [failedImages, setFailedImages] = useState<string[]>([])
  if (!activity) return null
  const tone = activityTone(activity.type)
  const details = recordEvent ? recordDetailFields(activity, recordEvent) : activityDetails(activity)
  const image = photoUrl === undefined ? activity.poopPhotoUrl : photoUrl
  const images = photoUrls ?? (image ? [image] : [])
  const hasPhotos = !!activity.poopPhotoUrl || !!photoCount

  async function previewImage(current: string) {
    try {
      await Taro.previewImage({ current, urls: images })
    } catch {
      void Taro.showToast({ title: '图片暂时无法打开', icon: 'none' })
    }
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
          {hasPhotos && <View className='bubu-detail-photo-section'><Text className='bubu-detail-label'>记录照片{photoCount && photoCount > 1 ? ` · ${photoCount} 张` : ''}</Text>{photoLoading ? <View className='bubu-photo-error'>正在读取照片…</View> : !images.length ? <View className='bubu-photo-error'>图片暂时无法加载</View> : images.map(url => failedImages.includes(url) ? <View className='bubu-photo-error' key={url}>图片暂时无法加载</View> : <Image key={url} className='bubu-detail-photo' src={url} mode='aspectFill' onClick={() => void previewImage(url)} onError={() => setFailedImages(previous => [...previous, url])} />)}<Text className='bubu-viz-caption'>点击图片可放大查看</Text></View>}
          {onChat && <Button className='primary-button' onClick={onChat}>在对话中修改这条记录</Button>}
          <View className='bubu-detail-bottom-space' />
        </ScrollView>
      </View>
    </View>
  )
}
