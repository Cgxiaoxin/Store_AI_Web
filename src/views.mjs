import { randomBytes } from 'node:crypto'
import { english, language, t } from './locales.mjs'

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char])
export const money = value => '¥' + (value / 100).toFixed(2)
const date = value => new Intl.DateTimeFormat(language(), { timeZone: 'Asia/Shanghai', dateStyle: 'medium' }).format(value)
const nav = [['/', '首页'], ['/products', '全部商品'], ['/blog', '使用指南'], ['/notice', '公告'], ['/about', '关于']]
const orderStates = { unpaid: '待支付', paid: '已支付 · 待发货', fulfilled: '已发货' }
const taskStates = { pending: '待处理', processing: '处理中', success: '已完成', failed: '未成功 · 已退回', cancelled: '已取消 · 已退回' }
const brand = () => `<a class="brand" href="/"><span class="brand-icon" aria-hidden="true">✦</span><span>${t('棱镜 AI')}</span></a>`
const link = (url, text, classes = 'button primary') => `<a class="${classes}" href="${escape(url)}">${escape(text)}</a>`
const submit = (text, secondary = false) => `<button class="button ${secondary ? 'secondary' : 'primary'}" type="submit">${escape(text)}</button>`
const hidden = (key, value) => `<input type="hidden" name="${key}" value="${escape(value)}">`
const field = (key, label, value = '', attrs = 'required') => `<label>${label}<input name="${key}" value="${escape(value)}" ${attrs}></label>`
const textarea = (key, label, value = '', attrs = 'required') => `<label>${label}<textarea name="${key}" ${attrs}>${escape(value)}</textarea></label>`
const option = (value, label, current) => `<option value="${escape(value)}"${String(value) === String(current) ? ' selected' : ''}>${escape(label)}</option>`
const select = (key, label, options) => `<label>${label}<select name="${key}" required>${options}</select></label>`
const form = (action, content, className = 'stack') => `<form method="post" action="${action}" class="${className}">${content}</form>`
const choices = (key, label, options, current) => select(key, label, options.map(([value, text]) => option(value, text, current)).join(''))
const header = (label, title, copy = '') => `<section class="page-heading"><p class="eyebrow">${label}</p><h1>${title}</h1>${copy ? `<p class="intro">${copy}</p>` : ''}</section>`
const panel = (title, body, classes = '') => `<section class="panel ${classes}"><h2>${title}</h2>${body}</section>`
const empty = (title, body, action = '') => `<section class="panel empty"><h2>${title}</h2><p>${body}</p>${action}</section>`

function searchForm(query = '') {
  return `<form class="search-form" action="/products" method="get" role="search">
    <label class="sr-only" for="product-search">${t('搜索商品')}</label>
    <input type="search" id="product-search" name="q" value="${escape(query)}" maxlength="100" placeholder="${t('输入商品名称或关键词')}">
    ${submit(t('搜索'))}</form>`
}

function tools({ customer, cartCount, theme, next, query }) {
  const dark = theme === 'dark'
  const inEnglish = language() === 'en'
  const preference = (name, value, label, mark) => form('/preferences/' + name,
    hidden('value', value) + hidden('next', next) + `<button class="header-control header-icon" type="submit" title="${label}" aria-label="${label}">${mark}</button>`, 'header-form')
  return `<div class="header-actions">
    <details class="header-search"><summary class="header-control header-icon" title="${t('搜索商品')}" aria-label="${t('搜索商品')}"><span class="search-icon" aria-hidden="true"></span></summary>
      <div class="search-popover">${searchForm(query)}</div></details>
    ${link('/guest/orders', t('订单查询'), 'header-control')}
    ${preference('theme', dark ? 'light' : 'dark', t(dark ? '切换浅色主题' : '切换深色主题'), `<span aria-hidden="true">${dark ? '☀' : '☾'}</span>`)}
    <a href="/cart" class="header-control cart-link">${t('购物车')}${cartCount ? ` <span>${cartCount}</span>` : ''}</a>
    ${preference('language', inEnglish ? 'zh' : 'en', t(inEnglish ? '切换至中文' : '切换至英文'), inEnglish ? '中文' : 'EN')}
    ${link(customer ? '/account' : '/auth/login', t(customer ? '我的账户' : '登录'), 'header-control header-login')}
  </div>`
}

