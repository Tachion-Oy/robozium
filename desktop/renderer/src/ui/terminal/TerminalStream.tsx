// The caller supplies the items, and the pane is always readable, so the HUD visibility store is gone.
import { Fragment, memo, useCallback, useEffect, useState } from "react"
import {
	isPromptUserAssistantMessage,
	StreamLogItemKind,
	type StreamLogItem,
} from "../../log/view-model"
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
	items: readonly StreamLogItem[]
}

const REVEAL_CHARS_PER_SECOND = 240

/** Rows per log page. Only the shown page is mounted, so its glow is all a scroll repaints. */
const LOG_PAGE_SIZE = 50

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
	return renderContent(item, "live", {
		maxChars: expanded
			? EXPANDED_MESSAGE_MAX_CHARS
			: LIVE_MESSAGE_MAX_CHARS,
		interactive,
		hoverable: interactive,
		expanded,
		onToggle: interactive ? () => onToggle(index) : undefined,
	})
})

export function TerminalStream({ items }: TerminalStreamProps) {
	const [reveal, setReveal] = useState({ index: -1, chars: 0 })
	const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set())
	// Pages are fixed from the run's first row. Null follows the newest page;
	// a held older page keeps its rows while new ones arrive.
	const [heldPage, setHeldPage] = useState<number | null>(null)
	// Stepping to a newer page starts reading at its top.
	const [topOfPage, setTopOfPage] = useState<number | null>(null)

	const latestRevealIndex = items.length - 1
	const latestRevealItem =
		latestRevealIndex >= 0 ? items[latestRevealIndex] : null
	const latestExpanded =
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
	const pageCount = Math.max(1, Math.ceil(items.length / LOG_PAGE_SIZE))
	const lastPage = pageCount - 1
	const shownPage = heldPage ?? lastPage
	const pageStart = shownPage * LOG_PAGE_SIZE
	const showPage = (next: number) => {
		setHeldPage(next === lastPage ? null : next)
		setTopOfPage(next > shownPage ? next : null)
	}

	const toggleRow = useCallback((index: number) => {
		setExpandedRows((rows) => {
			const next = new Set(rows)
			if (next.has(index)) next.delete(index)
			else next.add(index)
			return next
		})
	}, [])

	return (
		<div className="flex flex-1 min-h-0 w-full flex-col">
			<TerminalLog key={shownPage} clamp enter scrollable startAtTop={topOfPage === shownPage}>
				{items.slice(pageStart, pageStart + LOG_PAGE_SIZE).map((item, offset) => {
					const index = pageStart + offset
					const expanded = expandedRows.has(index)
					const interactive =
						item.kind === StreamLogItemKind.Message && isMessageTruncated(item)
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
			{pageCount > 1 && (
				<nav className="term-log-pager" aria-label="Message log pages">
					<button type="button" className="term-msg-badge" disabled={shownPage === 0} onClick={() => showPage(shownPage - 1)}>
						<span className="term-msg-badge-label">‹ OLDER</span>
					</button>
					<span className="term-log-pager__count">PAGE {shownPage + 1} / {pageCount}</span>
					<button type="button" className="term-msg-badge" disabled={shownPage === lastPage} onClick={() => showPage(shownPage + 1)}>
						<span className="term-msg-badge-label">NEWER ›</span>
					</button>
				</nav>
			)}
		</div>
	)
}
