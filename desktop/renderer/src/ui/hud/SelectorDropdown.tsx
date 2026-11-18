// The empty catch carries a comment for the desktop lint rules; the
// trigger markup lives in SelectorTrigger; the menu opens leftward from the trigger's
// right edge and scrolls its options within the room left in the window. An option
// with choices opens them in a second panel left of the menu.
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

type SelectorChoice = {
	value: string
	label: string
}

export type SelectorOption<Value extends string> = {
	value: Value
	label: string
	disabled?: boolean
	/** Listed in a panel beside the menu; the option opens the panel instead of being selected. */
	choices?: readonly SelectorChoice[]
}

type SelectorDropdownProps<Value extends string> = {
	value: Value | null
	options: readonly SelectorOption<Value>[]
	triggerLabel: string
	listboxLabel: string
	onSelect: (value: Value) => boolean | Promise<boolean>
	/** The selected one among the options' choices. */
	choice?: string | null
	/** A chosen choice closes the menu. */
	onSelectChoice?: (value: string) => void
	onOpen?: () => void
	disabled?: boolean
	busy?: boolean
	variant?: "model" | "view"
	emptyContent?: ReactNode
	/** Draws a label, such as a model's tier as an icon; plain text by default. */
	renderLabel?: (label: string) => ReactNode
}

/** Up and Down move the focus through a listbox's options, round its ends. */
function moveOptionFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
	if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
	event.preventDefault()
	const direction = event.key === "ArrowDown" ? 1 : -1
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
	choice = null,
	onSelectChoice,
	onOpen,
	disabled = false,
	busy = false,
	variant = "model",
	emptyContent = null,
	renderLabel = label => label,
}: SelectorDropdownProps<Value>) {
	const listboxId = useId()
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const choicesRef = useRef<HTMLDivElement>(null)
	const [isOpen, setIsOpen] = useState(false)
	// The option whose choices panel is open.
	const [expanded, setExpanded] = useState<Value | null>(null)
	const expandedOption = options.find((option) => option.value === expanded)
	const choices = isOpen && expandedOption?.choices ? expandedOption.choices : null
	const choicesOpen = choices !== null

	const closeChoices = () => {
		menuRef.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus()
		setExpanded(null)
	}

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
			// Escape leaves the choices panel first, then the menu.
			if (choicesOpen) {
				closeChoices()
				return
			}
			setIsOpen(false)
			triggerRef.current?.focus()
		}
		document.addEventListener("pointerdown", closeOnOutsidePointer)
		document.addEventListener("keydown", closeOnEscape, true)
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsidePointer)
			document.removeEventListener("keydown", closeOnEscape, true)
		}
	}, [isOpen, choicesOpen])

	// The menu may use the window from its left edge to the trigger's right edge, and
	// from the trigger's bottom edge down, so it never overflows the window. The choices
	// panel gets the room left of the menu.
	useLayoutEffect(() => {
		const root = rootRef.current
		const menu = menuRef.current
		const trigger = triggerRef.current
		if (!isOpen || !root || !menu || !trigger) return
		const fit = () => {
			const { right, bottom } = trigger.getBoundingClientRect()
			root.style.setProperty("--menu-room-inline", `${right}px`)
			root.style.setProperty("--menu-room-block", `${window.innerHeight - bottom}px`)
			root.style.setProperty("--menu-inline-size", `${menu.getBoundingClientRect().width}px`)
		}
		fit()
		window.addEventListener("resize", fit)
		return () => window.removeEventListener("resize", fit)
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

	useEffect(() => {
		const panel = choicesRef.current
		if (!choicesOpen || !panel) return
		const selected = panel.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
		const first = panel.querySelector<HTMLButtonElement>('[role="option"]')
		const optionToFocus = selected ?? first
		optionToFocus?.focus()
	}, [choicesOpen])

	const toggleMenu = () => {
		if (!isOpen) {
			onOpen?.()
			setExpanded(null)
		}
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

	const isViewSelector = variant === "view"

	return (
		<div
			ref={rootRef}
			className={`agent-hud__model-selector agent-hud__model-selector--ready${isViewSelector ? " agent-hud__view-selector" : ""}`}>
			<SelectorTrigger
				ref={triggerRef}
				label={renderLabel(triggerLabel)}
				open={isOpen}
				className={isViewSelector ? "agent-hud__view-trigger" : ""}
				disabled={disabled}
				aria-label={triggerLabel}
				title={triggerLabel}
				aria-busy={busy || undefined}
				aria-haspopup="listbox"
				aria-controls={isOpen ? listboxId : undefined}
				onClick={toggleMenu}
			/>
			{isOpen ? (
				<div
					ref={menuRef}
					id={listboxId}
					className="agent-hud__model-menu"
					role="listbox"
					aria-label={listboxLabel}
					onKeyDown={moveOptionFocus}>
					<div className="agent-hud__model-options">
						{options.map((option) => {
							const opensChoices = option.choices !== undefined
							const isExpanded = option.value === expanded
							const isSelected = option.value === value
							return (
								<button
									key={option.value}
									type="button"
									role="option"
									aria-selected={isSelected}
									aria-haspopup={opensChoices ? "listbox" : undefined}
									aria-expanded={opensChoices ? isExpanded : undefined}
									className="agent-hud__model-option"
									disabled={option.disabled}
									onClick={() => {
										if (!opensChoices) selectOption(option.value)
										else if (isExpanded) closeChoices()
										else setExpanded(option.value)
									}}
									onKeyDown={(event) => {
										if (!opensChoices || event.key !== "ArrowRight") return
										event.preventDefault()
										setExpanded(option.value)
									}}>
									<span className="agent-hud__model-option-label">{renderLabel(option.label)}</span>
									{opensChoices ? (
										<span className="agent-hud__model-option-marks" aria-hidden="true">
											<svg className="agent-hud__model-choices-caret" viewBox="0 0 16 14">
												<path d="M8 12.75 1.25 1.25h13.5Z" />
											</svg>
											{isSelected ? "●" : null}
										</span>
									) : null}
									{isSelected && !opensChoices ? (
										<span aria-hidden="true">●</span>
									) : null}
								</button>
							)
						})}
						{options.length === 0 ? emptyContent : null}
					</div>
				</div>
			) : null}
			{choices && expandedOption ? (
				<div
					ref={choicesRef}
					className="agent-hud__model-menu agent-hud__model-menu--choices"
					role="listbox"
					aria-label={expandedOption.label}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") {
							event.preventDefault()
							closeChoices()
							return
						}
						moveOptionFocus(event)
					}}>
					<div className="agent-hud__model-options">
						{choices.map((item) => (
							<button
								key={item.value}
								type="button"
								role="option"
								aria-selected={item.value === choice}
								className="agent-hud__model-option"
								onClick={() => {
									onSelectChoice?.(item.value)
									setIsOpen(false)
								}}>
								<span>{item.label}</span>
								{item.value === choice ? (
									<span aria-hidden="true">●</span>
								) : null}
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	)
}
