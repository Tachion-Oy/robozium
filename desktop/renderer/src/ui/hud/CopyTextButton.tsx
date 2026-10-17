import { useEffect, useRef, useState } from "react"
import { HudButton } from "../HudButton"

export function CopyTextButton({ content, target, onError }: {
	content: string; target: "reply" | "agent output"; onError: (message: string) => void
}) {
	const [copied, setCopied] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const request = useRef(0)
	useEffect(() => {
		setCopied(false)
		return () => {
			request.current++
			if (timer.current) clearTimeout(timer.current)
		}
	}, [content])
	const copy = async () => {
		const current = ++request.current
		onError("")
		setCopied(false)
		if (timer.current) clearTimeout(timer.current)
		try {
			await window.robozium.writeClipboardText(content)
			if (current !== request.current) return
			setCopied(true)
			timer.current = setTimeout(() => setCopied(false), 2000)
		} catch {
			if (current === request.current) onError(`Could not copy ${target}. Try again.`)
		}
	}
	return <>
		<HudButton className="hud-footer__copy" disabled={content === ""}
			onClick={() => void copy()} data-copied={copied || undefined}
			aria-label={`Copy ${target}`} title={copied ? "Copied" : `Copy ${target}`}>
			<svg className={`hud-footer__icon${target === "agent output" && !copied ? " hud-footer__icon--reverse" : ""}`}
				viewBox="0 0 24 24" aria-hidden="true">
				{copied ? <path d="m5 12.5 4.25 4.25L19 7" /> : <>
					<rect x="8" y="8" width="11" height="11" rx="1.5" />
					<path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-9A1.5 1.5 0 0 0 4 6.5v9A1.5 1.5 0 0 0 5.5 17H8" />
				</>}
			</svg>
		</HudButton>
		<span className="hud-footer__announcement" role="status">{copied ? `${target === "reply" ? "Reply" : "Agent output"} copied.` : ""}</span>
	</>
}