export function layout({ title, path, content, cartCount = 0, demo = false, customer, theme = 'light', next = '/', query = '' }) {
  return `<!doctype html><html lang="${language()}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${theme}"><meta name="description" content="${t("棱镜 AI 数字商店与卡密服务台")}"><title>${escape(t(title))} · ${t('棱镜 AI')}</title><link rel="stylesheet" href="/assets/shop.css"><script defer src="/assets/shop.js"></script></head>
  <body><a href="#main" class="skip">${t("跳到主要内容")}</a><header class="site-header"><div class="wrap header-inner">${brand()}
  <nav aria-label="${t("主导航")}">${nav.map(([url, label]) => {
    const active = path === url || (url !== '/' && path.startsWith(url + '/'))
    return `<a href="${url}"${active ? ' aria-current="page"' : ''}>${t(label)}</a>`
  }).join('')}</nav>${tools({ customer, cartCount, theme, next, query })}</div></header>
  ${demo ? `<div class="demo-strip">${t("体验环境 · 测试支付不会产生扣款")}</div>` : ''}
  <main class="wrap" id="main">${content}</main>
  <footer class="site-footer"><div class="wrap footer-inner"><div>${brand()}<p>${t("AI 服务与数字产品商店")}</p></div><div class="footer-links"><a href="/products">${t("商品目录")}</a><a href="/guest/orders">${t("游客订单")}</a><a href="/verify">${t("卡密验证")}</a><a href="/about">${t("关于我们")}</a></div><div class="footer-note">© ${new Date().getFullYear()} ${t("棱镜 AI")}</div></div></footer></body></html>`
}

function art(style, label) {
  return `<div class="product-art art-${style}" aria-hidden="true"><span class="art-mark">${['✦','✳','◈'][style]}</span><span class="art-label">${escape(label)}</span></div>`
}
const hasStock = sku => sku.mode === 'generate' || sku.stock > 0
function card(product) {
  const prices = product.skus.map(sku => sku.price)
  const url = '/products/' + product.slug
  return `<article class="product-card"><a class="product-visual" href="${url}" aria-label="${escape(t(product.name))}">${art(product.art, ['WORKSPACE', 'STUDIO', 'GUIDANCE'][product.art])}</a><div class="product-body">
    <p class="product-category">${escape(t(product.category))}</p><h3><a href="${url}">${escape(t(product.name))}</a></h3><p class="product-description">${escape(t(product.description))}</p>
    <div class="product-bottom"><strong>${prices.length ? money(Math.min(...prices)) : t('即将开放')}${prices.length > 1 ? ` <small>${t("起")}</small>` : ''}</strong>${link(url, t('查看商品'), 'button secondary compact')}</div></div></article>`
}

export function home(products, notice) {
  return `<section class="hero"><div class="hero-content"><p class="hero-kicker"><span></span> PRISM AI STORE</p>
    <h1>${t("把 AI 用在")}<br>${t("你的日常里。")}</h1><p class="hero-copy">${t("选购所需的 AI 服务。支付后领取专属卡密，按自己的节奏使用。")}</p>
    <div class="actions">${link('/products', t('浏览全部商品'), 'button light')}${link('/verify', t('验证卡密'), 'button glass')}</div></div>
    <div class="hero-art" aria-hidden="true"><i class="orbit orbit-a"></i><i class="orbit orbit-b"></i><i class="orbit orbit-c"></i><i class="orbit orbit-d"></i><span class="hero-star">✦</span><span class="light-dot dot-a"></span><span class="light-dot dot-b"></span></div></section>
    ${notice ? `<a class="announcement" href="/notice/${notice.slug}"><span class="announcement-tag">${t("店铺公告")}</span><strong>${escape(t(notice.title))}</strong><span class="announcement-date">${date(notice.updated)}</span></a>` : ''}
    <section class="catalog-section"><div class="section-heading"><div><p class="eyebrow">CATALOG</p><h2>${t("精选 AI 服务")}</h2></div>${link('/products', t('全部商品'), 'button secondary')}</div>
    ${products.length ? `<div class="product-grid">${products.slice(0, 3).map(card).join('')}</div>` : empty(t('商品即将上架'), t('你可以先查看使用指南。'), link('/blog', t('使用指南'), 'button secondary'))}</section>
    <section class="process"><div><strong>${t("选择服务")}</strong><p>${t("按所需次数和规格选购。")}</p></div><div><strong>${t("领取卡密")}</strong><p>${t("支付完成后，前往订单详情查看。")}</p></div><div><strong>${t("按需兑换")}</strong><p>${t("到卡密验证页查看额度和进度。")}</p></div></section>`
}

