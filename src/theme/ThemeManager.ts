// ThemeManager — runtime theme state management

import type { ThemeId, CanvasTheme, CssTheme } from './Theme.ts'
import { THEMES, CSS_THEMES, DEFAULT_THEME } from './Theme.ts'

const STORAGE_KEY = 'zx-sketch-theme'

type ThemeSubscriber = () => void

let currentThemeId: ThemeId = 'default'
let resolvedCanvas: CanvasTheme = DEFAULT_THEME
const subscribers: Set<ThemeSubscriber> = new Set()

function resolveSystemTheme(): 'default' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

function resolveTheme(id: ThemeId): { canvas: CanvasTheme; css: CssTheme; dataTheme: string } {
  if (id === 'system') {
    const resolved = resolveSystemTheme()
    return { canvas: THEMES[resolved], css: CSS_THEMES[resolved], dataTheme: resolved }
  }
  return { canvas: THEMES[id], css: CSS_THEMES[id], dataTheme: id }
}

function applyCssVariables(css: CssTheme): void {
  const s = document.documentElement.style
  s.setProperty('--ui-bg', css.uiBg)
  s.setProperty('--ui-bg-solid', css.uiBgSolid)
  s.setProperty('--ui-text', css.uiText)
  s.setProperty('--ui-text-muted', css.uiTextMuted)
  s.setProperty('--ui-border', css.uiBorder)
  s.setProperty('--ui-hover', css.uiHover)
  s.setProperty('--ui-sep', css.uiSep)
  s.setProperty('--panel-bg', css.panelBg)
  s.setProperty('--overlay-bg', css.overlayBg)
  s.setProperty('--input-bg', css.inputBg)
  s.setProperty('--logo-color', css.logoColor)
  s.setProperty('--logo-z', css.logoZ)
  s.setProperty('--logo-x', css.logoX)
}

function applyTheme(id: ThemeId): void {
  currentThemeId = id
  const { canvas, css, dataTheme } = resolveTheme(id)
  resolvedCanvas = canvas
  document.documentElement.dataset.theme = dataTheme
  applyCssVariables(css)
  for (const cb of subscribers) cb()
}

export function init(): void {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null
  if (stored && (stored === 'default' || stored === 'dark' || stored === 'system' || stored === 'classic')) {
    currentThemeId = stored
  }
  applyTheme(currentThemeId)

  // Listen for OS dark mode changes (relevant when theme is 'system')
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentThemeId === 'system') {
      applyTheme('system')
    }
  })
}

export function setTheme(id: ThemeId): void {
  localStorage.setItem(STORAGE_KEY, id)
  applyTheme(id)
}

export function getCanvasTheme(): CanvasTheme {
  return resolvedCanvas
}

export function getThemeId(): ThemeId {
  return currentThemeId
}

export function getResolvedId(): Exclude<ThemeId, 'system'> {
  if (currentThemeId === 'system') return resolveSystemTheme()
  return currentThemeId
}

export function subscribe(cb: ThemeSubscriber): void {
  subscribers.add(cb)
}

export function unsubscribe(cb: ThemeSubscriber): void {
  subscribers.delete(cb)
}
