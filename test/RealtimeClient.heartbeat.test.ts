import assert from 'assert'
import sinon from 'sinon'
import { describe, beforeEach, afterEach, test, vi } from 'vitest'

import RealtimeClient from '../src/RealtimeClient'
import { Server, WebSocket } from 'mock-socket'

const defaultTimeout = 1000

let socket: RealtimeClient
let mockServer: Server
let projectRef: string
let url: string
let clock: sinon.SinonFakeTimers

beforeEach(() => {
  clock = sinon.useFakeTimers()
  projectRef = 'test-project'
  url = `wss://${projectRef}/socket`
  mockServer = new Server(url)
  socket = new RealtimeClient(url, {
    transport: WebSocket,
    timeout: defaultTimeout,
    heartbeatIntervalMs: 5000,
  })
})

afterEach(() => {
  vi.resetAllMocks()
  mockServer.stop()
  clock.restore()
})

describe('Heartbeat timeout logic', () => {
  test('should handle heartbeat timeout correctly', async () => {
    // Mock isConnected to return true
    vi.spyOn(socket, 'isConnected').mockReturnValue(true)
    
    // Mock the push method to avoid WebSocket issues
    vi.spyOn(socket, 'push').mockImplementation(() => {})
    
    // Mock connection
    const closeMock = vi.fn()
    socket.conn = {
      close: closeMock,
    } as any
    
    // Track heartbeat callbacks
    const heartbeatStatuses: string[] = []
    socket.onHeartbeat((status) => {
      heartbeatStatuses.push(status)
    })
    
    // Send first heartbeat
    await socket.sendHeartbeat()
    
    // Should have a pending heartbeat ref
    const firstRef = socket.pendingHeartbeatRef
    assert.ok(firstRef, 'Should have pending heartbeat ref')
    assert.equal(heartbeatStatuses[0], 'sent', 'Should call heartbeat callback with sent')
    
    // Send second heartbeat while first is still pending (simulating timeout)
    await socket.sendHeartbeat()
    
    // Verify the close call was made with correct parameters
    assert.equal(closeMock.mock.calls[0][0], 1000, 'Should close with WS_CLOSE_NORMAL')
    assert.equal(closeMock.mock.calls[0][1], 'heartbeat timeout', 'Should close with correct message')
    
    // Should have closed connection due to timeout
    assert.ok(closeMock.mock.calls.length === 1, 'Should close connection on heartbeat timeout')
    assert.equal(heartbeatStatuses[1], 'timeout', 'Should call heartbeat callback with timeout')
    
    // Pending ref should be null after timeout
    assert.equal(socket.pendingHeartbeatRef, null, 'Pending heartbeat ref should be null after timeout')
  })
  
  test('should handle late heartbeat response correctly', async () => {
    // Mock isConnected to return true
    vi.spyOn(socket, 'isConnected').mockReturnValue(true)
    
    // Mock the push method to avoid WebSocket issues
    vi.spyOn(socket, 'push').mockImplementation(() => {})
    
    // Mock connection
    const closeMock = vi.fn()
    socket.conn = {
      close: closeMock,
      onmessage: null,
    } as any
    
    // Track heartbeat callbacks
    const heartbeatStatuses: string[] = []
    socket.onHeartbeat((status) => {
      heartbeatStatuses.push(status)
    })
    
    // Send first heartbeat
    await socket.sendHeartbeat()
    const firstHeartbeatRef = socket.pendingHeartbeatRef
    
    // Trigger timeout by sending another heartbeat
    await socket.sendHeartbeat()
    
    // Connection should be closed
    assert.ok(closeMock.mock.calls.length === 1, 'Should close connection on heartbeat timeout')
    assert.equal(socket.pendingHeartbeatRef, null, 'Pending heartbeat ref should be null after timeout')
    
    // Now simulate a late response for the original heartbeat
    const lateResponse = {
      data: JSON.stringify({
        topic: 'phoenix',
        event: 'phx_reply',
        payload: { status: 'ok' },
        ref: firstHeartbeatRef,
      })
    }
    
    // This should not cause issues even though the ref was cleared
    assert.doesNotThrow(() => {
      socket._onConnMessage(lateResponse)
    }, 'Late heartbeat response should not cause errors')
    
    // Pending ref should still be null (not changed by late response)
    assert.equal(socket.pendingHeartbeatRef, null, 'Late response should not change pending ref')
  })
  
  test('should properly clear pending heartbeat ref on successful response', async () => {
    // Mock isConnected to return true
    vi.spyOn(socket, 'isConnected').mockReturnValue(true)
    
    // Mock the push method to avoid WebSocket issues
    vi.spyOn(socket, 'push').mockImplementation(() => {})
    
    // Mock connection
    const closeMock = vi.fn()
    socket.conn = {
      close: closeMock,
      onmessage: null,
    } as any
    
    // Track heartbeat callbacks
    const heartbeatStatuses: string[] = []
    socket.onHeartbeat((status) => {
      heartbeatStatuses.push(status)
    })
    
    // Send heartbeat
    await socket.sendHeartbeat()
    const heartbeatRef = socket.pendingHeartbeatRef
    
    // Simulate successful response
    const successResponse = {
      data: JSON.stringify({
        topic: 'phoenix',
        event: 'phx_reply',
        payload: { status: 'ok' },
        ref: heartbeatRef,
      })
    }
    
    socket._onConnMessage(successResponse)
    
    // Pending ref should be cleared
    assert.equal(socket.pendingHeartbeatRef, null, 'Pending heartbeat ref should be cleared on successful response')
    assert.equal(heartbeatStatuses[1], 'ok', 'Should call heartbeat callback with ok')
    
    // Connection should not be closed on successful response
    assert.equal(closeMock.mock.calls.length, 0, 'Should not close connection on successful response')
  })
})