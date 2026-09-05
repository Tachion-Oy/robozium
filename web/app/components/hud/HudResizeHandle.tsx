"use client"

import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react"
import { useStore } from "zustand"
import { hudSizeStore, setHudSizeProgress } from "@/lib/robosprawl/hud-size"

const clamp = (value: number) => Math.min(1, Math.max(0, value))

type Bounds = {
	minWidth: number
	minHeight: number
	maxWidth: number
	maxHeight: number
}

function readBounds(): Bounds {
	const rootStyle = window.getComputedStyle(document.documentElement)
	const parsedRem = Number.parseFloat(
		rootStyle.fontSize,
	)
	const rem = Number.isFinite(parsedRem) ? parsedRem : 16
	// Leave a narrow rail around the maximum HUD size so it retains breathing
	// room against the viewport edge. The compact density is already reflected
	// in `rem`; multiplying viewport pixels by it again would undersize the max.
	const maxWidth = Math.max(0, window.innerWidth * 0.78)
	const maxHeight = Math.max(0, window.innerHeight * 0.84)
	return {
		minWidth: Math.min(68 * rem, maxWidth),
		minHeight: Math.min(40 * rem, maxHeight),
		maxWidth,
		maxHeight,
	}
}

export function useHudResizeDimensions(
	progress: number,
): CSSProperties | undefined {
	const [bounds, setBounds] = useState<Bounds | null>(null)

	useEffect(() => {
		let frameId = 0
		const update = () => {
			if (frameId) return
			frameId = window.requestAnimationFrame(() => {
				frameId = 0
				setBounds(readBounds())
			})
		}
		window.addEventListener("resize", update)
		update()
		return () => {
			window.removeEventListener("resize", update)
			if (frameId) window.cancelAnimationFrame(frameId)
		}
	}, [])

	if (!bounds) return undefined
	return {
		width: bounds.minWidth + (bounds.maxWidth - bounds.minWidth) * progress,
		height: bounds.minHeight + (bounds.maxHeight - bounds.minHeight) * progress,
	}
}

type HudResizeHandleProps = {
	progress: number
	onProgressChange: (progress: number) => void
	onResizingChange: (resizing: boolean) => void
}

type Drag = {
	pointerId: number
	startX: number
	startY: number
	startProgress: number
	pathX: number
	pathY: number
}

type ResizableHudBoxProps = {
	children: ReactNode
	className: string
	inert: boolean
}

/** Keep rapid size updates local to the shell, outside the full HUD tree. */
export function ResizableHudBox({
	children,
	className,
	inert,
}: ResizableHudBoxProps) {
	const progress = useStore(hudSizeStore, (state) => state.progress)
	const [isResizing, setIsResizing] = useState(false)
	const resizeStyle = useHudResizeDimensions(progress)

	return (
		<div
			className={`${className}${isResizing ? " agent-hud__box--resizing" : ""}`}
			style={resizeStyle}
			inert={inert}>
			{children}
			<HudResizeHandle
				progress={progress}
				onProgressChange={setHudSizeProgress}
				onResizingChange={setIsResizing}
			/>
		</div>
	)
}

export function HudResizeHandle({
	progress,
	onProgressChange,
	onResizingChange,
}: HudResizeHandleProps) {
	const dragRef = useRef<Drag | null>(null)
	const didDragRef = useRef(false)
	const frameRef = useRef(0)
	const pendingProgressRef = useRef<number | null>(null)

	const flushProgress = () => {
		if (frameRef.current) {
			window.cancelAnimationFrame(frameRef.current)
			frameRef.current = 0
		}
		const pendingProgress = pendingProgressRef.current
		pendingProgressRef.current = null
		if (pendingProgress !== null) {
			onProgressChange(pendingProgress)
		}
	}

	const scheduleProgress = (nextProgress: number) => {
		pendingProgressRef.current = nextProgress
		if (frameRef.current) return
		frameRef.current = window.requestAnimationFrame(() => {
			frameRef.current = 0
			const pendingProgress = pendingProgressRef.current
			pendingProgressRef.current = null
			if (pendingProgress !== null) {
				onProgressChange(pendingProgress)
			}
		})
	}

	useEffect(() => {
		return () => {
			if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
		}
	}, [])

	const finishDrag = (pointerId: number) => {
		if (dragRef.current?.pointerId !== pointerId) return
		flushProgress()
		dragRef.current = null
		onResizingChange(false)
	}

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return
		event.preventDefault()
		const bounds = readBounds()
		didDragRef.current = false
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startProgress: progress,
			pathX: -(bounds.maxWidth - bounds.minWidth) / 2,
			pathY: (bounds.maxHeight - bounds.minHeight) / 2,
		}
		event.currentTarget.setPointerCapture(event.pointerId)
		onResizingChange(true)
	}

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		if (!drag || drag.pointerId !== event.pointerId) return
		const deltaX = event.clientX - drag.startX
		const deltaY = event.clientY - drag.startY
		if (Math.hypot(deltaX, deltaY) >= 4) didDragRef.current = true

		const pathLength = drag.pathX ** 2 + drag.pathY ** 2
		if (pathLength === 0) return
		scheduleProgress(
			clamp(
				drag.startProgress +
					(deltaX * drag.pathX + deltaY * drag.pathY) / pathLength,
			),
		)
	}

	const toggleSize = () => {
		if (didDragRef.current) {
			didDragRef.current = false
			return
		}
		onProgressChange(progress >= 1 ? 0 : 1)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const progressForKey: Record<string, number> = {
			Home: 0,
			End: 1,
			ArrowUp: progress + 0.05,
			ArrowRight: progress + 0.05,
			ArrowDown: progress - 0.05,
			ArrowLeft: progress - 0.05,
		}
		const next = progressForKey[event.key]
		if (next === undefined) return
		event.preventDefault()
		onProgressChange(clamp(next))
	}

	const percentage = Math.round(progress * 100)
	return (
		<div
			className="agent-hud__resize-handle"
			role="slider"
			tabIndex={0}
			aria-label="Resize HUD"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percentage}
			aria-valuetext={`${percentage}% of maximum size`}
			onClick={toggleSize}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={(event) => finishDrag(event.pointerId)}
			onPointerCancel={(event) => finishDrag(event.pointerId)}
			onLostPointerCapture={(event) => finishDrag(event.pointerId)}>
			<span
				className="agent-hud__resize-wedge agent-hud__corner-control"
				aria-hidden="true">
				<svg
					className="agent-hud__resize-icon"
					viewBox="0 0 20 20">
					<path d="M8 5.5 3.5 10 8 14.5M3.5 10h13M12 5.5l4.5 4.5-4.5 4.5" />
				</svg>
			</span>
		</div>
	)
}
