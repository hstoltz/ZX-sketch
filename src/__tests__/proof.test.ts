import { describe, it, expect } from 'vitest'
import { NodeType } from '../model/types.ts'
import { createGraph, addNode, addEdge } from '../model/Graph.ts'
import { phase } from '../model/Phase.ts'
import {
  createProof, addStep, currentGraph, goToStep,
  isAtLatest, removeLastStep, setGoal, clearGoal,
} from '../proof/ProofModel.ts'
import { proofToJSON, proofFromJSON } from '../proof/proofSerialize.ts'
import { graphsStructurallyEqual } from '../model/serialize.ts'

function makeTestGraph() {
  const g = createGraph()
  const b1 = addNode(g, NodeType.Boundary, -100, 0)
  const z1 = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
  const b2 = addNode(g, NodeType.Boundary, 100, 0)
  g.inputs.push(b1)
  g.outputs.push(b2)
  addEdge(g, b1, z1)
  addEdge(g, z1, b2)
  return g
}

function makeSimplifiedGraph() {
  const g = createGraph()
  const b1 = addNode(g, NodeType.Boundary, -100, 0)
  const b2 = addNode(g, NodeType.Boundary, 100, 0)
  g.inputs.push(b1)
  g.outputs.push(b2)
  addEdge(g, b1, b2)
  return g
}

describe('ProofModel', () => {
  it('creates a proof with initial graph', () => {
    const g = makeTestGraph()
    const proof = createProof(g)
    expect(proof.steps).toHaveLength(0)
    expect(proof.currentStep).toBe(-1)
    expect(graphsStructurallyEqual(currentGraph(proof), g)).toBe(true)
  })

  it('adds steps and advances currentStep', () => {
    const g = makeTestGraph()
    const proof = createProof(g)

    const g2 = makeSimplifiedGraph()
    addStep(proof, g2, 'Identity Removal', 'id_removal')

    expect(proof.steps).toHaveLength(1)
    expect(proof.currentStep).toBe(0)
    expect(proof.steps[0].ruleName).toBe('Identity Removal')
    expect(proof.steps[0].ruleId).toBe('id_removal')
    expect(graphsStructurallyEqual(currentGraph(proof), g2)).toBe(true)
  })

  it('currentGraph returns initial graph at step -1', () => {
    const g = makeTestGraph()
    const proof = createProof(g)
    addStep(proof, makeSimplifiedGraph(), 'Test', 'test')

    goToStep(proof, -1)
    expect(graphsStructurallyEqual(currentGraph(proof), g)).toBe(true)
  })

  it('goToStep navigates correctly', () => {
    const g = makeTestGraph()
    const proof = createProof(g)
    const g2 = makeSimplifiedGraph()
    addStep(proof, g2, 'Step 1', 's1')

    const g3 = createGraph()
    addNode(g3, NodeType.Z, 50, 50)
    addStep(proof, g3, 'Step 2', 's2')

    expect(proof.currentStep).toBe(1)

    goToStep(proof, 0)
    expect(proof.currentStep).toBe(0)
    expect(graphsStructurallyEqual(currentGraph(proof), g2)).toBe(true)

    goToStep(proof, -1)
    expect(proof.currentStep).toBe(-1)
    expect(graphsStructurallyEqual(currentGraph(proof), g)).toBe(true)
  })

  it('goToStep rejects out of bounds', () => {
    const proof = createProof(makeTestGraph())
    goToStep(proof, -2)
    expect(proof.currentStep).toBe(-1)
    goToStep(proof, 0)
    expect(proof.currentStep).toBe(-1) // no steps exist
  })

  it('isAtLatest works correctly', () => {
    const proof = createProof(makeTestGraph())
    // Empty proof: currentStep=-1, steps.length-1 = -1 → true
    expect(isAtLatest(proof)).toBe(true)

    addStep(proof, makeSimplifiedGraph(), 'Test', 'test')
    expect(isAtLatest(proof)).toBe(true)

    goToStep(proof, -1)
    expect(isAtLatest(proof)).toBe(false)
  })

  it('removeLastStep pops the last step', () => {
    const proof = createProof(makeTestGraph())
    addStep(proof, makeSimplifiedGraph(), 'Step 1', 's1')
    addStep(proof, createGraph(), 'Step 2', 's2')

    expect(proof.steps).toHaveLength(2)

    const removed = removeLastStep(proof)
    expect(removed).toBe(true)
    expect(proof.steps).toHaveLength(1)
    expect(proof.currentStep).toBe(0)
  })

  it('removeLastStep returns false on empty proof', () => {
    const proof = createProof(makeTestGraph())
    expect(removeLastStep(proof)).toBe(false)
    expect(proof.currentStep).toBe(-1)
  })

  it('addStep while viewing past truncates future', () => {
    const proof = createProof(makeTestGraph())
    addStep(proof, makeSimplifiedGraph(), 'Step 1', 's1')
    addStep(proof, createGraph(), 'Step 2', 's2')

    goToStep(proof, 0)
    const g3 = createGraph()
    addNode(g3, NodeType.X, 0, 0)
    addStep(proof, g3, 'New Step 2', 'new_s2')

    expect(proof.steps).toHaveLength(2)
    expect(proof.steps[1].ruleName).toBe('New Step 2')
    expect(proof.currentStep).toBe(1)
  })
})

