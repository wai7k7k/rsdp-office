import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const baseUrl = 'http://127.0.0.1:' + port
const app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd, env: { ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#ffffff"/><rect x="100" y="100" width="1000" height="600" fill="#ddd3c4"/></svg>'
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(baseUrl)).ok) break } catch {}
    if (attempt >= 75 || app.exitCode !== null) throw new Error('not ready')
    await new Promise(r => setTimeout(r, 100))
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1800, height: 1150 }, deviceScaleFactor: 3 })
  await context.route('**/api/auth/me', route => route.fulfill({ json: { code: 200, data: { userId: 'MOCK-USER', username: 'test', displayName: 't', role: 'USER' } } }))
  await context.route('**/mock-product.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }))
  const page = await context.newPage()
  let saved = null
  const product = { id: 'EXACT', rspuId: 'M1', name: '测试桌', variant: 'PB', widthMm: 1180, depthMm: 580, heightMm: 750, price: 1345, colorPrimaryName: '浅木纹', imageUrl: '/mock-product.svg' }
  await context.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status, message: 'ok', data }) })
    if (path === '/api/v1/office/projects' && route.request().method() === 'GET') return respond([{ projectId: 'P1', name: 'p', customerRequirements: '', requirementsRevision: 1, leader: { userId: 'MOCK-USER', username: 't', displayName: 't', role: 'LEADER' }, collaborators: [], referenceImages: [], floors: [{ projectId: 'P1', floorId: 'P1', name: 'F', sortOrder: 1 }] }])
    if (path.endsWith('/canvas')) { if (route.request().method() === 'PUT') { saved = route.request().postDataJSON(); return respond(saved) } return respond(saved) }
    if (path.endsWith('/module-recommendations')) {
      const body = route.request().postDataJSON()
      const current = saved.objects.find(i => i.id === body.moduleId)
      return respond({ zoneId: body.zoneId, moduleId: body.moduleId, canvasRevision: body.canvasRevision, widthMm: current.w, depthMm: current.h, targetCategory: '桌', sameModuleCount: 1, missingDimensions: 0, eligibleVariantCount: 1, candidates: [{ product, rotationDeg: 0, fitRatio: 0.96, relevanceScore: 94.5, matchReason: '同品类', remainingWidthMm: 20, remainingDepthMm: 20, tier: 'CLOSE' }] })
    }
    return respond(path.endsWith('/P1') ? null : [])
  })
  await page.goto(baseUrl + '/canvas', { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('rsdp-office-v01:MOCK-USER:P1') || '{}')
    state.objects = [
      { id: 'Z', kind: 'zone', x: 0, y: 0, w: 6000, h: 4000, name: '会议室', zoneType: 'MEETING_ROOM', seats: 0, note: '', tone: 'blue', reviewUnit: 'mm', reviewConfirmation: { status: 'CONFIRMED' }, evidenceKind: 'MANUAL', geometrySource: 'manual_geometry', polygon: [[0,0],[6000,0],[6000,4000],[0,4000]] },
      { id: 'A', kind: 'furniture', zoneId: 'Z', furnitureTemplateId: 'desk-straight', label: '桌', x: 1500, y: 1500, w: 1200, h: 600, rotation: 0, productId: '', layoutConfirmed: true },
    ]
    state.canvasRevision = 9; state.canvasMode = 'design'; state.designZoneId = 'Z'; state.cart = []; state.floorPlan = null; state.spaceTemplate = null
    localStorage.setItem('rsdp-office-v01:MOCK-USER:P1', JSON.stringify(state))
  })
  await page.goto(baseUrl + '/canvas?mode=design&zoneId=Z', { waitUntil: 'networkidle' })
  await page.getByTestId('tab-product-selection').click()
  await page.locator('[data-furniture-id="A"]').click()
  await page.getByTestId('tab-style-recommendation').click()
  const panel = page.getByTestId('module-product-recommendations')
  await panel.locator('[data-product-id="EXACT"]').waitFor({ timeout: 15000 })
  await panel.locator('[data-product-id="EXACT"]').locator('img').first().hover()
  await page.waitForTimeout(600)
  const floatBox = await page.locator('body > div.pointer-events-none.fixed').boundingBox()
  console.log('float panel rect:', JSON.stringify(floatBox))
  const info = await page.evaluate(() => {
    const el = [...document.querySelectorAll('body > div')].find(d => d.className.includes('z-[100]'))
    if (!el) return 'not found'
    const cs = getComputedStyle(el)
    const matches = []
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      const walk = list => { for (const r of list) { if (r.cssRules) { walk(r.cssRules); continue } if (r.selectorText && r.style && r.style.borderRadius && el.matches(r.selectorText)) matches.push({ sheet: (sheet.href || 'inline').split('/').pop(), selector: r.selectorText, radius: r.style.borderRadius }) } }
      walk(rules)
    }
    const sheets = [...document.styleSheets].map(s => (s.href || 'inline').split('/').pop().split('?')[0])
    let cssText = ''
    for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) cssText += r.cssText } catch {} }
    const hasRule = cssText.includes('rounded-\\[10px\\]')
    const idx = cssText.indexOf('rounded-\\[10px\\]')
    const directMatch = el.matches('.rounded-\\[10px\\]')
    return JSON.stringify({ borderRadius: cs.borderRadius, hasRule, snippet: idx >= 0 ? cssText.slice(idx - 60, idx + 80) : null, directMatch })
  })
  console.log('panel computed:', info)
  const info2 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('body > div')].find(d => d.className.includes('z-[100]'))
    const before = { radius: getComputedStyle(el).borderRadius, shadow: getComputedStyle(el).boxShadow.slice(0, 60) }
    el.classList.remove('rounded-[10px]')
    el.classList.add('rounded-lg')
    const afterLg = getComputedStyle(el).borderRadius
    el.classList.remove('rounded-lg')
    el.style.borderRadius = '10px'
    const afterInline = getComputedStyle(el).borderRadius
    return JSON.stringify({ before, afterLg, afterInline })
  })
  console.log('radius experiments:', info2)
  await page.screenshot({ path: '.tmp/corner-zoom.png', clip: { x: floatBox.x - 30, y: floatBox.y - 30, width: 260, height: 260 } })
  console.log('done')
} finally { if (browser) await browser.close(); app.kill() }
