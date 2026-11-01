// Own the backend's secrets status, the unlock write and the request for a password.
// The password dialog keeps its field; it receives this state as props.
import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { getCredentialStatus, unlockCredentials, type CredentialStatus } from "./credentials-api"

export interface CredentialsState {
	/** Null until the first read succeeds. */
	status: CredentialStatus | null
	refresh: () => void
	/** A password is requested: the unlock dialog is open. */
	asking: boolean
	/** Ask for the password; resolves true once the backend unlocked, false on cancel. */
	prompt: () => Promise<boolean>
	/** Resolves true at once unless the secrets are known to be locked; otherwise prompts. */
	ensureUnlocked: () => Promise<boolean>
	/** Resolves true once the backend unlocked and answers the prompt; a failure is never retried. */
	unlock: (password: string) => Promise<boolean>
	cancel: () => void
}

/** `visible`: the HUD is shown, so locked secrets ask for their password once per client. */
export function useCredentials(client: DesktopApiClient, connected: boolean, visible: boolean): CredentialsState {
	const [status, setStatus] = useState<CredentialStatus | null>(null)
	const [asking, setAsking] = useState(false)
	const pending = useRef(false)
	const waiting = useRef<((unlocked: boolean) => void)[]>([])
	const askedAtStart = useRef(false)
	const lifetime = useClientLifetime(client)
	// A read that started before a write must not overwrite the write's result.
	const version = useRef(0)

	const refresh = useCallback(() => {
		const started = version.current
		const signal = lifetime()
		void (async () => {
			try {
				const next = await withDeadline(signal, requestSignal => getCredentialStatus(client, requestSignal))
				if (!signal.aborted && started === version.current) setStatus(next)
			} catch {
				// Reads stay quiet, as in the reference; the last status stays.
			}
		})()
	}, [client, lifetime])

	const answer = useCallback((unlocked: boolean) => {
		setAsking(false)
		for (const resolve of waiting.current.splice(0)) resolve(unlocked)
	}, [])
	const prompt = useCallback(() => {
		setAsking(true)
		return new Promise<boolean>(resolve => waiting.current.push(resolve))
	}, [])

	// A new client starts from an unknown status and ends the previous client's prompt.
	useEffect(() => {
		setStatus(null)
		askedAtStart.current = false
		return () => answer(false)
	}, [client, answer])
	useEffect(() => {
		if (connected) refresh()
	}, [connected, refresh])
	// Secrets saved while a restart is pending load only after it, so the prompt waits for it.
	const unlockable = Boolean(status?.locked && !status.restartRequired)
	useEffect(() => {
		if (!visible || !unlockable || askedAtStart.current) return
		askedAtStart.current = true
		void prompt()
	}, [visible, unlockable, prompt])

	const unlock = async (password: string) => {
		if (pending.current) return false
		pending.current = true
		version.current += 1
		const signal = lifetime()
		try {
			const next = await withDeadline(signal, requestSignal => unlockCredentials(client, password, requestSignal))
			if (signal.aborted) return false
			setStatus(next)
			answer(true)
			return true
		} catch {
			return false
		} finally {
			pending.current = false
		}
	}

	return {
		status, refresh, asking, prompt, unlock,
		ensureUnlocked: () => status?.locked ? prompt() : Promise.resolve(true),
		cancel: () => answer(false),
	}
}
