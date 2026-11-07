import type { ReactNode } from 'react'
import { View } from '@tarojs/components'
import type { PaperTurnState } from '../gestures/model'
import {
  completedPaperTurnDisplacement,
  paperTurnTransition,
  resolvePaperCurl,
  resolvePaperFoldGeometry,
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

const emptyCurl = {
  angle: 0,
  curlSize: 0,
  shadowOpacity: 0,
  originX: 0,
  originY: 0,
}

const fullSheetClip = 'none'

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
  const movingSide: PaperTurnSide = activeDirection === 'prev' ? 'neighbor' : 'current'
  const movingDirection = activeDirection === 'prev' ? 'prev' : activeDirection === 'next' ? 'next' : null
  const movingContentExists = activeDirection === 'prev'
    ? previous != null
    : activeDirection === 'next' ? next != null : false
  const canMoveSheet = movingDirection != null && movingContentExists
  const completedDirection = paperTurn.direction ?? 'prev'
  const displacement = paperTurn.phase === 'complete'
    ? horizontal && completedDirection === 'prev'
      ? size
      : completedPaperTurnDisplacement(paperTurn.axis, completedDirection, size)
    : paperTurn.phase === 'drag' ? paperTurn.displacement : 0
  const movingTransform = canMoveSheet && movingDirection != null
    ? resolvePaperTurnTransform({
      ...paperTurn,
      direction: movingDirection,
      displacement,
      size,
      side: movingSide,
    })
    : null
  const curl = canMoveSheet && movingDirection != null
    ? resolvePaperCurl({
      axis: paperTurn.axis,
      phase: paperTurn.phase,
      displacement,
      crossDisplacement: paperTurn.crossDisplacement,
      origin: paperTurn.origin,
      width: viewportWidth,
      height: viewportHeight,
      reducedMotion: paperTurn.reducedMotion,
    })
    : emptyCurl
  const movingLayerTransform = movingTransform == null
    ? 'translate(0px, 0px)'
    : `translate(${movingTransform.x}px, ${movingTransform.y}px)`
  const movingLayerStyle = {
    transform: movingLayerTransform,
  }
  const movingFold = canMoveSheet && movingDirection != null
    && !paperTurn.reducedMotion
    ? resolvePaperFoldGeometry({
      axis: paperTurn.axis,
      width: viewportWidth,
      height: viewportHeight,
      angle: curl.angle,
      curlSize: curl.curlSize,
      band: Math.max(curl.curlSize * 2, 18),
    })
    : null
  const movingSheetClipPath = movingFold?.clipPath ?? fullSheetClip
  const sheetClipStyle = (moving: boolean) => moving
    ? {
      clipPath: movingSheetClipPath,
      transitionProperty: paperTurn.phase === 'drag' ? 'none' : 'clip-path',
      transitionDuration: `${transition.durationMs}ms`,
    }
    : undefined
  const decorationTransition = transition.property === 'none'
    ? 'none'
    : 'left, top, width, height, transform, opacity'
  const layerStyle = (transform: string, moving = false) => ({
    ...(moving ? movingLayerStyle : { transform }),
    transitionProperty: transition.property,
    transitionDuration: `${transition.durationMs}ms`,
  })
  const decorationStyle = (
    decoration: NonNullable<typeof movingFold>['curl'] | NonNullable<typeof movingFold>['shadow'],
    opacity: number,
  ) => ({
    left: `${decoration.left}px`,
    top: `${decoration.top}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${decoration.width}px`,
    height: `${decoration.height}px`,
    opacity,
    transform: decoration.transform,
    transformOrigin: decoration.transformOrigin,
    transitionProperty: decorationTransition,
    transitionDuration: `${transition.durationMs}ms`,
  })
  const paperDecorations = (visible: boolean) => movingFold == null ? null : (
    <>
      <View
        className={`bubu-paper-cast-shadow bubu-paper-cast-shadow-${horizontal ? 'horizontal' : 'vertical'}`}
        style={decorationStyle(movingFold.shadow, visible ? Math.min(1, curl.shadowOpacity / 0.24) : 0)}
        aria-hidden
      />
      <View
        className={`bubu-paper-curl bubu-paper-curl-${horizontal ? 'horizontal' : 'vertical'}`}
        style={{
          ...decorationStyle(movingFold.curl, visible ? Math.min(1, curl.curlSize / 18) : 0),
        }}
        aria-hidden
      />
    </>
  )
  const preview = (direction: PaperTurnDirection, content: ReactNode, visible: boolean, moving: boolean) => (
    <View
      className={`bubu-paper-neighbor bubu-paper-neighbor-${direction}${visible ? ' bubu-paper-neighbor-active' : ''}`}
      style={layerStyle(moving ? movingLayerTransform : 'translate(0px, 0px)', moving)}
      {...inertPreviewAttributes}
    >
      <View className='bubu-paper-sheet-clip' style={sheetClipStyle(moving)}>
        <View
          className='bubu-paper-preview-scroll'
          style={{ transform: `translateY(${-gestureScrollTop}px)` }}
        >
          {content}
        </View>
      </View>
      {direction === 'prev' && activeDirection === 'prev' && canMoveSheet
        ? paperDecorations(paperTurn.phase === 'drag')
        : null}
    </View>
  )

  return (
    <View className='bubu-timeline-viewport'>
      {previous != null
        ? preview('prev', previous, activeDirection === 'prev', activeDirection === 'prev')
        : null}
      <View
        className='bubu-paper-current'
        style={layerStyle(
          activeDirection === 'next' && next != null ? movingLayerTransform : 'translate(0px, 0px)',
          activeDirection === 'next' && next != null,
        )}
      >
        <View
          className='bubu-paper-sheet-clip'
          style={sheetClipStyle(activeDirection === 'next' && next != null)}
        >
          {current}
        </View>
        {activeDirection === 'next' && canMoveSheet
          ? paperDecorations(paperTurn.phase === 'drag')
          : null}
      </View>
      {next != null ? preview('next', next, activeDirection === 'next', false) : null}
      {children}
    </View>
  )
}
