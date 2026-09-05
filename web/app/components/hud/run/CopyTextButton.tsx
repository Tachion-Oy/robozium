"use client"

import { useEffect, useRef, useState } from "react"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"

export type CopyTextButtonProps = {
	copyKey: string
	content: string
	target: "agent output" | "user reply"
	reverseIcon?: boolean
}

export function CopyTextButton({
	copyKey,
	content,
	target,
	reverseIcon = false,
}: CopyTextButtonProps) {
	const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
	const [copiedKey, setCopiedKey] = useState<string | null>(null)
	const isCopied = copiedKey === copyKey
	const targetLabel = target === "agent output" ? "Agent output" : "User reply"

	useEffect(() => {
		return () => {
			if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
		}
	}, [])

	const handleCopy = async () => {
		if (!content) return

		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error("Clipboard API unavailable")
			}
			await navigator.clipboard.writeText(content)
			if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
			setCopiedKey(copyKey)
			copiedTimerRef.current = setTimeout(() => {
				setCopiedKey((current) =>
					current === copyKey ? null : current,
				)
			}, 2000)
		} catch {
			showErrorToast({
				title: "Copy failed",
				message: `Could not copy the ${target}.`,
				detail: "Check your browser clipboard permissions and try again.",
			})
		}
	}

	return (
		<button
			type="button"
			className="agent-hud__copy-text"
			onClick={() => void handleCopy()}
			disabled={!content}
			data-copied={isCopied || undefined}
			aria-label={isCopied ? `${targetLabel} copied` : `Copy ${target}`}
			title={isCopied ? `${targetLabel} copied` : `Copy ${target}`}>
			{isCopied ? (
				<svg
					className="agent-hud__copy-text-icon"
					viewBox="0 0 24 24"
					aria-hidden="true">
					<path d="m5 12.5 4.25 4.25L19 7" />
				</svg>
			) : (
				<svg
					className={`agent-hud__copy-text-icon${
						reverseIcon ? " agent-hud__copy-text-icon--reverse" : ""
					}`}
					viewBox="0 0 24 24"
					aria-hidden="true">
					<rect
						x="8"
						y="8"
						width="11"
						height="11"
						rx="1.5"
					/>
					<path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-9A1.5 1.5 0 0 0 4 6.5v9A1.5 1.5 0 0 0 5.5 17H8" />
				</svg>
			)}
		</button>
	)
}
