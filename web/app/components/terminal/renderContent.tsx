import { Fragment, type ReactNode } from "react"
import {
	StreamLogItemKind,
	type LifecycleLogItem,
	type MessageLogItem,
	type StreamLogItem,
} from "@/lib/robozium/view-model"
import { RunLifecycleKind } from "@/lib/robozium/wire"
import { stringifyValue } from "@/lib/robozium/stream"
import { renderDemoContent } from "./demo"
import { TerminalBanner, bannerRevealText } from "./TerminalBanner"
import { TerminalCursor } from "./TerminalCursor"
import { TerminalEmphasis } from "./TerminalEmphasis"
import { TerminalMessage } from "./TerminalMessage"
import { TerminalTag } from "./TerminalTag"

const MAX_CONTENT_CHARS = 500
const ANGLE_BRACKET_LEFT = "["
const ANGLE_BRACKET_RIGHT = "]"

/**
 * Total character budget for a live log message, across all of its fields. With
 * `white-space: normal` cramming the text, this keeps each message to roughly
 * three lines without a height clip (which would slice the phosphor glow). It's
 * an approximation — exact line count depends on viewport width — but every
 * message stays compact and the glow renders fully. Also bounds the reveal so a
 * huge paste doesn't type far past what's shown.
 */
export const LIVE_MESSAGE_MAX_CHARS = 420
/** Largest amount of a message shown after the user expands a log row. */
export const EXPANDED_MESSAGE_MAX_CHARS = 4_000

export function cleanText(
	s: string,
	limit: number = MAX_CONTENT_CHARS,
): string {
	const substituted = s.replace(
		/<([^>\n]+)>/g,
		(_, inner: string) =>
			`${ANGLE_BRACKET_LEFT}${inner}${ANGLE_BRACKET_RIGHT}`,
	)
	if (substituted.length <= limit) return substituted
	const cap = Math.max(1, limit - 1)
	return `${substituted.slice(0, cap)}…`
}

/**
 * Truncate a message's `extra` entries against a shared character budget so the
 * whole row stays within ~3 lines. Stops once the budget is spent, dropping any
 * remaining entries rather than spilling.
 */
function budgetedExtras(
	extra: Record<string, unknown>,
	budget: number,
): { k: string; v: string }[] {
	const out: { k: string; v: string }[] = []
	for (const [k, v] of Object.entries(extra)) {
		if (budget <= 0) break
		const value = cleanText(
			stringifyValue(v),
			Math.max(1, budget - k.length - 1),
		)
		budget -= value.length + k.length + 1
		out.push({ k, v: value })
	}
	return out
}

function renderMessageContent(
	item: MessageLogItem,
	mode: "live" | "demo",
	maxChars: number = LIVE_MESSAGE_MAX_CHARS,
): ReactNode {
	if (mode === "demo") return renderDemoContent(item)
	if (!item.parsed) return cleanText(item.content, maxChars)

	switch (item.parsed.kind) {
		case "assistant": {
			const action = cleanText(item.parsed.action, maxChars)
			let budget = maxChars - action.length
			const rationale = item.parsed.rationale
				? cleanText(item.parsed.rationale, Math.max(0, budget))
				: ""
			budget -= rationale.length
			const extras = budgetedExtras(item.parsed.extra, budget)
			return (
				<>
					<TerminalTag>{action}</TerminalTag>
					{rationale ? ` ${rationale}` : ""}
					{extras.map(({ k, v }, i) => (
						<Fragment key={`${k}-${i}`}>
							{i === 0 ? " " : "; "}
							<TerminalEmphasis>{k}</TerminalEmphasis>
							{"="}
							{v}
						</Fragment>
					))}
				</>
			)
		}
		case "user": {
			const caller = cleanText(item.parsed.caller, maxChars)
			const extras = budgetedExtras(
				item.parsed.extra,
				maxChars - caller.length,
			)
			return (
				<>
					<TerminalTag>{caller}</TerminalTag>
					{extras.map(({ k, v }, i) => (
						<Fragment key={`${k}-${i}`}>
							{i === 0 ? " " : "; "}
							<TerminalEmphasis>{k}</TerminalEmphasis>
							{"="}
							{v}
						</Fragment>
					))}
				</>
			)
		}
		case "error": {
			return cleanText(item.parsed.value, maxChars)
		}
		case "system":
			return cleanText(item.parsed.value, maxChars)
	}
}

