import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View } from '@tarojs/components'
import type { PaperTurnState } from '../gestures/model'
import {
  paperTurnTransition,
  type PaperTurnDirection,
} from '../gestures/paper-turn'
import {
  resolvePaperFoldFrame,
  resolvePaperFoldMotion,
  type PaperFoldMotion,
} from '../gestures/paper-fold'

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

interface FoldLayers {
  current: ReactNode
  previous?: ReactNode
  next?: ReactNode
}

interface FoldPlayback {
  progress: number
  tilt: number
  target: number
  running: boolean
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
  const activeDirection = paperTurn.phase === 'idle' ? null : paperTurn.direction
  const reducedMotion = paperTurn.reducedMotion
  const transition = paperTurnTransition(paperTurn.phase, reducedMotion)
  const dragMotion = paperTurn.phase === 'drag'
    ? resolvePaperFoldMotion({
      axis: paperTurn.axis,
      direction: activeDirection,
      phase: paperTurn.phase,
      displacement: paperTurn.displacement,
      crossDisplacement: paperTurn.crossDisplacement,
      size,
    })
    : null
  const motionRef = useRef<PaperFoldMotion | null>(null)
  const layersRef = useRef<FoldLayers | null>(null)
  const [playback, setPlayback] = useState<FoldPlayback | null>(null)

  if (paperTurn.phase === 'drag') {
    motionRef.current = dragMotion
    const requiredContentLoaded = activeDirection === 'prev'
      ? previous != null
      : activeDirection === 'next' ? next != null : false
    if (activeDirection != null && requiredContentLoaded && layersRef.current == null) {
      layersRef.current = { current, previous, next }
    }
  } else if (paperTurn.phase === 'idle') {
    motionRef.current = null
    layersRef.current = null
  }

  useEffect(() => {
    if (paperTurn.phase === 'drag') {
      setPlayback(null)
      return
    }
    if (paperTurn.phase === 'idle') {
      setPlayback(null)
      return
    }

    const start = motionRef.current
    if (reducedMotion || start == null || transition.durationMs <= 0) {
      setPlayback(null)
      return
    }

    const target = paperTurn.phase === 'complete'
      ? activeDirection === 'prev' ? 0 : 1
      : activeDirection === 'prev' ? 1 : 0
    setPlayback({ ...start, target, running: true })

    let cancelled = false
    let frameId: number | undefined
    const startedAt = Date.now()
    const advance = () => {
      if (cancelled) return
      const elapsed = Date.now() - startedAt
      const amount = Math.min(1, elapsed / transition.durationMs)
      const nextProgress = start.progress + (target - start.progress) * amount
      setPlayback({ progress: nextProgress, tilt: start.tilt, target, running: amount < 1 })
      if (amount < 1) {
        frameId = requestNextFrame(advance)
      }
    }
    frameId = requestNextFrame(advance)

    return () => {
      cancelled = true
      if (frameId != null) cancelNextFrame(frameId)
    }
  }, [activeDirection, paperTurn.phase, reducedMotion, transition.durationMs])

  const layers = reducedMotion ? null : layersRef.current
  const dragContentExists = activeDirection === 'prev'
    ? previous != null
    : activeDirection === 'next' ? next != null : false
  const gestureLayersActive = activeDirection != null
    && !reducedMotion
    && (paperTurn.phase === 'drag' ? dragContentExists : layers != null)
  const playbackSeed = playback == null && motionRef.current != null && paperTurn.phase !== 'drag'
    ? {
      progress: motionRef.current.progress,
      tilt: motionRef.current.tilt,
      target: paperTurn.phase === 'complete'
        ? activeDirection === 'prev' ? 0 : 1
        : activeDirection === 'prev' ? 1 : 0,
      running: true,
    }
    : null
  const activePlayback = playback ?? playbackSeed
  // Keep the final preset frame while the parent settles navigation. Dropping it
  // as soon as the local timer finishes would flash the full outgoing sheet.
  // A fresh drag still wins synchronously, so completed playback cannot leak
  // into the next gesture before its effect clears the old timer state.
  const displayMotion = dragMotion ?? activePlayback
  const foldFrame = gestureLayersActive && displayMotion != null
    ? resolvePaperFoldFrame(displayMotion.progress, displayMotion.tilt, paperTurn.axis)
    : null
  const foldDecorations = foldFrame != null ? (
    <>
      <View
        className={`bubu-paper-fold-region bubu-paper-fold-${horizontal ? 'horizontal' : 'vertical'}`}
        style={{ clipPath: foldFrame.flatClipPath }}
        aria-hidden
      >
        <View
          className={`bubu-paper-fold-shadow bubu-paper-fold-${horizontal ? 'horizontal' : 'vertical'}`}
          style={{ clipPath: foldFrame.shadowClipPath }}
        />
        <View
          className={`bubu-paper-fold-back bubu-paper-fold-${horizontal ? 'horizontal' : 'vertical'}`}
          style={{ clipPath: foldFrame.backClipPath }}
        />
      </View>
    </>
  ) : null
  const sheetClipStyle = (moving: boolean) => moving && foldFrame != null
    ? { clipPath: foldFrame.flatClipPath }
    : undefined

  const currentIsUpper = activeDirection !== 'prev'
  const stableCurrent = activeDirection != null && layers != null
    ? layers.current
    : current
  const stableNext = activeDirection === 'next' && layers != null ? layers.next : next
  const stablePrevious = activeDirection === 'prev' && layers != null ? layers.previous : previous
  const nextVisible = gestureLayersActive && activeDirection === 'next'
  const previousVisible = gestureLayersActive && activeDirection === 'prev'

  const preview = (
    direction: PaperTurnDirection,
    content: ReactNode,
    visible: boolean,
    moving: boolean,
  ) => (
    <View
      className={`bubu-paper-neighbor bubu-paper-neighbor-${direction}${visible ? ' bubu-paper-neighbor-active' : ''}`}
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
      {moving ? foldDecorations : null}
    </View>
  )

  return (
    <View className='bubu-timeline-viewport'>
      {stablePrevious != null
        ? preview('prev', stablePrevious, previousVisible, previousVisible)
        : null}
      <View className='bubu-paper-current'>
        <View
          className='bubu-paper-sheet-clip'
          style={sheetClipStyle(currentIsUpper && nextVisible)}
        >
          {stableCurrent}
        </View>
        {currentIsUpper && nextVisible ? foldDecorations : null}
      </View>
      {stableNext != null
        ? preview('next', stableNext, nextVisible, false)
        : null}
      {children}
    </View>
  )
}

function requestNextFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback)
  }
  return setTimeout(callback, 16) as unknown as number
}

function cancelNextFrame(frameId: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(frameId)
    return
  }
  clearTimeout(frameId)
}
