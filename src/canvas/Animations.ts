import { createSpring, stepSpring, SPRING_PRESETS } from './Spring.ts'
import type { Spring } from './Spring.ts'
import type { EdgeType } from '../model/types.ts'

/** Returns true if the user prefers reduced motion. */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}


/**
 * Per-node animation state.
 * Each node can have a scale spring (for pop-in / fade-out)
 * and an opacity spring (for deletion).
 */
export interface NodeAnimation {
  scale: Spring
  opacity: Spring
  /** If true, remove the animation entry once at rest. */
  removeWhenDone: boolean
  /** If set, call this when the animation completes (springs at rest). */
  onComplete?: () => void
}

/** Per-node position offset animation (decaying to 0). */
export interface NodeMoveAnimation {
  xSpring: Spring
  ySpring: Spring
}

/** Per-edge opacity animation. */
export interface EdgeAnimation {
  opacity: Spring
  removeWhenDone: boolean
}

/**
 * Ghost node: a node that has been deleted but is still animating out.
 * We store just enough info to draw it during the fade.
 */
export interface GhostNode {
  id: string
  x: number
  y: number
  type: number    // NodeType value
  phaseLabel: string
  anim: NodeAnimation
}

/**
 * Ghost edge: a removed edge still fading out.
 * Stores resolved endpoint positions captured before replaceGraph.
 */
export interface GhostEdge {
  id: string
  source: { x: number; y: number }
  target: { x: number; y: number }
  type: EdgeType
  anim: EdgeAnimation
}

/**
 * Manages all active animations. Ticked once per frame.
 */
export interface AnimationManager {
  /** Per-node animations (keyed by node ID). */
  nodes: Map<string, NodeAnimation>
  /** Ghost nodes (deleted, still fading out). */
  ghosts: GhostNode[]
  /** Per-node position offset animations. */
  nodeMoves: Map<string, NodeMoveAnimation>
  /** Per-edge opacity animations. */
  edgeAnims: Map<string, EdgeAnimation>
  /** Ghost edges (deleted, still fading out). */
  ghostEdges: GhostEdge[]
  /** Cross-fade animation for large diffs. */
  crossFade: { opacity: Spring } | null
  /** Zoom spring for smooth zoom transitions. */
  zoomSpring: Spring
  /** Whether any animation is active (need to keep rendering). */
  hasActiveAnimations: boolean

  /** Start a pop-in animation for a newly placed node. */
  animateNodeIn(nodeId: string): void
  /** Start a fade-out animation for a deleted node. */
  animateNodeOut(ghost: GhostNode): void
  /** Start a fusion collapse: the absorbed node shrinks toward the target. */
  animateFusionCollapse(ghost: GhostNode, targetX: number, targetY: number): void
  /** Get the current animated scale for a node (1.0 if no animation). */
  getNodeScale(nodeId: string): number
  /** Get the current animated opacity for a node (1.0 if no animation). */
  getNodeOpacity(nodeId: string): number
  /** Animate a node moving from (fromX, fromY) to its current position via decaying offset. */
  animateNodeMove(nodeId: string, fromX: number, fromY: number): void
  /** Get the current animated position offset for a node (0,0 if no animation). */
  getNodeOffset(nodeId: string): { dx: number; dy: number }
  /** Start an edge fade-in animation. */
  animateEdgeIn(edgeId: string): void
  /** Start an edge fade-out animation for a removed edge. */
  animateEdgeOut(ghost: GhostEdge): void
  /** Get the current animated opacity for an edge (1.0 if no animation). */
  getEdgeOpacity(edgeId: string): number
  /** Start a fusion wobble (surviving node briefly swells then settles). */
  animateFusionWobble(nodeId: string): void
  /** Start a whole-scene cross-fade (for large diffs). */
  startCrossFade(): void
  /** Get cross-fade progress (null if no cross-fade active). */
  getCrossFadeProgress(): number | null
  /** Tick all animations. Returns true if any are still active. */
  tick(dt: number): boolean
}

