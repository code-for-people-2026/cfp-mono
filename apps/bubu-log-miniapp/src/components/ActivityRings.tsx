import { View } from '@tarojs/components'
import './activity-rings.css'

export interface ActivityRing {
  key: string
  color: string
  progress: number | null
}

export interface ActivityRingsProps {
  /** Supplied outer-to-inner; the compact glyph always reserves four slots. */
  rings: readonly ActivityRing[]
  ariaLabel?: string
}

const RING_SLOT_COUNT = 4
const MISSING_RING_COLOR = '#b7a793'

function ringRotation(progress: number, trailing: boolean): string {
  if (trailing) return `rotate(${(progress - 0.5) * 360}deg)`
  return `rotate(${progress <= 0.5 ? progress * 360 - 180 : 0}deg)`
}

export function ActivityRings({ rings, ariaLabel = '活动进度环' }: ActivityRingsProps) {
  const slots = Array.from({ length: RING_SLOT_COUNT }, (_, index) => {
    const ring = rings[index]
    const color = typeof ring?.color === 'string' && ring.color.trim() ? ring.color : MISSING_RING_COLOR
    const rawProgress = ring?.progress
    const progress = rawProgress === null || rawProgress === undefined || !Number.isFinite(rawProgress)
      ? null
      : Math.min(1, Math.max(0, rawProgress))

    return {
      key: typeof ring?.key === 'string' && ring.key ? ring.key : `activity-ring-${index}`,
      color,
      progress,
    }
  })

  return (
    <View className='activity-rings' role='img' ariaLabel={ariaLabel}>
      {slots.map((ring, index) => (
        <View key={`${ring.key}-${index}`} className={`activity-rings__ring activity-rings__ring-${index}`}>
          <View
            className='activity-rings__track'
            style={{ borderColor: ring.color, opacity: ring.progress === null ? 0.12 : 0.18 }}
          />
          {ring.progress === null && <View className='activity-rings__missing' />}
          {ring.progress !== null && ring.progress > 0 && (
            <View className='activity-rings__half activity-rings__half-right'>
              <View
                className='activity-rings__arc'
                style={{ borderColor: ring.color, transform: ringRotation(ring.progress, false) }}
              />
            </View>
          )}
          {ring.progress !== null && ring.progress > 0.5 && (
            <View className='activity-rings__half activity-rings__half-left'>
              <View
                className='activity-rings__arc activity-rings__arc-left'
                style={{ borderColor: ring.color, transform: ringRotation(ring.progress, true) }}
              />
            </View>
          )}
        </View>
      ))}
    </View>
  )
}
