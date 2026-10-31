// Plain object checks; the desktop renderer has no zod dependency.

export type AssistantParsedContent = {
	kind: "assistant"
	action: string
	rationale: string
	extra: Record<string, unknown>
}

export type UserParsedContent = {
	kind: "user"
	caller: string
	extra: Record<string, unknown>
}

export type ErrorParsedContent = {
	kind: "error"
	value: string
}

export type SystemParsedContent = {
	kind: "system"
	value: string
}

export type ParsedMessageContent =
	| AssistantParsedContent
	| UserParsedContent
	| ErrorParsedContent
	| SystemParsedContent

export type ContentObject = Record<string, unknown>

/** A JSON object, or undefined for any other content. */
export function parseContentObject(content: string): ContentObject | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return undefined
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
	return parsed as ContentObject
}

export function isAssistantContent(value: ContentObject): value is ContentObject & { action: string; rationale: string } {
	return typeof value.action === "string" && typeof value.rationale === "string"
}

export function isUserContent(value: ContentObject): value is ContentObject & { caller: string } {
	return typeof value.caller === "string"
}
