import type { Proof } from './ProofModel.ts'
import { toJSON, fromJSON } from '../model/serialize.ts'
import { createProof, addStep, setGoal } from './ProofModel.ts'

// --- ZXLive-compatible .zxp format ---
// This is the format used by ZXLive (https://github.com/Quantomatic/zxlive).
// We write this format so proofs can be opened in either tool.
//
// ZXLive format:
//   { initial_graph: {...}, proof_steps: [{ display_name, rule, graph, grouped_rewrites }] }
//
// Our legacy format (.zxproof.json):
//   { version: 1, initialGraph: {...}, steps: [{ graph, ruleName, ruleId, label }] }
//
// We read both formats transparently.

interface ZXLiveStep {
  display_name: string
  rule: string
  graph: object | string
  grouped_rewrites: ZXLiveStep[] | null
}

interface ZXLiveProof {
  initial_graph: object | string
  proof_steps: ZXLiveStep[]
  goal_graph?: object | string | null
}

interface LegacyStep {
  graph: object
  ruleName: string
  ruleId: string
  label: string | null
}

interface LegacyProof {
  version: 1
  initialGraph: object
  steps: LegacyStep[]
}

/** Rule name mapping: display names → our ruleIds.
 *  Covers both ZXLive names and our own names for round-trip fidelity. */
const RULE_NAME_TO_ID: Record<string, string> = {
  // ZXLive names
  'Fuse spiders': 'spider_fusion',
  'Remove identity': 'id_removal',
  'Remove self-loops': 'self_loop_removal',
  'Remove parallel edges': 'hopf',
  'Strong complementarity': 'bialgebra',
  'Strong complementarity in opposite direction': 'bialgebra',
  'Copy 0/pi spider through its neighbour': 'copy',
  'local complementation': 'lcomp',
  'pivot': 'pivot',
  'boundary pivot': 'pivot',
  'gadget pivot': 'pivot',
  'bialgebra simp': 'bialgebra',
  'full reduce': 'full_reduce',
  'clifford simplification': 'clifford_simp',
  // ZX Sketch names
  'Spider Fusion': 'spider_fusion',
  'Identity Removal': 'id_removal',
  'Bialgebra': 'bialgebra',
  'Hopf': 'hopf',
  'Copy': 'copy',
  'Color Change': 'color_change',
  'Local Complementation': 'lcomp',
  'Pivot': 'pivot',
  'Spider Split': 'spider_split',
  'Spider Simplify': 'spider_simp',
  'Basic Simplify': 'basic_simp',
  'Clifford Simplify': 'clifford_simp',
  'Full Reduce': 'full_reduce',
  'To Graph-Like': 'to_graph_like',
}

/** Serialize a proof to ZXLive-compatible .zxp JSON string. */
export function proofToJSON(proof: Proof): string {
  const obj: Record<string, unknown> = {
    initial_graph: JSON.parse(toJSON(proof.initialGraph, true)),
    proof_steps: proof.steps.map(s => ({
      display_name: s.label ?? s.ruleName,
      rule: s.ruleName,
      graph: JSON.parse(toJSON(s.graph, true)),
      grouped_rewrites: null,
    })),
  }
  // Persist goal graph if set (ZXLive ignores unknown fields)
  if (proof.goalGraph) {
    obj.goal_graph = JSON.parse(toJSON(proof.goalGraph, true))
  }
  return JSON.stringify(obj, null, 2)
}

/** Deserialize a proof from JSON string. Accepts both ZXLive .zxp and legacy .zxproof.json. */
export function proofFromJSON(jsonStr: string): Proof {
  const raw = JSON.parse(jsonStr)

  // Detect format
  if ('initial_graph' in raw) {
    return parseZXLiveProof(raw)
  }
  if ('initialGraph' in raw) {
    return parseLegacyProof(raw)
  }
  throw new Error('Unsupported proof format (expected initial_graph or initialGraph)')
}

function parseZXLiveProof(raw: ZXLiveProof): Proof {
  // Handle double-encoded legacy .zxp (initial_graph may be a JSON string)
  const initialGraphJson = typeof raw.initial_graph === 'string'
    ? raw.initial_graph
    : JSON.stringify(raw.initial_graph)
  const initialGraph = fromJSON(initialGraphJson, true)
  const proof = createProof(initialGraph)

  const steps = raw.proof_steps ?? []
  for (const step of steps) {
    // Handle double-encoded step (graph may be a JSON string)
    const stepRaw = typeof step === 'string' ? JSON.parse(step) as ZXLiveStep : step
    const graphJson = typeof stepRaw.graph === 'string'
      ? stepRaw.graph
      : JSON.stringify(stepRaw.graph)
    const graph = fromJSON(graphJson, true)

    const ruleName = stepRaw.rule || stepRaw.display_name || 'Unknown'
    const ruleId = RULE_NAME_TO_ID[stepRaw.rule] ?? stepRaw.rule ?? 'unknown'
    addStep(proof, graph, ruleName, ruleId)

    // If display_name differs from rule, store it as user-edited label
    if (stepRaw.display_name && stepRaw.display_name !== stepRaw.rule) {
      proof.steps[proof.steps.length - 1].label = stepRaw.display_name
    }
  }

  // Restore goal graph if present
  if (raw.goal_graph) {
    const goalJson = typeof raw.goal_graph === 'string'
      ? raw.goal_graph
      : JSON.stringify(raw.goal_graph)
    setGoal(proof, fromJSON(goalJson, true))
  }

  return proof
}

function parseLegacyProof(raw: LegacyProof): Proof {
  if (raw.version !== 1) {
    throw new Error(`Unsupported proof version: ${raw.version}`)
  }

  const initialGraph = fromJSON(JSON.stringify(raw.initialGraph))
  const proof = createProof(initialGraph)

  for (const step of raw.steps) {
    const graph = fromJSON(JSON.stringify(step.graph))
    addStep(proof, graph, step.ruleName, step.ruleId)
    proof.steps[proof.steps.length - 1].label = step.label
  }

  return proof
}
