// iOS haptic feedback via hidden switch checkbox toggle.
// Toggling <input type="checkbox" switch> triggers native haptic on iOS Safari.
// Must be offscreen (not display:none) to stay in the rendering tree.
//
// The switch haptic only fires when label.click() is called from inside a
// click handler. For drag-to-fuse (no native click event), we chain through
// a hidden button: button.click() → click handler → label.click().

let label: HTMLLabelElement | null = null
let proxy: HTMLButtonElement | null = null

function ensureDOM(): void {
  if (label) return

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

  // Hidden proxy button — its click handler calls label.click(),
  // which means label.click() always runs inside a click context.
  proxy = document.createElement('button')
  proxy.style.position = 'fixed'
  proxy.style.left = '-9999px'
  proxy.style.top = '-9999px'
  proxy.style.opacity = '0'
  proxy.style.pointerEvents = 'none'
  proxy.setAttribute('aria-hidden', 'true')
  proxy.addEventListener('click', () => { label!.click() })
  document.body.appendChild(proxy)
}

/** Fire haptic tap. Can be called from any event context. */
export function hapticTap(): void {
  ensureDOM()
  proxy!.click()
}
