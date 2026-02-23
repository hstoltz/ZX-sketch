export interface RewriteRule {
  id: string
  name: string
  description: string
  /** Key in the Python worker's rule_map. */
  pyzxName: string
  category: 'basic' | 'graph_like'
}

export const RULE_CATALOG: RewriteRule[] = [
  // --- Basic rules ---
  {
    id: 'spider_fusion',
    name: 'Spider Fusion',
    description: 'Fuse two same-color spiders connected by a simple edge',
    pyzxName: 'spider_fusion',
    category: 'basic',
  },
  {
    id: 'id_removal',
    name: 'Identity Removal',
    description: 'Remove a phaseless degree-2 spider (identity wire)',
    pyzxName: 'id_removal',
    category: 'basic',
  },
  {
    id: 'bialgebra',
    name: 'Bialgebra',
    description: 'Apply the bialgebra (Hopf) law to connected Z/X spiders',
    pyzxName: 'bialgebra',
    category: 'basic',
  },
  {
    id: 'bialgebra_op',
    name: 'Bialgebra (Reverse)',
    description: 'Compress a complete bipartite Z/X group into two connected spiders',
    pyzxName: 'bialgebra_op',
    category: 'basic',
  },
  {
    id: 'hopf',
    name: 'Hopf',
    description: 'Remove parallel edges between two spiders (Hadamard if same color, simple if different)',
    pyzxName: 'hopf',
    category: 'basic',
  },
  {
    id: 'copy',
    name: 'Copy',
    description: 'Remove a phaseless degree-1 spider via bialgebra (copy rule)',
    pyzxName: 'copy',
    category: 'basic',
  },
  {
    id: 'color_change',
    name: 'Color Change',
    description: 'Switch spider color by inserting Hadamard edges on all wires',
    pyzxName: 'color_change',
    category: 'basic',
  },
  {
    id: 'self_loops',
    name: 'Self-Loops',
    description: 'Remove self-loop edges from a spider',
    pyzxName: 'self_loops',
    category: 'basic',
  },
  {
    id: 'unfuse',
    name: 'Unfuse',
    description: 'Split a spider into two same-color spiders (choose wire partition)',
    pyzxName: 'unfuse',
    category: 'basic',
  },
  {
    id: 'push_pauli',
    name: 'Push Pauli',
    description: 'Push a π-phase spider through a same-color (Hadamard) or opposite-color (simple) neighbor',
    pyzxName: 'push_pauli',
    category: 'basic',
  },
  {
    id: 'decompose_hadamard',
    name: 'Decompose Hadamard',
    description: 'Replace a Hadamard edge with Z(π/2)·X(π/2)·Z(π/2)',
    pyzxName: 'decompose_hadamard',
    category: 'basic',
  },
  {
    id: 'gadgetize',
    name: 'Gadgetize',
    description: 'Extract non-Clifford phase into a degree-1 phase gadget',
    pyzxName: 'gadgetize',
    category: 'basic',
  },
  {
    id: 'wire_vertex',
    name: 'Add Wire Vertex',
    description: 'Insert a phaseless identity spider on a wire (inverse of id removal)',
    pyzxName: 'wire_vertex',
    category: 'basic',
  },

  // --- Graph-like rules ---
  {
    id: 'lcomp',
    name: 'Local Complementation',
    description: 'Apply local complementation to a proper Clifford spider',
    pyzxName: 'lcomp',
    category: 'graph_like',
  },
  {
    id: 'pivot',
    name: 'Pivot',
    description: 'Apply pivoting to two connected proper Clifford spiders',
    pyzxName: 'pivot',
    category: 'graph_like',
  },
  {
    id: 'pivot_boundary',
    name: 'Boundary Pivot',
    description: 'Apply pivoting with a boundary vertex',
    pyzxName: 'pivot_boundary',
    category: 'graph_like',
  },
  {
    id: 'pivot_gadget',
    name: 'Gadget Pivot',
    description: 'Apply pivoting with a phase gadget',
    pyzxName: 'pivot_gadget',
    category: 'graph_like',
  },
  {
    id: 'phase_gadget_fuse',
    name: 'Fuse Phase Gadgets',
    description: 'Merge phase gadgets that act on the same targets',
    pyzxName: 'phase_gadget_fuse',
    category: 'graph_like',
  },
  {
    id: 'supplementarity',
    name: 'Supplementarity',
    description: 'Apply the supplementarity rule to non-Clifford spiders',
    pyzxName: 'supplementarity',
    category: 'graph_like',
  },
]
