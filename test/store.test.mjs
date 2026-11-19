import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openStore } from '../src/store.mjs'

const key = 'test-encryption-key-'.repeat(3)
const buyer = ['buyer@example.com', 'order passphrase']

test('competing stock orders wait for restock, and persisted delivery stays stable on retries', t => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-shop-'))
  const database = join(directory, 'shop.sqlite')
  let store = openStore(database, key)
  t.after(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  store.seed()
  store.saveSku({ id: 'STOCK-1', product: 'ai-workspace', name: '库存授权', price: 1500, uses: 1, days: 30,
    mode: 'inventory', portal: 'https://example.com/redeem', active: '1' })
  assert.equal(store.importStock('STOCK-1', 'supplier-code-a\nsupplier-code-a'), 1)
  const first = store.order({ 'STOCK-1': 1 }, ...buyer)
  const second = store.order({ 'STOCK-1': 1, 'WORKSPACE-1': 1 }, ...buyer)
  const receipt = (eventId, orderId, amount) => ({ eventId, orderId, amount, currency: 'CNY' })
  assert.equal(store.pay(receipt('p1', first, 1500)).status, 'fulfilled')
  assert.equal(store.pay(receipt('p2', second, 2700)).status, 'paid')
  assert.ok(store.delivery(second).lines.every(line => !line.codes.length))
  assert.equal(store.importStock('STOCK-1', 'supplier-code-b'), 1)
  assert.equal(store.retry(second).status, 'fulfilled')
  assert.equal(store.delivery(first).lines[0].codes[0], 'supplier-code-a')
  assert.equal(store.delivery(second).lines[0].codes[0], 'supplier-code-b')
  const delivered = store.delivery(second)
  store.close()
  store = openStore(database, key)
  assert.equal(store.pay(receipt('p2', second, 2700)).status, 'fulfilled')
  assert.throws(() => store.pay(receipt('p1', second, 2700)), { status: 409 })
  assert.deepEqual(store.delivery(second), delivered)
})

test('an administrator claims a redemption before fulfilment to prevent a cancellation race', t => {
  const store = openStore(':memory:', key)
  t.after(() => store.close())
  store.seed()
  const [code] = store.generate('WORKSPACE-3', 1)
  const id = 'processing-redemption'
  store.redeem(code, id, '整理文档')
  store.claim(id)
  assert.equal(store.cardDetails(code).tasks[0].status, 'processing')
  assert.throws(() => store.resolve(id, 'cancelled', code), { status: 409 })
  store.resolve(id, 'failed')
  store.resolve(id, 'failed')
  assert.equal(store.cardDetails(code).remaining, 3)
  store.revoke(code)
  assert.equal(store.cardDetails(code).state, 'revoked')
  assert.throws(() => store.redeem(code, 'after-revocation', ''), { status: 409 })
})

test('the task queue prioritizes active redemptions and delivers the result only to the card holder', t => {
  const store = openStore(':memory:', key)
  t.after(() => store.close())
  store.seed()
  const [older, recent] = store.generate('WORKSPACE-3', 2)
  const olderId = 'older-pending-task'
  const recentId = 'recent-finished-task'
  store.redeem(older, olderId, '')
  store.redeem(recent, recentId, '')
  store.claim(recentId)
  store.resolve(recentId, 'success', undefined, '服务结果')
  assert.equal(store.tasks(1, 0)[0].id, olderId)
  assert.equal(store.tasks(1, 1)[0].id, recentId)
  assert.equal(store.cardDetails(recent).tasks[0].result, '服务结果')
  assert.notEqual(store.cardDetails(older).tasks[0].result, '服务结果')
})
