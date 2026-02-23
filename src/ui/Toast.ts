const TOAST_DURATION = 3500
const FADE_DURATION = 300

let container: HTMLElement | null = null

function getContainer(): HTMLElement {
  if (!container) {
    container = document.getElementById('toast-container')
  }
  return container!
}

/** Show a toast notification. Supports HTML content. */
export function showToast(html: string) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = html

  getContainer().appendChild(el)

  setTimeout(() => {
    el.classList.add('fade-out')
    setTimeout(() => el.remove(), FADE_DURATION)
  }, TOAST_DURATION)
}
