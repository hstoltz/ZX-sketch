const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface FocusTrap {
  activate(): void
  deactivate(): void
}

/**
 * Creates a focus trap that keeps Tab/Shift+Tab cycling within `container`.
 * Saves and restores previously focused element on activate/deactivate.
 */
export function createFocusTrap(container: HTMLElement): FocusTrap {
  let previousFocus: HTMLElement | null = null
  let handler: ((e: KeyboardEvent) => void) | null = null

  function activate() {
    previousFocus = document.activeElement as HTMLElement | null
    handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handler, true)

    // Focus first focusable element
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (focusable.length > 0) focusable[0].focus()
  }

  function deactivate() {
    if (handler) {
      document.removeEventListener('keydown', handler, true)
      handler = null
    }
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus()
    }
    previousFocus = null
  }

  return { activate, deactivate }
}
