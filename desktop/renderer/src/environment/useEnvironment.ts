// Copied from robozium-electron/desktop/web/hooks/useEnvironment.ts at 076b2c9.
// Adapted: requests use the desktop client under its lifetime and deadlines, a
// new client starts over, polling runs only while the screen is visible, and an
// import has a longer deadline than other requests.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { showErrorToast } from "../feedback/notices"
import {
	getEnvironment, importEnvironment, IMPORT_TIMEOUT_MS, replaceEnvironmentFile, resetEnvironment, saveEnvironment,
	type EnvironmentEntry, type EnvironmentImportResult, type EnvironmentView,
} from "./environment-api"

export function sameEnvironmentEntries(left: EnvironmentEntry[], right: EnvironmentEntry[]): boolean {
	if (left.length !== right.length) return false
	const previous = new Map(right.map(entry => [entry.name, entry]))
	return left.every(entry => {
		const other = previous.get(entry.name)
		previous.delete(entry.name)
		return other !== undefined && entry.value === other.value && entry.secret === other.secret
	})
}

export interface EnvironmentState {
	view: EnvironmentView | null
	/** The saved entries, with this app's unsaved changes applied. */
	entries: EnvironmentEntry[]
	editable: boolean
	pending: boolean
	loadFailed: boolean
	canReset: boolean
	saving: boolean
	change: (next: EnvironmentEntry[]) => void
	save: (password: string, nextEntries?: EnvironmentEntry[]) => Promise<boolean>
	importPackage: (files: File[]) => Promise<EnvironmentImportResult | null>
	/** Adopt a key file; failures are returned for the row to show, not raised as toasts. */
	replaceFile: (file: File, password: string) => Promise<{ loaded: boolean } | { error: string }>
	reset: () => Promise<boolean>
	retry: () => void
}

