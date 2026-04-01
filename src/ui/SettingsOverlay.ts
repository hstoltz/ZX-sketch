// SettingsOverlay.ts — Settings overlay with theme picker

import type { ThemeId, CanvasTheme } from '../theme/Theme.ts'
import { GLOSS_THEME, FLAT_THEME, DARK_THEME, CLASSIC_THEME } from '../theme/Theme.ts'
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
    { id: 'gloss', name: 'Gloss', subtitle: 'Glass orbs & brushed metal', palette: GLOSS_THEME },
    { id: 'dark', name: 'Gloss Dark', subtitle: 'Glass orbs, dark background', palette: DARK_THEME },
    { id: 'system', name: 'System', subtitle: 'Gloss light/dark (follows OS theme)', palette: systemResolved === 'dark' ? DARK_THEME : GLOSS_THEME },
    { id: 'flat', name: 'Flat', subtitle: 'The original ZX Sketch look', palette: FLAT_THEME },
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

  // --- Experimental section ---
  const experimentalTitle = document.createElement('div')
  experimentalTitle.className = 'settings-section-title'
  experimentalTitle.style.marginTop = '18px'
  experimentalTitle.textContent = 'Experimental'
  content.appendChild(experimentalTitle)

  const STABILIZER_STORAGE_KEY = 'zx-sketch-stabilizer-axioms'

  const stabLabel = document.createElement('label')
  stabLabel.className = 'settings-toggle-row'

  const stabCb = document.createElement('input')
  stabCb.type = 'checkbox'
  stabCb.id = 'rw-stabilizer-cb'
  stabCb.checked = localStorage.getItem(STABILIZER_STORAGE_KEY) === '1'
  stabCb.addEventListener('change', () => {
    localStorage.setItem(STABILIZER_STORAGE_KEY, stabCb.checked ? '1' : '0')
    window.dispatchEvent(new Event('zx-stabilizer-mode-changed'))
  })

  const stabText = document.createElement('span')
  stabText.textContent = 'Use BPW2020 stabilizer axiom set'

  stabLabel.appendChild(stabCb)
  stabLabel.appendChild(stabText)
  content.appendChild(stabLabel)

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
