import type { ReactNode } from 'react'
import { View } from '@tarojs/components'
import type { PaperTurnState } from '../gestures/model'
import {
  completedPaperTurnDisplacement,
  paperTurnTransition,
  resolvePaperTurnTransform,
  type PaperTurnDirection,
  type PaperTurnSide,
} from '../gestures/paper-turn'

interface PaperTurnViewportProps {
  paperTurn: PaperTurnState
  viewportWidth: number
  viewportHeight: number
  gestureScrollTop: number
  current: ReactNode
  previous?: ReactNode
  next?: ReactNode
  children?: ReactNode
}

const inertPreviewAttributes = { "aria-hidden": true, inert: true } as const

export function PaperTurnViewport({
  paperTurn,
  viewportWidth,
  viewportHeight,
  gestureScrollTop,
  current,
  previous,
  next,
  children,
}: PaperTurnViewportProps) {
  const horizontal = paperTurn.axis === 'horizontal'
  const size = Math.max(1, horizontal ? viewportWidth : viewportHeight)
  const activeDirection = paperTurn.phase !== 'idle' ? paperTurn.direction : null
  const transition = paperTurnTransition(paperTurn.phase, paperTurn.reducedMotion)
  const displacement = paperTurn.phase === 'complete'
    ? completedPaperTurnDisplacement(paperTurn.axis, paperTurn.direction ?? 'prev', size)
    : paperTurn.phase === 'drag' ? paperTurn.displacement : 0
  const transformFor = (side: PaperTurnSide, direction: PaperTurnDirection) => {
    const transform = resolvePaperTurnTransform({
      ...paperTurn,
      direction,
      displacement,
      size,
      side,
    })
    return `translate(${transform.x}px, ${transform.y}px)`
  }
  const layerStyle = (transform: string) => ({
    transform,
    transitionProperty: transition.property,
    transitionDuration: `${transition.durationMs}ms`,
  })
  const preview = (direction: PaperTurnDirection, content: ReactNode, activeLayer: boolean) => (
    <View
      className={`bubu-paper-neighbor bubu-paper-neighbor-${direction}${activeLayer ? ' bubu-paper-neighbor-active' : ''}`}
      style={layerStyle(transformFor('neighbor', direction))}
      {...inertPreviewAttributes}
    >
      <View
        className='bubu-paper-preview-scroll'
        style={{ transform: `translateY(${-gestureScrollTop}px)` }}
      >
        {content}
      </View>
    </View>
  )

  return (
    <View className='bubu-timeline-viewport'>
      {previous != null ? preview('prev', previous, activeDirection === 'prev') : null}
      <View
        className='bubu-paper-current'
        style={layerStyle(
          activeDirection != null && (activeDirection === 'prev' ? previous == null : next == null)
            ? 'translate(0px, 0px)'
            : transformFor('current', activeDirection ?? 'prev'),
        )}
      >
        {current}
      </View>
      {next != null ? preview('next', next, activeDirection === 'next') : null}
      {children}
    </View>
  )
}
