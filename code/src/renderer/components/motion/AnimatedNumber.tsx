import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export type AnimatedNumberProps = {
  value: number
  format?: (value: number) => string
  durationMs?: number
  animateOnMount?: boolean
  className?: string
}

const defaultFormat = (value: number) => Math.round(value).toLocaleString('zh-CN')

export function AnimatedNumber({
  value,
  format = defaultFormat,
  durationMs = 480,
  animateOnMount = true,
  className
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion()
  const frameRef = useRef<number | null>(null)
  const currentRef = useRef(animateOnMount ? 0 : value)
  const [displayValue, setDisplayValue] = useState(animateOnMount ? 0 : value)

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)

    if (reducedMotion || !Number.isFinite(value) || durationMs <= 0) {
      currentRef.current = value
      setDisplayValue(value)
      return
    }

    const from = currentRef.current
    const delta = value - from
    const startedAt = performance.now()

    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs))
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextValue = from + delta * eased
      currentRef.current = nextValue
      setDisplayValue(nextValue)

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step)
      } else {
        frameRef.current = null
        currentRef.current = value
      }
    }

    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [durationMs, reducedMotion, value])

  const finalText = format(value)
  return (
    <span className={clsx('motion-number', className)}>
      <span aria-hidden="true">{format(displayValue)}</span>
      <span className="sr-only">{finalText}</span>
    </span>
  )
}
