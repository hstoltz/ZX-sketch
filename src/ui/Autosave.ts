import type { AppState } from '../AppState.ts'
import type { GraphData } from '../model/types.ts'
import { toJSON, fromJSON } from '../model/serialize.ts'
import { rebuildSpatialIndex } from '../canvas/HitTest.ts'

const STORAGE_KEY = 'zx-sketch-autosave'
const DEBOUNCE_MS = 1000

/**
 * Autosave to localStorage, debounced. Also handles restore-on-load.
 */
export function setupAutosave(
  app: AppState,
): { scheduleAutosave: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  function save() {
    try {
      const json = toJSON(app.graph)
      localStorage.setItem(STORAGE_KEY, json)
    } catch {
      // localStorage full or unavailable — silently ignore
    }
  }

  function scheduleAutosave() {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(save, DEBOUNCE_MS)
  }

  return { scheduleAutosave }
}

/**
 * Check for an autosaved diagram and restore it if the user confirms.
 * Returns true if a diagram was restored.
 */
export function restoreAutosave(app: AppState): boolean {
  try {
    const json = localStorage.getItem(STORAGE_KEY)
    if (!json) return false

    const graph = fromJSON(json)
    // Only restore if the graph has content
    if (graph.nodes.size === 0) return false

    replaceGraph(app.graph, graph)
    app.history.clear()
    app.selectedNodes.clear()
    app.selectedEdges.clear()
    rebuildSpatialIndex(app.graph)
    return true
  } catch {
    // Corrupted autosave — clear it
    localStorage.removeItem(STORAGE_KEY)
    return false
  }
}

/**
 * Replace the contents of target graph with source graph (in place).
 * Preserves the target object reference so external references remain valid.
 */
export function replaceGraph(target: GraphData, source: GraphData): void {
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
}
