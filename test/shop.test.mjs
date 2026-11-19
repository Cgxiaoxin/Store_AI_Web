import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import { test } from 'node:test'

async function transport(server, t) {
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => server.close(resolve)))
    return { base: 'http://127.0.0.1:' + server.address().port, request: fetch }
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    t.diagnostic('Loopback binding is restricted. Exercising the same HTTP handler in process.')
    t.after(() => server.emit('close'))
    return {
      base: 'http://127.0.0.1',
      async request(url, options = {}) {
        const target = new URL(url)
        const { method = 'GET', body } = options
        const headers = new Headers({ host: target.host, ...options.headers })
        if (body instanceof URLSearchParams) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
        const request = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(String(body))]), {
          url: target.pathname + target.search, method, headers: Object.fromEntries(headers),
          socket: { remoteAddress: '127.0.0.1' }
        })
        return new Promise((resolve, reject) => {
          let status, responseHeaders
          const response = {
            writeHead(code, values) {
              status = code
              responseHeaders = new Headers()
              for (const [name, value] of Object.entries(values)) {
                for (const entry of Array.isArray(value) ? value : [value]) responseHeaders.append(name, entry)
              }
              this.headersSent = true
            },
            end(content) { resolve(new Response(content, { status, headers: responseHeaders })) }
          }
          server.listeners('request')[0](request, response).catch(reject)
        })
      }
    }
  }
}

