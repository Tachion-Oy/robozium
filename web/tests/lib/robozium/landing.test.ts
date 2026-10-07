import { describe, expect, it } from "vitest"

import {
	markProjectsCancelling,
	markProjectsDeleting,
	markProjectOpening,
	mergeProjects,
	ProjectStatus,
	type ProjectRow,
} from "../../../lib/robozium/landing"
import type { Project } from "../../../lib/robozium/wire"

function project(overrides: Partial<Project>): Project {
	return {
		slug: "alpha",
		status: "dormant",
		run_id: null,
		created_at: null,
		...overrides,
	}
}

describe("mergeProjects", () => {
	it("maps backend-composed dormant projects into UI rows", () => {
		const rows = mergeProjects([project({})])
		expect(rows).toEqual<ProjectRow[]>([
			{
				slug: "alpha",
				status: ProjectStatus.Dormant,
				runId: null,
				createdAt: null,
			},
		])
	})

	it("carries live status and run metadata from the backend row", () => {
		const rows = mergeProjects([
			project({
				status: "awaiting_user_input",
				run_id: "run-1",
				created_at: 1000,
			}),
		])
		expect(rows[0]).toMatchObject({
			slug: "alpha",
			status: "awaiting_user_input",
			runId: "run-1",
			createdAt: 1000,
		})
	})

	it("maps cancelling rows without reinterpreting status", () => {
		const rows = mergeProjects([
			project({ status: "cancelling", run_id: "run-1" }),
		])
		expect(rows[0]).toMatchObject({
			slug: "alpha",
			status: ProjectStatus.Cancelling,
			runId: "run-1",
		})
	})

	it("maps syncing rows from the backend-composed status", () => {
		const rows = mergeProjects([project({ status: "syncing" })])
		expect(rows[0]).toMatchObject({
			slug: "alpha",
			status: ProjectStatus.Syncing,
			runId: null,
		})
	})

})

describe("optimistic project status helpers", () => {
	it("marks the selected row as opening", () => {
		const rows: ProjectRow[] = [
			{
				slug: "alpha",
				status: ProjectStatus.Dormant,
				runId: null,
				createdAt: null,
			},
		]

		expect(markProjectOpening(rows, "alpha")[0]?.status).toBe(
			ProjectStatus.Opening,
		)
	})

	it("marks all rows with active cancel intents as cancelling", () => {
		const rows: ProjectRow[] = [
			{
				slug: "alpha",
				status: ProjectStatus.Syncing,
				runId: null,
				createdAt: 1,
			},
			{
				slug: "beta",
				status: ProjectStatus.Syncing,
				runId: null,
				createdAt: 1,
			},
		]
		expect(markProjectsCancelling(rows, ["alpha"])).toEqual<ProjectRow[]>([
			{
				slug: "alpha",
				status: ProjectStatus.Cancelling,
				runId: null,
				createdAt: 1,
			},
			{
				slug: "beta",
				status: ProjectStatus.Syncing,
				runId: null,
				createdAt: 1,
			},
		])
	})

	it("gives deletion tombstones precedence over stale polled status", () => {
		const rows: ProjectRow[] = [
			{
				slug: "alpha",
				status: ProjectStatus.Dormant,
				runId: null,
				createdAt: null,
			},
		]

		expect(markProjectsDeleting(rows, ["alpha"])[0]?.status).toBe(
			ProjectStatus.Deleting,
		)
	})

	it("lets deletion override an opening row", () => {
		const rows: ProjectRow[] = [
			{
				slug: "alpha",
				status: ProjectStatus.Dormant,
				runId: null,
				createdAt: null,
			},
		]
		const opening = markProjectOpening(rows, "alpha")

		expect(markProjectsDeleting(opening, ["alpha"])[0]?.status).toBe(
			ProjectStatus.Deleting,
		)
	})
})
