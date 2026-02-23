import type { AppState } from '../AppState.ts'
import type { GraphData } from '../model/types.ts'
import type { GraphDiff } from '../model/reconcile.ts'
import type { GhostNode, GhostEdge } from '../canvas/Animations.ts'
import { replaceGraph } from '../ui/Autosave.ts'
import { rebuildSpatialIndex } from '../canvas/HitTest.ts'
import { phaseToString } from '../model/Phase.ts'

const CROSS_FADE_THRESHOLD = 20

/** Animate a rewrite transition. Cross-fades if diff is large. */
export function animateRewriteTransition(
  app: AppState,
  diff: GraphDiff,
  newGraph: GraphData,
): void {
  const totalChange = diff.removedNodeIds.size + diff.addedNodes.size

  // --- Cross-fade path for large diffs ---
  if (totalChange > CROSS_FADE_THRESHOLD) {
    // Clean up selections for removed items before replacing
    for (const id of diff.removedNodeIds) app.selectedNodes.delete(id)
    for (const id of diff.removedEdgeIds) app.selectedEdges.delete(id)

    replaceGraph(app.graph, newGraph)
    rebuildSpatialIndex(app.graph)
    app.animations.startCrossFade()
    return
  }

  // --- Per-element animation path ---

  // 1. BEFORE replace: capture ghosts for removed nodes
  for (const nodeId of diff.removedNodeIds) {
    const node = app.graph.nodes.get(nodeId)
    if (!node) continue
    const ghost: GhostNode = {
      id: node.id,
      x: node.x,
      y: node.y,
      type: node.type,
      phaseLabel: phaseToString(node.phase),
      anim: { scale: { value: 1, target: 0, velocity: 0 }, opacity: { value: 1, target: 0, velocity: 0 }, removeWhenDone: true },
    }
    app.animations.animateNodeOut(ghost)
  }

  // 2. BEFORE replace: capture ghosts for removed edges
  for (const edgeId of diff.removedEdgeIds) {
    const edge = app.graph.edges.get(edgeId)
    if (!edge) continue
    const sourceNode = app.graph.nodes.get(edge.source)
    const targetNode = app.graph.nodes.get(edge.target)
    if (!sourceNode || !targetNode) continue
    const ghost: GhostEdge = {
      id: edge.id,
      source: { x: sourceNode.x, y: sourceNode.y },
      target: { x: targetNode.x, y: targetNode.y },
      type: edge.type,
      anim: { opacity: { value: 1, target: 0, velocity: 0 }, removeWhenDone: true },
    }
    app.animations.animateEdgeOut(ghost)
  }

  // 3. BEFORE replace: save old positions for surviving nodes
  const oldPositions = new Map<string, { x: number; y: number }>()
  for (const [nodeId, node] of diff.survivingNodes) {
    const oldNode = app.graph.nodes.get(nodeId)
    if (oldNode) {
      oldPositions.set(nodeId, { x: oldNode.x, y: oldNode.y })
    } else {
      oldPositions.set(nodeId, { x: node.x, y: node.y })
    }
  }

  // Clean up selections for removed items
  for (const id of diff.removedNodeIds) app.selectedNodes.delete(id)
  for (const id of diff.removedEdgeIds) app.selectedEdges.delete(id)

  // 4. REPLACE
  replaceGraph(app.graph, newGraph)
  rebuildSpatialIndex(app.graph)

  // 5. AFTER replace: animate added nodes popping in
  for (const nodeId of diff.addedNodes.keys()) {
    app.animations.animateNodeIn(nodeId)
  }

  // 6. AFTER replace: animate added edges fading in
  for (const edgeId of diff.addedEdges.keys()) {
    app.animations.animateEdgeIn(edgeId)
  }

  // 7. AFTER replace: animate surviving nodes that moved
  for (const [nodeId] of diff.survivingNodes) {
    const oldPos = oldPositions.get(nodeId)
    const newNode = newGraph.nodes.get(nodeId)
    if (!oldPos || !newNode) continue

    const dx = oldPos.x - newNode.x
    const dy = oldPos.y - newNode.y
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      app.animations.animateNodeMove(nodeId, dx, dy)
    }
  }
}
