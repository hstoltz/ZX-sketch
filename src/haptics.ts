// iOS haptic feedback via hidden switch checkbox toggle.
// Toggling <input type="checkbox" switch> triggers native haptic on iOS Safari.
// Must be offscreen (not display:none) to stay in the rendering tree.
// Must toggle via the checkbox directly — label.click() only works from
// click events, not pointerup (iOS doesn't grant user activation for it).

let checkbox: HTMLInputElement | null = null

function ensureDOM(): HTMLInputElement {
  if (checkbox) return checkbox

  const id = 'zx-haptic-switch'
  const label = document.createElement('label')
  label.setAttribute('for', id)
  label.style.position = 'fixed'
  label.style.left = '-9999px'
  label.style.top = '-9999px'
  label.style.pointerEvents = 'none'
  label.style.opacity = '0'
  label.style.userSelect = 'none'
  label.setAttribute('aria-hidden', 'true')

  checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.setAttribute('switch', '')
  checkbox.id = id
  checkbox.style.all = 'initial'
  checkbox.style.appearance = 'auto'
  checkbox.style.position = 'fixed'
  checkbox.style.left = '-9999px'
  checkbox.style.top = '-9999px'

  label.appendChild(checkbox)
  document.body.appendChild(label)
  return checkbox
}

/** Single tap — triggers native iOS haptic via switch checkbox toggle. */
export function hapticFusion(): void {
  const cb = ensureDOM()
  cb.checked = !cb.checked
}
