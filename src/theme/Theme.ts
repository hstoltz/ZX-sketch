// Theme type definitions and palette objects

export type ThemeId = 'gloss' | 'flat' | 'dark' | 'system' | 'classic'

export interface CanvasTheme {
  bgColor: string
  gridDotColor: string
  zInner: string
  zOuter: string
  xInner: string
  xOuter: string
  useGradient: boolean
  /** Enable multi-layer glass spider rendering (Gloss theme). */
  useGloss: boolean
  glossHighlightAlpha: number
  glossRimAlpha: number
  glossShadowAlpha: number
  glossBaseAlpha: number
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

export const FLAT_THEME: CanvasTheme = {
  bgColor: '#f8f8f5',
  gridDotColor: 'rgba(140, 160, 200, 0.45)',
  zInner: '#6fcf6f',
  zOuter: '#2e8b2e',
  xInner: '#f27a7a',
  xOuter: '#c42b2b',
  useGradient: true,
  useGloss: false,
  glossHighlightAlpha: 0,
  glossRimAlpha: 0,
  glossShadowAlpha: 0,
  glossBaseAlpha: 1,
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
  useGloss: false,
  glossHighlightAlpha: 0,
  glossRimAlpha: 0,
  glossShadowAlpha: 0,
  glossBaseAlpha: 1,
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
  useGloss: false,
  glossHighlightAlpha: 0,
  glossRimAlpha: 0,
  glossShadowAlpha: 0,
  glossBaseAlpha: 1,
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

export const GLOSS_THEME: CanvasTheme = {
  bgColor: '#f0f0ec',
  gridDotColor: 'rgba(130, 150, 190, 0.35)',
  zInner: '#7ee87e',
  zOuter: '#28862e',
  xInner: '#ff8888',
  xOuter: '#c42b2b',
  useGradient: true,
  useGloss: true,
  glossHighlightAlpha: 0.55,
  glossRimAlpha: 0.25,
  glossShadowAlpha: 0.12,
  glossBaseAlpha: 0.88,
  spiderBorderColor: null,
  edgeColor: '#3a3a3a',
  hadamardFill: '#f0c030',
  hadamardStroke: '#b8901a',
  boundaryColor: '#555',
  phaseLabelColor: '#1a1a1a',
  selectionGlow: 'rgba(70, 130, 255, 0.6)',
  hoverGlow: 'rgba(70, 130, 255, 0.35)',
  wireTargetGlow: 'rgba(70, 200, 120, 0.5)',
  fusionGlowZ: 'rgba(70, 210, 70, 0.55)',
  fusionGlowX: 'rgba(230, 70, 70, 0.55)',
  rewriteMatchGlow: 'rgba(240, 170, 50, 0.5)',
  confettiColors: ['#28862e', '#c42b2b', '#f0c030', '#508cff', '#3cba54', '#d4534e'],
}

export const GLOSS_CSS: CssTheme = {
  uiBg: 'rgba(248, 248, 245, 0.82)',
  uiBgSolid: '#f4f4f0',
  uiText: '#3a3a3a',
  uiTextMuted: '#888',
  uiBorder: 'rgba(0, 0, 0, 0.08)',
  uiHover: 'rgba(0, 0, 0, 0.06)',
  uiSep: 'rgba(0, 0, 0, 0.10)',
  panelBg: 'rgba(250, 250, 247, 0.78)',
  overlayBg: 'rgba(0, 0, 0, 0.35)',
  inputBg: 'rgba(255, 255, 255, 0.6)',
  logoColor: '#333',
  logoZ: '#28862e',
  logoX: '#c42b2b',
}

export const FLAT_CSS: CssTheme = {
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
  gloss: GLOSS_THEME,
  flat: FLAT_THEME,
  dark: DARK_THEME,
  classic: CLASSIC_THEME,
}

export const CSS_THEMES: Record<Exclude<ThemeId, 'system'>, CssTheme> = {
  gloss: GLOSS_CSS,
  flat: FLAT_CSS,
  dark: DARK_CSS,
  classic: FLAT_CSS,
}
