import clsx from 'clsx'

export type BrandGlyphAsset = {
  src: string
  monochrome?: boolean
  color?: string
}

export function BrandGlyph({
  asset,
  size,
  className,
  ariaHidden = true
}: {
  asset: BrandGlyphAsset
  size: number
  className?: string
  ariaHidden?: boolean
}) {
  if (asset.monochrome) {
    return (
      <span
        className={clsx('inline-block shrink-0', className)}
        aria-hidden={ariaHidden}
        style={{
          width: size,
          height: size,
          backgroundColor: asset.color ?? 'currentColor',
          WebkitMaskImage: `url("${asset.src}")`,
          maskImage: `url("${asset.src}")`,
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          maskSize: 'contain'
        }}
      />
    )
  }

  return (
    <img
      src={asset.src}
      width={size}
      height={size}
      className={clsx('block shrink-0 object-contain', className)}
      aria-hidden={ariaHidden}
      alt=""
      draggable={false}
    />
  )
}
