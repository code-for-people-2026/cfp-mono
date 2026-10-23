import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import { activityDetails, activityTone, activityTypeLabel, type Activity } from '../model'
import './visualizations.css'

export interface ActivityDetailProps {
  activity: Activity | null
  onClose: () => void
  photoUrl?: string | null
  photoLoading?: boolean
}

export function ActivityDetail({ activity, onClose, photoUrl, photoLoading }: ActivityDetailProps) {
  const [failedImage, setFailedImage] = useState('')
  if (!activity) return null
  const tone = activityTone(activity.type)
  const details = activityDetails(activity)
  const image = photoUrl === undefined ? activity.poopPhotoUrl : photoUrl

  async function previewImage() {
    if (!image) return
    try {
      await Taro.previewImage({ current: image, urls: [image] })
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
          {activity.poopPhotoUrl && <View className='bubu-detail-photo-section'><Text className='bubu-detail-label'>记录照片</Text>{photoLoading ? <View className='bubu-photo-error'>正在读取照片…</View> : !image || failedImage === image ? <View className='bubu-photo-error'>图片暂时无法加载</View> : <Image className='bubu-detail-photo' src={image} mode='aspectFill' onClick={() => void previewImage()} onError={() => setFailedImage(image)} />}<Text className='bubu-viz-caption'>点击图片可放大查看</Text></View>}
          <View className='bubu-detail-bottom-space' />
        </ScrollView>
      </View>
    </View>
  )
}
