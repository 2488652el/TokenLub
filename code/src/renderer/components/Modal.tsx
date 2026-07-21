/**
 * 通用模态弹窗组件:提供遮罩层、标题栏、关闭按钮与内容区,
 * 支持 ESC 关闭与点击遮罩关闭。
 * (glm-5.2)
 */
import { Icon } from './Icon'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useReducedMotion } from '../hooks/useReducedMotion'

/**
 * 模态弹窗组件。
 * @param title 弹窗标题
 * @param onClose 关闭回调
 * @param children 弹窗内容
 */
export function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const requestClose = useCallback(() => {
    if (closing) return
    if (reducedMotion) {
      onClose()
      return
    }

    setClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 140)
  }, [closing, onClose, reducedMotion])

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      previousFocusRef.current?.focus()
    }
  }, [])

  // 监听 ESC 键以关闭弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [requestClose])

  return (
    <div
      className={clsx(
        'motion-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4',
        closing && 'is-closing'
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'motion-modal-panel bg-bg-card border border-border-light rounded-lg shadow-popover w-full max-w-[480px] max-h-[calc(100vh-32px)] flex flex-col overflow-hidden',
          closing && 'is-closing'
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="关闭"
            className="text-text-muted hover:text-text-primary w-7 h-7 flex items-center justify-center rounded"
          >
            <Icon name="fa-xmark" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
