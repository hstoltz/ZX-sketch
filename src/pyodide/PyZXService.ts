import { nanoid } from 'nanoid'

type ProgressCallback = (stage: string, percent: number) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface GraphInfo {
  num_vertices: number
  num_edges: number
  tcount: number
}

export interface PyZXService {
  /** Initialize the PyZX engine. Lazy — called automatically on first use. */
  init(): Promise<void>

  /** Whether the engine is ready for requests. */
  isReady(): boolean

  /** Apply a simplification strategy. Returns the resulting PyZX JSON string. */
  simplify(graphJson: string, strategy: string): Promise<string>

  /** Find all matches for a rewrite rule. Returns array of vertex-ID matches. */
  findMatches(graphJson: string, rule: string): Promise<number[][]>

  /** Find matches for ALL rules in a single call (one graph load). */
  findAllMatches(graphJson: string, rules: string[]): Promise<Record<string, number[][]>>

  /** Apply a specific rewrite rule to a match. Returns the resulting PyZX JSON string. */
  applyRewrite(graphJson: string, rule: string, match: number[], unfusePhase?: { n: number; d: number }): Promise<string>

  /** Convert an OpenQASM 2.0 circuit string to a PyZX JSON graph string. */
  fromQASM(qasmText: string): Promise<string>

  /** Split a spider into two same-color spiders connected by a simple edge. */
  splitSpider(graphJson: string, nodeId: number, phase1N: number, phase1D: number): Promise<string>

  /** Get graph statistics (node count, edge count, T-count). */
  graphInfo(graphJson: string): Promise<GraphInfo>

  /** Compare two graphs for semantic equality (same linear map up to scalar). */
  compareTensors(graph1Json: string, graph2Json: string): Promise<boolean>

  /** Register a progress callback for initialization. */
  onProgress(callback: ProgressCallback): void
}

const REQUEST_TIMEOUT = 120_000 // 2 minutes (simplification can be slow)

export function createPyZXService(): PyZXService {
  let worker: Worker | null = null
  let ready = false
  let initPromise: Promise<void> | null = null
  const pending = new Map<string, PendingRequest>()
  let progressCallback: ProgressCallback | null = null

  function getWorker(): Worker {
    if (!worker) {
      worker = new Worker('/pyodide-worker.mjs', { type: 'module' })
      worker.onmessage = handleMessage
      worker.onerror = handleError
    }
    return worker
  }

  function handleMessage(e: MessageEvent) {
    const msg = e.data

    // Progress updates have no ID — they're broadcast during init
    if (msg.type === 'progress') {
      progressCallback?.(msg.stage, msg.percent)
      return
    }

    const id: string | undefined = msg.id
    if (id && pending.has(id)) {
      const req = pending.get(id)!
      pending.delete(id)
      clearTimeout(req.timer)

      if (msg.type === 'error') {
        req.reject(new Error(msg.message))
      } else {
        req.resolve(msg)
      }
    }
  }

  function handleError(e: ErrorEvent) {
    console.error('PyZX worker error:', e)
    for (const [id, req] of pending) {
      clearTimeout(req.timer)
      req.reject(new Error('Worker error: ' + e.message))
      pending.delete(id)
    }
  }

  function sendMessage(type: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = nanoid()
    const w = getWorker()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`PyZX request timed out after ${REQUEST_TIMEOUT / 1000}s (${type})`))
      }, REQUEST_TIMEOUT)

      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })

      w.postMessage({ id, type, ...data })
    })
  }

  return {
    async init() {
      if (ready) return
      if (initPromise) return initPromise

      initPromise = (async () => {
        try {
          await sendMessage('init')
          ready = true
        } catch (err) {
          initPromise = null
          throw err
        }
      })()

      return initPromise
    },

    isReady() {
      return ready
    },

    async simplify(graphJson: string, strategy: string): Promise<string> {
      if (!ready) await this.init()
      const response = await sendMessage('simplify', { graph: graphJson, strategy })
      return response.graph as string
    },

    async findMatches(graphJson: string, rule: string): Promise<number[][]> {
      if (!ready) await this.init()
      const response = await sendMessage('find_matches', { graph: graphJson, rule })
      return response.matches as number[][]
    },

    async findAllMatches(graphJson: string, rules: string[]): Promise<Record<string, number[][]>> {
      if (!ready) await this.init()
      const response = await sendMessage('find_all_matches', { graph: graphJson, rules })
      return response.allMatches as Record<string, number[][]>
    },

    async applyRewrite(graphJson: string, rule: string, match: number[], unfusePhase?: { n: number; d: number }): Promise<string> {
      if (!ready) await this.init()
      const data: Record<string, unknown> = { graph: graphJson, rule, match }
      if (unfusePhase) data.unfusePhase = unfusePhase
      const response = await sendMessage('apply_rewrite', data)
      return response.graph as string
    },

    async fromQASM(qasmText: string): Promise<string> {
      if (!ready) await this.init()
      const response = await sendMessage('from_qasm', { qasm: qasmText })
      return response.graph as string
    },

    async splitSpider(graphJson: string, nodeId: number, phase1N: number, phase1D: number): Promise<string> {
      if (!ready) await this.init()
      const response = await sendMessage('spider_split', { graph: graphJson, nodeId, phase1N, phase1D })
      return response.graph as string
    },

    async graphInfo(graphJson: string): Promise<GraphInfo> {
      if (!ready) await this.init()
      const response = await sendMessage('graph_info', { graph: graphJson })
      return response.info as GraphInfo
    },

    async compareTensors(graph1Json: string, graph2Json: string): Promise<boolean> {
      if (!ready) await this.init()
      const response = await sendMessage('compare_tensors', { graph1: graph1Json, graph2: graph2Json })
      return response.equal as boolean
    },

    onProgress(callback: ProgressCallback) {
      progressCallback = callback
    },
  }
}

/** Singleton PyZX service instance. */
export const pyzx = createPyZXService()