export function catalog(products, category, query = '') {
  const categories = [...new Set(products.map(product => product.category))]
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean)
  const filtered = products.filter(product => {
    if (category && product.category !== category) return false
    const fields = [product.name, product.slug, product.category, product.description, ...product.skus.flatMap(sku => [sku.id, sku.name])]
    const searchable = fields.flatMap(field => [field, english(field)]).join(' ').toLowerCase()
    return terms.every(term => searchable.includes(term))
  })
  const categoryUrl = key => {
    const params = new URLSearchParams()
    if (key) params.set('category', key)
    if (query) params.set('q', query)
    return '/products' + (params.size ? '?' + params.toString() : '')
  }
  return header('CATALOG', t(query ? '搜索结果' : '全部商品'), query ? escape(query) : t('浏览 AI 服务，选择适合你的规格。')) +
    `<nav class="filters" aria-label="${t("商品分类")}">${[['', '全部'], ...categories.map(name => [name, name])].map(([key, label]) => `<a class="filter${category === key ? ' selected' : ''}" href="${escape(categoryUrl(key))}">${escape(t(label))}</a>`).join('')}
    ${query ? link('/products', t('清除搜索'), 'filter') : ''}</nav>` +
    (filtered.length ? `<div class="product-grid">${filtered.map(card).join('')}</div>` : empty(t('暂无商品'), t(query ? '试试其他关键词。' : '请查看其他分类。'), link('/products', t('所有分类'))))
}

export function detail(product) {
  const available = product.skus.filter(hasStock)
  return `<p class="breadcrumb"><a href="/products">${t("全部商品")}</a> / ${escape(t(product.name))}</p><div class="product-detail"><div>${art(product.art, t(product.category))}</div><div>
    ${header(escape(t(product.category)), escape(t(product.name)), escape(t(product.description)))}
    ${available.length ? form('/cart/add', select('sku', t('选择规格'), available.map(sku => option(sku.id, t(sku.name) + ' · ' + money(sku.price) + (sku.mode === 'generate' ? ' · ' + sku.uses + t(' 次 / ') + sku.days + t(' 天') : t(' · 库存 ') + sku.stock))).join('')) +
      field('quantity', t('购买数量'), 1, 'type="number" min="1" max="10" required') + submit(t('加入购物车'))) : `<p class="message">${t("当前规格暂不可购买。")}</p>`}
    </div></div>${panel(t('服务说明'), `<p class="long-text">${escape(t(product.detail))}</p>`)}`
}

export function cartPage(items, ready, unavailable = []) {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  return header('YOUR CART', t('购物车')) + (!items.length && !unavailable.length ? empty(t('购物车为空'), t('挑选一项服务开始购买。'), link('/products', t('浏览商品'))) :
    `<div class="split">${panel(t('已选商品'), items.map(item => `<div class="list-row"><div><strong>${escape(t(item.product_name))}</strong><p>${escape(t(item.name))} · ${money(item.price)}</p></div>
    ${form('/cart/update', hidden('sku', item.id) + field('quantity', t('数量（0 为移除）'), item.quantity, 'type="number" min="0" max="10" required') + submit(t('更新'), true), 'inline')}</div>`).join('') +
    unavailable.map(id => `<div class="list-row"><p>${escape(id)} ${t("已下架")}</p>${form('/cart/update', hidden('sku', id) + hidden('quantity', 0) + submit(t('移除'), true), 'inline')}</div>`).join(''))}
    ${panel(t('订单合计'), `<p class="large-money">${money(total)}</p>${unavailable.length ? `<p class="message">${t("请先移除已下架的规格。")}</p>` :
      ready ? link('/checkout', t('前往结算')) : `<p class="message">${t("支付通道尚未开放。")}</p>`}`)}</div>`)
}

