// Own the backend's secrets status and the unlock and remove writes.
// The menu keeps its own open state and password field; it receives this state as props.
import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { clearCredentials, getCredentialStatus, unlockCredentials, type CredentialStatus } from "./credentials-api"

export interface CredentialsState {
	/** Null until the first read succeeds; the menu is hidden while unavailable. */
	status: CredentialStatus | null
	pending: boolean
	refresh: () => void
	/** Resolves true once the backend unlocked; a failure is never retried. */
	unlock: (password: string) => Promise<boolean>
	remove: () => Promise<boolean>
}

export function useCredentials(client: DesktopApiClient | null, connected: boolean): CredentialsState {
	const [status, setStatus] = useState<CredentialStatus | null>(null)
	const [pending, setPending] = useState(false)
	const lifetime = useClientLifetime(client)
	// A read that started before a write must not overwrite the write's result.
	const version = useRef(0)

	const refresh = useCallback(() => {
		if (!client) return
		const started = version.current
		const signal = lifetime()
		void (async () => {
			try {
				const next = await withDeadline(signal, requestSignal => getCredentialStatus(client, requestSignal))
				if (!signal.aborted && started === version.current) setStatus(next)
			} catch {
				// Reads stay quiet, as in the reference; the menu keeps the last status.
			}
		})()
	}, [client, lifetime])

	// A new client starts from an unknown status; an outage keeps the last one.
	useEffect(() => {
		setStatus(null)
		setPending(false)
	}, [client])
	useEffect(() => {
		if (connected) refresh()
	}, [connected, refresh])

	const write = async (operation: (client: DesktopApiClient, signal: AbortSignal) => Promise<CredentialStatus>) => {
		if (!client || pending) return false
		version.current += 1
		setPending(true)
		const signal = lifetime()
		try {
			const next = await withDeadline(signal, requestSignal => operation(client, requestSignal))
			if (signal.aborted) return false
			setStatus(next)
			return true
		} catch {
			return false
		} finally {
			if (!signal.aborted) setPending(false)
		}
	}

	return {
		status, pending, refresh,
		unlock: password => write((client, signal) => unlockCredentials(client, password, signal)),
		remove: () => write(clearCredentials),
	}
}
