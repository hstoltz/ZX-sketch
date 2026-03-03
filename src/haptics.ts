// iOS haptic feedback via hidden switch checkbox toggle.
// Toggling <input type="checkbox" switch> triggers native haptic on iOS Safari.
// Must be offscreen (not display:none) to stay in the rendering tree.
//
// Key constraint: label.click() only triggers the native haptic when called
// from a "click" user activation context. Canvas pointerup doesn't qualify.
// On iOS touch, the event sequence is pointerup → click, so we set a pending
// flag in pointerup and fire from a click listener on the canvas.

let label: HTMLLabelElement | null = null
let pending = false
let boundCanvas: HTMLCanvasElement | null = null

function ensureDOM(): HTMLLabelElement {
  if (label) return label

  const id = 'zx-haptic-switch'
  label = document.createElement('label')
  label.setAttribute('for', id)
  label.style.position = 'fixed'
  label.style.left = '-9999px'
  label.style.top = '-9999px'
  label.style.pointerEvents = 'none'
  label.style.opacity = '0'
  label.style.userSelect = 'none'
  label.setAttribute('aria-hidden', 'true')

  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.setAttribute('switch', '')
  cb.id = id
  cb.style.all = 'initial'
  cb.style.appearance = 'auto'
  cb.style.position = 'fixed'
  cb.style.left = '-9999px'
  cb.style.top = '-9999px'

  label.appendChild(cb)
  document.body.appendChild(label)
  return label
}

function flush(): void {
  if (!pending) return
  pending = false
  ensureDOM().click()
}

/** Bind to canvas so pending haptics fire on the follow-up click event. */
export function bindCanvas(canvas: HTMLCanvasElement): void {
  if (boundCanvas === canvas) return
  boundCanvas = canvas
  canvas.addEventListener('click', flush, { passive: true })
}

/**
 * Trigger haptic feedback.
 * When called from a click handler (e.g. button), fires immediately.
 * When called from pointerup (e.g. canvas fusion), defers to the next click.
 */
export function hapticFusion(): void {
  pending = true
  // Also try immediate — works when called from click context (e.g. test button)
  ensureDOM().click()
}