export function messageRevealText(
	item: MessageLogItem,
	maxChars: number = LIVE_MESSAGE_MAX_CHARS,
): string {
	if (!item.parsed) return cleanText(item.content, maxChars)
	switch (item.parsed.kind) {
		case "assistant": {
			const action = cleanText(item.parsed.action, maxChars)
			let budget = maxChars - action.length
			const rationale = item.parsed.rationale
				? cleanText(item.parsed.rationale, Math.max(0, budget))
				: ""
			budget -= rationale.length
			const extras = budgetedExtras(item.parsed.extra, budget)
			return `${action}${rationale ? ` ${rationale}` : ""}${extras
				.map(({ k, v }, i) => `${i === 0 ? " " : "; "}${k}=${v}`)
				.join("")}`
		}
		case "user": {
			const caller = cleanText(item.parsed.caller, maxChars)
			const extras = budgetedExtras(
				item.parsed.extra,
				maxChars - caller.length,
			)
			return `${caller}${extras
				.map(({ k, v }, i) => `${i === 0 ? " " : "; "}${k}=${v}`)
				.join("")}`
		}
		case "error":
		case "system":
			return cleanText(item.parsed.value, maxChars)
	}
}

/** Whether the compact log view omits any of this message's rendered fields. */
export function isMessageTruncated(item: MessageLogItem): boolean {
	return (
		messageRevealText(item, LIVE_MESSAGE_MAX_CHARS) !==
		messageRevealText(item, Number.MAX_SAFE_INTEGER)
	)
}

function lifecycleBannerTitle(item: LifecycleLogItem): string {
	return item.phase === RunLifecycleKind.Stopped
		? "PROCESS STOPPED"
		: "NEW PROCESS"
}

/** Text used as a timing reference for banner typewriter animation. */
export function lifecycleRevealText(item: LifecycleLogItem): string {
	return bannerRevealText(item.agentName, item.details)
}

/** Renders a lifecycle banner with field values progressively revealed. */
export function renderLifecycleWithReveal(
	item: LifecycleLogItem,
	revealChars: number,
): ReactNode {
	return (
		<TerminalBanner
			agentName={item.agentName}
			details={item.details}
			title={lifecycleBannerTitle(item)}
			revealChars={revealChars}
		/>
	)
}

function renderLifecycleContent(item: LifecycleLogItem): ReactNode {
	switch (item.phase) {
		case RunLifecycleKind.Started:
			return (
				<TerminalBanner
					agentName={item.agentName}
					details={item.details}
				/>
			)
		case RunLifecycleKind.Stopped:
			return (
				<TerminalBanner
					agentName={item.agentName}
					details={item.details}
					title="PROCESS STOPPED"
				/>
			)
	}
}

export function renderContent(
	item: StreamLogItem,
	mode: "live" | "demo" = "live",
	showCaret = false,
	messageOptions: MessageRenderOptions = {},
): ReactNode {
	switch (item.kind) {
		case "lifecycle":
			return renderLifecycleContent(item)
		case "message":
			return (
				<TerminalMessage
					role={item.role}
					label={item.label}
					interactive={messageOptions.interactive}
					hoverable={messageOptions.hoverable}
					expanded={messageOptions.expanded}
					onToggle={messageOptions.onToggle}>
					{renderMessageContent(
						item,
						mode,
						messageOptions.maxChars,
					)}
					{showCaret ? <TerminalCursor role={item.role} /> : null}
				</TerminalMessage>
			)
	}
}

type MessageRenderOptions = {
	maxChars?: number
	interactive?: boolean
	hoverable?: boolean
	expanded?: boolean
	onToggle?: () => void
}

