// The saved settings as read from the backend, with this app's unsaved edits on
// top. This owner never writes: useEnvironmentMutations does, and App passes each
// write's outcome here. Polling runs only while the screen is visible, and a new
// client starts over.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { showErrorToast } from "../feedback/notices"
import { getEnvironment, type EnvironmentEntry, type EnvironmentView } from "./environment-api"
import type { EnvironmentWrites } from "./useEnvironmentMutations"


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

export interface EnvironmentDraft {
	view: EnvironmentView | null
	editable: boolean
	loadFailed: boolean
	/** Why the last read failed; the panel shows it in a toast with Retry. */
	loadError: string | null
	canReset: boolean
	editor: Editor | null
	/** The entries a save sends, including an open edit. */
	currentEntries: EnvironmentEntry[]
	/** The saved entries differ from what the screen shows, including an open edit. */
	dirty: boolean
	needsPassword: boolean
	variables: EnvironmentVariable[]
	openEditor: (entry?: EnvironmentEntry) => void
	closeEditor: () => void
	updateEditor: (entry: EnvironmentEntry) => void
	applyEditor: () => void
	removeVariable: (name: string) => void
	validateSave: () => boolean
	retry: () => void
	/** Write outcomes, passed in by App. */
	replaced: (next: EnvironmentView) => void
	reset: () => void
}

/** Polls every two seconds while `visible`; edits outlive the screen. */
export function useEnvironmentDraft(client: DesktopApiClient, visible: boolean, writes: EnvironmentWrites): EnvironmentDraft {
	const [view, setView] = useState<EnvironmentView | null>(null)
	/** The saved entries, with this app's unsaved changes applied. */
	const [changedEntries, setChangedEntries] = useState<EnvironmentEntry[]>([])
	const [editor, setEditor] = useState<Editor | null>(null)
	const [hiddenSuggestions, setHiddenSuggestions] = useState<Set<string>>(new Set())
	const [loadError, setLoadError] = useState<string | null>(null)
	const loadFailed = loadError !== null
	const lastLoadError = useRef("")
	const [refreshVersion, setRefreshVersion] = useState(0)
	const dirtyRef = useRef(false)
	const editingRef = useRef(false)
	// The write checks read refs, so the first render's functions stay current.
	const writesRef = useRef(writes)

	useEffect(() => { editingRef.current = editor !== null }, [editor])
	useEffect(() => {
		if (!visible) return
		const controller = new AbortController()
		const { isWriting, version: writeVersion } = writesRef.current
		const refresh = async () => {
			if (isWriting()) return
			const version = writeVersion()
			try {
				const next = await withDeadline(controller.signal, signal => getEnvironment(client, signal))
				if (controller.signal.aborted || isWriting() || version !== writeVersion()) return
				const preserve = dirtyRef.current || editingRef.current
				setView(previous => preserve && previous ? { ...next, entries: previous.entries, revision: previous.revision } : next)
				if (!preserve) setChangedEntries(next.entries)
				setLoadError(null)
				const message = next.example_errors.join("\n")
				if (message && lastLoadError.current !== message) {
					showErrorToast({ title: "Could not read environment examples", message })
				}
				lastLoadError.current = message
			} catch (cause) {
				if (!controller.signal.aborted && version === writeVersion()) {
					setLoadError(cause instanceof Error ? cause.message : "Could not load environment settings.")
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
		setLoadError(null)
		dirtyRef.current = false
		lastLoadError.current = ""
	}, [client])

	const editable = Boolean(view?.editable && !writes.pending && !loadFailed)
	const canReset = !writes.pending && (view?.editable ?? loadFailed)
	const newEntry = (name = "", value = "", secret = false): EnvironmentEntry => ({
		name, value, secret, configured: false,
		overridden: view?.overrides.includes(name) ?? false,
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
		...(view?.repositories ?? []).flatMap(repository => repository.packages).filter(item => item.variables.includes(name))
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
	const closeEditor = () => {
		setEditor(null)
	}
	const openEditor = (entry = newEntry()) => {
		if (!editable) return
		setEditor({ originalName: assigned.has(entry.name) ? entry.name : null, original: entry, entry })
	}
	const updateEditor = (entry: EnvironmentEntry) => {
		if (!editor || !editable) return
		setEditor({
			...editor,
			entry: { ...entry, overridden: view?.overrides.includes(entry.name) ?? false },
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

	return {
		view, editable, loadFailed, loadError, canReset,
		editor, currentEntries, dirty, needsPassword,
		variables: [...variables.values()],
		openEditor, closeEditor, updateEditor, applyEditor, removeVariable,
		validateSave: () => !edited || validateEditor(),
		retry: () => { lastLoadError.current = ""; setRefreshVersion(version => version + 1) },
		replaced: next => {
			setView(next)
			setChangedEntries(next.entries)
			dirtyRef.current = false
			closeEditor()
		},
		reset: () => {
			setView(null)
			setChangedEntries([])
			dirtyRef.current = false
			setLoadError(null)
			lastLoadError.current = ""
			closeEditor()
			setHiddenSuggestions(new Set())
			setRefreshVersion(version => version + 1)
		},
	}
}
