// iOS haptic feedback via hidden switch checkbox toggle.
// Toggling <input type="checkbox" switch> triggers native haptic on iOS Safari.
// Must be offscreen (not display:none) to stay in the rendering tree.

let label: HTMLLabelElement | null = null

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

/** Single tap — triggers native iOS haptic via switch checkbox toggle. */
export function hapticFusion(): void {
  ensureDOM().click()
}
