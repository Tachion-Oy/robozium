/**
 * Logging for the streaming/concurrency paths, levelled the same way as the
 * backend: anomalies are always visible, the per-frame firehose is opt-in.
 *
 * - `serror` / `swarn` (errors and anomalies/races) always fire, so a failed
 *   cancel, a stream error, or a dropped connection shows up in the wild without
 *   anyone having armed for it first.
 * - `slog` is the high-volume lifecycle/per-frame trace; it's the browser's
 *   equivalent of a DEBUG level and stays off unless enabled with the
 *   `NEXT_PUBLIC_ROBOZIUM_DEBUG=1` build flag or `localStorage["robozium:debug"] = "1"`.
 */

function debugEnabled(): boolean {
	if (process.env.NEXT_PUBLIC_ROBOZIUM_DEBUG === "1") return true
	try {
		return (
			typeof localStorage !== "undefined" &&
			localStorage.getItem("robozium:debug") === "1"
		)
	} catch {
		// localStorage can throw (SSR, privacy modes); treat as disabled.
		return false
	}
}

function format(scope: string, msg: string): string {
	return `[robozium:${scope}] ${msg}`
}

export function slog(scope: string, msg: string, data?: unknown): void {
	if (!debugEnabled()) return
	if (data === undefined) console.log(format(scope, msg))
	else console.log(format(scope, msg), data)
}

export function swarn(scope: string, msg: string, data?: unknown): void {
	if (data === undefined) console.warn(format(scope, msg))
	else console.warn(format(scope, msg), data)
}

export function serror(scope: string, msg: string, data?: unknown): void {
	if (data === undefined) console.error(format(scope, msg))
	else console.error(format(scope, msg), data)
}
