import {
	StreamLogItemKind,
	StreamLogRole,
	type StreamLogItem,
} from "@/lib/robozium/view-model"
import { RunLifecycleKind } from "@/lib/robozium/wire"

/**
 * Visual fixture data for the home page. Structured exactly like the live
 * stream so the same rendering path can be reused.
 */
export const placeholderLogItems: StreamLogItem[] = [
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Error,
		content:
			"subspace_link failed — ./warp/core.flux:Δ42\nζ-variance over ℵ-tolerance · phase ψ collapsed · rerouting through the Σ-lattice.",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.System,
		content:
			"cold boot reactor=online flux=0.94c lattice=Λ-stable entropy=↓ shields=nominal sync=⊹ band=∞ horizon=⟨ψ|ψ⟩ id=ax-9∮",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Tool,
		content:
			"scan_subspace\npath = ./hyperlane/Σ-grid sector=7∮ depth=∞\n=> 12 nodes coherent · 3 dark · drift ε<10⁻⁹ · torsion ∇×F→0",
	},
	{
		contentType: "plain-text",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Script,
		content:
			"ignition.seq ⊹⊹⊹  ⎔ phase-lock ⟨ψ|ψ⟩=1  ▮▮▮▯▯ 63%  λ=632nm  ∮=∞  Ω→0  ⌁ handshake ⌁  ⊹ armed ⊹",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content:
			"Lattice handshake holds. The Σ-grid is coherent and the dark nodes are dormant, not lost — I will warm them in order and keep every jump reversible and easy to back out.",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Tool,
		content:
			"align_manifold\npath = ./fields/∂M curvature=R sector=∮\n=> torsion ∇×F→0 · ∮_∂M dω balanced · settled in 0.8s · Λ nominal",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content:
			"Session live — I can see the tree and your invariants. Ask for refactors, a tight plan, or a read-only pass; I will keep steps small, reversible, and easy to review.",
	},

	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.System,
		content:
			"runtime bound arch=linux/amd64 policy=deny-by-default caps=fs+proc id=ph-sess-7xb2 index=warm vectors=1536 ctx_window=128k audit=structured",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content:
			"Booting up. Scanning the workspace to build context for the refactor you asked about. I will follow file references and invariants in order so we do not paint ourselves into a corner.",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Tool,
		content:
			"read_file\npath = ./src/pipe.ts lines=1..160\n=> 158 lines, 4 classes, 11 exported symbols",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content:
			"Found 3 candidates for the refactor. The happy path and fallback path share most logic, so a parameterized emit target should collapse duplication. I will start with the smallest change...",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Tool,
		content:
			"list_files\npath = ./src depth=2\n=> 14 entries: pipe.ts, pipes/*, runner.ts, runtime.ts, persistence/*, types.ts, index.ts, tests/*",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Tool,
		content:
			"apply_patch\n./src/pipe.ts  ∶  2 hunks  ∶  unified, emit() path only, no test churn\n=> landed  ·  +47 / -19  ·  queue type_check",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content:
			"Patch applied on the hot path — structure stayed familiar, so the review surface is narrow. I will re-validate the generic at the failing line and add a local shim only if the type solver still balks.",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Error,
		content:
			"type_check failed — src/pipe.ts:87:12\nProperty 'emit' does not exist on type Pipe<never>.",
	},
	{
		contentType: "plain-text",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Script,
		content: `apply_euclidean_path_integral
∫_γ ω = ∮_∂M dω  |  (F,∇) ∼  H²(M)  |  δS/δφ=0, ℏ∂_tψ=Ĥψ  |  ζ(2)=π²/6, e^{iπ}+1=0 
|  R_{μν}−½Rg_{μν}+Λg_{μν}=8πG T_{μν}  |  F_{μν}=∂_μA_ν−∂_νA_μ, ∇·E=ρ/ε₀ `,
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content:
			"Narrowing the generic and threading the event type through overloads. Re-running type check. If anything still resists, I will add a local adapter rather than spreading generic soup across the file.",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Tool,
		content: "type_check\n=> passed in 1.4s (0 errors, 0 warnings)",
	},
	{
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.System,
		content: "run stopped status=completed duration=00:00:41 tokens=12 314",
	},
	{
		kind: StreamLogItemKind.Lifecycle,
		role: StreamLogRole.Lifecycle,
		phase: RunLifecycleKind.Started,
		agentName: "NOVA-Ω∞ ∮ Prime Intelligence",
		startedAt: "2026-04-22T00:03:14Z",
		details: {
			model_name: "Scalaron-Ω・Δ9 (ℏ-tuned)",
			temperature: "δS/δφ = 0.2, ℏ∂_tψ = Ĥψ",
			entropy_gradient: "∇·S = −ζ(2)/π² ↓",
			containment_field: "∮_∂M dω = 0, Λ-stable",
			context_horizon: "⟨ψ|ψ⟩ = 1, ctx = 10²⁴ tok",
			power_draw: "e^{iπ}+1=0 ⇒ 1.21 GW ⚡",
		},
	},
]
