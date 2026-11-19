import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { customerSessionDays, equal, openStore, ShopError } from './store.mjs'
import { t, withLanguage } from './locales.mjs'
import * as view from './views.mjs'

const assets = new Map([
  ['/assets/shop.css', ['text/css; charset=utf-8', new URL('../public/shop.css', import.meta.url)]],
  ['/assets/shop.js', ['text/javascript; charset=utf-8', new URL('../public/shop.js', import.meta.url)]]
])
const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
}
const orderPattern = /^[A-F0-9]{32}$/
const productPath = /^\/products\/([a-z0-9-]+)$/
const orderPath = /^\/guest\/orders\/([A-F0-9]{32})(\/download)?$/
const articlePath = /^\/(blog|notice)(?:\/([a-z0-9-]+))?$/
const mac = (secret, value) => createHmac('sha256', secret).update(value).digest('hex')

function localPath(target) {
  if (!target.startsWith('/') || target.startsWith('//') || /[\\\x00-\x20\x7f]/.test(target) || target.length > 1200) return '/'
  const url = new URL(target, 'http://shop.invalid')
  return url.origin === 'http://shop.invalid' && !url.pathname.startsWith('//') ? url.pathname + url.search : '/'
}

async function readBody(request) {
  if (Number(request.headers['content-length']) > 96_000) throw new ShopError(413, '提交内容过长。')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 96_000) throw new ShopError(413, '提交内容过长。')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function cookieValue(request, name) {
  const entry = (request.headers.cookie ?? '').split(';').find(term => term.trim().startsWith(name + '='))
  return entry?.trim().slice(name.length + 1) ?? ''
}

function cartCookie(request) {
  try {
    const data = JSON.parse(Buffer.from(cookieValue(request, 'cart'), 'base64url').toString())
    const entries = Object.entries(data)
    return Object.assign(Object.create(null), Object.fromEntries(entries.slice(0, 20).filter(([id, count]) =>
      /^[A-Z0-9][A-Z0-9-]{0,59}$/.test(id) && Number.isInteger(count) && count >= 1 && count <= 10)))
  } catch {
    return Object.create(null)
  }
}

