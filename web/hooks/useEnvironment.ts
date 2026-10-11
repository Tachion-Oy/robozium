"use client"

import { useEffect, useRef, useState } from "react"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { getEnvironment, importEnvironmentPackage, resetEnvironment, saveEnvironment } from "@/lib/robozium/client"
import type { EnvironmentEntry, EnvironmentImportResult, EnvironmentView } from "@/lib/robozium/wire"

export function sameEnvironmentEntries(left: EnvironmentEntry[], right: EnvironmentEntry[]): boolean {
	if (left.length !== right.length) return false
	const previous = new Map(right.map(entry => [entry.name, entry]))
	return left.every(entry => {
		const other = previous.get(entry.name)
		previous.delete(entry.name)
		return other !== undefined && entry.value === other.value && entry.secret === other.secret
	})
}

export function useEnvironment(editing: boolean) {
	const [view, setView] = useState<EnvironmentView | null>(null)
	const [entries, setEntries] = useState<EnvironmentEntry[]>([])
	const [operation, setOperation] = useState<"save" | "import" | "reset" | null>(null)
	const pending = operation !== null
	const [loadFailed, setLoadFailed] = useState(false)
	const lastLoadError = useRef("")
	const [refreshVersion, setRefreshVersion] = useState(0)
	const mounted = useRef(true)
	const dirtyRef = useRef(false)
	const pendingRef = useRef(false)
	const editingRef = useRef(editing)
	const saveVersion = useRef(0)

	useEffect(() => { editingRef.current = editing }, [editing])
	useEffect(() => {
		mounted.current = true
		const controller = new AbortController()
		const refresh = async () => {
			if (pendingRef.current) return
			const version = saveVersion.current
			try {
				const next = await getEnvironment({ signal: controller.signal })
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
			mounted.current = false
			controller.abort()
			window.clearInterval(timer)
		}
	}, [refreshVersion])

	const editable = Boolean(view?.editable && !pending && !loadFailed)
	const canReset = !pending && (view?.editable ?? loadFailed)
	const change = (next: EnvironmentEntry[]) => {
		if (!editable) return
		dirtyRef.current = !sameEnvironmentEntries(next, view?.entries ?? [])
		setEntries(next)
	}
	const importPackage = async (files: File[]): Promise<EnvironmentImportResult | null> => {
		if (!editable || pendingRef.current) return null
		pendingRef.current = true
		saveVersion.current++
		setOperation("import")
		try {
			const result = await importEnvironmentPackage(files)
			if (!mounted.current) return null
			setView(previous => previous && {
				...previous,
				imports: [...previous.imports.filter(item => item.name !== result.imported.name), result.imported],
				suggestions: [...previous.suggestions.filter(item => item.source !== result.imported.name), ...result.suggestions],
			})
			return result
		} catch (cause) {
			if (mounted.current) showErrorToast({
				title: "Import failed",
				message: cause instanceof Error ? cause.message : "Could not import package",
			})
			return null
		} finally {
			pendingRef.current = false
			if (mounted.current) setOperation(null)
		}
	}
	const save = async (password: string, nextEntries = entries): Promise<boolean> => {
		if (!view || !editable || pendingRef.current) return false
		pendingRef.current = true
		saveVersion.current++
		setOperation("save")
		try {
			await saveEnvironment({
				revision: view.revision,
				entries: nextEntries.map(({ name, value, secret }) => ({ name, value, secret })),
				password: password || null,
			})
			const next = await getEnvironment()
			if (!mounted.current) return false
			setView(next)
			setEntries(next.entries)
			dirtyRef.current = false
			return true
		} catch (cause) {
			if (mounted.current) showErrorToast({
				title: "Could not save settings",
				message: cause instanceof Error ? cause.message : "Could not save settings",
			})
			return false
		} finally {
			pendingRef.current = false
			if (mounted.current) setOperation(null)
		}
	}
	const reset = async (): Promise<boolean> => {
		if (!canReset || pendingRef.current) return false
		pendingRef.current = true
		saveVersion.current++
		setOperation("reset")
		try {
			await resetEnvironment()
			if (!mounted.current) return false
			setView(null)
			setEntries([])
			dirtyRef.current = false
			setLoadFailed(false)
			lastLoadError.current = ""
			setRefreshVersion(version => version + 1)
			return true
		} catch (cause) {
			if (mounted.current) showErrorToast({
				title: "Could not reset settings",
				message: cause instanceof Error ? cause.message : "Could not delete saved settings",
			})
			return false
		} finally {
			pendingRef.current = false
			if (mounted.current) setOperation(null)
		}
	}
	return { view, entries, editable, pending, loadFailed, change, save, importPackage, reset, canReset, saving: operation === "save",
		retry: () => { lastLoadError.current = ""; setRefreshVersion(version => version + 1) },
	}
}
