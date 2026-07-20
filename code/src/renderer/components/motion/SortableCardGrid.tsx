import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import { moveCard } from '../../../shared/utils/card-order'

type DragSession = {
  activeId: string
  originalIds: string[]
  pointerId: number
  startX: number
  startY: number
  rects: Map<string, DOMRect>
  dragging: boolean
}

type DragView = {
  activeId: string
  overId: string
  deltaX: number
  deltaY: number
}

type SortableCardGridProps<T> = {
  items: readonly T[]
  getId: (item: T) => string
  getLabel: (item: T) => string
  onReorder: (ids: readonly string[]) => void
  renderItem: (item: T) => ReactNode
  className?: string
  ariaLabel: string
}

const DRAG_THRESHOLD = 6
const DROP_FEEDBACK_MS = 220

function closestCardId(rects: Map<string, DOMRect>, x: number, y: number): string | null {
  let closest: { id: string; distance: number } | null = null
  for (const [id, rect] of rects) {
    const dx = x - (rect.left + rect.width / 2)
    const dy = y - (rect.top + rect.height / 2)
    const distance = dx * dx + dy * dy
    if (!closest || distance < closest.distance) closest = { id, distance }
  }
  return closest?.id ?? null
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'button:not([data-drag-handle]), a, input, select, textarea, [role="button"]:not([data-drag-handle]), [data-no-drag]'
    )
  )
}

export function SortableCardGrid<T>({
  items,
  getId,
  getLabel,
  onReorder,
  renderItem,
  className,
  ariaLabel
}: SortableCardGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const dropTimerRef = useRef<number | null>(null)
  const [dragView, setDragView] = useState<DragView | null>(null)
  const [droppedId, setDroppedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const ids = useMemo(() => items.map(getId), [getId, items])
  const labels = useMemo(
    () => new Map(items.map((item) => [getId(item), getLabel(item)])),
    [getId, getLabel, items]
  )
  const previewIds = dragView
    ? moveCard(sessionRef.current?.originalIds ?? ids, dragView.activeId, dragView.overId)
    : ids

  useEffect(
    () => () => {
      document.body.classList.remove('is-card-sorting')
      if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current)
    },
    []
  )

  function measureCards(): Map<string, DOMRect> {
    const rects = new Map<string, DOMRect>()
    gridRef.current?.querySelectorAll<HTMLElement>('[data-sortable-id]').forEach((element) => {
      const id = element.dataset.sortableId
      if (id) rects.set(id, element.getBoundingClientRect())
    })
    return rects
  }

  function finishDrop(activeId: string, nextIds: readonly string[]): void {
    onReorder(nextIds)
    setDroppedId(activeId)
    setAnnouncement(
      `${labels.get(activeId) ?? '卡片'}已移动到第 ${nextIds.indexOf(activeId) + 1} 位`
    )
    if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current)
    dropTimerRef.current = window.setTimeout(() => setDroppedId(null), DROP_FEEDBACK_MS)
  }

  function resetDrag(): void {
    sessionRef.current = null
    setDragView(null)
    document.body.classList.remove('is-card-sorting')
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>, activeId: string): void {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    sessionRef.current = {
      activeId,
      originalIds: [...ids],
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rects: measureCards(),
      dragging: false
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const session = sessionRef.current
    if (!session || event.pointerId !== session.pointerId) return
    const deltaX = event.clientX - session.startX
    const deltaY = event.clientY - session.startY
    if (!session.dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return

    if (!session.dragging) {
      session.dragging = true
      document.body.classList.add('is-card-sorting')
      setAnnouncement(`${labels.get(session.activeId) ?? '卡片'}已拿起`)
    }

    event.preventDefault()
    const overId = closestCardId(session.rects, event.clientX, event.clientY) ?? session.activeId
    setDragView({ activeId: session.activeId, overId, deltaX, deltaY })
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>): void {
    const session = sessionRef.current
    if (!session || event.pointerId !== session.pointerId) return
    if (session.dragging) {
      const overId = dragView?.overId ?? session.activeId
      finishDrop(session.activeId, moveCard(session.originalIds, session.activeId, overId))
    }
    resetDrag()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, activeId: string): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = ids.indexOf(activeId)
    if (currentIndex < 0) return
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    const targetIndex = Math.max(0, Math.min(ids.length - 1, currentIndex + direction))
    if (targetIndex === currentIndex) return
    const targetId = ids[targetIndex]
    if (targetId) finishDrop(activeId, moveCard(ids, activeId, targetId))
  }

  function itemStyle(id: string): CSSProperties | undefined {
    const session = sessionRef.current
    if (!dragView || !session) return undefined
    if (id === dragView.activeId) {
      return {
        transform: `translate3d(${dragView.deltaX}px, ${dragView.deltaY}px, 0) scale(1.015)`
      }
    }

    const currentRect = session.rects.get(id)
    const targetIndex = previewIds.indexOf(id)
    const targetSlotId = session.originalIds[targetIndex]
    const targetRect = targetSlotId ? session.rects.get(targetSlotId) : undefined
    if (!currentRect || !targetRect) return undefined
    return {
      transform: `translate3d(${targetRect.left - currentRect.left}px, ${targetRect.top - currentRect.top}px, 0)`
    }
  }

  return (
    <div
      ref={gridRef}
      className={className}
      data-motion-group
      data-sortable-grid
      role="list"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const id = getId(item)
        const label = getLabel(item)
        const dragging = dragView?.activeId === id
        const target = !!dragView && dragView.overId === id && !dragging
        return (
          <div
            key={id}
            data-sortable-id={id}
            role="listitem"
            className={`motion-sortable-item ${dragging ? 'is-dragging' : ''} ${
              target ? 'is-sort-target' : ''
            } ${droppedId === id ? 'is-dropped' : ''}`}
            style={itemStyle(id)}
            onPointerDown={(event) => handlePointerDown(event, id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            <button
              type="button"
              className="motion-sortable-grip"
              data-drag-handle
              aria-label={`拖动${label}调整顺序`}
              title="拖动调整顺序；也可用方向键移动"
              onPointerDown={(event) => {
                event.stopPropagation()
                handlePointerDown(event, id)
              }}
              onKeyDown={(event) => handleKeyDown(event, id)}
            >
              <i className="fa-solid fa-grip-lines" aria-hidden="true" />
            </button>
            {renderItem(item)}
          </div>
        )
      })}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