/** Per-message reveal options shared by the landing intro and the live log. */
export type RevealOpts = {
	/** Reveal right-to-left (the landing intro alternates direction per row). */
	reversed?: boolean
	/** Keep delayed cascade carets hidden until their row starts. */
	caretVisible?: boolean
	/** Show a blinking caret on the settled message (the live log's newest row). */
	settledCaret?: boolean
	/** Character budget and interaction passed to a settled message row. */
	messageOptions?: MessageRenderOptions
}

/**
 * Settled message: the highlight decoration cross-fades in over a plain,
 * pixel-aligned copy of the same content, so tags / emphasis materialise instead
 * of popping and no glyph moves. Both layers render identical content; `mode`
 * picks the renderer and CSS (`.intro-emph__plain`) strips decoration from the
 * underlay. A settled caret rides the (full-opacity) plain layer so it sits at
 * the end of the text immediately instead of fading in with the rich layer.
 */
function renderSettledMessage(
	message: MessageLogItem,
	mode: "live" | "demo",
	settledCaret: boolean,
	messageOptions: MessageRenderOptions,
): ReactNode {
	const content =
		mode === "demo"
			? renderDemoContent(message)
			: renderMessageContent(message, "live", messageOptions.maxChars)
	return (
		<TerminalMessage
			role={message.role}
			label={message.label}
			interactive={messageOptions.interactive}
			hoverable={messageOptions.hoverable}
			expanded={messageOptions.expanded}
			onToggle={messageOptions.onToggle}>
			<span
				className={
					mode === "live"
						? "intro-emph intro-emph--fast"
						: "intro-emph"
				}>
				<span
					className="intro-emph__plain"
					aria-hidden="true">
					{content}
					{settledCaret ? (
						<TerminalCursor role={message.role} />
					) : null}
				</span>
				<span className="intro-emph__rich">{content}</span>
			</span>
		</TerminalMessage>
	)
}

/**
 * In-progress message: the full reveal text is laid out up front (untyped tail
 * kept in layout but invisible, zero-width caret) so the line wrapping is fixed
 * from the first frame and only the visible character count changes — no reflow.
 */
function renderInProgressMessage(
	message: MessageLogItem,
	revealText: string,
	revealed: number,
	reversed: boolean,
	caretVisible: boolean,
): ReactNode {
	const split = reversed ? revealText.length - revealed : revealed
	const head = revealText.slice(0, split)
	const tail = revealText.slice(split)
	const caret = caretVisible ? (
		<span
			className={
				reversed
					? "term-caret--reveal term-caret--reveal-reversed"
					: "term-caret--reveal"
			}
			aria-hidden="true"
		/>
	) : null
	return (
		<TerminalMessage
			role={message.role}
			label={message.label}>
			{reversed ? (
				<span className="term-reveal-pending">{head}</span>
			) : (
				head
			)}
			{caret}
			{reversed ? (
				tail
			) : (
				<span className="term-reveal-pending">{tail}</span>
			)}
		</TerminalMessage>
	)
}

/**
 * The single per-item reveal mechanism shared by the landing intro
 * (`IntroStream`) and the live stream log (`TerminalStream`): caret reveal over
 * a non-reflowing full layout, then a highlight cross-fade once settled.
 */
export function renderRevealItem(
	item: StreamLogItem,
	revealText: string,
	revealedChars: number,
	mode: "live" | "demo",
	opts: RevealOpts = {},
): ReactNode {
	const revealed = Math.min(revealedChars, revealText.length)
	const settled = revealed >= revealText.length
	if (item.kind === StreamLogItemKind.Lifecycle) {
		return settled
			? renderLifecycleContent(item)
			: renderLifecycleWithReveal(item, revealed)
	}
	return settled
		? renderSettledMessage(
				item,
				mode,
				opts.settledCaret ?? false,
				opts.messageOptions ?? {},
			)
		: renderInProgressMessage(
				item,
				revealText,
				revealed,
				opts.reversed ?? false,
				opts.caretVisible ?? true,
			)
}
