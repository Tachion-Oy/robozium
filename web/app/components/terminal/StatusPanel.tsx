"use client"

import { useEffect, useMemo, useState } from "react"
import { checkDependencies, listDependencies } from "@/lib/robosprawl/client"
import type { DependencyRecord, DependencyStatus } from "@/lib/robosprawl/wire"
import { showErrorToast } from "../feedback/ErrorToast"

type SortField = "dependency_id" | "status"
type SortDirection = "ascending" | "descending"
type DependencySort = {
	field: SortField
	direction: SortDirection
}

const statusStyles: Record<
	DependencyStatus,
	{ label: string; className: string }
> = {
	available: {
		label: "AVAILABLE",
		className: "text-term-green text-shadow-(--term-glow-green)",
	},
	unavailable: {
		label: "UNAVAILABLE",
		className: "text-term-red text-shadow-(--term-glow-red)",
	},
	pending: {
		label: "PENDING",
		className: "text-term-amber text-shadow-(--term-glow-amber)",
	},
}

type CheckedAtDisplay = {
	date: string
	time: string | null
}

function formatCheckedAt(value: string | null): CheckedAtDisplay {
	if (value === null) return { date: "Not checked", time: null }
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) return { date: value, time: null }
	const gmtPlusThree = new Date(parsed.getTime() + 3 * 60 * 60 * 1000)
	const iso = gmtPlusThree.toISOString()
	return {
		date: iso.slice(0, 10),
		time: iso.slice(11, 19),
	}
}

function Metadata({
	metadata,
}: {
	metadata: DependencyRecord["redacted_metadata"]
}) {
	const entries = Object.entries(metadata).sort(([left], [right]) =>
		left.localeCompare(right),
	)
	if (entries.length === 0) return <span aria-label="No metadata">—</span>
	return (
		<dl className="space-y-1">
			{entries.map(([key, value]) => (
				<div
					key={key}
					className="grid grid-cols-[max-content_minmax(0,1fr)] gap-1">
					<dt className="text-term-blue text-shadow-(--term-glow-blue)">
						{key}=
					</dt>
					<dd className="break-all">{value}</dd>
				</div>
			))}
		</dl>
	)
}

