// Validate decoded backend payloads against each module's schema. Transport stays in client.ts.
import { z } from "zod"
import { ApiError } from "./client"

// Zod would otherwise probe `new Function`, which the renderer's CSP blocks and reports as a violation.
z.config({ jitless: true })

/** A string with at least one non-whitespace character. */
export const nonBlank = z.string().refine(text => text.trim() !== "")

/** An absent or null field, read as null. */
export const orNull = <T>(schema: z.ZodType<T>): z.ZodType<T | null> => schema.nullish().transform(value => value ?? null)

/** Validate a decoded payload; any mismatch is reported as `message`. */
export function parsePayload<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
	const result = schema.safeParse(value)
	if (!result.success) throw new ApiError("malformed", message)
	return result.data
}
