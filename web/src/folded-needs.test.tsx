import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'

// dmalis/shepherdr#45: a space whose task waits on a prompt keeps its row, with its count, under a folded group (as a
// space with something unread does), and its folded machine counts it.
const { setUI } = await import('./kernel.ts')
const { List } = await import('./list.tsx')

const place = (id: string, x = {}) => ({ id, name: id, machine: 'mini', level: 0 as const, status: 'idle' as const, mode: 'regular' as const, chat: id, ...x })
const held = { id: 'SHOP-4', name: 'Fix login', place: 'shop', state: 'needs', status: 'need', sub: 'Wants to run git push' } as any
const snap = (tasks: any[]): Snapshot => ({
  name: '', host: 'mini', user: '', everything: 'home',
  places: [place('home', { home: true }), place('shop'), place('blog')],
  machines: [{ id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' }],
  tasks, automations: {}, artifacts: [], asks: {}, needs: [], settings: [],
  sections: [{ id: 's:g1', name: 'Work', machine: 'mini', spaces: ['shop', 'blog'] }],
} as any)

test('#45: a folded group keeps the space that needs you, with its count; the others stay folded', () => {
  setUI({ shut: { 's:g1': true }, at: 'home' })
  try {
    const html = renderToStaticMarkup(<List snap={snap([held])} />)
    expect(html).toContain('data-project="shop"')
    expect(html).not.toContain('data-project="blog"')
    const shop = html.slice(html.indexOf('data-project="shop"'))
    expect(shop.slice(0, shop.indexOf('</div>', shop.indexOf('cnt')) + 6)).toContain('<span class="cnt needs">1</span>')
    // answered: it folds away with the rest
    expect(renderToStaticMarkup(<List snap={snap([{ ...held, state: 'working', status: 'work' }])} />)).not.toContain('data-project="shop"')
  } finally {
    setUI({ shut: {}, at: '' })
  }
})

test('#45: a folded machine counts it', () => {
  setUI({ shut: { 'm:mini': true }, at: 'home' })
  try {
    expect(renderToStaticMarkup(<List snap={snap([held])} />)).toContain('<span class="cnt needs">1</span>')
  } finally {
    setUI({ shut: {}, at: '' })
  }
})
