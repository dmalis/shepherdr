// fork #279: the demo's ?case=cards day answers what its grouped sheets ask, so a card can leave its sheet there
import { expect, test } from 'bun:test'
import { createServer } from 'node:net'

test('?case=cards: a grouped review merges and a grouped stopped agent restarts', async () => {
  const listener = createServer()
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as { port: number }).port
  await new Promise<void>((resolve) => listener.close(() => resolve()))
  const child = Bun.spawn(['bun', 'web/demo/serve.ts', String(port)], { stdout: 'ignore', stderr: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(`${url}/api/me`)).ok) break } catch {}
      await Bun.sleep(50)
    }
    const snapshots: any[] = []
    const ws = new WebSocket(`${url.replace('http:', 'ws:')}/api/ws`, { headers: { cookie: 'demo-case=cards' } } as never)
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.type === 'snapshot') snapshots.push(m.snapshot) }
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('demo socket failed')) })
    const act = async (body: object) => (await fetch(`${url}/api/action`, { method: 'POST', body: JSON.stringify(body) })).json()
    const task = (id: string) => snapshots.at(-1)?.tasks.find((t: any) => t.id === id)
    for (let i = 0; i < 30 && !task('SHOP-40'); i++) await Bun.sleep(20)
    expect(task('SHOP-50')?.stopped).toBeTruthy()
    expect(await act({ type: 'accept', task: 'SHOP-40' })).toMatchObject({ ok: true })
    expect(await act({ type: 'task-resume', chat: 'SHOP-50/worker' })).toMatchObject({ ok: true })
    for (let i = 0; i < 50 && (task('SHOP-50')?.stopped || task('SHOP-40')?.status === 'ready'); i++) await Bun.sleep(20)
    expect(task('SHOP-40')?.status).not.toBe('ready')
    expect(task('SHOP-50')?.stopped).toBeUndefined()
    ws.close()
  } finally { child.kill(); await child.exited }
})
