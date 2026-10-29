// Copied from robozium-electron/desktop/web/app/components/hud/SelectorDropdown.tsx at 076b2c9.
// Adapted: the empty catch carries a comment for the desktop lint rules; the
// trigger markup lives in SelectorTrigger; the menu opens leftward from the trigger's
// right edge and scrolls its options within the room left in the window.
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
	/** Draws a label, such as a model's tier as an icon; plain text by default. */
	renderLabel?: (label: string) => ReactNode
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
	renderLabel = label => label,
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

	// The menu may use the window from its left edge to the trigger's right edge, and
	// from the trigger's bottom edge down, so it never overflows the window.
	useLayoutEffect(() => {
		const menu = menuRef.current
		const trigger = triggerRef.current
		if (!isOpen || !menu || !trigger) return
		const fit = () => {
			const { right, bottom } = trigger.getBoundingClientRect()
			menu.style.setProperty("--menu-room-inline", `${right}px`)
			menu.style.setProperty("--menu-room-block", `${window.innerHeight - bottom}px`)
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
					<div className="agent-hud__model-options">
						{options.map((option) => (
							<button
								key={option.value}
								type="button"
								role="option"
								aria-selected={option.value === value}
								className="agent-hud__model-option"
								disabled={option.disabled}
								onClick={() => selectOption(option.value)}>
								<span>{renderLabel(option.label)}</span>
								{option.value === value ? (
									<span aria-hidden="true">●</span>
								) : null}
							</button>
						))}
						{options.length === 0 ? emptyContent : null}
					</div>
				</div>
			) : null}
		</div>
	)
}
