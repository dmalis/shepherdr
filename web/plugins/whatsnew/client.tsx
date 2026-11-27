// What's new (fork patch #70): what changed in each version, under Settings › About's version rows, and the toast
// after the page updates itself saying what the update brought, with a button to What's new at it. The list is read
// at build time (web/changelog.ts) into a chunk of its own, fetched only when one of them asks.
import { definePlugin, notice, openSettings } from '@client/kernel.ts'
import { OWN_VERSION } from '@client/update.ts'
import { sayUpdated } from './go.ts'
import { WhatsNew } from './whats-new.tsx'

export default definePlugin({
  name: 'whatsnew',
  setup(reg) {
    reg.views.about = WhatsNew
    reg.afterUpdate = (said, from) => void sayUpdated(OWN_VERSION, said, from, notice, () => openSettings('all', 'About'))
  },
})
