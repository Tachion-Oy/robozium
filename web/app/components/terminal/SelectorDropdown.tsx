"use client"

import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react"

export type SelectorOption<Value extends string> = {
	value: Value
	label: string
	disabled?: boolean
}

type SelectorDropdownProps<Value extends string> = {
	value: Value | null
	options: readonly SelectorOption<Value>[]
	triggerLabel: string
	listboxLabel: string
	onSelect: (value: Value) => boolean | Promise<boolean>
	onOpen?: () => void
	disabled?: boolean
	busy?: boolean
	variant?: "model" | "view"
	emptyContent?: ReactNode
}

function moveOptionFocus(
	event: ReactKeyboardEvent<HTMLDivElement>,
	direction: -1 | 1,
) {
	const options = Array.from(
		event.currentTarget.querySelectorAll<HTMLButtonElement>(
			'[role="option"]:not(:disabled)',
		),
	)
	const currentIndex = options.indexOf(event.target as HTMLButtonElement)
	if (currentIndex < 0) return

	const nextIndex = (currentIndex + direction + options.length) % options.length
	options[nextIndex]?.focus()
}

/** Shared accessible listbox behavior for the model and HUD-view selectors. */
export function SelectorDropdown<Value extends string>({
	value,
	options,
	triggerLabel,
	listboxLabel,
	onSelect,
	onOpen,
	disabled = false,
	busy = false,
	variant = "model",
	emptyContent = null,
}: SelectorDropdownProps<Value>) {
	const listboxId = useId()
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const [isOpen, setIsOpen] = useState(false)

	useEffect(() => {
		if (!isOpen) return

		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			event.preventDefault()
			event.stopImmediatePropagation()
			setIsOpen(false)
			triggerRef.current?.focus()
		}
		document.addEventListener("pointerdown", closeOnOutsidePointer)
		document.addEventListener("keydown", closeOnEscape, true)
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsidePointer)
			document.removeEventListener("keydown", closeOnEscape, true)
		}
	}, [isOpen])

	useEffect(() => {
		if (!isOpen) return
		const menu = menuRef.current
		const selected = menu?.querySelector<HTMLButtonElement>(
			'[role="option"][aria-selected="true"]:not(:disabled)',
		)
		const first = menu?.querySelector<HTMLButtonElement>(
			'[role="option"]:not(:disabled)',
		)
		const optionToFocus = selected ?? first
		optionToFocus?.focus()
	}, [isOpen, options.length, value])

	const toggleMenu = () => {
		if (!isOpen) onOpen?.()
		setIsOpen((open) => !open)
	}

	const selectOption = (nextValue: Value) => {
		const shouldClose = onSelect(nextValue)
		if (typeof shouldClose === "boolean") {
			if (shouldClose) setIsOpen(false)
			return
		}
		void shouldClose.then((close) => {
			if (close) setIsOpen(false)
		})
	}

	const isViewSelector = variant === "view"

	return (
		<div
			ref={rootRef}
			className={`agent-hud__model-selector agent-hud__model-selector--ready${isViewSelector ? " agent-hud__view-selector" : ""}`}>
			<button
				ref={triggerRef}
				type="button"
				className={`agent-hud__selector-trigger agent-hud__model-trigger${isViewSelector ? " agent-hud__view-trigger" : ""}`}
				disabled={disabled}
				aria-busy={busy || undefined}
				aria-haspopup="listbox"
				aria-expanded={isOpen}
				aria-controls={isOpen ? listboxId : undefined}
				onClick={toggleMenu}>
				<span>{triggerLabel}</span>
				<svg
					className="agent-hud__model-caret"
					data-open={isOpen || undefined}
					viewBox="0 0 16 14"
					aria-hidden="true">
					<path d="M8 12.75 1.25 1.25h13.5Z" />
				</svg>
			</button>
			{isOpen ? (
				<div
					ref={menuRef}
					id={listboxId}
					className={`agent-hud__model-menu${isViewSelector ? " agent-hud__view-menu" : ""}`}
					role="listbox"
					aria-label={listboxLabel}
					onKeyDown={(event) => {
						if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
						event.preventDefault()
						moveOptionFocus(event, event.key === "ArrowDown" ? 1 : -1)
					}}>
					{options.map((option) => (
						<button
							key={option.value}
							type="button"
							role="option"
							aria-selected={option.value === value}
							className="agent-hud__model-option"
							disabled={option.disabled}
							onClick={() => selectOption(option.value)}>
							<span>{option.label}</span>
							{option.value === value ? <span aria-hidden="true">●</span> : null}
						</button>
					))}
					{options.length === 0 ? emptyContent : null}
				</div>
			) : null}
		</div>
	)
}
