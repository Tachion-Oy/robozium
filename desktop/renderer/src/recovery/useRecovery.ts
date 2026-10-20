// Each Electron profile already has isolated renderer storage; mode supplies the remaining scope.
import { useCallback, useState } from "react"
import type { BackendMode } from "../../../src/bridge"
import { emptyRecovery, parseRecovery, recoveryKey, type RecoveryRecord } from "./recovery-storage"

interface LoadedRecovery {
	record: RecoveryRecord
	error: string
}

export interface RecoveryState {
	initial: RecoveryRecord
	error: string
	save: (record: RecoveryRecord) => void
}

function loadRecovery(mode: BackendMode | null): LoadedRecovery {
	if (!mode) return { record: emptyRecovery(), error: "" }
	try {
		const text = window.localStorage.getItem(recoveryKey(mode))
		return { record: text === null ? emptyRecovery() : parseRecovery(text), error: "" }
	} catch {
		return { record: emptyRecovery(), error: "Saved recovery data could not be read. Your current draft is still editable." }
	}
}

export function useRecovery(mode: BackendMode | null): RecoveryState {
	const [loaded] = useState(() => loadRecovery(mode))
	const [saveError, setSaveError] = useState("")
	const save = useCallback((record: RecoveryRecord): void => {
		if (!mode) return
		try {
			window.localStorage.setItem(recoveryKey(mode), JSON.stringify(record))
			setSaveError("")
		} catch {
			setSaveError("Recovery data could not be saved. Keep this window open to retain your draft.")
		}
	}, [mode])
	return { initial: loaded.record, error: saveError || loaded.error, save }
}
