import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_BODY_BYTES, refusal } from '../lib/guard.mjs'

const PORT = 4791
const json = { 'content-type': 'application/json' }
const get = headers => refusal({ method: 'GET', headers }, PORT)
const post = headers => refusal({ method: 'POST', headers: { host: `localhost:${PORT}`, ...headers } }, PORT)

test('local hosts with this port are allowed', () => {
  for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`]) assert.equal(get({ host }), null, host)
})

test('other hosts are refused (DNS rebinding)', () => {
  for (const host of [`evil.example:${PORT}`, 'localhost:9999', 'localhost', undefined]) assert.equal(get({ host })?.status, 421, String(host))
})

test('same-origin JSON posts pass, with or without Origin', () => {
  assert.equal(post({ ...json, origin: `http://localhost:${PORT}` }), null)
  assert.equal(post({ 'content-type': 'application/json; charset=utf-8' }), null)
})

test('cross-origin posts are refused', () => {
  assert.equal(post({ ...json, origin: 'http://evil.example' })?.status, 403)
  assert.equal(post({ ...json, origin: `http://127.0.0.1:${PORT}` })?.status, 403) // not the same origin as localhost
  assert.equal(post({ ...json, origin: 'null' })?.status, 403)
})

test('posts must be JSON and not too large', () => {
  assert.equal(post({ 'content-type': 'text/plain' })?.status, 415)
  assert.equal(post({})?.status, 415)
  assert.equal(post({ ...json, 'content-length': String(MAX_BODY_BYTES + 1) })?.status, 413)
})