export function checkoutPage(items, customer) {
  return header('CHECKOUT', t('确认订单'), t(customer ? '下单后可在「我的订单」查看卡密。' : '请保管订单号和查询密码，以便重新查看卡密。')) + `<div class="split">
  ${panel(t(customer ? '账户结算' : '游客购买'), form('/checkout', (customer ? `<p>${escape(customer.email)}</p>` :
    field('email', t('邮箱'), '', 'type="email" maxlength="254" autocomplete="email" required') +
    field('password', t('查询密码'), '', 'type="password" minlength="8" maxlength="100" autocomplete="new-password" required')) + submit(t('提交订单'))))}
  ${panel(t('订单摘要'), items.map(item => `<div class="list-row"><span>${escape(t(item.product_name))} · ${escape(t(item.name))} × ${item.quantity}</span><strong>${money(item.price * item.quantity)}</strong></div>`).join('') +
    `<p class="large-money">${money(items.reduce((sum, item) => sum + item.price * item.quantity, 0))}</p>`)}</div>`
}

export function lookupPage(orderId = '', error = '') {
  return header('ORDER LOOKUP', t('查询订单'), t('输入购买时保存的订单号、邮箱和查询密码。')) +
    panel(t('游客订单'), (error ? `<p class="message error" role="alert">${escape(t(error))}</p>` : '') + form('/guest/orders',
      field('orderId', t('订单号'), orderId, 'maxlength="32" required') + field('email', t('邮箱'), '', 'type="email" autocomplete="email" required') +
      field('password', t('查询密码'), '', 'type="password" autocomplete="off" required') + submit(t('查询订单'))), 'narrow')
}

export function orderPage(order, demo, paymentUrl) {
  const checkout = order.status === 'unpaid' ? (demo ?
    form('/pay/demo', hidden('orderId', order.id) + submit(t('确认测试支付'))) :
    paymentUrl ? link(paymentUrl, t('前往付款')) : `<p class="message">${t("暂时无法发起付款。")}</p>`) : ''
  return header('ORDER DETAILS', t('订单详情'), `<span class="breakable">${escape(order.id)}</span>`) + `<div class="split">
    ${panel(t('商品与卡密'), order.lines.map(line => `<div class="order-item"><div class="list-row"><div><strong>${escape(t(line.product_name))}</strong><p>${escape(t(line.sku_name))} × ${line.quantity}</p></div><b>${money(line.price * line.quantity)}</b></div>
      ${line.codes.map(code => `<div class="code-row"><code>${escape(code)}</code><button class="button secondary compact" data-copy="${escape(code)}" type="button">${t("复制")}</button></div>`).join('')}
      ${line.codes.length ? link(line.portal, line.mode === 'generate' ? t('前往卡密验证') : t('前往官方兑换入口'), 'button secondary compact') : ''}</div>`).join('') +
      (order.status === 'fulfilled' ? link('/guest/orders/' + order.id + '/download', t('下载所有卡密'), 'button secondary') : ''))}
    ${panel(t('订单状态'), `<p class="status">${t(orderStates[order.status])}</p><p class="large-money">${money(order.total)}</p><p class="muted">${t("下单时间")} ${date(order.created)}</p>
    ${order.status === 'paid' ? `<p class="message">${t("订单已收款。店铺补货后会重新发货。")}</p>` : ''}${checkout}`)}</div>`
}