test('storefront, payment, card balance, and admin transitions', async t => {
  const { createShop } = await import('../src/server.mjs')
  const key = 'k'.repeat(40)
  const paymentSecret = 'test-payment-secret-for-this-suite'
  const server = createShop({ database: ':memory:', key, demo: true, adminPassword: 'Admin passphrase test', paymentSecret })
  const { base, request } = await transport(server, t)
  const post = (path, data, cookie = '') => request(base + path, { method: 'POST', redirect: 'manual', headers: { origin: base, cookie }, body: new URLSearchParams(data) })
  for (const path of ['/', '/products', '/products/ai-workspace', '/cart', '/blog', '/blog/using-your-card', '/notice', '/notice/store-preview', '/about', '/verify', '/guest/orders', '/admin']) {
    const result = await request(base + path)
    assert.equal(result.status, 200, path)
    assert.match(await result.text(), /棱镜 AI/)
  }
  assert.match(await (await request(base + '/assets/shop.css')).text(), /prefers-reduced-motion/)
  assert.match(await (await request(base + '/assets/shop.js')).text(), /navigator.clipboard/)
  const cart = await post('/cart/add', { sku: 'WORKSPACE-3', quantity: 2 })
  assert.equal(cart.status, 303)
  const cartCookie = cart.headers.get('set-cookie').split(';')[0]
  assert.match(await (await request(base + '/cart', { headers: { cookie: cartCookie } })).text(), /¥58\.00/)
  const email = 'buyer@example.com'
  const password = 'order passphrase'
  const order = await post('/checkout', { email, password }, cartCookie)
  assert.equal(order.status, 303)
  const location = order.headers.get('location')
  const orderId = location.split('/').at(-1)
  const cookie = order.headers.getSetCookie().find(value => value.startsWith('guest=')).split(';')[0]
  assert.equal((await request(base + location, { redirect: 'manual' })).status, 303)
  assert.equal((await post('/guest/orders', { orderId, email, password: 'incorrect' })).status, 401)
  assert.equal((await post('/admin/retry', { orderId })).status, 403)
  const wrongOrigin = await request(base + '/pay/demo', { method: 'POST', headers: { origin: 'https://elsewhere.invalid', cookie }, body: new URLSearchParams({ orderId }) })
  assert.equal(wrongOrigin.status, 403)
  const receipt = { eventId: 'webhook-first', orderId, amount: 5801, currency: 'CNY' }
  const webhook = (payload, signed = true) => {
    const body = JSON.stringify(payload)
    const signature = createHmac('sha256', paymentSecret).update(body).digest('hex')
    return request(base + '/webhooks/payment', { method: 'POST', headers: { 'x-payment-signature': signed ? signature : '0', 'content-type': 'application/json' }, body })
  }
  assert.equal((await webhook(receipt, false)).status, 401)
  assert.equal((await webhook(receipt)).status, 409)
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await post('/pay/demo', { orderId }, cookie)).status, 303)
  assert.equal((await webhook({ ...receipt, amount: 5800 })).status, 409)
  const secondOrder = await post('/checkout', { email, password }, cartCookie)
  const secondId = secondOrder.headers.get('location').split('/').at(-1)
  for (let attempt = 0; attempt < 2; attempt++) {
    const settled = await webhook({ ...receipt, orderId: secondId, amount: 5800 })
    assert.equal(settled.status, 200)
    assert.equal((await settled.json()).status, 'fulfilled')
  }
  const result = await request(base + location + '/download', { headers: { cookie } })
  assert.equal(result.status, 200)
  const cards = (await result.text()).match(/PRISM-[A-F0-9]{32}/g)
  assert.equal(new Set(cards).size, 2)
  const [code] = cards
  assert.match(await (await post('/verify', { code })).text(), /剩余 3 次/)
  const redemption = await (await post('/redeem', { code, requestId: 'replay-key-000001' })).text()
  assert.match(redemption, /剩余 2 次/)
  assert.match(redemption, /name="next" value="\/verify"/)
  assert.match(await (await post('/redeem', { code, requestId: 'replay-key-000001' })).text(), /剩余 2 次/)
  const login = await post('/admin/login', { password: 'Admin passphrase test' })
  assert.equal(login.status, 303)
  const admin = login.headers.get('set-cookie').split(';')[0]
  assert.match(await (await request(base + '/admin', { headers: { cookie: admin } })).text(), /replay-key-000001/)
  assert.equal((await post('/redeem/cancel', { code, requestId: 'replay-key-000001' })).status, 200)
  assert.match(await (await post('/verify', { code })).text(), /剩余 3 次/)
  await post('/redeem', { code, requestId: 'successful-000001' })
  assert.equal((await post('/admin/claim', { requestId: 'successful-000001' }, admin)).status, 303)
  assert.equal((await post('/admin/resolve', { requestId: 'successful-000001', status: 'success', result: '你的服务结果' }, admin)).status, 303)
  assert.equal((await post('/redeem/cancel', { code, requestId: 'successful-000001' })).status, 409)
  const verified = await (await post('/verify', { code })).text()
  assert.match(verified, /剩余 2 次/)
  assert.match(verified, /你的服务结果/)
  assert.equal((await post('/admin/product', { slug: 'escaped', name: '示例', category: '<mark>写作</mark>',
    description: '简介', detail: '内容', art: 1, active: 1 }, admin)).status, 303)
  const detail = await (await request(base + '/products/escaped')).text()
  assert.match(detail, /&lt;mark&gt;写作&lt;\/mark&gt;/)
  assert.doesNotMatch(detail, /<mark>/)
})

test('production defaults to a closed checkout until a merchant is configured', async t => {
  const { createShop } = await import('../src/server.mjs')
  const key = 'k'.repeat(40)
  assert.throws(() => createShop({ database: ':memory:', key, paymentSecret: 'too-short' }), /PAYMENT_SECRET/)
  const { base, request } = await transport(createShop({ database: ':memory:', key }), t)
  const post = path => request(base + path, { method: 'POST', headers: { origin: base }, body: new URLSearchParams() })
  assert.equal((await post('/checkout')).status, 503)
  assert.equal((await post('/pay/demo')).status, 404)
  assert.equal((await post('/webhooks/payment')).status, 404)
})

