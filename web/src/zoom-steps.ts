// Zoom's steps and Chat text size's sizes (Settings › General › Appearance). No imports: the build reads ZOOMS too
// (web/zoom-css.ts writes each container query once per step).

/** the whole app, in percent: a browser's own zoom steps */
export const ZOOMS = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const
export type Zoom = (typeof ZOOMS)[number]

/** the chat's messages only; ds.css gives each its sizes (data-text on <html>, none for Default) */
export const TEXTS = ['Small', 'Default', 'Large', 'Larger'] as const
export type TextSize = (typeof TEXTS)[number]

/** the next step up (1) or down (-1) from `z`, staying at the ends; a value between steps goes to the nearest one */
export function stepZoom(z: number, by: 1 | -1): Zoom {
  const i = by > 0 ? ZOOMS.findIndex((s) => s > z) : ZOOMS.findLastIndex((s) => s < z)
  if (i < 0) return by > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]
  return ZOOMS[i]
}