/** Polls every two seconds while `visible`; edits and results outlive the screen. */
export function useEnvironment(client: DesktopApiClient | null, visible: boolean, editing: boolean): EnvironmentState {
	const [view, setView] = useState<EnvironmentView | null>(null)
	const [entries, setEntries] = useState<EnvironmentEntry[]>([])
	const [operation, setOperation] = useState<"save" | "import" | "file" | "reset" | null>(null)
	const pending = operation !== null
	const [loadFailed, setLoadFailed] = useState(false)
	const lastLoadError = useRef("")
	const [refreshVersion, setRefreshVersion] = useState(0)
	const lifetime = useClientLifetime(client)
	const dirtyRef = useRef(false)
	const pendingRef = useRef(false)
	const editingRef = useRef(editing)
	const saveVersion = useRef(0)

	useEffect(() => { editingRef.current = editing }, [editing])
	useEffect(() => {
		if (!client || !visible) return
		const controller = new AbortController()
		const refresh = async () => {
			if (pendingRef.current) return
			const version = saveVersion.current
			try {
				const next = await withDeadline(controller.signal, signal => getEnvironment(client, signal))
				if (controller.signal.aborted || pendingRef.current || version !== saveVersion.current) return
				const preserve = dirtyRef.current || editingRef.current
				setView(previous => preserve && previous ? { ...next, entries: previous.entries, revision: previous.revision } : next)
				if (!preserve) setEntries(next.entries)
				setLoadFailed(false)
				const message = next.example_errors.join("\n")
				if (message && lastLoadError.current !== message) {
					showErrorToast({ title: "Could not read environment examples", message })
				}
				lastLoadError.current = message
			} catch (cause) {
				if (!controller.signal.aborted && version === saveVersion.current) {
					setLoadFailed(true)
					const message = cause instanceof Error ? cause.message : "Could not load environment settings."
					if (lastLoadError.current !== message) showErrorToast({ title: "Could not load settings", message })
					lastLoadError.current = message
				}
			}
		}
		void refresh()
		const timer = window.setInterval(() => void refresh(), 2000)
		return () => {
			controller.abort()
			window.clearInterval(timer)
		}
	}, [client, visible, refreshVersion])
	// A new client starts from its own settings, discarding the previous client's edits.
	useEffect(() => () => {
		setView(null)
		setEntries([])
		setLoadFailed(false)
		setOperation(null)
		dirtyRef.current = false
		pendingRef.current = false
		lastLoadError.current = ""
	}, [client])

	const editable = Boolean(view?.editable && !pending && !loadFailed)
	const canReset = !pending && (view?.editable ?? loadFailed)
	const change = (next: EnvironmentEntry[]) => {
		if (!editable) return
		dirtyRef.current = !sameEnvironmentEntries(next, view?.entries ?? [])
		setEntries(next)
	}
	const importPackage = async (files: File[]): Promise<EnvironmentImportResult | null> => {
		if (!client || !editable || pendingRef.current) return null
		pendingRef.current = true
		saveVersion.current++
		setOperation("import")
		const signal = lifetime()
		try {
			const result = await withDeadline(signal, requestSignal => importEnvironment(client, files, requestSignal), IMPORT_TIMEOUT_MS)
			if (signal.aborted) return null
			setView(previous => previous && {
				...previous,
				imports: [...previous.imports.filter(item => item.name !== result.imported.name), result.imported],
				suggestions: [...previous.suggestions.filter(item => item.source !== result.imported.name), ...result.suggestions],
			})
			return result
		} catch (cause) {
			if (!signal.aborted) showErrorToast({
				title: "Import failed",
				message: cause instanceof Error ? cause.message : "Could not import package",
			})
			return null
		} finally {
			if (!signal.aborted) {
				pendingRef.current = false
				setOperation(null)
			}
		}
	}
	const save = async (password: string, nextEntries = entries): Promise<boolean> => {
		if (!client || !view || !editable || pendingRef.current) return false
		pendingRef.current = true
		saveVersion.current++
		setOperation("save")
		const signal = lifetime()
		try {
			// Sent once; a conflict or failure keeps the edits for the user to retry.
			await withDeadline(signal, requestSignal => saveEnvironment(client, {
				revision: view.revision,
				entries: nextEntries.map(({ name, value, secret }) => ({ name, value, secret })),
				password: password || null,
			}, requestSignal))
			const next = await withDeadline(signal, requestSignal => getEnvironment(client, requestSignal))
			if (signal.aborted) return false
			setView(next)
			setEntries(next.entries)
			dirtyRef.current = false
			return true
		} catch (cause) {
			if (!signal.aborted) showErrorToast({
				title: "Could not save settings",
				message: cause instanceof Error ? cause.message : "Could not save settings",
			})
			return false
		} finally {
			if (!signal.aborted) {
				pendingRef.current = false
				setOperation(null)
			}
		}
	}
	const replaceFile = async (file: File, password: string): Promise<{ loaded: boolean } | { error: string }> => {
		if (!client || !view || !editable || pendingRef.current) return { error: "Settings cannot be changed right now." }
		pendingRef.current = true
		saveVersion.current++
		setOperation("file")
		const signal = lifetime()
		try {
			// Sent once; a wrong password or a conflict keeps the chosen file for another try.
			const result = await withDeadline(signal, requestSignal =>
				replaceEnvironmentFile(client, file, view.revision, password, requestSignal))
			const next = await withDeadline(signal, requestSignal => getEnvironment(client, requestSignal))
			if (signal.aborted) return { error: "" }
			setView(next)
			setEntries(next.entries)
			dirtyRef.current = false
			return result
		} catch (cause) {
			return { error: signal.aborted ? "" : cause instanceof Error ? cause.message : "Could not use the key file" }
		} finally {
			if (!signal.aborted) {
				pendingRef.current = false
				setOperation(null)
			}
		}
	}
	const reset = async (): Promise<boolean> => {
		if (!client || !canReset || pendingRef.current) return false
		pendingRef.current = true
		saveVersion.current++
		setOperation("reset")
		const signal = lifetime()
		try {
			await withDeadline(signal, requestSignal => resetEnvironment(client, requestSignal))
			if (signal.aborted) return false
			setView(null)
			setEntries([])
			dirtyRef.current = false
			setLoadFailed(false)
			lastLoadError.current = ""
			setRefreshVersion(version => version + 1)
			return true
		} catch (cause) {
			if (!signal.aborted) showErrorToast({
				title: "Could not reset settings",
				message: cause instanceof Error ? cause.message : "Could not delete saved settings",
			})
			return false
		} finally {
			if (!signal.aborted) {
				pendingRef.current = false
				setOperation(null)
			}
		}
	}
	return { view, entries, editable, pending, loadFailed, change, save, importPackage, replaceFile, reset, canReset, saving: operation === "save",
		retry: () => { lastLoadError.current = ""; setRefreshVersion(version => version + 1) },
	}
}