export function createShop({
  database, key, demo = false, seed = demo, adminPassword, paymentSecret, checkoutUrl, publicOrigins = [], secure = false, trustedProxyIps = []
}) {
  if (typeof key !== 'string' || key.length < 32) throw new Error('APP_KEY 至少需要 32 个字符。')
  if (adminPassword && adminPassword.length < 12) throw new Error('ADMIN_PASSWORD 至少需要 12 个字符。')
  if (paymentSecret && paymentSecret.length < 32) throw new Error('PAYMENT_SECRET 至少需要 32 个字符。')
  const merchant = checkoutUrl ? new URL(checkoutUrl) : null
  if (merchant && (merchant.protocol !== 'https:' || merchant.username || merchant.password || !paymentSecret)) {
    throw new Error('商户付款入口须使用 HTTPS，并配置 PAYMENT_SECRET。')
  }
  const ready = demo || Boolean(merchant)
  const store = openStore(database, key)
  if (seed) store.seed()

  const signatures = (purpose, payload) => mac(key, purpose + ':' + payload)
  const sign = (purpose, subject, ttl) => {
    const payload = subject + '.' + (Date.now() + ttl) + '.' + randomBytes(12).toString('hex')
    return payload + '.' + signatures(purpose, payload)
  }
  const check = (cookie, purpose, subject) => {
    const segments = cookie.split('.')
    if (segments.length !== 4 || segments[0] !== subject || Number(segments[1]) <= Date.now()) return false
    return equal(signatures(purpose, segments.slice(0, 3).join('.')), segments[3])
  }
  const cookie = (name, value, seconds) => name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + seconds + (secure ? '; Secure' : '')
  const guest = id => cookie('guest', sign('guest', id, 43_200_000), 43_200)
  const adminSubject = adminPassword ? signatures('admin-password', adminPassword).slice(0, 32) : ''

  const limitBuckets = new Map()
  const trustedProxy = new Set(trustedProxyIps.map(ip => ip.replace(/^::ffff:/, '')))
  const allowed = (request, group, limit) => {
    const now = Date.now()
    if (limitBuckets.size > 2000) {
      for (const [bucket, value] of limitBuckets) if (value.until <= now) limitBuckets.delete(bucket)
    }
    const remote = request.socket.remoteAddress
    const forwarded = request.headers['x-real-ip']
    const ip = trustedProxy.has(remote?.replace(/^::ffff:/, '')) && typeof forwarded === 'string' && isIP(forwarded)
      ? forwarded : remote
    const id = group + ':' + ip
    let value = limitBuckets.get(id)
    if (!value || value.until <= now) {
      if (!value && limitBuckets.size >= 10_000) return false
      value = { count: 0, until: now + 60_000 }
      limitBuckets.set(id, value)
    }
    return ++value.count <= limit
  }

  const merchantLink = order => {
    if (!merchant) return ''
    const url = new URL(merchant)
    const tuple = [order.id, order.total, 'CNY']
    for (const [index, name] of ['orderId','amount','currency'].entries()) url.searchParams.set(name, tuple[index])
    url.searchParams.set('signature', mac(paymentSecret, 'checkout:' + tuple.join(':')))
    return url.href
  }
  const adminView = (message, codes, query = new URLSearchParams()) => {
    const number = key => {
      const page = Number(query.get(key))
      return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1
    }
    const size = 25
    const orderPage = number('orders'), taskPage = number('tasks')
    const orders = store.orders(size + 1, (orderPage - 1) * size)
    const tasks = store.tasks(size + 1, (taskPage - 1) * size)
    return view.adminPage({
      products: store.products(true), posts: store.posts(), message, codes,
      orders: orders.slice(0, size), tasks: tasks.slice(0, size),
      orderPage, taskPage, moreOrders: orders.length > size, moreTasks: tasks.length > size
    })
  }

  async function handler(request, response) {
    const requestTarget = request.url ?? '/'
    const separator = requestTarget.indexOf('?')
    const path = separator < 0 ? requestTarget : requestTarget.slice(0, separator)
    const currentPath = localPath(requestTarget)
    const query = new URLSearchParams(separator < 0 ? '' : requestTarget.slice(separator + 1))
    const method = request.method
    const items = cartCookie(request)
    const isAdmin = Boolean(adminSubject) && check(cookieValue(request, 'admin'), 'admin', adminSubject)
    const isGuest = id => orderPattern.test(id) && check(cookieValue(request, 'guest'), 'guest', id)
    const customerSession = cookieValue(request, 'customer')
    let customer
    const canAccessOrder = id => orderPattern.test(id) && (isGuest(id) || (customer && store.ownsOrder(customer.id, id)))
    const theme = cookieValue(request, 'theme') === 'dark' ? 'dark' : 'light'
    const term = (query.get('q') ?? '').trim().slice(0, 100)
    let preferencePath = currentPath
    if (method === 'POST') {
      if (path.startsWith('/redeem')) preferencePath = '/verify'
      else if (path.startsWith('/admin/')) preferencePath = '/admin'
      else if (path.startsWith('/cart/')) preferencePath = '/cart'
    }
    const send = (status, content, type = 'text/html; charset=utf-8', headers = {}) => {
      response.writeHead(status, { ...securityHeaders, 'Cache-Control': 'no-store', 'Content-Type': type, ...headers })
      response.end(method === 'HEAD' ? undefined : content)
    }
    const page = (title, content, status = 200) => send(status, view.layout({
      title, path, content, demo, customer, theme, next: preferencePath, query: term,
      cartCount: Object.values(items).reduce((total, quantity) => total + quantity, 0)
    }))
    const redirect = (location, cookies = []) => send(303, '', 'text/plain; charset=utf-8', { Location: location, 'Set-Cookie': cookies })
    const json = (status, body) => send(status, JSON.stringify(body), 'application/json; charset=utf-8')

    try {
      customer = store.customer(customerSession)
      if (method === 'GET' || method === 'HEAD') {
        const asset = assets.get(path)
        if (asset) return send(200, readFileSync(asset[1]), asset[0], { 'Cache-Control': 'public, max-age=300' })
        if (path === '/') return page('首页', view.home(store.products(), store.posts('notice')[0]))
        if (path === '/products') return page(term ? '搜索结果' : '全部商品', view.catalog(store.products(), query.get('category') ?? '', term))
        const productMatch = productPath.exec(path)
        if (productMatch) {
          const product = store.products().find(item => item.slug === productMatch[1])
          if (product) return page(product.name, view.detail(product))
        }
        if (path === '/about') return page('关于', view.about())
        const articleMatch = articlePath.exec(path)
        if (articleMatch) {
          const [, kind, slug] = articleMatch
          const article = slug ? store.post(slug) : null
          if (!slug || article?.kind === kind) return page(article?.title ?? (kind === 'blog' ? '使用指南' : '公告'), view.contentPage(kind, store.posts(kind), article))
        }
        if (path === '/verify') return page('卡密验证', view.verifyPage())
        if (path === '/cart') {
          const selected = store.cart(items)
          const active = new Set(selected.map(item => item.id))
          return page('购物车', view.cartPage(selected, ready, Object.keys(items).filter(id => !active.has(id))))
        }
        if (path === '/checkout') {
          const selected = store.cart(items)
          return ready && selected.length && selected.length === Object.keys(items).length
            ? page('确认订单', view.checkoutPage(selected, customer)) : redirect('/cart')
        }
        if (path === '/auth/login' || path === '/auth/register') {
          const register = path === '/auth/register'
          return customer ? redirect('/account') : page(register ? '创建账户' : '顾客登录', view.customerLogin(register))
        }
        if (path === '/account') {
          if (!customer) return redirect('/auth/login')
          const requested = Number(query.get('page'))
          const index = Number.isSafeInteger(requested) && requested > 0 && requested <= 100_000 ? requested : 1
          const orders = store.customerOrders(customer.id, 26, (index - 1) * 25)
          return page('我的账户', view.account(customer, orders.slice(0, 25), index, orders.length > 25))
        }
        if (path === '/guest/orders') {
          const id = query.get('order') ?? ''
          return page('查询订单', view.lookupPage(orderPattern.test(id) ? id : ''))
        }
        const orderMatch = orderPath.exec(path)
        if (orderMatch) {
          const [, id, download] = orderMatch
          if (!canAccessOrder(id)) return redirect('/guest/orders?order=' + id)
          const order = store.delivery(id)
          if (!order) throw new ShopError(404, '订单不存在。')
          if (!download) return page('订单详情', view.orderPage(order, demo, merchantLink(order)))
          if (order.status !== 'fulfilled') throw new ShopError(409, '订单尚未发货。')
          const content = order.lines.map(line => [t(line.product_name) + ' · ' + t(line.sku_name), ...line.codes, line.portal].join('\n')).join('\n\n')
          return send(200, content, 'text/plain; charset=utf-8', { 'Content-Disposition': 'attachment; filename="prism-' + id + '.txt"' })
        }
        if (path === '/admin') return page('店铺管理', isAdmin ?
          adminView(undefined, undefined, query) : view.adminLogin())
        throw new ShopError(404, '没有找到这个页面。')
      }

      if (method !== 'POST') return send(405, 'Method Not Allowed', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD, POST' })
      if (path === '/webhooks/payment') {
        if (!paymentSecret) return json(404, { error: 'Payment endpoint unavailable' })
        const body = await readBody(request)
        if (!equal(mac(paymentSecret, body), request.headers['x-payment-signature'] ?? '')) return json(401, { error: 'Invalid signature' })
        let payload
        try { payload = JSON.parse(body.toString('utf8')) } catch { throw new ShopError(400, '支付通知必须为 JSON。') }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ShopError(400, '支付通知格式无效。')
        return json(200, { status: store.pay(payload).status })
      }

      const origin = request.headers.origin
      const localOrigin = (secure ? 'https://' : 'http://') + request.headers.host
      if (!origin || !(publicOrigins.length ? publicOrigins.includes(origin) : origin === localOrigin)) throw new ShopError(403, '请从本站页面提交请求。')
      const group = path === '/admin/login' ? 'admin' : ['/auth/login', '/auth/register'].includes(path) ? 'customer' : path === '/guest/orders' ? 'lookup' :
        path.startsWith('/redeem') || path === '/verify' ? 'verify' : path === '/checkout' ? 'checkout' : 'forms'
      if (!allowed(request, group, { admin: 10, customer: 10, lookup: 15, verify: 45, checkout: 15, forms: 90 }[group])) {
        throw new ShopError(429, '请求过于频繁，请稍后重试。')
      }
      if (!(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) throw new ShopError(415, '提交格式不受支持。')
      const params = new URLSearchParams((await readBody(request)).toString('utf8'))
      const input = Object.fromEntries(params)
      const value = key => params.get(key) ?? ''

      if (path === '/preferences/theme' || path === '/preferences/language') {
        const name = path.endsWith('theme') ? 'theme' : 'language'
        const preference = value('value')
        const allowedValues = name === 'theme' ? ['light', 'dark'] : ['zh', 'en']
        if (!allowedValues.includes(preference)) throw new ShopError(400, '提交格式不受支持。')
        return redirect(localPath(value('next')), [cookie(name, preference, 365 * 86_400)])
      }
      if (path === '/auth/login' || path === '/auth/register') {
        if (customer) return redirect('/account')
        const register = path === '/auth/register'
        try {
          const session = store.customerAuth(value('email'), value('password'), register)
          return redirect('/account', [cookie('customer', session, customerSessionDays * 86_400), cookie('guest', '', 0)])
        } catch (error) {
          if (!(error instanceof ShopError)) throw error
          return page(register ? '创建账户' : '顾客登录', view.customerLogin(register, error.message, value('email').slice(0, 254)), error.status)
        }
      }
      if (path === '/auth/logout') {
        if (customer) store.logoutCustomer(customerSession)
        return redirect('/auth/login', [cookie('customer', '', 0), cookie('guest', '', 0)])
      }
      if (path === '/cart/add' || path === '/cart/update') {
        const id = value('sku')
        const count = Number(value('quantity'))
        const adding = path === '/cart/add'
        const sku = store.sku(id)
        const quantity = (adding ? items[id] ?? 0 : 0) + count
        if ((!sku?.active || !sku.product_active) && (adding || quantity > 0)) throw new ShopError(409, '此项规格不可购买。')
        if (!/^[A-Z0-9][A-Z0-9-]{0,59}$/.test(id) || !/^\d+$/.test(value('quantity')) || !Number.isInteger(count) ||
          count < (adding ? 1 : 0) || quantity > 10 || (quantity && sku?.mode === 'inventory' && quantity > sku.stock)) {
          throw new ShopError(409, '请检查购买数量与库存，每项最多购买 10 件。')
        }
        if (quantity) items[id] = quantity
        else delete items[id]
        if (Object.keys(items).length > 20) throw new ShopError(409, '购物车最多可以添加 20 项规格。')
        return redirect('/cart', [cookie('cart', Buffer.from(JSON.stringify(items)).toString('base64url'), 604800)])
      }
      if (path === '/checkout') {
        if (!ready) throw new ShopError(503, '支付通道尚未开放。')
        const id = customer ? store.order(items, customer.email, randomBytes(24).toString('hex'), customer.id) :
          store.order(items, value('email'), value('password'))
        const clearedCart = cookie('cart', '', 0)
        return redirect('/guest/orders/' + id, customer ? [clearedCart] : [guest(id), clearedCart])
      }
      if (path === '/guest/orders') {
        const id = value('orderId').trim().toUpperCase()
        if (!orderPattern.test(id) || !store.authenticate(id, value('email'), value('password'))) {
          return page('查询订单', view.lookupPage(id.slice(0, 32), '订单号、邮箱或查询密码有误。'), 401)
        }
        return redirect('/guest/orders/' + id, [guest(id)])
      }
      if (path === '/pay/demo') {
        if (!demo) throw new ShopError(404, '测试支付没有启用。')
        const id = value('orderId')
        if (!canAccessOrder(id)) throw new ShopError(403, '请先验证订单。')
        const order = store.lookup(id)
        if (!order) throw new ShopError(404, '订单不存在。')
        store.pay({ eventId: 'demo:' + id, orderId: id, amount: order.total, currency: 'CNY' })
        return redirect('/guest/orders/' + id)
      }
      if (path === '/verify' || path === '/redeem' || path === '/redeem/cancel') {
        const code = value('code').trim().toUpperCase().slice(0, 300)
        try {
          const details = path === '/verify' ? store.cardDetails(code) : path === '/redeem' ?
            store.redeem(code, value('requestId'), value('reference').trim()) : store.resolve(value('requestId'), 'cancelled', code)
          return page('卡密验证', view.verifyPage(code, details))
        } catch (error) {
          if (!(error instanceof ShopError)) throw error
          return page('卡密验证', view.verifyPage(code, null, error.message), error.status)
        }
      }
      if (path === '/admin/login') {
        if (!adminSubject || !equal(signatures('admin-password', value('password')).slice(0, 32), adminSubject)) {
          return page('店铺管理', view.adminLogin('管理员口令无效，或管理登录尚未配置。'), 401)
        }
        return redirect('/admin', [cookie('admin', sign('admin', adminSubject, 28_800_000), 28_800)])
      }
      if (path.startsWith('/admin/')) {
        if (!isAdmin) throw new ShopError(403, '需要管理员登录。')
        switch (path) {
          case '/admin/logout': return redirect('/admin', [cookie('admin', '', 0)])
          case '/admin/product': store.saveProduct(input); break
          case '/admin/sku': store.saveSku(input); break
          case '/admin/post': store.savePost(input); break
          case '/admin/retry': store.retry(value('orderId')); break
          case '/admin/claim': store.claim(value('requestId')); break
          case '/admin/resolve': store.resolve(value('requestId'), value('status'), undefined, value('result').trim()); break
          case '/admin/revoke': store.revoke(value('code')); break
          case '/admin/inventory': return page('店铺管理', adminView('已导入 ' + store.importStock(value('sku'), value('codes')) + ' 条新授权码。'))
          case '/admin/generate': return page('店铺管理', adminView('请妥善保管以下卡密。', store.generate(value('sku'), Number(value('count')))))
          default: throw new ShopError(404, '没有找到这个管理操作。')
        }
        return redirect('/admin')
      }
      throw new ShopError(404, '没有找到这个页面。')
    } catch (error) {
      const status = error instanceof ShopError ? error.status : 500
      const message = status === 500 ? '暂时无法处理，请稍后重试。' : error.message
      if (status === 500) console.error('Shop request failed', method, error.code ?? error.name)
      if (!response.headersSent && !response.destroyed) {
        if (path === '/webhooks/payment') json(status, { error: message })
        else page('请求未完成', view.errorPage(status, message), status)
      }
    }
  }
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, (request, response) =>
    withLanguage(cookieValue(request, 'language'), () => handler(request, response)))
  server.on('close', () => store.close())
  return server
}

function start() {
  const demo = process.env.DEMO_MODE === '1'
  const secure = process.env.COOKIE_SECURE === '1'
  const key = process.env.APP_KEY || (demo ? randomBytes(32).toString('hex') : '')
  const database = process.env.DATABASE_PATH || (demo && !process.env.APP_KEY ? ':memory:' : 'data/store.sqlite')
  if (database !== ':memory:' && !existsSync(dirname(database))) mkdirSync(dirname(database), { recursive: true, mode: 0o700 })
  const server = createShop({
    database, key, demo, secure, seed: demo || process.env.SEED_DEMO === '1', adminPassword: process.env.ADMIN_PASSWORD,
    paymentSecret: process.env.PAYMENT_SECRET, checkoutUrl: process.env.CHECKOUT_URL,
    publicOrigins: (process.env.PUBLIC_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    trustedProxyIps: (process.env.TRUSTED_PROXY_IPS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  })
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 3000)
  server.listen(port, host, () => {
    const address = server.address()
    console.log('棱镜 AI  http://' + address.address + ':' + address.port)
  })
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close())
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start()