function DependencyTable({
	dependencies,
	sort,
	onSort,
}: {
	dependencies: DependencyRecord[]
	sort: DependencySort
	onSort: (field: SortField) => void
}) {
	if (dependencies.length === 0) {
		return (
			<p className="py-12 text-center text-xl uppercase tracking-widest opacity-80">
				No dependencies registered
			</p>
		)
	}

	const sortHeader = (field: SortField, label: string) => {
		const active = sort.field === field
		const indicator = active
			? sort.direction === "ascending"
				? "↑"
				: "↓"
			: "↕"
		return (
			<th
				scope="col"
				aria-sort={active ? sort.direction : "none"}>
				<button
					type="button"
					className="flex w-full cursor-pointer items-center gap-2 text-left text-term-blue text-shadow-(--term-glow-blue)
					 hover:text-white focus-visible:text-white focus-visible:outline-none"
					onClick={() => onSort(field)}>
					<span>{label}</span>
					<span
						className={active ? "opacity-100" : "opacity-50"}
						aria-hidden="true">
						{indicator}
					</span>
				</button>
			</th>
		)
	}

	return (
		<div className="agent-hud__table-scroll min-h-0 flex-1 overflow-auto">
			<table className="agent-hud__markdown-table w-full table-fixed text-base">
				<colgroup>
					<col className="w-[13%]" />
					<col className="w-[25%]" />
					<col className="w-[22%]" />
					<col className="w-[22%]" />
					<col className="w-[18%]" />
				</colgroup>
				<thead className="agent-hud__table-header text-left uppercase tracking-widest">
					<tr>
						{sortHeader("status", "Status")}
						{sortHeader("dependency_id", "Dependency ID")}
						<th scope="col">Metadata</th>
						<th scope="col">Checked (GMT+3)</th>
						<th scope="col">Failure reason</th>
					</tr>
				</thead>
				<tbody>
					{dependencies.map((dependency) => {
						const status = statusStyles[dependency.status]
						const checkedAt = formatCheckedAt(dependency.checked_at)
						return (
							<tr key={dependency.dependency_id}>
								<td
									className={`${status.className} whitespace-nowrap`}>
									{status.label}
								</td>
								<td className="break-all">
									<code>{dependency.dependency_id}</code>
								</td>
								<td className="wrap-break-word">
									<Metadata
										metadata={dependency.redacted_metadata}
									/>
								</td>
								<td className="text-sm leading-tight">
									<span className="block whitespace-nowrap">
										{checkedAt.date}
									</span>
									{checkedAt.time ? (
										<span className="block whitespace-nowrap">
											{checkedAt.time}
										</span>
									) : null}
								</td>
								<td className="break-all">
									{dependency.reason_code ?? "—"}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

export function StatusPanel() {
	const [dependencies, setDependencies] = useState<DependencyRecord[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isChecking, setIsChecking] = useState(false)
	const [loadFailed, setLoadFailed] = useState(false)
	const [sort, setSort] = useState<DependencySort>({
		field: "status",
		direction: "ascending",
	})

	useEffect(() => {
		const controller = new AbortController()

		const load = async () => {
			try {
				const records = await listDependencies({
					signal: controller.signal,
				})
				setDependencies(records)
				setLoadFailed(false)
			} catch {
				if (!controller.signal.aborted) setLoadFailed(true)
			} finally {
				if (!controller.signal.aborted) setIsLoading(false)
			}
		}

		void load()
		return () => controller.abort()
	}, [])

	const available = dependencies.filter(
		(dependency) => dependency.status === "available",
	).length
	const sortedDependencies = useMemo(() => {
		return [...dependencies].sort((left, right) => {
			const primary = left[sort.field].localeCompare(right[sort.field])
			if (primary !== 0) {
				return sort.direction === "ascending" ? primary : -primary
			}
			return left.dependency_id.localeCompare(right.dependency_id)
		})
	}, [dependencies, sort])

	const handleSort = (field: SortField) => {
		setSort((current) => ({
			field,
			direction:
				current.field === field && current.direction === "ascending"
					? "descending"
					: "ascending",
		}))
	}

	const handleCheck = async () => {
		setIsChecking(true)
		try {
			const updated = await checkDependencies()
			setDependencies(updated)
			setLoadFailed(false)
		} catch (error) {
			showErrorToast({
				title: "Dependency Check Failed",
				message: "Unable to check dependencies.",
				detail:
					error instanceof Error
						? error.message
						: "An unexpected error occurred.",
			})
		} finally {
			setIsChecking(false)
		}
	}

	return (
		<section className="agent-hud__status-view flex min-h-0 w-full flex-1 flex-col">
			<div
				className="agent-hud__replyBox min-h-0 flex-1 [--hud-reply-pad-block-start:1.25rem]
			 [--hud-reply-pad-block-end:1.25rem] [--hud-reply-pad-inline:1.5rem]">
				<div className="flex min-h-0 w-full flex-1 flex-col gap-4">
					<div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
						<p
							className="text-xl uppercase tracking-widest"
							aria-live="polite">
							<span className="text-term-green text-shadow-(--term-glow-green)">
								{available}
							</span>
							<span className="opacity-80">
								{" "}
								/ {dependencies.length} available
							</span>
						</p>
						<button
							type="button"
							className="app-nav__cta disabled:cursor-wait disabled:opacity-50"
							disabled={isLoading || isChecking}
							onClick={handleCheck}>
							{isChecking ? "Checking…" : "Check Now"}
						</button>
					</div>
					{isLoading ? (
						<div
							className="flex min-h-0 flex-1 items-center justify-center text-center"
							role="status">
							<p className="text-xl uppercase tracking-widest opacity-80">
								Loading dependency records…
							</p>
						</div>
					) : loadFailed ? (
						<div
							className="flex min-h-0 flex-1 items-center justify-center text-center text-term-red text-shadow-(--term-glow-red)"
							role="alert">
							<p className="text-xl uppercase tracking-widest">
								Unable to load dependency records. Use Check Now
								to retry.
							</p>
						</div>
					) : (
						<DependencyTable
							dependencies={sortedDependencies}
							sort={sort}
							onSort={handleSort}
						/>
					)}
				</div>
			</div>
		</section>
	)
}
