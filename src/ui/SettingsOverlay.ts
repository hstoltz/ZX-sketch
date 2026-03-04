// SettingsOverlay.ts — Settings overlay with theme picker

import type { ThemeId, CanvasTheme } from '../theme/Theme.ts'
import { DEFAULT_THEME, DARK_THEME, CLASSIC_THEME } from '../theme/Theme.ts'
import * as themeManager from '../theme/ThemeManager.ts'

interface ThemeOption {
  id: ThemeId
  name: string
  subtitle: string
  palette: CanvasTheme
}

function getThemeOptions(): ThemeOption[] {
  const systemResolved = themeManager.getResolvedId()
  return [
    { id: 'default', name: 'Default', subtitle: 'The default ZX Sketch theme!', palette: DEFAULT_THEME },
    { id: 'dark', name: 'Dark', subtitle: 'Join the dark side', palette: DARK_THEME },
    { id: 'system', name: 'System', subtitle: 'A tasteful choice (follows OS theme)', palette: systemResolved === 'dark' ? DARK_THEME : DEFAULT_THEME },
    { id: 'classic', name: 'Classic', subtitle: 'Close to PyZX/ZXLive. The classic!', palette: CLASSIC_THEME },
  ]
}

function createSwatches(palette: CanvasTheme): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'theme-card-swatches'
  const colors = [palette.bgColor, palette.zInner, palette.xInner, palette.hadamardFill]
  for (const color of colors) {
    const swatch = document.createElement('div')
    swatch.className = 'theme-swatch'
    swatch.style.background = color
    container.appendChild(swatch)
  }
  return container
}

/** Populate the settings overlay content area. */
export function buildSettingsContent(): void {
  const content = document.querySelector('#settings-overlay .settings-content')
  if (!content) return

  content.innerHTML = ''

  const title = document.createElement('div')
  title.className = 'settings-section-title'
  title.textContent = 'Appearance'
  content.appendChild(title)

  const cardsContainer = document.createElement('div')
  cardsContainer.className = 'theme-cards'
  content.appendChild(cardsContainer)

  function render() {
    cardsContainer.innerHTML = ''
    const options = getThemeOptions()
    const currentId = themeManager.getThemeId()

    for (const opt of options) {
      const card = document.createElement('button')
      card.className = 'theme-card'
      if (opt.id === currentId) card.classList.add('active')

      const radio = document.createElement('div')
      radio.className = 'theme-card-radio'
      card.appendChild(radio)

      const info = document.createElement('div')
      info.className = 'theme-card-info'

      const name = document.createElement('div')
      name.className = 'theme-card-name'
      name.textContent = opt.name
      info.appendChild(name)

      const subtitle = document.createElement('div')
      subtitle.className = 'theme-card-subtitle'
      subtitle.textContent = opt.subtitle
      info.appendChild(subtitle)

      card.appendChild(info)
      card.appendChild(createSwatches(opt.palette))

      card.addEventListener('click', () => {
        themeManager.setTheme(opt.id)
        render()
      })

      cardsContainer.appendChild(card)
    }
  }

  render()

  // Re-render when theme changes externally (e.g. OS dark mode toggle)
  themeManager.subscribe(render)

  // --- Debug section ---
  const debugTitle = document.createElement('div')
  debugTitle.className = 'settings-section-title'
  debugTitle.style.marginTop = '18px'
  debugTitle.textContent = 'Debug'
  content.appendChild(debugTitle)

  const VERIFY_STORAGE_KEY = 'zx-sketch-verify-tensors'

  const verifyLabel = document.createElement('label')
  verifyLabel.className = 'settings-toggle-row'

  const verifyCb = document.createElement('input')
  verifyCb.type = 'checkbox'
  verifyCb.id = 'rw-verify-cb'
  verifyCb.checked = localStorage.getItem(VERIFY_STORAGE_KEY) === '1'
  verifyCb.addEventListener('change', () => {
    localStorage.setItem(VERIFY_STORAGE_KEY, verifyCb.checked ? '1' : '0')
  })

  const verifyText = document.createElement('span')
  verifyText.textContent = 'Verify tensors after each rewrite step'

  verifyLabel.appendChild(verifyCb)
  verifyLabel.appendChild(verifyText)
  content.appendChild(verifyLabel)
}
