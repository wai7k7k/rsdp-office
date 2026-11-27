import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const baseUrl = 'http://127.0.0.1:' + port
const app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd, env: { ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
const outDir = process.env.OUT_DIR || '.tmp'

const productSvg = (tone) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 340 280">
  <rect width="340" height="280" fill="#f7f4f0"/>
  <polygon points="30,90 310,90 330,130 10,130" fill="${tone}" stroke="#b8a98f" stroke-width="2"/>
  <polygon points="10,130 330,130 330,142 10,142" fill="#cbbca6"/>
  <g stroke="#7d6a4f" stroke-width="6" stroke-linecap="round">
    <line x1="48" y1="142" x2="30" y2="250"/><line x1="76" y1="142" x2="88" y2="250"/>
    <line x1="264" y1="142" x2="252" y2="250"/><line x1="292" y1="142" x2="310" y2="250"/>
  </g>
</svg>`

let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(baseUrl)).ok) break } catch {}
    if (attempt >= 75 || app.exitCode !== null) throw new Error('preview server not ready')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await mkdir(outDir, { recursive: true })
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1800, height: 1150 } })
  await context.route('**/api/auth/me', route => route.fulfill({ json: { code: 200, data: { userId: 'MOCK-USER', username: 'test', displayName: '测试用户', role: 'USER' } } }))
  await context.route('**/mock-product-*.svg', route => {
    const tone = route.request().url().includes('dark') ? '#cfd4cf' : '#ddd3c4'
    return route.fulfill({ contentType: 'image/svg+xml', body: productSvg(tone) })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let saved = null
  const products = [
    { id: 'EXACT', rspuId: 'MASTER-EXACT', name: '1.8米会议台/洽谈台', variant: '默认规格 / PB', widthMm: 1180, depthMm: 580, heightMm: 750, price: 1345, colorPrimaryName: '浅木纹', imageUrl: '/mock-product-a.svg' },
    { id: 'MEDIUM', rspuId: 'MASTER-MEDIUM', name: '1.8米会议台/洽谈台', variant: '默认规格 / 深灰', widthMm: 1000, depthMm: 500, heightMm: 720, price: 2561, colorPrimaryName: '深灰', imageUrl: '/mock-product-dark.svg' },
    { id: 'NOIMG', rspuId: 'MASTER-NOIMG', name: '无图会议桌', variant: '规格 X', widthMm: 900, depthMm: 450, price: 0, colorPrimaryName: '' },
  ]
  await context.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const respond = (data, status = 200, message = '成功') => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status, message, data }) })
    if (path === '/api/v1/office/projects' && route.request().method() === 'GET') return respond([{
      projectId: 'OFFICE-PROJECT-001', name: '悬停预览验证', customerRequirements: '', requirementsRevision: 1,
      leader: { userId: 'MOCK-USER', username: 'test', displayName: '测试用户', role: 'LEADER' }, collaborators: [], referenceImages: [],
      floors: [{ projectId: 'OFFICE-PROJECT-001', floorId: 'OFFICE-PROJECT-001', name: '默认楼层', sortOrder: 1 }],
    }])
    if (path.endsWith('/canvas')) {
      if (route.request().method() === 'PUT') { saved = route.request().postDataJSON(); return respond(saved) }
      return respond(saved)
    }
    if (path.endsWith('/module-recommendations')) {
      const body = route.request().postDataJSON()
      const current = saved.objects.find(item => item.id === body.moduleId)
      const candidates = products.flatMap(product => {
        const w = product.widthMm, d = product.depthMm
        if (w > current.w || d > current.h) return []
        const fitRatio = Math.min(w / current.w, d / current.h)
        return [{ product, rotationDeg: 0, fitRatio, relevanceScore: 80 + fitRatio * 15,
          matchReason: '同品类 · 商品名称或规格名',
          remainingWidthMm: current.w - w, remainingDepthMm: current.h - d, tier: fitRatio >= .85 ? 'CLOSE' : fitRatio >= .6 ? 'RELAXED' : 'SMALL' }]
      }).sort((a, b) => b.relevanceScore - a.relevanceScore)
      return respond({ zoneId: body.zoneId, moduleId: body.moduleId, canvasRevision: body.canvasRevision, widthMm: current.w, depthMm: current.h, targetCategory: '会议 / 洽谈桌', sameModuleCount: 1, missingDimensions: 0, eligibleVariantCount: products.length, candidates })
    }
    return respond(path.endsWith('/OFFICE-PROJECT-001') ? null : [])
  })
  await page.goto(baseUrl + '/canvas', { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('rsdp-office-v01:MOCK-USER:OFFICE-PROJECT-001') || '{}')
    state.objects = [
      { id: 'Z', kind: 'zone', x: 0, y: 0, w: 6000, h: 4000, name: '会议室', zoneType: 'MEETING_ROOM', seats: 0, note: '', tone: 'blue', reviewUnit: 'mm', reviewConfirmation: { status: 'CONFIRMED' }, evidenceKind: 'MANUAL', geometrySource: 'manual_geometry', polygon: [[0,0],[6000,0],[6000,4000],[0,4000]] },
      { id: 'A', kind: 'furniture', zoneId: 'Z', furnitureTemplateId: 'desk-straight', label: '长方形会议桌', x: 1500, y: 1500, w: 1200, h: 600, rotation: 0, productId: '', layoutConfirmed: true },
    ]
    state.canvasRevision = 9; state.canvasMode = 'design'; state.designZoneId = 'Z'; state.cart = []; state.floorPlan = null; state.spaceTemplate = null
    localStorage.setItem('rsdp-office-v01:MOCK-USER:OFFICE-PROJECT-001', JSON.stringify(state))
  })
  await page.goto(baseUrl + '/canvas?mode=design&zoneId=Z', { waitUntil: 'networkidle' })
  await page.getByTestId('tab-product-selection').click()
  await page.locator('[data-furniture-id="A"]').click()
  await page.getByTestId('tab-style-recommendation').click()
  const panel = page.getByTestId('module-product-recommendations')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: outDir + '/debug-before-cards.png' })
  console.log('panel text:', (await panel.innerText()).slice(0, 300).replace(/\n/g, ' | '))
  await panel.locator('[data-product-id="EXACT"]').waitFor({ timeout: 15000 })

  // 悬停第一张卡片的缩略图
  const thumb = panel.locator('[data-product-id="EXACT"]').locator('img').first()
  await thumb.hover()
  await page.waitForTimeout(600)
  await page.screenshot({ path: outDir + '/hover-preview-with-data.png', animations: 'disabled' })

  // 悬停无图商品，确认不崩且不出悬浮框
  await panel.locator('[data-product-id="NOIMG"]').first().hover()
  await page.waitForTimeout(400)
  await page.screenshot({ path: outDir + '/hover-preview-noimg.png', animations: 'disabled' })

  // 移开后悬浮框应消失
  await page.mouse.move(900, 600)
  await page.waitForTimeout(400)
  await page.screenshot({ path: outDir + '/hover-preview-closed.png', animations: 'disabled' })

  console.log('pageerrors:', JSON.stringify(errors))
  console.log('done')
} finally {
  if (browser) await browser.close()
  app.kill()
}
