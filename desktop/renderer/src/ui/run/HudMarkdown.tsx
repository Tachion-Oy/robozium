// Copied from web/app/components/hud/run/HudMarkdown.tsx at 2a0c183.
// Adapted: links open through the desktop bridge instead of navigating; a file
// link names its hub-relative path, and hub images load from the backend.
import type { MouseEvent, ReactNode } from "react"
import { openExternalLink, openHubFile } from "../../links/open-link"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import { resolveHudImageSource } from "../../links/hud-images"
import { HudImage, HudImageLinkContext, HudImageViewer } from "./HudImage"

type HudMarkdownProps = {
	children: string
	className?: string
	/** The backend address of a hub file, for inline images. */
	hubFileUrl?: (path: string) => string
}

type HudRendererProps = {
	children?: ReactNode
	href?: string
	src?: string
	alt?: string
	className?: string
}

type HudHastNode = {
	type?: string
	tagName?: string
	value?: string
	children?: HudHastNode[]
}

const JSON_UNICODE_HEX = /^[0-9a-f]{4}$/i

// Agent HTML is untrusted; only extend the safe defaults for our file links.
const HUD_SANITIZE_SCHEMA = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "file"],
	attributes: {
		...defaultSchema.attributes,
		file: ["src"],
	},
}

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
	"img",
]

function toHubFilePath(src: string): string | null {
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

	return segments.join("/")
}

function isExternalHttpUrl(href: string): boolean {
	try {
		const url = new URL(href)
		return url.protocol === "http:" || url.protocol === "https:"
	} catch {
		return false
	}
}

function transformHudLinkUrl(url: string, key: string, node: HudHastNode): string | null {
	// HudImage resolves the kept source to a hub file or web address.
	if (node.tagName === "img" && key === "src") return resolveHudImageSource(url) ? url : null
	const trimmed = url.trim()

	if (!trimmed) {
		return null
	}

	if (isExternalHttpUrl(trimmed)) {
		return trimmed
	}

	return null
}

/** The window never navigates; main opens the target outside it. */
function opening(open: () => void) {
	return (event: MouseEvent<HTMLAnchorElement>) => {
		event.preventDefault()
		open()
	}
}

function HudFileLink({
	src,
	children,
}: {
	src?: string
	children?: ReactNode
}) {
	const path = src ? toHubFilePath(src) : null
	if (!path) {
		return <>{children}</>
	}

	return (
		<a
			className="agent-hud__markdown-link"
			href={path}
			onClick={opening(() => openHubFile(path))}>
			<HudImageLinkContext value={true}>{children}</HudImageLinkContext>
		</a>
	)
}

const HUD_MARKDOWN_COMPONENTS: Record<
	string,
	(props: HudRendererProps) => ReactNode
> = {
	img: ({ src, alt }) => <HudImage key={src} src={src} alt={alt} />,
	file: ({ children, src }) => (
		<HudFileLink src={src}>{children}</HudFileLink>
	),
	a: ({ children, href }) => {
		if (!href) return <>{children}</>

		return (
			<a
				className="agent-hud__markdown-link"
				href={href}
				onClick={opening(() => openExternalLink(href))}>
				<HudImageLinkContext value={true}>{children}</HudImageLinkContext>
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

export function HudMarkdown({ children, className, hubFileUrl }: HudMarkdownProps) {
	const rootClassName = ["agent-hud__agent", "agent-hud__markdown", className]
		.filter(Boolean)
		.join(" ")
	return (
		<HudImageViewer hubFileUrl={hubFileUrl}>
			<div className={rootClassName}>
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					rehypePlugins={[
						rehypeRaw,
						[rehypeSanitize, HUD_SANITIZE_SCHEMA],
						rehypeDecodeHudUnicodeEscapes,
					]}
					allowedElements={HUD_ALLOWED_ELEMENTS}
					urlTransform={transformHudLinkUrl}
					components={HUD_MARKDOWN_COMPONENTS as never}>
					{children}
				</ReactMarkdown>
			</div>
		</HudImageViewer>
	)
}
