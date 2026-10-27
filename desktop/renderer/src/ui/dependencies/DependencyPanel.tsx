// Copied from robozium-electron/desktop/web/app/components/hud/dependencies/DependencyPanel.tsx at 076b2c9.
// Adapted: records and Check Now come from the dependencies owner, the diagnostic is
// copied through the native clipboard bridge, and cells wrap as in web/ at db6a20f.
// A failed read is a toast with Check now; the table area stays empty.
import { Fragment, useMemo, useState, type ReactElement } from "react"
import type { DependencyRecord, DependencyStatus } from "../../dependencies/dependencies-api"
import type { DependenciesState } from "../../dependencies/useDependencies"
import type { HostServiceStatus } from "../../../../src/bridge"
import { showErrorToast } from "../../feedback/notices"
import { Toast } from "../feedback/Toast"
import { DisplayArt } from "../branding/DisplayArt"

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
				<div key={key} className="wrap-anywhere">
					<dt className="inline text-term-blue text-shadow-(--term-glow-blue)">
						{key}=
					</dt>
					{" "}
					<dd className="inline">{value}</dd>
				</div>
			))}
		</dl>
	)
}

function DependencyDiagnostic({ dependency }: { dependency: DependencyRecord }) {
	const [copied, setCopied] = useState(false)
	const diagnostic = [
		`Dependency: ${dependency.dependency_id}`,
		`Checked: ${dependency.checked_at ?? "Not checked"}`,
		`Reason: ${dependency.reason_code ?? "unknown"}`,
		...Object.entries(dependency.redacted_metadata)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => `${key}: ${value}`),
		dependency.message,
	].join("\n")

	const copyDiagnostic = async () => {
		try {
			await window.robozium.writeClipboardText(diagnostic)
			setCopied(true)
		} catch {
			showErrorToast({
				title: "Copy Failed",
				message: "Select and copy the diagnostic text below.",
			})
		}
	}

	return (
		<tr>
			<td colSpan={5}>
				<div className="flex flex-wrap items-start gap-3">
					<pre className="min-w-0 flex-1 basis-80 select-text whitespace-pre-wrap wrap-anywhere text-sm">
						{diagnostic}
					</pre>
					<button type="button" className="app-nav__cta" onClick={copyDiagnostic}>
						{copied ? "Copied" : "Copy diagnostic"}
					</button>
				</div>
			</td>
		</tr>
	)
}

const hostServiceStyles: Record<HostServiceStatus["state"], { label: string; className: string }> = {
	running: statusStyles.available,
	starting: statusStyles.pending,
	failed: statusStyles.unavailable,
	unsupported: { label: "UNSUPPORTED", className: "opacity-80" },
}

/** Programs the desktop runs on this computer for backend tools; a failed one says why. */
function HostServices({ services }: { services: HostServiceStatus[] }): ReactElement | null {
	if (services.length === 0) return null
	return (
		<ul className="shrink-0 space-y-1" aria-label="Host services">
			{services.map(service => {
				const style = hostServiceStyles[service.state]
				return (
					<li key={service.name} className="flex flex-wrap gap-x-3 wrap-anywhere">
						<span className={`${style.className} whitespace-nowrap`}>{style.label}</span>
						<code>host:{service.name}</code>
						<span className="select-text opacity-80">{service.message}</span>
					</li>
				)
			})}
		</ul>
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
		<div className="agent-hud__table-scroll min-h-0 min-w-0 flex-1 overflow-auto">
			<table className="agent-hud__markdown-table w-full text-base">
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
							<Fragment key={dependency.dependency_id}>
								<tr>
									<td
										className={`${status.className} whitespace-nowrap`}>
										{status.label}
									</td>
									<td>
										<code>{dependency.dependency_id}</code>
									</td>
									<td>
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
									<td>
										{dependency.reason_code ?? "—"}
									</td>
								</tr>
								{dependency.status === "unavailable" && dependency.message ? (
									<DependencyDiagnostic
										key={dependency.checked_at}
										dependency={dependency}
									/>
								) : null}
							</Fragment>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

export function DependencyPanel({ dependencies: state }: {
	dependencies: DependenciesState
}) {
	const { records: dependencies, loading: isLoading, checking: isChecking, loadFailed } = state
	const [sort, setSort] = useState<DependencySort>({
		field: "status",
		direction: "ascending",
	})

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

	return (
		<section className="agent-hud__status-view flex min-h-0 w-full flex-1 flex-col">
			{loadFailed && <Toast tone="error" title="Could not load dependencies" message="Unable to load dependency records."
				actions={[{ label: "Check now", disabled: isChecking, onClick: state.check }]} />}
			<div
				className="agent-hud__replyBox min-h-0 flex-1 [--hud-reply-pad-block-start:1.25rem]
			 [--hud-reply-pad-block-end:1.25rem] [--hud-reply-pad-inline:1.5rem]">
				<div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4">
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
							onClick={() => void state.check()}>
							<DisplayArt name={isChecking ? "checking" : "check-now"} />
						</button>
					</div>
					<HostServices services={state.hostServices} />
					{isLoading ? (
						<div
							className="flex min-h-0 flex-1 items-center justify-center text-center"
							role="status">
							<p className="text-xl uppercase tracking-widest opacity-80">
								Loading dependency records…
							</p>
						</div>
					) : loadFailed ? (
						<div className="min-h-0 flex-1" />
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