describe('Goal diagram', () => {
  it('sets and clears goal', () => {
    const proof = createProof(makeTestGraph())
    expect(proof.goalGraph).toBeNull()
    expect(proof.goalReached).toBe(false)

    const goal = makeSimplifiedGraph()
    setGoal(proof, goal)
    expect(proof.goalGraph).not.toBeNull()
    expect(proof.goalReached).toBe(false)
    expect(graphsStructurallyEqual(proof.goalGraph!, goal)).toBe(true)

    clearGoal(proof)
    expect(proof.goalGraph).toBeNull()
    expect(proof.goalReached).toBe(false)
  })

  it('setGoal clones the graph', () => {
    const proof = createProof(makeTestGraph())
    const goal = makeSimplifiedGraph()
    setGoal(proof, goal)

    // Mutating the original should not affect the stored goal
    addNode(goal, NodeType.Z, 200, 200)
    expect(proof.goalGraph!.nodes.size).toBe(goal.nodes.size - 1)
  })

  it('clearGoal resets goalReached', () => {
    const proof = createProof(makeTestGraph())
    setGoal(proof, makeSimplifiedGraph())
    proof.goalReached = true

    clearGoal(proof)
    expect(proof.goalReached).toBe(false)
  })
})

describe('Proof serialization', () => {
  it('round-trips a proof', () => {
    const g = makeTestGraph()
    const proof = createProof(g)

    const g2 = makeSimplifiedGraph()
    addStep(proof, g2, 'Identity Removal', 'id_removal')
    proof.steps[0].label = 'Removed identity wire'

    const json = proofToJSON(proof)
    const restored = proofFromJSON(json)

    expect(restored.steps).toHaveLength(1)
    expect(restored.steps[0].ruleName).toBe('Identity Removal')
    expect(restored.steps[0].ruleId).toBe('id_removal')
    expect(restored.steps[0].label).toBe('Removed identity wire')
    expect(restored.currentStep).toBe(0)

    // Structural equality (IDs regenerated, so we compare structure)
    expect(graphsStructurallyEqual(currentGraph(restored), g2)).toBe(true)
  })

  it('round-trips an empty proof', () => {
    const proof = createProof(makeTestGraph())
    const json = proofToJSON(proof)
    const restored = proofFromJSON(json)
    expect(restored.steps).toHaveLength(0)
    expect(restored.currentStep).toBe(-1)
  })

  it('round-trips a proof with goal', () => {
    const proof = createProof(makeTestGraph())
    addStep(proof, makeSimplifiedGraph(), 'Step 1', 's1')
    const goal = makeSimplifiedGraph()
    setGoal(proof, goal)

    const json = proofToJSON(proof)
    const restored = proofFromJSON(json)

    expect(restored.goalGraph).not.toBeNull()
    expect(graphsStructurallyEqual(restored.goalGraph!, goal)).toBe(true)
    expect(restored.goalReached).toBe(false)
  })

  it('round-trips a proof without goal', () => {
    const proof = createProof(makeTestGraph())
    const json = proofToJSON(proof)
    const restored = proofFromJSON(json)
    expect(restored.goalGraph).toBeNull()
  })

  it('rejects unsupported format', () => {
    expect(() => proofFromJSON('{"version": 99}')).toThrow('Unsupported proof format')
  })
})
