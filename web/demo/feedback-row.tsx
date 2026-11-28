// The Feedback page drawn from a real herdr-task record (friction loop slice 4's demo, #94): `bun web/demo/feedback-row.tsx
// <list.json> <out.html>` reads `herdr-task feedback --list --all --json`'s answer, makes it the page's rows through the
// service's own rowsOf, and writes the page as static HTML with the built app's styles (web/dist) beside the demo's day.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { rowsOf } from '../../service/feedback.ts'
import { snapshot } from './data.ts'
import { FeedbackPage } from '../plugins/feedback/rows.tsx'

const [list, out, theme = 'light'] = process.argv.slice(2)
const snap = snapshot('normal')
snap.feedback = rowsOf(JSON.parse(readFileSync(list!, 'utf8')), {})
snap.feedback.rows = snap.feedback.rows.map((r) => ({ ...r, space: undefined }))
const dist = join(import.meta.dir, '..', 'dist', 'assets')
const css = readdirSync(dist).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dist, f), 'utf8')).join('\n')
const body = renderToStaticMarkup(<FeedbackPage now={Date.now()} snap={snap} at={snap.everything} />)
writeFileSync(out!, `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>` +
  `<body style="background:var(--canvas);margin:0"><div class="app"><div style="max-width:680px;margin:0 auto;padding:0 16px">${body}</div></div></body></html>`)
console.log(out)
