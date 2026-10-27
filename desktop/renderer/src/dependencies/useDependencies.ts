// The Dependencies view's records: loaded when the view opens, replaced by Check Now.
import { useEffect, useState } from "react"
import type { HostServiceStatus } from "../../../src/bridge"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { showErrorToast } from "../feedback/notices"
import { checkDependencies, CHECK_TIMEOUT_MS, listDependencies, type DependencyRecord } from "./dependencies-api"

export interface DependenciesState {
	records: DependencyRecord[]
	/** The desktop's own host services, read from main with the records. */
	hostServices: HostServiceStatus[]
	loading: boolean
	loadFailed: boolean
	checking: boolean
	check: () => Promise<void>
}

/** Reads the records each time the view becomes visible; a check is sent once per click. */
export function useDependencies(client: DesktopApiClient, visible: boolean): DependenciesState {
	const [records, setRecords] = useState<DependencyRecord[]>([])
	const [hostServices, setHostServices] = useState<HostServiceStatus[]>([])
	const [loading, setLoading] = useState(true)
	const [loadFailed, setLoadFailed] = useState(false)
	const [checking, setChecking] = useState(false)
	const lifetime = useClientLifetime(client)

	useEffect(() => {
		if (!visible) return
		const controller = new AbortController()
		const load = async () => {
			try {
				const [next, services] = await Promise.all([
					withDeadline(controller.signal, signal => listDependencies(client, signal)),
					window.robozium.getHostServices(),
				])
				if (controller.signal.aborted) return
				setRecords(next)
				setHostServices(services)
				setLoadFailed(false)
			} catch {
				if (!controller.signal.aborted) setLoadFailed(true)
			} finally {
				if (!controller.signal.aborted) setLoading(false)
			}
		}
		void load()
		return () => controller.abort()
	}, [client, visible])
	// A new client starts from its own records.
	useEffect(() => () => {
		setRecords([])
		setHostServices([])
		setLoading(true)
		setLoadFailed(false)
		setChecking(false)
	}, [client])

	const check = async () => {
		if (checking) return
		setChecking(true)
		const signal = lifetime()
		try {
			const [next, services] = await Promise.all([
				withDeadline(signal, requestSignal => checkDependencies(client, requestSignal), CHECK_TIMEOUT_MS),
				window.robozium.getHostServices(),
			])
			if (signal.aborted) return
			setRecords(next)
			setHostServices(services)
			setLoadFailed(false)
		} catch (error) {
			if (!signal.aborted) showErrorToast({
				title: "Dependency Check Failed",
				message: "Unable to check dependencies.",
				detail: error instanceof Error ? error.message : "An unexpected error occurred.",
			})
		} finally {
			if (!signal.aborted) setChecking(false)
		}
	}
	return { records, hostServices, loading, loadFailed, checking, check }
}
