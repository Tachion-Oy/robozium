// Copied from robozium-electron/desktop/web/hooks/{useEnvironment,useEnvironmentEditor}.ts at 076b2c9.
// Adapted: one owner for the screen's settings, requests and edits. Requests use
// the desktop client under its lifetime and deadlines, a new client starts over,
// polling runs only while the screen is visible, an import has a longer deadline
// than other requests, and the restart flag is this hook's state instead of a
// global store; App owns the hook, so the flag lasts until the app restarts.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { showErrorToast, showNotificationToast } from "../feedback/notices"
import {
	getEnvironment, importEnvironment, IMPORT_TIMEOUT_MS, replaceEnvironmentFile, resetEnvironment, saveEnvironment,
	type EnvironmentEntry, type EnvironmentView,
} from "./environment-api"

const startupNames = new Set(["ROBOZIUM_HUB_ROOT", "ROBOZIUM_WEB_PORT"])

export type Editor = {
	originalName: string | null
	original: EnvironmentEntry
	entry: EnvironmentEntry
}

export type EnvironmentVariable = {
	entry: EnvironmentEntry
	assigned: boolean
	sources: string[]
}

function sameEnvironmentEntries(left: EnvironmentEntry[], right: EnvironmentEntry[]): boolean {
	if (left.length !== right.length) return false
	const previous = new Map(right.map(entry => [entry.name, entry]))
	return left.every(entry => {
		const other = previous.get(entry.name)
		previous.delete(entry.name)
		return other !== undefined && entry.value === other.value && entry.secret === other.secret
	})
}

function replaceEntry(entries: EnvironmentEntry[], editor: Editor): EnvironmentEntry[] {
	if (editor.originalName === null) return [...entries, editor.entry]
	return entries.map(entry => entry.name === editor.originalName ? editor.entry : entry)
}

function entryError({ entry, original, originalName }: Editor, entries: EnvironmentEntry[]): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name) || /_ENCRYPTED$/i.test(entry.name)) {
		return "Use a variable name without the reserved _ENCRYPTED suffix."
	}
	if (entries.some(row => row.name !== originalName && row.name === entry.name)) {
		return "Variable names must be unique."
	}
	if (original.secret && original.value === null && entry.value === null) {
		if (!entry.secret) return "Enter a replacement value to make a secret public."
		if (entry.name !== original.name) return "Enter a replacement value to rename a secret."
	}
	return ""
}

export interface EnvironmentEditorState {
	view: EnvironmentView | null
	editable: boolean
	loadFailed: boolean
	canReset: boolean
	saving: boolean
	editor: Editor | null
	/** The saved entries differ from what the screen shows, including an open edit. */
	dirty: boolean
	needsPassword: boolean
	/** A save, import or reset applies only after Restart app. */
	restartRequired: boolean
	variables: EnvironmentVariable[]
	openEditor: (entry?: EnvironmentEntry) => void
	closeEditor: () => void
	updateEditor: (entry: EnvironmentEntry) => void
	applyEditor: () => void
	removeVariable: (name: string) => void
	importPackage: (files: File[]) => Promise<boolean>
	/** Resolves to an error to show beside the key file, or null once it is in use. */
	replaceFile: (file: File, password: string) => Promise<string | null>
	validateSave: () => boolean
	save: (password: string) => Promise<boolean>
	reset: () => Promise<boolean>
	retry: () => void
}

/**
 * Polls every two seconds while `visible`; edits and results outlive the screen.
 * `onKeysLoaded` runs when adopted keys load without a restart, so App can refresh the secrets status.
 */
