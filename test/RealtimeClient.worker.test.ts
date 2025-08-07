import assert from 'assert'
import path from 'path'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { Server } from 'mock-socket'
import RealtimeClient from '../src/RealtimeClient'
import {
  setupRealtimeTest,
  cleanupRealtimeTest,
  TestSetup,
} from './helpers/setup'
import Worker from 'web-worker'

let testSetup: TestSetup
let mockServer: Server
let client: RealtimeClient

beforeAll(() => {
  window.Worker = Worker
  const projectRef = testSetup?.projectRef || 'test-project'
  const url = `wss://${projectRef}/socket`
  mockServer = new Server(url)
})

afterAll(() => {
  vi.stubGlobal('Worker', Worker)
  mockServer.close()
})

beforeEach(() => {
  testSetup = setupRealtimeTest()
  const workerPath = path.join(__dirname, '/helpers/test_worker.js')
  client = new RealtimeClient('ws://localhost:8080/socket', {
    worker: true,
    workerUrl: workerPath,
    heartbeatIntervalMs: 10,
    params: { apikey: '123456789' },
  })
})

afterEach(() => {
  cleanupRealtimeTest(testSetup)
})

test('sets worker flag', () => {
  assert.ok(client.worker)
})

test('sets worker URL', () => {
  const workerPath = path.join(__dirname, '/helpers/test_worker.js')
  assert.equal(client.workerUrl, workerPath)
})

test('ensures single worker ref is started even with multiple connect calls', () => {
  client._onConnOpen()
  let ref = client.workerRef

  client._onConnOpen()
  assert.ok(ref === client.workerRef)
})

test('throws error when Web Worker is not supported', () => {
  // Temporarily remove Worker from window
  const originalWorker = window.Worker
  // @ts-ignore - Deliberately setting to undefined to test error case
  window.Worker = undefined

  expect(() => {
    new RealtimeClient('ws://localhost:8080/socket', {
      worker: true,
      params: { apikey: '123456789' },
    })
  }).toThrow('Web Worker is not supported')

  // Restore Worker
  window.Worker = originalWorker
})