test('header controls, native form policy, and customer order ownership', async t => {
  const { createShop } = await import('../src/server.mjs')
  const server = createShop({ database: ':memory:', key: 'k'.repeat(40), demo: true })
  const { base, request } = await transport(server, t)
  const get = (path, cookie = '') => request(base + path, { headers: { cookie }, redirect: 'manual' })
  const post = (path, data, cookie = '', origin = base) => request(base + path, {
    method: 'POST', redirect: 'manual', headers: { origin, cookie }, body: new URLSearchParams(data)
  })
  const cookieFrom = (res, name) => res.headers.getSetCookie().find(value => value.startsWith(name + '=')).split(';')[0]
  const home = await get('/')
  assert.equal(home.headers.get('referrer-policy'), 'same-origin')
  const header = await home.text()
  for (const text of ['搜索商品', '订单查询', '购物车', '切换深色主题', '登录']) assert.ok(header.includes(text), text)
  assert.match(header, /action="\/preferences\/language"/)
  const search = await (await get('/products?q=' + encodeURIComponent('工作台'))).text()
  assert.match(search, /AI 工作台/)
  assert.doesNotMatch(search, /提示词工作室/)
  assert.equal((await post('/cart/add', { sku: 'WORKSPACE-1', quantity: 1 }, '', 'null')).status, 403)
  const dark = await post('/preferences/theme', { value: 'dark', next: '/products?q=ai' })
  assert.equal(dark.headers.get('location'), '/products?q=ai')
  const lang = await post('/preferences/language', { value: 'en', next: '//elsewhere.invalid/' })
  assert.equal(lang.headers.get('location'), '/')
  assert.equal((await post('/preferences/theme', { value: 'dark', next: '/..//elsewhere.invalid/' })).headers.get('location'), '/')
  const preferences = [cookieFrom(dark, 'theme'), cookieFrom(lang, 'language')].join('; ')
  const english = await (await get('/products?q=workspace', preferences)).text()
  assert.match(english, /lang="en" data-theme="dark"/)
  assert.match(english, /AI Workspace/)
  assert.match(english, /Order lookup/)
  assert.doesNotMatch(english, /暂无商品/)
  assert.match(await (await get('/products/ai-workspace', preferences)).text(), /Add to cart/)
  assert.match(await (await get('/guest/orders', preferences)).text(), /Order lookup/)

  const email = 'customer@example.com'
  const guestCart = cookieFrom(await post('/cart/add', { sku: 'WORKSPACE-1', quantity: 1 }), 'cart')
  const guestOrder = await post('/checkout', { email, password: 'guest-order-pass' }, guestCart)
  const register = await post('/auth/register', { email, password: 'customer-demo-passphrase' })
  assert.equal(register.status, 303)
  const signedIn = cookieFrom(register, 'customer')
  assert.equal((await get(guestOrder.headers.get('location'), signedIn)).status, 303)
  const cart = cookieFrom(await post('/cart/add', { sku: 'WORKSPACE-3', quantity: 1 }), 'cart')
  const order = await post('/checkout', {}, cart + '; ' + signedIn)
  assert.equal(order.status, 303)
  const orderLocation = order.headers.get('location')
  assert.match(orderLocation, /\/guest\/orders\/[A-F0-9]{32}$/)
  assert.equal((await get(orderLocation, signedIn)).status, 200)
  assert.match(await (await get('/account', signedIn)).text(), new RegExp(orderLocation))
  assert.equal((await post('/pay/demo', { orderId: orderLocation.split('/').at(-1) }, signedIn)).status, 303)
  const other = await post('/auth/register', { email: 'other@example.com', password: 'different-demo-passphrase' })
  const otherSession = cookieFrom(other, 'customer')
  assert.equal((await get(orderLocation, otherSession)).status, 303)
  assert.equal((await get(orderLocation + '/download', otherSession)).status, 303)
  assert.equal((await post('/pay/demo', { orderId: orderLocation.split('/').at(-1) }, otherSession)).status, 403)
  assert.equal((await post('/auth/logout', {}, signedIn)).status, 303)
  assert.equal((await get(orderLocation, signedIn)).status, 303)
  const login = await post('/auth/login', { email, password: 'customer-demo-passphrase' })
  assert.equal(login.status, 303)
  assert.equal((await get(orderLocation + '/download', cookieFrom(login, 'customer'))).status, 200)
})
