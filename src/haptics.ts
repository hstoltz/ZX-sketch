import { WebHaptics } from 'web-haptics'

const haptics = new WebHaptics()

/** Single short tap on spider fusion. */
export function hapticFusion(): void {
  haptics.trigger('nudge')
}
