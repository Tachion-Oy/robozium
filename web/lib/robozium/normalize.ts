import { z } from "zod"

/**
 * Internal normalization types/parsers derived from validated wire payloads.
 */

export const zAssistantContentObject = z
	.object({
		action: z.string(),
		rationale: z.string(),
	})
	.catchall(z.unknown())

export const zUserContentObject = z
	.object({
		caller: z.string(),
	})
	.catchall(z.unknown())

export const zUserKindContentObject = z
	.object({
		kind: z.string(),
	})
	.catchall(z.unknown())

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