export function verifyPage(code = '', details = null, message = '') {
  const requestId = randomBytes(16).toString('hex')
  return header('SERVICE DESK', t('卡密验证'), t('查询自营卡密的有效期和余额，或提交一项服务兑换。')) +
  `<div class="verify-layout">${panel(t('查询卡密'), form('/verify', field('code', t('卡密'), code, 'maxlength="300" autocapitalize="characters" autocomplete="off" spellcheck="false" required') +
    submit(t('查询卡密'))) + (message ? `<p class="message error" role="alert">${escape(t(message))}</p>` : ''))}
  ${details ? panel(escape(t(details.name)), `<div class="balance">${details.state === 'active' ? t('剩余 ') + details.remaining + t(' 次') : details.state === 'revoked' ? t('已撤销') : t('已过期')}</div>
    <p class="muted">${escape(details.sku)} ${t("· 有效期至")} ${date(details.expires)}</p>` +
    (details.state === 'active' && details.remaining ? form('/redeem', hidden('code', code) + hidden('requestId', requestId) +
      textarea('reference', t('服务需求'), '', `maxlength="240" placeholder="${t("简要说明你的需求")}"`) + submit(t('提交兑换'))) : '') +
    (details.tasks.length ? `<h3>${t("最近兑换")}</h3>${details.tasks.map(task => `<div class="list-row"><div><strong>${t(taskStates[task.status])}</strong><p>${escape(task.reference || task.id)} · ${date(task.created)}</p>${task.result ? `<p class="long-text"><strong>${t("服务结果")}</strong><br>${escape(task.result)}</p>` : ''}</div>
    ${task.status === 'pending' ? form('/redeem/cancel', hidden('code', code) + hidden('requestId', task.id) + submit(t('取消'), true), 'inline') : ''}</div>`).join('')}` : '')) :
    panel(t('兑换说明'), `<ol class="steps"><li>${t("从订单详情复制你的自营卡密。")}</li><li>${t("查询可用次数及卡密有效期。")}</li><li>${t("提交服务需求，并在此页查看处理结果。")}</li></ol><p class="muted">${t("失败或取消的任务会退回额度。第三方授权码请使用订单中附带的入口。")}</p>`)}</div>`
}

export function contentPage(kind, posts, current) {
  const title = kind === 'blog' ? t('使用指南') : t('店铺公告')
  const kicker = kind === 'blog' ? 'GUIDES' : 'ANNOUNCEMENTS'
  if (current) return header(kicker, escape(t(current.title)), date(current.updated)) + panel(t('正文'), `<p class="long-text">${escape(t(current.body))}</p>${link('/' + kind, t('返回') + title, 'button secondary')}`)
  return header(kicker, title) + (posts.length ? `<div class="content-list">${posts.map(post =>
    `<a class="panel content-item" href="/${kind}/${post.slug}"><p class="muted">${date(post.updated)}</p><h2>${escape(t(post.title))}</h2><p>${escape(t(post.body).slice(0, 105))}${t(post.body).length > 105 ? '…' : ''}</p></a>`).join('')}</div>` :
    empty(t('暂无内容'), t('后续更新会发布在这里。')))
}
export const about = () => header('ABOUT PRISM', t('关于棱镜 AI'), t('为个人和小团队提供可按次使用的 AI 服务。')) +
  `<div class="verify-layout">${panel(t('购买与交付'), `<p>${t("浏览商品并选择规格。交易确认后，可在订单详情领取卡密及对应的使用入口。")}</p>` + link('/products', t('浏览商品'), 'button secondary'))}
  ${panel(t('订单与服务'), `<p>${t("游客可凭订单号、邮箱和查询密码找回订单。自营卡密可以在验证页查余额及兑换进度。")}</p>` + link('/guest/orders', t('查订单'), 'button secondary'))}</div>`
export const errorPage = (status, message) => header('PRISM AI', status === 404 ? t('页面不存在') : t('当前操作未完成')) + empty(escape(t(message)), '', link('/', t('返回首页'), 'button secondary'))

