import { useId, type SVGProps } from 'react'
import clsx from 'clsx'

export function MoonMeterMark({
  className,
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  const maskId = `moonmeter-cut-${useId().replaceAll(':', '')}`

  return (
    <svg
      viewBox="0 0 220 120"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title && <title>{title}</title>}
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="220" height="120">
          <rect width="220" height="120" fill="white" />
          <path d="M110 12L118 60L110 108L102 60Z" fill="black" />
        </mask>
      </defs>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        mask={`url(#${maskId})`}
      >
        <circle cx="62" cy="60" r="46" />
        <circle cx="158" cy="60" r="46" />
      </g>
    </svg>
  )
}

export function MoonMeterWordmark({
  className,
  compact = false
}: {
  className?: string
  compact?: boolean
}) {
  return (
    <span
      className={clsx('moonmeter-wordmark', compact && 'moonmeter-wordmark-compact', className)}
      aria-label="MoonMeter"
    >
      <span>M</span>
      <MoonMeterMark className="moonmeter-wordmark-mark" />
      <span>NMETER</span>
    </span>
  )
}

export function MoonMeterAppIcon({ className }: { className?: string }) {
  return (
    <span className={clsx('moonmeter-app-icon', className)} aria-hidden="true">
      <MoonMeterMark className="h-auto w-[72%]" />
    </span>
  )
}
