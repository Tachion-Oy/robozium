import type { ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"

type HudMarkdownProps = {
	children: string
	className?: string
}

type HudRendererProps = {
	children?: ReactNode
	href?: string
	src?: string
	className?: string
}

type HudHastNode = {
	type?: string
	tagName?: string
	value?: string
	children?: HudHastNode[]
}

const JSON_UNICODE_HEX = /^[0-9a-f]{4}$/i

/**
 * Recover Unicode that was escaped twice before reaching the HUD. Only a
 * single literal JSON-style escape is decoded: doubled backslashes and invalid
 * or isolated surrogate escapes remain visible verbatim.
 */
function decodeLiteralJsonUnicodeEscapes(value: string): string {
	let decoded = ""
	let index = 0

	while (index < value.length) {
		if (value[index] !== "\\") {
			decoded += value[index]
			index += 1
			continue
		}

		let slashEnd = index + 1
		while (value[slashEnd] === "\\") slashEnd += 1

		// A doubled (or longer) slash run is authored literal code-like text.
		if (slashEnd - index !== 1) {
			decoded += value.slice(index, slashEnd)
			index = slashEnd
			continue
		}

		const hex = value.slice(index + 2, index + 6)
		if (value[index + 1] !== "u" || !JSON_UNICODE_HEX.test(hex)) {
			decoded += "\\"
			index += 1
			continue
		}

		const codeUnit = Number.parseInt(hex, 16)
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const lowIndex = index + 6
			const lowHex = value.slice(lowIndex + 2, lowIndex + 6)
			const lowCodeUnit = Number.parseInt(lowHex, 16)
			if (
				value[lowIndex] === "\\" &&
				value[lowIndex + 1] === "u" &&
				JSON_UNICODE_HEX.test(lowHex) &&
				lowCodeUnit >= 0xdc00 &&
				lowCodeUnit <= 0xdfff
			) {
				decoded += String.fromCodePoint(
					0x10000 +
						((codeUnit - 0xd800) << 10) +
						(lowCodeUnit - 0xdc00),
				)
				index = lowIndex + 6
				continue
			}
		}

		if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
			decoded += value.slice(index, index + 6)
		} else {
			decoded += String.fromCharCode(codeUnit)
		}
		index += 6
	}

	return decoded
}

function decodeHudProseText(node: HudHastNode, preserveLiteral = false): void {
	const preserveChildren =
		preserveLiteral || node.tagName === "code" || node.tagName === "pre"

	if (node.type === "text" && typeof node.value === "string") {
		if (!preserveLiteral) {
			node.value = decodeLiteralJsonUnicodeEscapes(node.value)
		}
		return
	}

	for (const child of node.children ?? []) {
		decodeHudProseText(child, preserveChildren)
	}
}

function rehypeDecodeHudUnicodeEscapes() {
	return (tree: HudHastNode) => decodeHudProseText(tree)
}

const HUD_ALLOWED_ELEMENTS = [
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"code",
	"pre",
	"strong",
	"em",
	"del",
	"a",
	"blockquote",
	"hr",
	"br",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"file",
]

function toHubFileUrl(src: string): string | null {
	const trimmed = src.trim()
	if (!trimmed || trimmed.startsWith("/")) {
		return null
	}

	const segments = trimmed.split("/")
	if (
		segments.some(
			(segment) => !segment || segment === "." || segment === "..",
		)
	) {
		return null
	}

	return `/api/files/${segments
		.map((segment) => encodeURIComponent(segment))
		.join("/")}`
}

function isExternalHttpUrl(href: string): boolean {
	try {
		const url = new URL(href)
		return url.protocol === "http:" || url.protocol === "https:"
	} catch {
		return false
	}
}

function transformHudLinkUrl(url: string): string | null {
	const trimmed = url.trim()

	if (!trimmed) {
		return null
	}

	if (isExternalHttpUrl(trimmed)) {
		return trimmed
	}

	return null
}

function HudFileLink({
	src,
	children,
}: {
	src?: string
	children?: ReactNode
}) {
	const href = src ? toHubFileUrl(src) : null
	if (!href) {
		return <>{children}</>
	}

	return (
		<a
			className="agent-hud__markdown-link"
			href={href}
			target="_blank"
			rel="noreferrer">
			{children}
		</a>
	)
}

const HUD_MARKDOWN_COMPONENTS: Record<
	string,
	(props: HudRendererProps) => ReactNode
> = {
	file: ({ children, src }) => (
		<HudFileLink src={src}>{children}</HudFileLink>
	),
	a: ({ children, href }) => {
		if (!href) return <>{children}</>

		return (
			<a
				className="agent-hud__markdown-link"
				href={href}
				target="_blank"
				rel="noreferrer">
				{children}
			</a>
		)
	},
	p: ({ children }) => <p className="agent-hud__markdown-p">{children}</p>,
	h1: ({ children }) => <h1 className="agent-hud__markdown-h1">{children}</h1>,
	h2: ({ children }) => <h2 className="agent-hud__markdown-h2">{children}</h2>,
	h3: ({ children }) => <h3 className="agent-hud__markdown-h3">{children}</h3>,
	ul: ({ children }) => <ul className="agent-hud__markdown-ul">{children}</ul>,
	ol: ({ children }) => <ol className="agent-hud__markdown-ol">{children}</ol>,
	li: ({ children }) => <li>{children}</li>,
	code: ({ children, className }) =>
		className ? (
			<code className={className}>{children}</code>
		) : (
			<code className="agent-hud__markdown-inline-code">{children}</code>
		),
	pre: ({ children }) => (
		<pre className="agent-hud__markdown-pre">{children}</pre>
	),
	blockquote: ({ children }) => (
		<blockquote className="agent-hud__markdown-blockquote">
			{children}
		</blockquote>
	),
	table: ({ children }) => (
		<div className="agent-hud__markdown-table-scroll">
			<table className="agent-hud__markdown-table">{children}</table>
		</div>
	),
}

export function HudMarkdown({ children, className }: HudMarkdownProps) {
	const rootClassName = ["agent-hud__agent", "agent-hud__markdown", className]
		.filter(Boolean)
		.join(" ")
	return (
		<div className={rootClassName}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeRaw, rehypeDecodeHudUnicodeEscapes]}
				allowedElements={HUD_ALLOWED_ELEMENTS}
				urlTransform={transformHudLinkUrl}
				components={HUD_MARKDOWN_COMPONENTS as never}>
				{children}
			</ReactMarkdown>
		</div>
	)
}