export function customerLogin(register, error = '', email = '') {
  const action = register ? '/auth/register' : '/auth/login'
  return header('ACCOUNT', t(register ? '创建账户' : '顾客登录')) + panel(t(register ? '注册' : '登录'),
    (error ? `<p class="message error" role="alert">${escape(t(error))}</p>` : '') +
    form(action, field('email', t('邮箱'), email, 'type="email" maxlength="254" autocomplete="username" required') +
      field('password', t('密码'), '', `type="password" ${register ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"'} maxlength="100" required`) +
      submit(t(register ? '注册' : '登录'))) +
    `<p class="auth-switch">${t(register ? '已有账户？' : '还没有账户？')} ${link(register ? '/auth/login' : '/auth/register', t(register ? '登录' : '创建账户'), 'text-link')}</p>`, 'narrow')
}

export function account(customer, orders, page, more) {
  return header('ACCOUNT', t('我的账户'), escape(customer.email)) +
    form('/auth/logout', submit(t('退出登录'), true), 'inline account-actions') +
    (orders.length ? panel(t('我的订单'), orders.map(order => {
      const url = '/guest/orders/' + order.id
      return `<div class="list-row"><div><code class="breakable">${escape(order.id)}</code>
        <p>${date(order.created)} · ${t(orderStates[order.status])} · ${money(order.total)}</p></div>
        ${link(url, t('订单详情'), 'button secondary compact')}</div>`
    }).join('')) : empty(t('尚无账户订单'), t('登录后下单，订单会显示在这里。'), link('/products', t('浏览商品')))) +
    `<div class="inline account-actions">${page > 1 ? link('/account?page=' + (page - 1), t('上一页'), 'button secondary compact') : ''}
    ${more ? link('/account?page=' + (page + 1), t('下一页'), 'button secondary compact') : ''}</div>`
}

export function adminLogin(error = '') {
  return header('MANAGEMENT', '店铺管理') + panel('管理员登录', (error ? `<p class="message error">${escape(error)}</p>` : '') +
    form('/admin/login', field('password', '管理员口令', '', 'type="password" autocomplete="current-password" required') + submit('登录')), 'narrow')
}

function productForm(product = {}) {
  return form('/admin/product', field('slug', '商品地址名', product.slug, product.slug ? 'readonly required' : 'required pattern="[a-z0-9][a-z0-9-]{0,59}"') +
    field('name', '商品名称', product.name) + field('category', '分类', product.category) + field('description', '摘要', product.description) +
    textarea('detail', '服务说明', product.detail) + choices('art', '商品图案', [[0,'星芒'],[1,'花环'],[2,'棱镜']], product.art ?? 0) +
    choices('active','商品状态',[[1,'上架'],[0,'下架']], product.active ?? 1) + submit('保存商品'))
}
function skuForm(products, spec = {}) {
  return form('/admin/sku', field('id', 'SKU 编号', spec.id, spec.id ? 'readonly required' : 'required pattern="[A-Z0-9][A-Z0-9-]{0,59}"') +
    choices('product', '所属商品', products.map(product => [product.slug, product.name]), spec.product) +
    field('name', '规格名称', spec.name) + field('price', '价格（人民币分）', spec.price, 'type="number" min="1" required') +
    field('uses', '自营卡次数', spec.uses ?? 1, 'type="number" min="1" required') +
    field('days', '自营卡有效天数', spec.days ?? 90, 'type="number" min="1" required') +
    choices('mode', '发卡方式', [['generate','生成自营卡'],['inventory','分配库存授权码']], spec.mode ?? 'generate') +
    field('portal','授权码官方兑换地址', spec.mode === 'inventory' ? spec.portal : '', 'type="url" maxlength="500"') +
    choices('active','规格状态',[[1,'可购买'],[0,'不可购买']],spec.active ?? 1) + submit('保存规格'))
}
function postForm(post = {}) {
  return form('/admin/post', field('slug','文章地址名',post.slug,post.slug ? 'readonly required' : 'required pattern="[a-z0-9][a-z0-9-]{0,59}"') +
    choices('kind','内容分类',[['blog','使用指南'],['notice','公告']],post.kind ?? 'blog') + field('title','标题',post.title) +
    textarea('body','正文',post.body) + submit('保存内容'))
}