export function createAnimationManager(): AnimationManager {
  const nodes = new Map<string, NodeAnimation>()
  const ghosts: GhostNode[] = []
  const nodeMoves = new Map<string, NodeMoveAnimation>()
  const edgeAnims = new Map<string, EdgeAnimation>()
  const ghostEdges: GhostEdge[] = []
  let crossFade: { opacity: Spring } | null = null
  const zoomSpring = createSpring(1)

  const manager: AnimationManager = {
    nodes,
    ghosts,
    nodeMoves,
    edgeAnims,
    ghostEdges,
    crossFade: null,
    zoomSpring,
    hasActiveAnimations: false,

    animateNodeIn(nodeId: string) {
      if (prefersReducedMotion()) return  // node appears instantly at full size
      nodes.set(nodeId, {
        scale: createSpring(0.3, 1),     // start small, spring to full size
        opacity: createSpring(1),         // fully opaque immediately
        removeWhenDone: true,
      })
      // Give initial pop velocity for overshoot
      const anim = nodes.get(nodeId)!
      anim.scale.velocity = 4
      manager.hasActiveAnimations = true
    },

    animateNodeOut(ghost: GhostNode) {
      if (prefersReducedMotion()) return  // node disappears instantly
      ghost.anim = {
        scale: createSpring(1, 0),       // shrink to zero
        opacity: createSpring(1, 0),     // fade out
        removeWhenDone: true,
      }
      ghosts.push(ghost)
      manager.hasActiveAnimations = true
    },

    animateFusionCollapse(ghost: GhostNode, _targetX: number, _targetY: number) {
      if (prefersReducedMotion()) return  // instant collapse
      ghost.anim = {
        scale: createSpring(1, 0),       // shrink to zero
        opacity: createSpring(1, 0),     // fade out
        removeWhenDone: true,
      }
      ghosts.push(ghost)
      manager.hasActiveAnimations = true
    },

    animateFusionWobble(nodeId: string) {
      if (prefersReducedMotion()) return
      nodes.set(nodeId, {
        scale: createSpring(1.15, 1),    // swell from 1.15 then settle to 1.0
        opacity: createSpring(1),
        removeWhenDone: true,
      })
      manager.hasActiveAnimations = true
    },

    getNodeScale(nodeId: string): number {
      const anim = nodes.get(nodeId)
      return anim ? anim.scale.value : 1
    },

    getNodeOpacity(nodeId: string): number {
      const anim = nodes.get(nodeId)
      return anim ? anim.opacity.value : 1
    },

    animateNodeMove(nodeId: string, fromX: number, fromY: number) {
      if (prefersReducedMotion()) return  // instant move
      // Offset = fromPos - currentPos, decaying to 0
      // The graph model already has the final position; we animate a visual offset
      nodeMoves.set(nodeId, {
        xSpring: createSpring(fromX, 0),
        ySpring: createSpring(fromY, 0),
      })
      manager.hasActiveAnimations = true
    },

    getNodeOffset(nodeId: string): { dx: number; dy: number } {
      const move = nodeMoves.get(nodeId)
      if (!move) return { dx: 0, dy: 0 }
      return { dx: move.xSpring.value, dy: move.ySpring.value }
    },

    animateEdgeIn(edgeId: string) {
      if (prefersReducedMotion()) return  // edge appears instantly
      edgeAnims.set(edgeId, {
        opacity: createSpring(0, 1),
        removeWhenDone: true,
      })
      manager.hasActiveAnimations = true
    },

    animateEdgeOut(ghost: GhostEdge) {
      if (prefersReducedMotion()) return  // edge disappears instantly
      ghost.anim = {
        opacity: createSpring(1, 0),
        removeWhenDone: true,
      }
      ghostEdges.push(ghost)
      manager.hasActiveAnimations = true
    },

    getEdgeOpacity(edgeId: string): number {
      const anim = edgeAnims.get(edgeId)
      return anim ? anim.opacity.value : 1
    },

    startCrossFade() {
      if (prefersReducedMotion()) return  // instant transition
      crossFade = { opacity: createSpring(0, 1) }
      manager.crossFade = crossFade
      manager.hasActiveAnimations = true
    },

    getCrossFadeProgress(): number | null {
      return crossFade ? crossFade.opacity.value : null
    },

    tick(dt: number): boolean {
      let anyActive = false

      // Tick node scale/opacity animations
      for (const [id, anim] of nodes) {
        const scaleActive = stepSpring(anim.scale, SPRING_PRESETS.bouncy.stiffness, SPRING_PRESETS.bouncy.damping, dt)
        const opacityActive = stepSpring(anim.opacity, SPRING_PRESETS.fast.stiffness, SPRING_PRESETS.fast.damping, dt)

        if (scaleActive || opacityActive) {
          anyActive = true
        } else if (anim.removeWhenDone) {
          anim.onComplete?.()
          nodes.delete(id)
        }
      }

      // Tick ghost node animations
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const ghost = ghosts[i]
        const scaleActive = stepSpring(ghost.anim.scale, SPRING_PRESETS.fast.stiffness, SPRING_PRESETS.fast.damping, dt)
        const opacityActive = stepSpring(ghost.anim.opacity, SPRING_PRESETS.fast.stiffness, SPRING_PRESETS.fast.damping, dt)

        if (scaleActive || opacityActive) {
          anyActive = true
        } else {
          ghost.anim.onComplete?.()
          ghosts.splice(i, 1)
        }
      }

      // Tick node move animations
      for (const [id, move] of nodeMoves) {
        const xActive = stepSpring(move.xSpring, SPRING_PRESETS.fast.stiffness, SPRING_PRESETS.fast.damping, dt)
        const yActive = stepSpring(move.ySpring, SPRING_PRESETS.fast.stiffness, SPRING_PRESETS.fast.damping, dt)

        if (xActive || yActive) {
          anyActive = true
        } else {
          nodeMoves.delete(id)
        }
      }

      // Tick edge opacity animations
      for (const [id, anim] of edgeAnims) {
        const active = stepSpring(anim.opacity, SPRING_PRESETS.fast.stiffness, SPRING_PRESETS.fast.damping, dt)
        if (active) {
          anyActive = true
        } else if (anim.removeWhenDone) {
          edgeAnims.delete(id)
        }
      }

      // Tick ghost edge animations
      for (let i = ghostEdges.length - 1; i >= 0; i--) {
        const ge = ghostEdges[i]
        const active = stepSpring(ge.anim.opacity, SPRING_PRESETS.fast.stiffness, SPRING_PRESETS.fast.damping, dt)
        if (active) {
          anyActive = true
        } else {
          ghostEdges.splice(i, 1)
        }
      }

      // Tick cross-fade
      if (crossFade) {
        const active = stepSpring(crossFade.opacity, SPRING_PRESETS.gentle.stiffness, SPRING_PRESETS.gentle.damping, dt)
        if (active) {
          anyActive = true
        } else {
          crossFade = null
          manager.crossFade = null
        }
      }

      manager.hasActiveAnimations = anyActive
      return anyActive
    },
  }

  return manager
}
