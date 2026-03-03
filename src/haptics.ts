import { WebHaptics } from 'web-haptics'

let instance: WebHaptics | null = null

function get(): WebHaptics {
  if (!instance) instance = new WebHaptics()
  return instance
}

/** Single short tap on spider fusion. */
export function hapticFusion(): void {
  get().trigger('nudge')
}
