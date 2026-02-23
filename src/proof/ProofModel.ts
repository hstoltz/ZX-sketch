import type { GraphData } from '../model/types.ts'
import { cloneGraph } from '../model/Graph.ts'

export interface ProofStep {
  /** Snapshot of the graph AFTER this rewrite step. */
  graph: GraphData
  /** Human-readable rule name, e.g. "Spider Fusion". */
  ruleName: string
  /** Machine ID, e.g. "spider_fusion". */
  ruleId: string
  /** User-editable annotation (null = no annotation). */
  label: string | null
}

export interface Proof {
  /** Graph before any rewrites. */
  initialGraph: GraphData
  /** Ordered sequence of rewrite steps. */
  steps: ProofStep[]
  /** Current viewing position: -1 = initial, 0..N-1 = after step[i]. */
  currentStep: number
  /** Target diagram the user is working toward (null = no goal). */
  goalGraph: GraphData | null
  /** True when the current diagram matches the goal. */
  goalReached: boolean
}

/** Create a new proof from the current graph state. */
export function createProof(graph: GraphData): Proof {
  return {
    initialGraph: cloneGraph(graph),
    steps: [],
    currentStep: -1,
    goalGraph: null,
    goalReached: false,
  }
}

/** Set a goal diagram for the proof. */
export function setGoal(proof: Proof, graph: GraphData): void {
  proof.goalGraph = cloneGraph(graph)
  proof.goalReached = false
}

/** Clear the goal diagram. */
export function clearGoal(proof: Proof): void {
  proof.goalGraph = null
  proof.goalReached = false
}

/** Append a rewrite step to the proof. The graph is cloned. */
export function addStep(proof: Proof, graph: GraphData, ruleName: string, ruleId: string): void {
  // If viewing a past step, truncate any future steps
  if (proof.currentStep < proof.steps.length - 1) {
    proof.steps.length = proof.currentStep + 1
  }
  // Clear goal-reached so it's re-evaluated against the new diagram
  proof.goalReached = false
  proof.steps.push({
    graph: cloneGraph(graph),
    ruleName,
    ruleId,
    label: null,
  })
  proof.currentStep = proof.steps.length - 1
}

/** Get the graph at the current step (cloned for safety). */
export function currentGraph(proof: Proof): GraphData {
  if (proof.currentStep === -1) {
    return proof.initialGraph
  }
  return proof.steps[proof.currentStep].graph
}

/** Navigate to a specific step. -1 = initial graph. */
export function goToStep(proof: Proof, index: number): void {
  if (index < -1 || index >= proof.steps.length) return
  proof.currentStep = index
}

/** Check if viewing the latest step (or initial if no steps). */
export function isAtLatest(proof: Proof): boolean {
  return proof.currentStep === proof.steps.length - 1
}

/** Remove the last step (proof undo). Returns true if a step was removed. */
export function removeLastStep(proof: Proof): boolean {
  if (proof.steps.length === 0) return false
  proof.steps.pop()
  proof.currentStep = proof.steps.length - 1
  return true
}
