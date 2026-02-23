import { NodeType } from './types.ts'
import type { GraphData } from './types.ts'

export interface ValidationError {
  severity: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
}

/**
 * Validate all graph invariants. Returns an array of errors/warnings.
 * An empty array means the graph is valid.
 */
export function validate(g: GraphData): ValidationError[] {
  const errors: ValidationError[] = []

  // Check boundary node arity
  for (const [id, node] of g.nodes) {
    if (node.type === NodeType.Boundary) {
      const deg = g.incidentEdges.get(id)?.size ?? 0
      if (deg === 0) {
        errors.push({
          severity: 'warning',
          message: `Boundary node has no edge (disconnected)`,
          nodeId: id,
        })
      } else if (deg > 1) {
        errors.push({
          severity: 'error',
          message: `Boundary node has ${deg} edges (must have exactly 1)`,
          nodeId: id,
        })
      }
    }
  }

  // Check for orphaned edges
  for (const [id, edge] of g.edges) {
    if (!g.nodes.has(edge.source)) {
      errors.push({
        severity: 'error',
        message: `Edge references nonexistent source node ${edge.source}`,
        edgeId: id,
      })
    }
    if (!g.nodes.has(edge.target)) {
      errors.push({
        severity: 'error',
        message: `Edge references nonexistent target node ${edge.target}`,
        edgeId: id,
      })
    }
  }

  // Check phase validity
  for (const [id, node] of g.nodes) {
    if (node.type === NodeType.Z || node.type === NodeType.X) {
      if (node.phase.d === 0) {
        errors.push({
          severity: 'error',
          message: `Spider has invalid phase (denominator is 0)`,
          nodeId: id,
        })
      }
    }
  }

  // Check inputs/outputs reference existing boundary nodes
  for (const id of g.inputs) {
    const node = g.nodes.get(id)
    if (!node) {
      errors.push({
        severity: 'error',
        message: `Input references nonexistent node ${id}`,
      })
    } else if (node.type !== NodeType.Boundary) {
      errors.push({
        severity: 'error',
        message: `Input references non-boundary node ${id}`,
        nodeId: id,
      })
    }
  }

  for (const id of g.outputs) {
    const node = g.nodes.get(id)
    if (!node) {
      errors.push({
        severity: 'error',
        message: `Output references nonexistent node ${id}`,
      })
    } else if (node.type !== NodeType.Boundary) {
      errors.push({
        severity: 'error',
        message: `Output references non-boundary node ${id}`,
        nodeId: id,
      })
    }
  }

  // Check no node appears in both inputs and outputs
  const inputSet = new Set(g.inputs)
  for (const id of g.outputs) {
    if (inputSet.has(id)) {
      errors.push({
        severity: 'error',
        message: `Node ${id} appears in both inputs and outputs`,
        nodeId: id,
      })
    }
  }

  // Check for duplicate IDs in inputs/outputs
  if (new Set(g.inputs).size !== g.inputs.length) {
    errors.push({
      severity: 'error',
      message: `Duplicate entries in inputs list`,
    })
  }
  if (new Set(g.outputs).size !== g.outputs.length) {
    errors.push({
      severity: 'error',
      message: `Duplicate entries in outputs list`,
    })
  }

  return errors
}

/** Returns only errors (not warnings). */
export function hasErrors(g: GraphData): boolean {
  return validate(g).some(e => e.severity === 'error')
}
