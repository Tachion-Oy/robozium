"use client"

import { Fragment, memo, useCallback, useEffect, useState } from "react"
import { useStore } from "zustand"
import { useRunSessionSelector } from "@/hooks/useRunSession"
import { hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import {
	isPromptUserAssistantMessage,
	StreamLogItemKind,
	type MessageLogItem,
	type StreamLogItem,
} from "@/lib/robozium/view-model"
import { TerminalLog } from "./TerminalLog"
import {
	EXPANDED_MESSAGE_MAX_CHARS,
	LIVE_MESSAGE_MAX_CHARS,
	isMessageTruncated,
	lifecycleRevealText,
	messageRevealText,
	renderContent,
	renderRevealItem,
} from "./renderContent"

type TerminalStreamProps = {
	items?: StreamLogItem[]
}

const REVEAL_CHARS_PER_SECOND = 240

type TerminalStreamRowProps = {
	item: StreamLogItem
	index: number
	expanded: boolean
	interactive: boolean
	onToggle: (index: number) => void
}

/** Settled rows do not need to re-render for every frame of the live row. */
const TerminalStreamRow = memo(function TerminalStreamRow({
	item,
	index,
	expanded,
	interactive,
	onToggle,
}: TerminalStreamRowProps) {
	return renderContent(item, "live", false, {
		maxChars: expanded
			? EXPANDED_MESSAGE_MAX_CHARS
			: LIVE_MESSAGE_MAX_CHARS,
		interactive,
		hoverable: interactive,
		expanded,
		onToggle: interactive ? () => onToggle(index) : undefined,
	})
})

/** Flat text of a message item, used as the typewriter timing reference. */
export function getRevealText(item: MessageLogItem): string {
	return messageRevealText(item)
}

export function TerminalStream({ items: providedItems }: TerminalStreamProps) {
	const items = useRunSessionSelector(
		(state) => state.log.items,
		providedItems ?? [],
	)
	const [reveal, setReveal] = useState({ index: -1, chars: 0 })
	const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set())
	// The transcript becomes scrollable whenever the run HUD or recovery matrix
	// is minimized. Landing content has no run overlay and remains scrollable.
	const scrollable = useStore(
		hudVisibilityStore,
		(state) => !state.open || !state.runActive,
	)
	const hudDismissed = useStore(hudVisibilityStore, (state) => !state.open)
	// Messages become interactive only after the overlay has been minimized.
	const messagesInteractive = scrollable && hudDismissed

	useEffect(() => {
		return hudVisibilityStore.subscribe((state, previousState) => {
			if (state.open && !previousState.open) setExpandedRows(new Set())
		})
	}, [])

	const latestRevealIndex = items.length - 1
	const latestRevealItem =
		latestRevealIndex >= 0 ? items[latestRevealIndex] : null
	const latestExpanded =
		messagesInteractive &&
		latestRevealItem?.kind === StreamLogItemKind.Message &&
		expandedRows.has(latestRevealIndex)
	const latestMessageMaxChars = latestExpanded
		? EXPANDED_MESSAGE_MAX_CHARS
		: LIVE_MESSAGE_MAX_CHARS
	const latestRevealText = latestRevealItem
		? latestRevealItem.kind === StreamLogItemKind.Lifecycle
			? lifecycleRevealText(latestRevealItem)
			: messageRevealText(latestRevealItem, latestMessageMaxChars)
		: ""
	const latestRevealChars = latestRevealText.length
	const skipTypewriterReveal =
		latestRevealItem?.kind === StreamLogItemKind.Message &&
		isPromptUserAssistantMessage(latestRevealItem)

	useEffect(() => {
		if (
			skipTypewriterReveal ||
			latestRevealIndex < 0 ||
			latestRevealChars <= 0
		) {
			return
		}
		const t0 = performance.now()
		let frameId = 0
		const step = (now: number) => {
			const chars = Math.min(
				latestRevealChars,
				Math.floor(((now - t0) * REVEAL_CHARS_PER_SECOND) / 1000),
			)
			setReveal({ index: latestRevealIndex, chars })
			if (chars < latestRevealChars) frameId = requestAnimationFrame(step)
		}
		frameId = requestAnimationFrame(step)
		return () => cancelAnimationFrame(frameId)
	}, [latestRevealIndex, latestRevealChars, skipTypewriterReveal])

	const revealChars = skipTypewriterReveal
		? latestRevealChars
		: reveal.index === latestRevealIndex
			? reveal.chars
			: 0
	const toggleRow = useCallback((index: number) => {
		setExpandedRows((rows) => {
			const next = new Set(rows)
			if (next.has(index)) next.delete(index)
			else next.add(index)
			return next
		})
	}, [])

	return (
		<TerminalLog clamp enter scrollable={scrollable}>
			{items.map((item, index) => {
				const expanded = messagesInteractive && expandedRows.has(index)
				const interactive = Boolean(
					messagesInteractive &&
					item.kind === StreamLogItemKind.Message &&
					isMessageTruncated(item),
				)
				const messageOptions = {
					maxChars: expanded
						? EXPANDED_MESSAGE_MAX_CHARS
						: LIVE_MESSAGE_MAX_CHARS,
					interactive,
					// Only rows that can actually open advertise hover affordance.
					hoverable: interactive,
					expanded,
					onToggle: interactive ? () => toggleRow(index) : undefined,
				}
				if (index === latestRevealIndex && latestRevealItem) {
					return (
						<Fragment key={index}>
							{renderRevealItem(
								item,
								latestRevealText,
								revealChars,
								"live",
								{
									settledCaret:
										item.kind === StreamLogItemKind.Message,
									messageOptions,
								},
							)}
						</Fragment>
					)
				}
				return (
					<TerminalStreamRow
						key={index}
						item={item}
						index={index}
						expanded={expanded}
						interactive={interactive}
						onToggle={toggleRow}
					/>
				)
			})}
		</TerminalLog>
	)
}
