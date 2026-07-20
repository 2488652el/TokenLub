import { useEffect, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import { useReducedMotion } from '../../hooks/useReducedMotion'

type ProgressTone = 'accent' | 'blue' | 'amber' | 'purple' | 'red'

const TONE_CLASS: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  blue: 'bg-status-blue',
  amber: 'bg-status-amber',
  purple: 'bg-status-purple',
  red: 'bg-status-red'
}

export type ProgressBarProps = {
  value: number
  label: string
  tone?: ProgressTone
  className?: string
  trackClassName?: string
  fillClassName?: string
  color?: string | undefined
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function ProgressBar({
  value,
  label,
  tone = 'accent',
  className,
  trackClassName,
  fillClassName,
  color
}: ProgressBarProps) {
  const reducedMotion = useReducedMotion()
  const [ready, setReady] = useState(reducedMotion)
  const progress = clampProgress(value)

  useEffect(() => {
    if (reducedMotion) {
      setReady(true)
      return
    }

    setReady(false)
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [reducedMotion])

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className={clsx(
        'h-1.5 overflow-hidden rounded-full bg-border-light',
        trackClassName,
        className
      )}
    >
      <div
        className={clsx(
          'motion-progress-fill h-full rounded-full',
          !fillClassName && !color && TONE_CLASS[tone],
          fillClassName
        )}
        style={
          {
            '--motion-progress': ready ? progress : 0,
            ...(color ? { backgroundColor: color } : {})
          } as CSSProperties
        }
      />
    </div>
  )
}
