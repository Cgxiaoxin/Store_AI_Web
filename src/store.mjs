import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export class ShopError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (status, message) => { throw new ShopError(status, message) }
const token = () => randomBytes(16).toString('hex')
const day = 86_400_000
export const customerSessionDays = 14
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
export const equal = (a, b) => {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}
const mac = (key, value) => createHmac('sha256', key).update(value).digest('hex')

export function openStore(database, key) {
  const db = new DatabaseSync(database)
  const encryptionKey = createHash('sha256').update('delivery:' + key).digest()
  const encrypt = value => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.')
  }
  const decrypt = value => {
    const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'))
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
    cipher.setAuthTag(tag)
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8')
  }
  const digest = code => mac(key, 'card:' + code)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS products (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      description TEXT NOT NULL, detail TEXT NOT NULL, art INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS skus (
      id TEXT PRIMARY KEY, product TEXT NOT NULL REFERENCES products(slug), name TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price > 0), uses INTEGER NOT NULL CHECK(uses > 0),
      days INTEGER NOT NULL CHECK(days > 0), mode TEXT NOT NULL CHECK(mode IN ('generate','inventory')),
      portal TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, secret TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      digest TEXT PRIMARY KEY, customer TEXT NOT NULL REFERENCES customers(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, salt TEXT NOT NULL, secret TEXT NOT NULL,
      total INTEGER NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, customer TEXT REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), sku TEXT NOT NULL REFERENCES skus(id),
      product_name TEXT NOT NULL, sku_name TEXT NOT NULL, quantity INTEGER NOT NULL, price INTEGER NOT NULL,
      uses INTEGER NOT NULL, days INTEGER NOT NULL, mode TEXT NOT NULL, portal TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), amount INTEGER NOT NULL, currency TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY, sku TEXT NOT NULL REFERENCES skus(id), digest TEXT NOT NULL UNIQUE,
      secret TEXT NOT NULL, line INTEGER REFERENCES order_lines(id)
    );
    CREATE TABLE IF NOT EXISTS cards (
      digest TEXT PRIMARY KEY, sku TEXT NOT NULL REFERENCES skus(id), name TEXT NOT NULL,
      secret TEXT NOT NULL, line INTEGER REFERENCES order_lines(id),
      expires INTEGER NOT NULL, remaining INTEGER NOT NULL CHECK(remaining >= 0), revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS redemptions (
      id TEXT PRIMARY KEY, card TEXT NOT NULL REFERENCES cards(digest), reference TEXT NOT NULL,
      status TEXT NOT NULL, created INTEGER NOT NULL, result TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS posts (
      slug TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('blog','notice')),
      title TEXT NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL
    );
  `)
  const get = (sql, ...values) => db.prepare(sql).get(...values)
  const all = (sql, ...values) => db.prepare(sql).all(...values)
  const run = (sql, ...values) => db.prepare(sql).run(...values)
  const atomic = operation => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  atomic(() => {
    if (!all('PRAGMA table_info(redemptions)').some(column => column.name === 'result')) {
      db.exec("ALTER TABLE redemptions ADD COLUMN result TEXT NOT NULL DEFAULT ''")
    }
    if (!all('PRAGMA table_info(orders)').some(column => column.name === 'customer')) {
      db.exec('ALTER TABLE orders ADD COLUMN customer TEXT REFERENCES customers(id)')
    }
    db.exec('CREATE INDEX IF NOT EXISTS orders_by_customer ON orders(customer, created DESC)')
  })
  const skuSql = `SELECT s.*, p.name AS product_name, p.art, p.active AS product_active,
    (SELECT count(*) FROM inventory i WHERE i.sku=s.id AND i.line IS NULL) AS stock
    FROM skus s JOIN products p ON p.slug=s.product`
  const sku = id => get(skuSql + ' WHERE s.id=?', id)
  const products = (admin = false) => all('SELECT * FROM products' + (admin ? '' : ' WHERE active=1') + ' ORDER BY rowid').map(product => ({
    ...product, skus: all(skuSql + ' WHERE s.product=?' + (admin ? '' : ' AND s.active=1') + ' ORDER BY s.rowid', product.slug)
  }))
  const lines = id => all('SELECT * FROM order_lines WHERE order_id=? ORDER BY id', id)
  const lookup = id => get('SELECT id,email,total,status,created FROM orders WHERE id=?', id)
  const makeCard = (spec, line = null) => {
    const code = 'PRISM-' + token().toUpperCase()
    run('INSERT INTO cards(digest,sku,name,secret,line,expires,remaining) VALUES(?,?,?,?,?,?,?)',
      digest(code), spec.sku, spec.product_name, encrypt(code), line, Date.now() + spec.days * day, spec.uses)
    return code
  }

  function cart(items) {
    return Object.entries(items).flatMap(([id, quantity]) => {
      const spec = sku(id)
      return spec?.active && spec.product_active && Number.isInteger(quantity) && quantity >= 1 && quantity <= 10
        ? [{ ...spec, quantity }] : []
    })
  }

  function openCustomerSession(id) {
    const session = token()
    run('DELETE FROM customer_sessions WHERE expires <= ?', Date.now())
    run('INSERT INTO customer_sessions VALUES(?,?,?)', mac(key, 'customer:' + session), id, Date.now() + customerSessionDays * day)
    return session
  }

  function customerAuth(email, password, register = false) {
    email = email.trim().toLowerCase()
    if (register) {
      if (!validEmail(email) || password.length < 8 || password.length > 100) fail(400, '请填写有效邮箱及 8–100 位密码。')
      const id = token()
      const salt = token()
      const secret = scryptSync(password, salt, 32).toString('hex')
      return atomic(() => {
        const inserted = run('INSERT OR IGNORE INTO customers VALUES(?,?,?,?)', id, email, salt, secret)
        if (!inserted.changes) fail(409, '该邮箱已注册，请登录。')
        return openCustomerSession(id)
      })
    }
    if (!validEmail(email) || password.length > 100) fail(401, '邮箱或密码有误。')
    const user = get('SELECT * FROM customers WHERE email=?', email)
    const hash = scryptSync(password, user?.salt ?? 'invalid-customer-login', 32).toString('hex')
    if (!user || !equal(hash, user.secret)) fail(401, '邮箱或密码有误。')
    return atomic(() => openCustomerSession(user.id))
  }

  function customer(session) {
    if (!/^[a-f0-9]{32}$/.test(session)) return null
    return get(`SELECT c.id,c.email FROM customers c JOIN customer_sessions s ON s.customer=c.id
      WHERE s.digest=? AND s.expires>?`, mac(key, 'customer:' + session), Date.now())
  }

  function order(items, email, password, customerId = null) {
    email = email.trim().toLowerCase()
    if (!validEmail(email) || password.length < 8 || password.length > 100) {
      fail(400, '请填写有效邮箱及 8–100 位查询密码。')
    }
    const id = token().toUpperCase()
    const salt = token()
    const secret = scryptSync(password, salt, 32).toString('hex')
    return atomic(() => {
      const selected = cart(items)
      if (!selected.length || selected.length !== Object.keys(items).length) fail(409, '购物车商品已变化，请返回购物车确认。')
      if (selected.some(item => item.mode === 'inventory' && item.quantity > item.stock)) fail(409, '库存不足，请调整购买数量。')
      const total = selected.reduce((sum, item) => sum + item.price * item.quantity, 0)
      run('INSERT INTO orders(id,email,salt,secret,total,status,created,customer) VALUES(?,?,?,?,?,?,?,?)', id, email, salt, secret, total, 'unpaid', Date.now(), customerId)
      for (const item of selected) {
        run('INSERT INTO order_lines(order_id,sku,product_name,sku_name,quantity,price,uses,days,mode,portal) VALUES(?,?,?,?,?,?,?,?,?,?)',
          id, item.id, item.product_name, item.name, item.quantity, item.price, item.uses, item.days, item.mode, item.portal)
      }
      return id
    })
  }

  function authenticate(id, email, password) {
    if (password.length > 100) return false
    const order = get('SELECT * FROM orders WHERE id=?', id)
    const hash = scryptSync(password, order?.salt ?? 'invalid-order-lookup', 32).toString('hex')
    return order && equal(hash, order.secret) && order.email === email.trim().toLowerCase()
  }

  function fulfill(id) {
    const order = lookup(id)
    if (!order || order.status !== 'paid') return order
    const pending = lines(id)
    const inventory = new Map()
    for (const line of pending.filter(item => item.mode === 'inventory')) {
      const stock = all('SELECT id FROM inventory WHERE sku=? AND line IS NULL ORDER BY id LIMIT ?', line.sku, line.quantity)
      if (stock.length !== line.quantity) return order
      inventory.set(line.id, stock)
    }
    for (const line of pending) {
      if (line.mode === 'inventory') {
        for (const item of inventory.get(line.id)) run('UPDATE inventory SET line=? WHERE id=?', line.id, item.id)
      } else {
        for (let index = 0; index < line.quantity; index++) makeCard(line, line.id)
      }
    }
    run("UPDATE orders SET status='fulfilled' WHERE id=?", id)
    return lookup(id)
  }

  function pay({ eventId, orderId, amount, currency }) {
    if (typeof eventId !== 'string' || !eventId.length || eventId.length > 150 ||
      typeof orderId !== 'string' || !Number.isSafeInteger(amount) || currency !== 'CNY') fail(400, '支付通知格式无效。')
    return atomic(() => {
      const order = lookup(orderId)
      if (!order) fail(404, '订单不存在。')
      if (order.total !== amount) fail(409, '支付金额与订单不符。')
      const previous = get('SELECT * FROM payment_events WHERE id=?', eventId)
      if (previous && (previous.order_id !== orderId || previous.amount !== amount || previous.currency !== currency)) fail(409, '支付流水已经使用。')
      if (!previous) {
        if (order.status !== 'unpaid') fail(409, '此订单已有另一笔支付流水。')
        run('INSERT INTO payment_events VALUES(?,?,?,?)', eventId, orderId, amount, currency)
        run("UPDATE orders SET status='paid' WHERE id=?", orderId)
      }
      return fulfill(orderId)
    })
  }

  function delivery(id) {
    const order = lookup(id)
    if (!order) return null
    return { ...order, lines: lines(id).map(line => ({
      ...line, codes: order.status === 'fulfilled'
        ? all('SELECT secret FROM ' + (line.mode === 'inventory' ? 'inventory' : 'cards') + ' WHERE line=? ORDER BY rowid', line.id).map(row => decrypt(row.secret)) : []
    })) }
  }

  function findCard(code) {
    const card = get('SELECT * FROM cards WHERE digest=?', digest(code.trim().toUpperCase()))
    if (!card) fail(404, '未找到该自营卡密。')
    return card
  }
  function cardDetails(code) {
    const card = findCard(code)
    return {
      name: card.name, sku: card.sku, remaining: card.remaining, expires: card.expires,
      state: card.revoked ? 'revoked' : card.expires <= Date.now() ? 'expired' : 'active',
      tasks: all("SELECT id,reference,status,created,result FROM redemptions WHERE card=? ORDER BY status IN ('pending','processing') DESC, created DESC, rowid DESC LIMIT 20", card.digest)
        .map(task => ({ ...task, result: task.result ? decrypt(task.result) : '' }))
    }
  }

  function redeem(code, requestId, reference) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId) || reference.length > 240) fail(400, '兑换请求格式无效。')
    return atomic(() => {
      const card = findCard(code)
      const prior = get('SELECT card FROM redemptions WHERE id=?', requestId)
      if (prior?.card === card.digest) return cardDetails(code)
      if (prior) fail(409, '请重新查询卡密后再提交。')
      if (card.revoked || card.expires <= Date.now() || card.remaining < 1) fail(409, '卡密已失效或可用额度不足。')
      run('UPDATE cards SET remaining=remaining-1 WHERE digest=?', card.digest)
      run("INSERT INTO redemptions(id,card,reference,status,created) VALUES(?,?,?,'pending',?)", requestId, card.digest, reference, Date.now())
      return cardDetails(code)
    })
  }

  function claim(requestId) {
    const update = run("UPDATE redemptions SET status='processing' WHERE id=? AND status='pending'", requestId)
    if (!update.changes) fail(409, '兑换已被领取或已结束。')
  }

  function resolve(requestId, status, code, result = '') {
    if (!['success', 'failed', 'cancelled'].includes(status) || result.length > 4000) fail(400, '请检查任务状态和结果长度。')
    return atomic(() => {
      const task = get('SELECT * FROM redemptions WHERE id=?', requestId)
      const card = code === undefined ? null : findCard(code)
      if (!task || (card && task.card !== card.digest)) fail(404, '兑换任务不存在。')
      const expected = status === 'cancelled' ? 'pending' : 'processing'
      if (task.status !== expected && task.status !== status) fail(409, '这个兑换状态无法执行该操作。')
      if (task.status === expected) {
        run('UPDATE redemptions SET status=?,result=? WHERE id=?', status, result ? encrypt(result) : '', requestId)
        if (status !== 'success') run('UPDATE cards SET remaining=remaining+1 WHERE digest=?', task.card)
      }
      return card ? cardDetails(code) : undefined
    })
  }

  function fields(input, names) {
    return names.map(([name, max]) => {
      const value = String(input[name] ?? '').trim()
      if (!value.length || value.length > max) fail(400, '请检查必填字段和文本长度。')
      return value
    })
  }
  const slugPattern = /^[a-z0-9][a-z0-9-]{0,59}$/

  function saveProduct(input) {
    const [slug, name, category, description, detail] = fields(input, [['slug', 60], ['name', 80], ['category', 40], ['description', 200], ['detail', 3000]])
    const art = Number(input.art)
    if (!slugPattern.test(slug) || ![0, 1, 2].includes(art)) fail(400, '请检查商品地址及图案选项。')
    run(`INSERT INTO products VALUES(?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, category=excluded.category, description=excluded.description, detail=excluded.detail,
      art=excluded.art, active=excluded.active`, slug, name, category, description, detail, art, Number(input.active === '1'))
  }

  function saveSku(input) {
    const [id, product, name] = fields(input, [['id', 60], ['product', 60], ['name', 80]])
    const [price, uses, days] = ['price', 'uses', 'days'].map(field => Number(input[field]))
    const mode = input.mode
    const portal = mode === 'generate' ? '/verify' : String(input.portal ?? '').trim()
    const url = URL.canParse(portal) ? new URL(portal) : null
    if (!/^[A-Z0-9][A-Z0-9-]{0,59}$/.test(id) || !get('SELECT 1 FROM products WHERE slug=?', product) ||
      ![price, uses, days].every(Number.isSafeInteger) || price < 1 || price > 10_000_000 || uses < 1 || uses > 10_000 || days < 1 || days > 3650 ||
      !['generate','inventory'].includes(mode) || (mode === 'inventory' && (url?.protocol !== 'https:' || url.username || url.password || portal.length > 500))) fail(400, '请检查 SKU、金额、次数、有效期及 HTTPS 兑换链接。')
    const existing = sku(id)
    if (existing && (existing.product !== product || existing.mode !== mode)) fail(409, '已有 SKU 的商品和交付方式固定，请新建 SKU。')
    run(`INSERT INTO skus VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, price=excluded.price, uses=excluded.uses, days=excluded.days, portal=excluded.portal,
      active=excluded.active`, id, product, name, price, uses, days, mode, portal, Number(input.active === '1'))
  }

  function importStock(id, text) {
    if (sku(id)?.mode !== 'inventory') fail(400, '请选择库存码类型的 SKU。')
    const codes = text.split(/\r?\n/).map(code => code.trim()).filter(Boolean)
    if (!codes.length || codes.length > 200 || codes.some(code => code.length > 300)) fail(400, '每次可导入 1–200 条，每条最长 300 字符。')
    return atomic(() => codes.reduce((count, code) => count + Number(run(
      'INSERT OR IGNORE INTO inventory(sku,digest,secret) VALUES(?,?,?)', id, mac(key, 'inventory:' + code), encrypt(code)
    ).changes), 0))
  }

  function generate(id, count) {
    const spec = sku(id)
    if (spec?.mode !== 'generate' || !Number.isInteger(count) || count < 1 || count > 100) fail(400, '请选择自营 SKU，数量为 1–100。')
    return atomic(() => Array.from({ length: count }, () => makeCard({ ...spec, sku: id })))
  }

  function savePost(input) {
    const [slug, title, body] = fields(input, [['slug', 60], ['title', 120], ['body', 10000]])
    if (!slugPattern.test(slug) || !['blog','notice'].includes(input.kind)) fail(400, '请检查内容分类和地址。')
    run(`INSERT INTO posts VALUES(?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET
      kind=excluded.kind,title=excluded.title,body=excluded.body,updated=excluded.updated`, slug, input.kind, title, body, Date.now())
  }

  function seed() {
    atomic(() => {
      if (get('SELECT 1 FROM products LIMIT 1')) return
      const samples = [
        ['ai-workspace', 'AI 工作台', '效率工具', '用于文档整理、提纲构思与日常写作的 AI 工作台服务。', '购买后可在本站提交服务申请。每次兑换对应一项服务请求。请在兑换备注中简要说明需求。', 0],
        ['prompt-studio', '提示词工作室', '创作服务', '将想法整理成结构清晰、便于复用的提示词。', '适用于写作、内容规划与提示词调优。订单内的自营卡可在本站验证并提交兑换。', 1],
        ['ai-consult', 'AI 使用指导', '使用指导', '适合第一次搭建个人 AI 工作流的上手指导。', '持卡提交使用场景与目标，由服务台处理兑换。', 2]
      ]
      for (const [slug, name, category, description, detail, art] of samples) saveProduct({ slug, name, category, description, detail, art, active: '1' })
      for (const [id, product, name, price, uses] of [
        ['WORKSPACE-1', 'ai-workspace', '单次体验', 1200, 1], ['WORKSPACE-3', 'ai-workspace', '三次服务', 2900, 3],
        ['PROMPT-1', 'prompt-studio', '单次创作', 1800, 1], ['CONSULT-1', 'ai-consult', '一次指导', 3900, 1]
      ]) saveSku({ id, product, name, price, uses, days: 90, mode: 'generate', active: '1' })
      savePost({ slug: 'using-your-card', kind: 'blog', title: '如何使用购买后的卡密', body: '打开订单详情并复制卡密。自营服务可在「卡密验证」查询额度并提交兑换。库存授权码请按订单中附带的服务入口使用。' })
      savePost({ slug: 'store-preview', kind: 'notice', title: '商城试运行', body: '当前示例目录用于演示购买、发卡和兑换的完整流程。' })
    })
  }

  return {
    products, sku, cart, order, authenticate, lookup, delivery, pay, cardDetails, redeem, claim, resolve, seed,
    customerAuth, customer,
    logoutCustomer: session => run('DELETE FROM customer_sessions WHERE digest=?', mac(key, 'customer:' + session)),
    ownsOrder: (customer, id) => Boolean(get('SELECT 1 FROM orders WHERE id=? AND customer=?', id, customer)),
    customerOrders: (customer, limit, offset) => all('SELECT id,total,status,created FROM orders WHERE customer=? ORDER BY created DESC, rowid DESC LIMIT ? OFFSET ?', customer, limit, offset),
    retry: id => atomic(() => fulfill(id)),
    revoke: code => run('UPDATE cards SET revoked=1 WHERE digest=?', findCard(code).digest),
    posts: kind => kind ? all('SELECT * FROM posts WHERE kind=? ORDER BY updated DESC', kind) : all('SELECT * FROM posts ORDER BY updated DESC'),
    post: slug => get('SELECT * FROM posts WHERE slug=?', slug),
    orders: (limit, offset) => all("SELECT id,email,total,status,created FROM orders ORDER BY (status='paid') DESC, created DESC, rowid DESC LIMIT ? OFFSET ?", limit, offset),
    tasks: (limit, offset) => all(`SELECT r.id,r.reference,r.status,r.created,c.name,c.sku FROM redemptions r
      JOIN cards c ON r.card=c.digest ORDER BY r.status IN ('pending','processing') DESC, r.created DESC, r.rowid DESC LIMIT ? OFFSET ?`, limit, offset),
    saveProduct, saveSku, importStock, generate, savePost,
    close: () => db.close()
  }
}
