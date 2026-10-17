import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { HudButton } from "../HudButton"
import { SelectorCaret } from "./SelectorCaret"
import "./hud-selector.css"

type HudSelectorProps<Value extends string> = {
	value: Value
	disabled?: boolean
	placeholder?: string
	options: readonly { value: Value; label: string }[]
	label: string
	variant: "model" | "view"
	open: boolean
	onOpenChange: (open: boolean) => void
	onSelect: (value: Value) => void
}

export function HudSelector<Value extends string>({
	value, options, label, variant, open, onOpenChange, onSelect, disabled = false, placeholder = "No choices available",
}: HudSelectorProps<Value>) {
	const id = useId()
	const root = useRef<HTMLDivElement>(null)
	const menu = useRef<HTMLDivElement>(null)
	const trigger = useRef<HTMLButtonElement>(null)
	const search = useRef({ text: "", time: 0 })
	const selected = options.findIndex(option => option.value === value)
	const [active, setActive] = useState(selected)
	const selectedLabel = options[selected]?.label ?? placeholder
	const close = (commit: boolean) => {
		if (commit && !disabled && options[active]) onSelect(options[active].value)
		search.current.text = ""
		onOpenChange(false)
	}
	const openAt = (index: number) => {
		if (disabled || !options.length) return
		setActive(Math.max(0, index))
		onOpenChange(true)
	}

	useEffect(() => {
		if (!open) return
		const outside = (event: PointerEvent) => {
			if (root.current?.contains(event.target as Node)) return
			if (!disabled && options[active]) onSelect(options[active].value)
			onOpenChange(false)
			search.current.text = ""
		}
		document.addEventListener("pointerdown", outside)
		return () => document.removeEventListener("pointerdown", outside)
	}, [open, active, options, onSelect, onOpenChange, disabled])

	useEffect(() => {
		if (!open || !menu.current) return
		const reveal = () => document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" })
		const observer = new ResizeObserver(reveal)
		observer.observe(menu.current)
		reveal()
		return () => observer.disconnect()
	}, [open, active, id])

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (disabled || !options.length || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
		const { key } = event
		if (event.altKey && key !== "ArrowDown" && key !== "ArrowUp") return
		const now = performance.now()
		const previous = now - search.current.time < 500 ? search.current.text : ""
		if (!event.altKey && key.length === 1 && (key !== " " || previous)) {
			event.preventDefault()
			const text = previous + key.toLowerCase()
			const prefix = [...text].every(char => char === text[0]) ? text[0] : text
			const start = (open ? active : selected) + (prefix.length === 1 ? 1 : 0)
			const match = options.map((_, index) => (start + index) % options.length)
				.find(index => options[index].label.toLowerCase().startsWith(prefix))
			openAt(match ?? (open ? active : selected))
			search.current = { text, time: now }
			return
		}
		switch (key) {
			case "Enter": case " ":
				event.preventDefault()
				if (open) close(true)
				else openAt(selected)
				break
			case "ArrowDown": case "ArrowUp":
				event.preventDefault()
				if (event.altKey) {
					if (key === "ArrowDown") openAt(open ? active : selected)
					else if (open) close(true)
				} else if (!open) openAt(key === "ArrowDown" ? selected : 0)
				else setActive(Math.max(0, Math.min(options.length - 1, active + (key === "ArrowDown" ? 1 : -1))))
				break
			case "Home": case "End":
				event.preventDefault()
				openAt(key === "Home" ? 0 : options.length - 1)
				break
			case "Escape":
				if (open) { event.preventDefault(); close(false) }
				break
			case "Tab":
				if (open) close(true)
				break
		}
	}

	return (
		<div ref={root} className={`hud-select hud-select--${variant}`} data-open={open || undefined}
			onBlur={event => { if (open && !event.currentTarget.contains(event.relatedTarget)) close(true) }}>
			<HudButton ref={trigger} variant={variant === "model" ? "success" : "warning"}
				className="hud-header__selector" role="combobox" aria-label={`${label}: ${selectedLabel}`}
				aria-disabled={disabled || !options.length || undefined}
				title={selectedLabel} aria-haspopup="listbox" aria-expanded={open}
				aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
				onKeyDown={onKeyDown} onClick={() => open ? close(false) : openAt(selected)}>
				<span className="hud-header__label">{selectedLabel}</span>
				<SelectorCaret />
			</HudButton>
			{open && (
				<div ref={menu} id={id} className="hud-select__menu" role="listbox" aria-label={label}>
					{options.map((option, index) => (
						<div key={option.value} id={`${id}-${index}`} role="option" aria-selected={active === index}
							className="hud-select__option" title={option.label}
							onPointerDown={event => event.preventDefault()}
							onClick={() => {
								if (!disabled) onSelect(option.value)
								close(false)
								trigger.current?.focus()
							}}>
							<span>{option.label}</span>
							<span aria-hidden="true">{option.value === value ? "●" : ""}</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
