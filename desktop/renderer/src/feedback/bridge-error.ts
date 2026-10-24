/** Main's own message from a rejected desktop bridge call; Electron prefixes IPC rejections. */
export function bridgeErrorMessage(error: unknown): string | null {
	return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "") : null
}
