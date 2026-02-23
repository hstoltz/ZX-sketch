// Theme type definitions and palette objects

export type ThemeId = 'default' | 'dark' | 'system' | 'classic'

export interface CanvasTheme {
  bgColor: string
  gridDotColor: string
  zInner: string
  zOuter: string
  xInner: string
  xOuter: string
  useGradient: boolean
  spiderBorderColor: string | null // null = use outerColor
  edgeColor: string
  hadamardFill: string
  hadamardStroke: string
  boundaryColor: string
  phaseLabelColor: string
  selectionGlow: string
  hoverGlow: string
  wireTargetGlow: string
  fusionGlowZ: string
  fusionGlowX: string
  rewriteMatchGlow: string
  confettiColors: string[]
}

export interface CssTheme {
  uiBg: string
  uiBgSolid: string
  uiText: string
  uiTextMuted: string
  uiBorder: string
  uiHover: string
  uiSep: string
  panelBg: string
  overlayBg: string
  inputBg: string
  logoColor: string
  logoZ: string
  logoX: string
}

export const DEFAULT_THEME: CanvasTheme = {
  bgColor: '#f8f8f5',
  gridDotColor: 'rgba(140, 160, 200, 0.45)',
  zInner: '#6fcf6f',
  zOuter: '#2e8b2e',
  xInner: '#f27a7a',
  xOuter: '#c42b2b',
  useGradient: true,
  spiderBorderColor: null,
  edgeColor: '#444',
  hadamardFill: '#e8b828',
  hadamardStroke: '#b8901a',
  boundaryColor: '#555',
  phaseLabelColor: '#222',
  selectionGlow: 'rgba(80, 140, 255, 0.55)',
  hoverGlow: 'rgba(80, 140, 255, 0.3)',
  wireTargetGlow: 'rgba(80, 200, 120, 0.45)',
  fusionGlowZ: 'rgba(80, 200, 80, 0.5)',
  fusionGlowX: 'rgba(220, 80, 80, 0.5)',
  rewriteMatchGlow: 'rgba(230, 160, 50, 0.45)',
  confettiColors: ['#2e8b2e', '#c42b2b', '#e8a832', '#508cff', '#3cba54', '#d4534e'],
}

export const DARK_THEME: CanvasTheme = {
  bgColor: '#1e1e22',
  gridDotColor: 'rgba(100, 120, 160, 0.3)',
  zInner: '#4db84d',
  zOuter: '#1a6b1a',
  xInner: '#d45a5a',
  xOuter: '#991e1e',
  useGradient: true,
  spiderBorderColor: null,
  edgeColor: '#aaa',
  hadamardFill: '#e8b828',
  hadamardStroke: '#b8901a',
  boundaryColor: '#999',
  phaseLabelColor: '#ddd',
  selectionGlow: 'rgba(80, 140, 255, 0.55)',
  hoverGlow: 'rgba(80, 140, 255, 0.3)',
  wireTargetGlow: 'rgba(80, 200, 120, 0.45)',
  fusionGlowZ: 'rgba(80, 200, 80, 0.5)',
  fusionGlowX: 'rgba(220, 80, 80, 0.5)',
  rewriteMatchGlow: 'rgba(230, 160, 50, 0.45)',
  confettiColors: ['#4db84d', '#d45a5a', '#e8a832', '#508cff', '#3cba54', '#d4534e'],
}

export const CLASSIC_THEME: CanvasTheme = {
  bgColor: '#ffffff',
  gridDotColor: 'rgba(180, 180, 180, 0.15)',
  zInner: '#ccffcc',
  zOuter: '#000000',
  xInner: '#ff8888',
  xOuter: '#000000',
  useGradient: false,
  spiderBorderColor: '#000',
  edgeColor: '#000',
  hadamardFill: '#ffff00',
  hadamardStroke: '#000',
  boundaryColor: '#000',
  phaseLabelColor: '#000',
  selectionGlow: 'rgba(80, 140, 255, 0.55)',
  hoverGlow: 'rgba(80, 140, 255, 0.3)',
  wireTargetGlow: 'rgba(80, 200, 120, 0.45)',
  fusionGlowZ: 'rgba(80, 200, 80, 0.5)',
  fusionGlowX: 'rgba(220, 80, 80, 0.5)',
  rewriteMatchGlow: 'rgba(230, 160, 50, 0.45)',
  confettiColors: ['#2e8b2e', '#c42b2b', '#e8a832', '#508cff', '#3cba54', '#d4534e'],
}

export const DEFAULT_CSS: CssTheme = {
  uiBg: 'rgba(255, 255, 255, 0.88)',
  uiBgSolid: '#ffffff',
  uiText: '#444',
  uiTextMuted: '#888',
  uiBorder: 'rgba(0, 0, 0, 0.1)',
  uiHover: 'rgba(0, 0, 0, 0.07)',
  uiSep: 'rgba(0, 0, 0, 0.12)',
  panelBg: 'rgba(255, 255, 255, 0.92)',
  overlayBg: 'rgba(0, 0, 0, 0.35)',
  inputBg: 'rgba(255, 255, 255, 0.7)',
  logoColor: '#333',
  logoZ: '#2e8b2e',
  logoX: '#c42b2b',
}

export const DARK_CSS: CssTheme = {
  uiBg: 'rgba(30, 30, 35, 0.88)',
  uiBgSolid: '#252528',
  uiText: '#ccc',
  uiTextMuted: '#888',
  uiBorder: 'rgba(255, 255, 255, 0.1)',
  uiHover: 'rgba(255, 255, 255, 0.08)',
  uiSep: 'rgba(255, 255, 255, 0.1)',
  panelBg: 'rgba(35, 35, 40, 0.92)',
  overlayBg: 'rgba(0, 0, 0, 0.55)',
  inputBg: 'rgba(255, 255, 255, 0.08)',
  logoColor: '#ccc',
  logoZ: '#4db84d',
  logoX: '#d45a5a',
}

export const THEMES: Record<Exclude<ThemeId, 'system'>, CanvasTheme> = {
  default: DEFAULT_THEME,
  dark: DARK_THEME,
  classic: CLASSIC_THEME,
}

export const CSS_THEMES: Record<Exclude<ThemeId, 'system'>, CssTheme> = {
  default: DEFAULT_CSS,
  dark: DARK_CSS,
  classic: DEFAULT_CSS,
}
