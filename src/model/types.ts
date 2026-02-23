/** Node types matching PyZX VertexType enum values. */
export enum NodeType {
  Boundary = 0,
  Z = 1,
  X = 2,
}

/** Edge types matching PyZX EdgeType enum values. */
export enum EdgeType {
  Simple = 1,
  Hadamard = 2,
}

/**
 * Exact rational phase as a fraction of pi.
 * E.g. { n: 3, d: 4 } represents 3pi/4.
 * Always kept in lowest terms with d > 0 and 0 <= n/d < 2.
 */
export interface Phase {
  /** Numerator */
  readonly n: number
  /** Denominator (always positive) */
  readonly d: number
}

export interface Node {
  readonly id: string
  readonly type: NodeType
  x: number
  y: number
  readonly phase: Phase
  readonly ground?: boolean
}

export interface Edge {
  readonly id: string
  source: string
  target: string
  readonly type: EdgeType
}

/**
 * A ZX-diagram graph.
 * Nodes and edges are stored by ID for O(1) lookup.
 * Each node caches its set of incident edge IDs for O(1) degree queries.
 */
export interface GraphData {
  readonly nodes: Map<string, Node>
  readonly edges: Map<string, Edge>
  /** Incident edge IDs per node, kept in sync with edges map. */
  readonly incidentEdges: Map<string, Set<string>>
  /** Ordered list of input boundary node IDs. */
  readonly inputs: string[]
  /** Ordered list of output boundary node IDs. */
  readonly outputs: string[]
  readonly scalar?: { power2: number; phase: string }
}
