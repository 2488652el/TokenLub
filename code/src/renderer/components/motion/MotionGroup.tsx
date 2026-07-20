import { type ReactNode } from 'react'

export function MotionGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-motion-group className={className}>
      {children}
    </div>
  )
}
