import type { GraphData } from './types.ts'
import { cloneGraph } from './Graph.ts'

interface HistoryEntry {
  /** The graph state before the operation. */
  snapshot: GraphData
  /** Human-readable label for the operation (e.g. "Fuse Z(π/4) + Z(π/2)"). */
  label: string
}

const MAX_UNDO = 200

/** Snapshot-based undo/redo. */
export interface History {
  /** Save a snapshot of the current graph state before mutating it. */
  save(graph: GraphData, label: string): void
  /** Undo: restore the previous state. Returns the label or null if nothing to undo. */
  undo(graph: GraphData): string | null
  /** Redo: re-apply the undone change. Returns the label or null if nothing to redo. */
  redo(graph: GraphData): string | null
  /** Whether undo is available. */
  canUndo(): boolean
  /** Whether redo is available. */
  canRedo(): boolean
  /** Label of the next undo operation, or null. */
  undoLabel(): string | null
  /** Label of the next redo operation, or null. */
  redoLabel(): string | null
  /** Clear all history. */
  clear(): void
}

export function createHistory(): History {
  const undoStack: HistoryEntry[] = []
  const redoStack: HistoryEntry[] = []

  return {
    save(graph: GraphData, label: string) {
      undoStack.push({ snapshot: cloneGraph(graph), label })
      if (undoStack.length > MAX_UNDO) {
        undoStack.shift()
      }
      // Any new operation invalidates the redo stack
      redoStack.length = 0
    },

    undo(graph: GraphData): string | null {
      const entry = undoStack.pop()
      if (!entry) return null

      // Save current state to redo stack
      redoStack.push({ snapshot: cloneGraph(graph), label: entry.label })

      // Replace graph contents with the snapshot
      replaceGraphContents(graph, entry.snapshot)
      return entry.label
    },

    redo(graph: GraphData): string | null {
      const entry = redoStack.pop()
      if (!entry) return null

      // Save current state to undo stack
      undoStack.push({ snapshot: cloneGraph(graph), label: entry.label })

      // Replace graph contents with the redo snapshot
      replaceGraphContents(graph, entry.snapshot)
      return entry.label
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null,
    redoLabel: () => redoStack.length > 0 ? redoStack[redoStack.length - 1].label : null,

    clear() {
      undoStack.length = 0
      redoStack.length = 0
    },
  }
}

/** Replace contents of `target` with `source`, mutating in place. */
function replaceGraphContents(target: GraphData, source: GraphData): void {
  target.nodes.clear()
  for (const [id, node] of source.nodes) target.nodes.set(id, node)

  target.edges.clear()
  for (const [id, edge] of source.edges) target.edges.set(id, edge)

  target.incidentEdges.clear()
  for (const [id, set] of source.incidentEdges) target.incidentEdges.set(id, new Set(set))

  target.inputs.length = 0
  target.inputs.push(...source.inputs)

  target.outputs.length = 0
  target.outputs.push(...source.outputs)

  ;(target as { scalar?: typeof source.scalar }).scalar = source.scalar
    ? { ...source.scalar }
    : undefined
}
