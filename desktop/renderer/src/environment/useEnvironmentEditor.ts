// Copied from robozium-electron/desktop/web/hooks/useEnvironmentEditor.ts at 076b2c9.
// Adapted: the environment owner receives the desktop client; folder import and
// the restart flag arrive with Restart app in a later PR.
import { useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { showErrorToast, showNotificationToast } from "../feedback/notices"
import type { EnvironmentEntry } from "./environment-api"
import { sameEnvironmentEntries, useEnvironment, type EnvironmentState } from "./useEnvironment"

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

export interface EnvironmentEditorState extends EnvironmentState {
	editor: Editor | null
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
	save: (password: string) => Promise<boolean>
}

export function useEnvironmentEditor(client: DesktopApiClient | null, visible: boolean): EnvironmentEditorState {
	const [editor, setEditor] = useState<Editor | null>(null)
	const [hiddenSuggestions, setHiddenSuggestions] = useState<Set<string>>(new Set())
	const environment = useEnvironment(client, visible, editor !== null)
	const { view, entries: savedEntries, editable, change } = environment

	const newEntry = (name = "", value = "", secret = false): EnvironmentEntry => ({
		name, value, secret, configured: false,
		overridden: view?.overrides.includes(name) ?? false,
		startup: startupNames.has(name),
	})
	const assigned = new Map(savedEntries.map(entry => [entry.name, entry]))
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
	const save = async (password: string) => {
		if (!await environment.save(password, currentEntries)) return false
		closeEditor()
		showNotificationToast({
			tone: "success", title: "Settings saved",
			message: "Close and reopen the app, then unlock with Secrets.",
		})
		return true
	}
	const reset = async () => {
		if (!await environment.reset()) return false
		closeEditor()
		setHiddenSuggestions(new Set())
		showNotificationToast({
			tone: "success", title: "Environment reset",
			message: "Saved settings and secrets deleted. Enter them again and restart the app.",
		})
		return true
	}

	return {
		...environment,
		editor, dirty, needsPassword,
		variables: [...variables.values()],
		openEditor, closeEditor, updateEditor, applyEditor, removeVariable,
		validateSave: () => !edited || validateEditor(),
		save, reset,
	}
}