export function useEnvironmentEditor(client: DesktopApiClient | null, visible: boolean, onKeysLoaded: () => void): EnvironmentEditorState {
	const [view, setView] = useState<EnvironmentView | null>(null)
	/** The saved entries, with this app's unsaved changes applied. */
	const [changedEntries, setChangedEntries] = useState<EnvironmentEntry[]>([])
	const [editor, setEditor] = useState<Editor | null>(null)
	const [hiddenSuggestions, setHiddenSuggestions] = useState<Set<string>>(new Set())
	const [restartRequired, setRestartRequired] = useState(false)
	const [operation, setOperation] = useState<"save" | "import" | "file" | "reset" | null>(null)
	const pending = operation !== null
	const [loadFailed, setLoadFailed] = useState(false)
	const lastLoadError = useRef("")
	const [refreshVersion, setRefreshVersion] = useState(0)
	const lifetime = useClientLifetime(client)
	const dirtyRef = useRef(false)
	const pendingRef = useRef(false)
	const editingRef = useRef(false)
	const saveVersion = useRef(0)

	useEffect(() => { editingRef.current = editor !== null }, [editor])
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
				if (!preserve) setChangedEntries(next.entries)
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
		setChangedEntries([])
		setLoadFailed(false)
		setOperation(null)
		dirtyRef.current = false
		pendingRef.current = false
		lastLoadError.current = ""
	}, [client])

	const editable = Boolean(view?.editable && !pending && !loadFailed)
	const canReset = !pending && (view?.editable ?? loadFailed)
	const newEntry = (name = "", value = "", secret = false): EnvironmentEntry => ({
		name, value, secret, configured: false,
		overridden: view?.overrides.includes(name) ?? false,
		startup: startupNames.has(name),
	})
	const assigned = new Map(changedEntries.map(entry => [entry.name, entry]))
	for (const suggestion of view?.suggestions ?? []) {
		if (suggestion.value !== "" && !assigned.has(suggestion.name)
			&& !hiddenSuggestions.has(suggestion.name) && !view?.overrides.includes(suggestion.name)) {
			assigned.set(suggestion.name, newEntry(suggestion.name, suggestion.value, suggestion.secret))
		}
	}
	const entries = [...assigned.values()]
	const edited = editor !== null && !sameEnvironmentEntries([editor.entry], [editor.original])
	const currentEntries = edited ? replaceEntry(entries, editor) : entries
	const dirty = Boolean(view && !sameEnvironmentEntries(currentEntries, view.entries))
	const needsPassword = Boolean(view?.requires_password || currentEntries.some(entry => entry.secret))
	const sources = (name: string) => [...new Set([
		...(view?.suggestions.some(item => item.name === name && item.source === "Application") ? ["required"] : []),
		...(view?.imports ?? []).filter(item => item.variables.includes(name))
			.flatMap(item => item.capabilities.map(capability => capability.name)),
	])]
	const variables = new Map<string, EnvironmentVariable>()
	for (const suggestion of view?.suggestions ?? []) {
		if (variables.has(suggestion.name)) continue
		const entry = assigned.get(suggestion.name)
		if (!entry && hiddenSuggestions.has(suggestion.name)) continue
		variables.set(suggestion.name, {
			entry: entry ?? newEntry(suggestion.name, suggestion.value, suggestion.secret),
			assigned: entry !== undefined,
			sources: sources(suggestion.name),
		})
	}
	for (const entry of entries) variables.set(entry.name, { entry, assigned: true, sources: sources(entry.name) })

	const change = (next: EnvironmentEntry[]) => {
		if (!editable) return
		dirtyRef.current = !sameEnvironmentEntries(next, view?.entries ?? [])
		setChangedEntries(next)
	}
	/** Runs one write at a time; an aborted write returns `ignored` without reporting. */
	const run = async <T,>(
		kind: NonNullable<typeof operation>,
		ignored: T,
		write: (signal: AbortSignal) => Promise<T>,
		failed: (cause: unknown) => T,
	): Promise<T> => {
		pendingRef.current = true
		saveVersion.current++
		setOperation(kind)
		const signal = lifetime()
		try {
			return await write(signal)
		} catch (cause) {
			return signal.aborted ? ignored : failed(cause)
		} finally {
			if (!signal.aborted) {
				pendingRef.current = false
				setOperation(null)
			}
		}
	}
	/** Reloads the saved settings after a write, discarding this app's edits. */
	const reload = async (signal: AbortSignal) => {
		const next = await withDeadline(signal, requestSignal => getEnvironment(client!, requestSignal))
		if (signal.aborted) return false
		setView(next)
		setChangedEntries(next.entries)
		dirtyRef.current = false
		return true
	}
	const failure = (title: string, fallback: string) => (cause: unknown) => {
		showErrorToast({ title, message: cause instanceof Error ? cause.message : fallback })
		return false
	}

	const closeEditor = () => {
		setEditor(null)
	}
	const openEditor = (entry = newEntry()) => {
		if (!editable) return
		setEditor({ originalName: assigned.has(entry.name) ? entry.name : null, original: entry, entry })
	}
	const updateEditor = (entry: EnvironmentEntry) => {
		if (!editor || !editable) return
		const startup = startupNames.has(entry.name)
		setEditor({
			...editor,
			entry: { ...entry, startup, secret: !startup && entry.secret, overridden: view?.overrides.includes(entry.name) ?? false },
		})
	}
	const validateEditor = () => {
		const message = editor ? entryError(editor, entries) : ""
		if (message) showErrorToast({ title: "Invalid variable", message })
		return !message
	}
	const revealSuggestions = (names: Set<string>) => {
		setHiddenSuggestions(previous => new Set([...previous].filter(name => !names.has(name))))
	}
	const applyEditor = () => {
		if (!editor || !editable || !validateEditor()) return
		change(replaceEntry(entries, editor))
		revealSuggestions(new Set([editor.entry.name]))
		closeEditor()
	}
	const removeVariable = (name: string) => {
		if (!editable) return
		if (assigned.has(name)) change(entries.filter(entry => entry.name !== name))
		setHiddenSuggestions(previous => new Set(previous).add(name))
		if (editor?.original.name === name) closeEditor()
	}
	const importPackage = async (files: File[]): Promise<boolean> => {
		if (!client || !editable || pendingRef.current) return false
		return run("import", false, async signal => {
			const result = await withDeadline(signal, requestSignal => importEnvironment(client, files, requestSignal), IMPORT_TIMEOUT_MS)
			if (signal.aborted) return false
			setView(previous => previous && {
				...previous,
				imports: [...previous.imports.filter(item => item.name !== result.imported.name), result.imported],
				suggestions: [...previous.suggestions.filter(item => item.source !== result.imported.name), ...result.suggestions],
			})
			revealSuggestions(new Set(result.suggestions.map(entry => entry.name)))
			setRestartRequired(true)
			const item = result.imported
			showNotificationToast({
				tone: "success", title: "Imported",
				message: `${item.capabilities.map(capability => `${capability.kind === "tool" ? "Tool" : "Skill"} ${capability.name}`).join(", ")} found and imported. Available after restart.`,
			})
			return true
		}, failure("Import failed", "Could not import package"))
	}
	const replaceFile = async (file: File, password: string): Promise<string | null> => {
		if (!client || !view || !editable || pendingRef.current) return "Settings cannot be changed right now."
		return run("file", "", async signal => {
			// Sent once; a wrong password or a conflict keeps the chosen file for another try.
			const { loaded } = await withDeadline(signal, requestSignal =>
				replaceEnvironmentFile(client, file, view.revision, password, requestSignal))
			if (!await reload(signal)) return ""
			closeEditor()
			// First-start setup loads the keys at once; later replacements apply after a restart.
			if (!loaded) setRestartRequired(true)
			showNotificationToast(loaded
				? { tone: "success", title: "Keys loaded", message: "Your key file is in use." }
				: { tone: "success", title: "Key file saved", message: "Use Restart app in Environment, then unlock with Secrets." })
			if (loaded) onKeysLoaded()
			return null
		}, cause => cause instanceof Error ? cause.message : "Could not use the key file")
	}
	const save = async (password: string): Promise<boolean> => {
		if (!client || !view || !editable || pendingRef.current) return false
		return run("save", false, async signal => {
			// Sent once; a conflict or failure keeps the edits for the user to retry.
			await withDeadline(signal, requestSignal => saveEnvironment(client, {
				revision: view.revision,
				entries: currentEntries.map(({ name, value, secret }) => ({ name, value, secret })),
				password: password || null,
			}, requestSignal))
			if (!await reload(signal)) return false
			setRestartRequired(true)
			closeEditor()
			showNotificationToast({
				tone: "success", title: "Settings saved",
				message: "Use Restart app in Environment, then unlock with Secrets.",
			})
			return true
		}, failure("Could not save settings", "Could not save settings"))
	}
	const reset = async (): Promise<boolean> => {
		if (!client || !canReset || pendingRef.current) return false
		return run("reset", false, async signal => {
			await withDeadline(signal, requestSignal => resetEnvironment(client, requestSignal))
			if (signal.aborted) return false
			setView(null)
			setChangedEntries([])
			dirtyRef.current = false
			setLoadFailed(false)
			lastLoadError.current = ""
			setRefreshVersion(version => version + 1)
			setRestartRequired(true)
			closeEditor()
			setHiddenSuggestions(new Set())
			showNotificationToast({
				tone: "success", title: "Environment reset",
				message: "Saved settings and secrets deleted. Enter them again and restart the app.",
			})
			return true
		}, failure("Could not reset settings", "Could not delete saved settings"))
	}

	return {
		view, editable, loadFailed, canReset, saving: operation === "save",
		editor, dirty, needsPassword, restartRequired,
		variables: [...variables.values()],
		openEditor, closeEditor, updateEditor, applyEditor, removeVariable, importPackage, replaceFile,
		validateSave: () => !edited || validateEditor(),
		save, reset,
		retry: () => { lastLoadError.current = ""; setRefreshVersion(version => version + 1) },
	}
}
