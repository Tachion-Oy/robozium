// The empty catch carries a comment for the desktop lint rules; the
// trigger markup lives in SelectorTrigger; the menu opens leftward from the trigger's
// right edge (the run selector's, which starts the row, rightward from its left edge)
// and scrolls its options within the room left in the window. The message log's
// selector is a terminal badge whose menu rises from it within the log pane.
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react"
import { SelectorTrigger } from "./SelectorTrigger"

export type SelectorOption<Value extends string> = {
	value: Value
	label: string
	/** Drawn in place of the label text, such as a model's icons and prices. */
	content?: ReactNode
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
	variant?: "model" | "view" | "run" | "log"
	emptyContent?: ReactNode
	/** A line below the options. */
	note?: ReactNode
	/** Drawn in place of the trigger label text. */
	triggerContent?: ReactNode
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

	const nextIndex =
		(currentIndex + direction + options.length) % options.length
	options[nextIndex]?.focus()
}

/** Shared accessible listbox behavior for the model and HUD-screen selectors. */
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
	note = null,
	triggerContent = triggerLabel,
}: SelectorDropdownProps<Value>) {
	const listboxId = useId()
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const [isOpen, setIsOpen] = useState(false)

	useEffect(() => {
		if (!isOpen) return

		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node))
				setIsOpen(false)
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

	// The menu may use the window from its left edge to the trigger's right edge (the run
	// menu from the trigger's left edge to the window's right edge), and from the
	// trigger's bottom edge down, so it never overflows the window. The log's menu may use
	// its terminal frame, which clips it, from the trigger's left edge right and from its top edge up.
	useLayoutEffect(() => {
		const menu = menuRef.current
		const trigger = triggerRef.current
		if (!isOpen || !menu || !trigger) return
		const fit = () => {
			const { left, right, top, bottom } = trigger.getBoundingClientRect()
			let roomInline = right
			let roomBlock = window.innerHeight - bottom
			if (variant === "run") roomInline = window.innerWidth - left
			const frame = trigger.closest(".term-frame")
			if (variant === "log" && frame) {
				const bounds = frame.getBoundingClientRect()
				roomInline = bounds.right - left
				roomBlock = top - bounds.top
			}
			menu.style.setProperty("--menu-room-inline", `${roomInline}px`)
			menu.style.setProperty("--menu-room-block", `${roomBlock}px`)
		}
		fit()
		window.addEventListener("resize", fit)
		return () => window.removeEventListener("resize", fit)
	}, [isOpen, variant])

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
		const settleSelection = async () => {
			try {
				if (await shouldClose) setIsOpen(false)
			} catch {
				// A rejected selection keeps the menu open.
			}
		}
		void settleSelection()
	}

	// The view and run selectors add their own classes to the model selector's.
	let selectorClass = "agent-hud__model-selector agent-hud__model-selector--ready"
	let triggerClass = ""
	if (variant === "view" || variant === "run") {
		selectorClass = `${selectorClass} agent-hud__${variant}-selector`
		triggerClass = `agent-hud__${variant}-trigger`
	}
	let menuClass = "agent-hud__model-menu"
	let optionsClass = "agent-hud__model-options"
	let optionClass = "agent-hud__model-option"
	let optionLabelClass: string | undefined
	const triggerProps = {
		ref: triggerRef,
		disabled,
		"aria-label": triggerLabel,
		title: triggerLabel,
		"aria-busy": busy || undefined,
		"aria-haspopup": "listbox" as const,
		"aria-controls": isOpen ? listboxId : undefined,
		onClick: toggleMenu,
	}
	let trigger = <SelectorTrigger {...triggerProps} label={triggerContent} open={isOpen} className={triggerClass} />
	// The log's selector takes the terminal's classes: its trigger is a badge like the pager's.
	if (variant === "log") {
		selectorClass = "term-log-selector"
		menuClass = "term-log-selector__menu"
		optionsClass = "term-log-selector__options"
		optionClass = "term-msg-badge term-log-selector__option"
		optionLabelClass = "term-msg-badge-label"
		trigger = (
			<button {...triggerProps} type="button" className="term-msg-badge" aria-expanded={isOpen}>
				<span className="term-msg-badge-label">
					<span className="term-log-selector__name">{triggerContent}</span>
					<span className="term-log-selector__caret" data-open={isOpen || undefined} aria-hidden="true">▴</span>
				</span>
			</button>
		)
	}

	return (
		<div
			ref={rootRef}
			className={selectorClass}>
			{trigger}
			{isOpen ? (
				<div
					ref={menuRef}
					id={listboxId}
					className={menuClass}
					role="listbox"
					aria-label={listboxLabel}
					onKeyDown={(event) => {
						if (
							event.key !== "ArrowDown" &&
							event.key !== "ArrowUp"
						)
							return
						event.preventDefault()
						moveOptionFocus(
							event,
							event.key === "ArrowDown" ? 1 : -1,
						)
					}}>
					<div className={optionsClass}>
						{options.map((option) => (
							<button
								key={option.value}
								type="button"
								role="option"
								aria-selected={option.value === value}
								className={optionClass}
								disabled={option.disabled}
								onClick={() => selectOption(option.value)}>
								<span className={optionLabelClass}>{option.content ?? option.label}</span>
								{option.value === value ? (
									<span className={optionLabelClass} aria-hidden="true">●</span>
								) : null}
							</button>
						))}
						{options.length === 0 ? emptyContent : null}
						{note}
					</div>
				</div>
			) : null}
		</div>
	)
}
