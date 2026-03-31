import type { GraphData, Node, Edge } from './model/types.ts'
import type { History } from './model/History.ts'
import type { AnimationManager } from './canvas/Animations.ts'
import type { Proof } from './proof/ProofModel.ts'
import { createGraph } from './model/Graph.ts'
import { createHistory } from './model/History.ts'
import { createAnimationManager } from './canvas/Animations.ts'

/** State for unfuse wire partition mode. */
export interface UnfusePartition {
  /** The spider being unfused (nanoid). */
  nodeId: string
  /** Snapshot of nanoid→int mapping at time of entering partition mode. */
  nanoidToInt: Map<string, number>
  /** Snapshot of graph JSON at time of entering partition mode. */
  graphJson: string
  /** Edge nanoid IDs assigned to the "new" spider side. */
  newSideEdges: Set<string>
  /** All incident edge nanoid IDs (excluding self-loops), in stable order. */
  allEdges: string[]
  /** Which side is currently receiving edge clicks. */
  activeSide: 'original' | 'new'
  /** Original spider's phase (snapshot). */
  originalPhase: import('./model/types.ts').Phase
}

/** Clipboard data for copy/paste operations. */
export interface Clipboard {
  nodes: Map<string, Node>
  edges: Map<string, Edge>
  centroidX: number
  centroidY: number
}

/**
 * Central application state. Holds the graph, selection, and history.
 * Passed to renderers and input handlers.
 */
export interface AppState {
  graph: GraphData
  history: History
  /** Set of currently selected node IDs. */
  selectedNodes: Set<string>
  /** Set of currently selected edge IDs. */
  selectedEdges: Set<string>
  /** Clipboard for copy/paste. */
  clipboard: Clipboard | null
  /** Hover target for visual feedback (not selection). */
  hoveredNode: string | null
  hoveredEdge: string | null
  /** World-space position of the hover cursor (for partial edge highlighting). */
  hoverWorld: { x: number; y: number } | null
  /** Wire creation: source node being dragged from. */
  wireSourceNode: string | null
  /** Wire creation: candidate target node (glows). */
  wireTargetNode: string | null
  /** Wire creation: current cursor position in world space. */
  wireCursorWorld: { x: number; y: number } | null
  /** Spider fusion: candidate target node (same-color spider that glows). */
  fusionTargetNode: string | null
  /** Animation manager for springs and per-node animations. */
  animations: AnimationManager
  /** Node IDs highlighted by rewrite-rule hover in the panel. */
  rewriteHighlightNodes: Set<string>
  /** Edge IDs highlighted by rewrite-rule hover in the panel. */
  rewriteHighlightEdges: Set<string>
  /** Node IDs eligible for one-click identity removal in proof mode. */
  idRemovalNodes: Set<string>
  /** Edge IDs eligible for one-click Hopf cut in proof mode. Maps edge nanoid → [v1, v2] nanoids. */
  hopfCutEdges: Map<string, [string, string]>
  /** Drag velocity for squash-and-stretch deformation (world px/sec). */
  dragVelocity: { vx: number; vy: number }
  /** IDs of nodes currently being dragged (for deformation rendering). */
  dragNodeIds: Set<string>
  /** Non-null when unfuse wire partition mode is active. */
  unfusePartition: UnfusePartition | null
  /** Non-null when proof mode is active. */
  proof: Proof | null
  /** True when viewing a past step in proof mode (read-only). */
  proofViewingPast: boolean
  /** True during proof setup phase (panel visible, editing unlocked, proof not yet started). */
  proofSetup: boolean
}

export function createAppState(): AppState {
  return {
    graph: createGraph(),
    history: createHistory(),
    selectedNodes: new Set(),
    selectedEdges: new Set(),
    clipboard: null,
    hoveredNode: null,
    hoveredEdge: null,
    hoverWorld: null,
    wireSourceNode: null,
    wireTargetNode: null,
    wireCursorWorld: null,
    fusionTargetNode: null,
    animations: createAnimationManager(),
    rewriteHighlightNodes: new Set(),
    rewriteHighlightEdges: new Set(),
    idRemovalNodes: new Set(),
    hopfCutEdges: new Map(),
    dragVelocity: { vx: 0, vy: 0 },
    dragNodeIds: new Set(),
    unfusePartition: null,
    proof: null,
    proofViewingPast: false,
    proofSetup: false,
  }
}
