export interface RewriteRule {
  id: string
  name: string
  description: string
  /** Key in the Python worker's rule_map. */
  pyzxName: string
  category: 'basic' | 'graph_like' | 'stabilizer'
}

/** BPW2020 minimal stabilizer ZX-calculus axiom set (minus B2'). */
export const BPW2020_CATALOG: RewriteRule[] = [
  {
    id: 'spider_fusion',
    name: 'S1 \u2014 Spider Fusion',
    description: 'Fuse two same-color spiders connected by a simple edge (phases add)',
    pyzxName: 'spider_fusion',
    category: 'stabilizer',
  },
  {
    id: 'unfuse',
    name: 'S1\u207b\u00b9 \u2014 Unfuse',
    description: 'Split a spider into two same-color spiders (choose wire partition)',
    pyzxName: 'unfuse',
    category: 'stabilizer',
  },
  {
    id: 'id_removal',
    name: "S3' \u2014 Identity Removal",
    description: 'Remove a phaseless degree-2 spider (induced compact structure)',
    pyzxName: 'id_removal',
    category: 'stabilizer',
  },
  {
    id: 'wire_vertex',
    name: "S3'\u207b\u00b9 \u2014 Wire Vertex",
    description: 'Insert a phaseless identity spider on a wire',
    pyzxName: 'wire_vertex',
    category: 'stabilizer',
  },
  {
    id: 'b1_copy',
    name: 'B1 \u2014 Copy',
    description: 'Copy a phaseless X(0) through a Z(0) spider (consumes a Z-X scalar pair)',
    pyzxName: 'b1_copy',
    category: 'stabilizer',
  },
  {
    id: 'b1_uncopy',
    name: 'B1\u207b\u00b9 \u2014 Uncopy',
    description: 'Merge phaseless X(0) degree-1 spiders into a Z-X structure (creates a scalar pair)',
    pyzxName: 'b1_uncopy',
    category: 'stabilizer',
  },
  {
    id: 'euler_prime',
    name: "EU' \u2014 Euler Decompose",
    description: 'Decompose Hadamard edge into Z(\u03c0/2)\u2013X(0)\u2013Z(\u03c0/2) chain with Z(-\u03c0/2) leaf',
    pyzxName: 'euler_prime',
    category: 'stabilizer',
  },
  {
    id: 'euler_prime_rev',
    name: "EU'\u207b\u00b9 \u2014 Euler Compose",
    description: 'Compose Z(\u03c0/2)\u2013X(0)\u2013Z(\u03c0/2) chain with Z(-\u03c0/2) leaf into Hadamard edge',
    pyzxName: 'euler_prime_rev',
    category: 'stabilizer',
  },
  {
    id: 'color_change',
    name: 'H \u2014 Color Change',
    description: 'Switch spider color by toggling all edge types (simple\u2194Hadamard)',
    pyzxName: 'color_change',
    category: 'stabilizer',
  },
  {
    id: 'color_change_rev',
    name: 'H\u207b\u00b9 \u2014 Color Change',
    description: 'Switch spider color by toggling all edge types (involution)',
    pyzxName: 'color_change',
    category: 'stabilizer',
  },
  {
    id: 'identity_void',
    name: "IV' \u2014 Identity Void",
    description: 'Remove two triple-edge Z-X pairs and a Z(0) scalar (= empty diagram)',
    pyzxName: 'identity_void',
    category: 'stabilizer',
  },
  {
    id: 'identity_void_rev',
    name: "IV'\u207b\u00b9 \u2014 Create Scalar",
    description: 'Create the scalar identity pattern (two triple-edge Z-X pairs + Z(0) scalar)',
    pyzxName: 'identity_void_rev',
    category: 'stabilizer',
  },
  {
    id: 'zero_op',
    name: "ZO' \u2014 Zero (Z\u2192X)",
    description: 'With Z(\u03c0) scalar present: change phaseless Z degree-1 spider to X',
    pyzxName: 'zero_op',
    category: 'stabilizer',
  },
  {
    id: 'zero_op_rev',
    name: "ZO'\u207b\u00b9 \u2014 Zero (X\u2192Z)",
    description: 'With Z(\u03c0) scalar present: change phaseless X degree-1 spider to Z',
    pyzxName: 'zero_op_rev',
    category: 'stabilizer',
  },
]

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
