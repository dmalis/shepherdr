// Zoom and Chat text size: the app's own zoom on the browser's keys (Cmd/Ctrl + = or +, − and 0, matched by the
// character so every keyboard layout has them), and a palette row that finds both in Settings › General by "zoom",
// "text size" or "font". The rows themselves are in Settings › General › Appearance (web/src/size-rows.tsx).
import { definePlugin, openSettings } from '@client/kernel.ts'
import { zoomIn, zoomOut, zoomReset } from '@client/zoom.ts'

export default definePlugin({
  name: 'zoom',
  setup(reg) {
    reg.commands.push(
      { id: 'zoom.in', title: 'Zoom in', area: 'General', icon: 'plus', keys: ['Mod+=', 'Mod+Shift+='], words: 'bigger larger magnify scale text size font', run: () => zoomIn(true) },
      { id: 'zoom.out', title: 'Zoom out', area: 'General', icon: 'minus', keys: ['Mod+-'], words: 'smaller scale text size font', run: () => zoomOut(true) },
      { id: 'zoom.reset', title: 'Reset zoom', area: 'General', icon: 'reload', keys: ['Mod+0'], words: 'actual size 100% default scale', run: () => zoomReset(true) },
      { id: 'zoom.settings', title: 'Zoom and chat text size', area: 'General', icon: 'gear', words: 'text size font bigger smaller messages appearance settings scale', run: () => openSettings('all', 'General') },
    )
  },
})