const disclosure = (title, body) => `<details><summary>${escape(title)}</summary>${body}</details>`
export function adminPage({ products, orders, tasks, posts, codes, message, orderPage, taskPage, moreOrders, moreTasks }) {
  const specs = products.flatMap(product => product.skus)
  const stock = specs.filter(spec => spec.mode === 'inventory')
  const generated = specs.filter(spec => spec.mode === 'generate')
  const adminUrl = (orders, tasks) => '/admin?orders=' + orders + '&tasks=' + tasks
  const paging = (previous, next) => `<div class="inline">${previous ? link(previous, '上一页', 'button secondary compact') : ''}
    ${next ? link(next, '下一页', 'button secondary compact') : ''}</div>`
  return header('MANAGEMENT', '店铺管理') + form('/admin/logout', submit('退出管理', true), 'inline') +
    (message ? `<p class="message" role="status">${escape(message)}</p>` : '') +
    (codes?.length ? panel('本次生成的卡密', `<pre class="breakable">${escape(codes.join('\n'))}</pre><button class="button secondary" type="button" data-copy="${escape(codes.join('\n'))}">复制全部</button>`) : '') +
    `<div class="admin-grid">
    ${panel('商品与规格', disclosure('新增商品', productForm()) + (products.length ? disclosure('新增规格', skuForm(products)) : '') +
    products.map(product => disclosure(product.name, productForm(product)) + product.skus.map(spec => disclosure(spec.id + ' · ' + spec.name +
      (spec.mode === 'inventory' ? ' · 库存 ' + spec.stock : ''), skuForm(products, spec))).join('')).join(''))}
    ${panel('卡密与库存', (generated.length ? disclosure('批量生成自营卡', form('/admin/generate',
      choices('sku','自营 SKU',generated.map(spec => [spec.id, spec.id + ' · ' + spec.name])) +
      field('count','生成数量',1,'type="number" min="1" max="100" required') + submit('生成卡密'))) : '') +
      (stock.length ? disclosure('导入库存授权码', form('/admin/inventory', choices('sku','库存 SKU',stock.map(spec => [spec.id,spec.id])) +
      textarea('codes','授权码（每行一条）') + submit('导入'))) : '') +
      disclosure('撤销自营卡密', form('/admin/revoke', field('code','待撤销卡密') + submit('撤销卡密',true))))}
    ${panel('最近订单', orders.length ? orders.map(order => `<div class="list-row"><div><code class="breakable">${escape(order.id)}</code><p>${escape(order.email)} · ${money(order.total)} · ${orderStates[order.status]}</p></div>
    ${order.status === 'paid' ? form('/admin/retry', hidden('orderId', order.id) + submit('重试发货', true), 'inline') : ''}</div>`).join('') : '<p>当前页暂无订单。</p>') +
    paging(orderPage > 1 ? adminUrl(orderPage - 1, taskPage) : '', moreOrders ? adminUrl(orderPage + 1, taskPage) : '')}
    ${panel('最近兑换', tasks.length ? tasks.map(task => `<div class="order-item"><strong>${escape(task.name)} · ${taskStates[task.status]}</strong><p class="breakable">${escape(task.id)}<br>${escape(task.reference)}</p>
      ${task.status === 'pending' ? form('/admin/claim', hidden('requestId', task.id) + submit('开始处理', true)) : ''}
      ${task.status === 'processing' ? form('/admin/resolve', hidden('requestId', task.id) + choices('status','处理结果',[['success','已完成服务'],['failed','未完成并退回']]) +
        textarea('result','给持卡用户的结果或说明','','maxlength="4000"') + submit('更新任务',true)) : ''}</div>`).join('') : '<p>当前页暂无兑换任务。</p>') +
      paging(taskPage > 1 ? adminUrl(orderPage, taskPage - 1) : '', moreTasks ? adminUrl(orderPage, taskPage + 1) : '')}
    ${panel('博客与公告', disclosure('新增内容', postForm()) + posts.map(post => disclosure(post.title, postForm(post))).join(''))}</div>`
}
