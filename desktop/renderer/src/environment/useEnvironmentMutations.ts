// Adapted from robozium-electron/desktop/web/hooks/{useEnvironment,useEnvironmentEditor}.ts at 076b2c9.
// This app's writes to the saved settings, one at a time. The draft reads and
// edits them; App passes each write's outcome to it. Requests use the desktop
// client under its lifetime and deadlines, an import has a longer deadline than
// other requests, and the restart flag lasts until the app restarts.
import { useEffect, useRef, useState } from "react"
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { showErrorToast, showNotificationToast } from "../feedback/notices"
import {
	getEnvironment, importEnvironment, IMPORT_TIMEOUT_MS, replaceEnvironmentFile, resetEnvironment, saveEnvironment,
	type EnvironmentEntry, type EnvironmentImportResult, type EnvironmentView,
} from "./environment-api"

type Operation = "save" | "import" | "file" | "reset"

/** Read synchronously by the draft's polling, so no read started before a write is applied after it. */
export interface EnvironmentWrites {
	pending: boolean
	isWriting: () => boolean
	/** Changes when a write starts. */
	version: () => number
}

export interface EnvironmentOutcomes {
	/** A save or key file replaced the saved settings; `next` is read after it. */
	onReplaced: (next: EnvironmentView) => void
	onImported: (result: EnvironmentImportResult) => void
	onReset: () => void
	/** Adopted keys loaded without a restart. */
	onKeysLoaded: () => void
}

export interface EnvironmentMutations extends EnvironmentWrites {
	saving: boolean
	/** A save, import or reset applies only after Restart app. */
	restartRequired: boolean
	save: (password: string, entries: EnvironmentEntry[], revision: string) => Promise<boolean>
	importPackage: (files: File[]) => Promise<boolean>
	/** Resolves to an error to show beside the key file, or null once it is in use. */
	replaceFile: (file: File, password: string, revision: string) => Promise<string | null>
	reset: () => Promise<boolean>
}

export function useEnvironmentMutations(client: DesktopApiClient | null, outcomes: EnvironmentOutcomes): EnvironmentMutations {
	const [operation, setOperation] = useState<Operation | null>(null)
	const [restartRequired, setRestartRequired] = useState(false)
	const lifetime = useClientLifetime(client)
	const writing = useRef(false)
	const version = useRef(0)
	// A new client discards the previous client's write with its lifetime.
	useEffect(() => () => {
		setOperation(null)
		writing.current = false
	}, [client])

	/** Runs one write at a time; an aborted write returns `ignored` without reporting. */
	const run = async <T,>(
		kind: Operation,
		ignored: T,
		write: (client: DesktopApiClient, signal: AbortSignal) => Promise<T>,
		failed: (cause: unknown) => T,
	): Promise<T> => {
		if (!client || writing.current) return ignored
		writing.current = true
		version.current++
		setOperation(kind)
		const signal = lifetime()
		try {
			return await write(client, signal)
		} catch (cause) {
			return signal.aborted ? ignored : failed(cause)
		} finally {
			if (!signal.aborted) {
				writing.current = false
				setOperation(null)
			}
		}
	}
	const failure = (title: string, fallback: string) => (cause: unknown) => {
		showErrorToast({ title, message: cause instanceof Error ? cause.message : fallback })
		return false
	}
	const read = (client: DesktopApiClient, signal: AbortSignal) => withDeadline(signal, requestSignal => getEnvironment(client, requestSignal))

	const save = (password: string, entries: EnvironmentEntry[], revision: string) => run("save", false, async (client, signal) => {
		// Sent once; a conflict or failure keeps the edits for the user to retry.
		await withDeadline(signal, requestSignal => saveEnvironment(client, {
			revision,
			entries: entries.map(({ name, value, secret }) => ({ name, value, secret })),
			password: password || null,
		}, requestSignal))
		const next = await read(client, signal)
		if (signal.aborted) return false
		outcomes.onReplaced(next)
		setRestartRequired(true)
		showNotificationToast({
			tone: "success", title: "Settings saved",
			message: "Use Restart app in Environment, then unlock with Secrets.",
		})
		return true
	}, failure("Could not save settings", "Could not save settings"))

	const importPackage = (files: File[]) => run("import", false, async (client, signal) => {
		const result = await withDeadline(signal, requestSignal => importEnvironment(client, files, requestSignal), IMPORT_TIMEOUT_MS)
		if (signal.aborted) return false
		outcomes.onImported(result)
		setRestartRequired(true)
		const item = result.imported
		showNotificationToast({
			tone: "success", title: "Imported",
			message: `${item.capabilities.map(capability => `${capability.kind === "tool" ? "Tool" : "Skill"} ${capability.name}`).join(", ")} found and imported. Available after restart.`,
		})
		return true
	}, failure("Import failed", "Could not import package"))

	const replaceFile = (file: File, password: string, revision: string) => run<string | null>("file", "", async (client, signal) => {
		// Sent once; a wrong password or a conflict keeps the chosen file for another try.
		const { loaded } = await withDeadline(signal, requestSignal =>
			replaceEnvironmentFile(client, file, revision, password, requestSignal))
		const next = await read(client, signal)
		if (signal.aborted) return ""
		outcomes.onReplaced(next)
		// First-start setup loads the keys at once; later replacements apply after a restart.
		if (!loaded) setRestartRequired(true)
		showNotificationToast(loaded
			? { tone: "success", title: "Keys loaded", message: "Your key file is in use." }
			: { tone: "success", title: "Key file saved", message: "Use Restart app in Environment, then unlock with Secrets." })
		if (loaded) outcomes.onKeysLoaded()
		return null
	}, cause => cause instanceof ApiError && cause.detail ? cause.detail
		: cause instanceof Error ? cause.message : "Could not use the key file")

	const reset = () => run("reset", false, async (client, signal) => {
		await withDeadline(signal, requestSignal => resetEnvironment(client, requestSignal))
		if (signal.aborted) return false
		outcomes.onReset()
		setRestartRequired(true)
		showNotificationToast({
			tone: "success", title: "Environment reset",
			message: "Saved settings and secrets deleted. Enter them again and restart the app.",
		})
		return true
	}, failure("Could not reset settings", "Could not delete saved settings"))

	return {
		pending: operation !== null,
		isWriting: () => writing.current,
		version: () => version.current,
		saving: operation === "save",
		restartRequired,
		save, importPackage, replaceFile, reset,
	}
}
