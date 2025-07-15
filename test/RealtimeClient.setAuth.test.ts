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

beforeEach(() => {
  projectRef = 'test-project'
  url = `wss://${projectRef}/socket`
  mockServer = new Server(url)
  socket = new RealtimeClient(url, {
    transport: WebSocket,
    timeout: defaultTimeout,
  })
})

afterEach(() => {
  vi.resetAllMocks()
  mockServer.stop()
})

describe('setAuth error handling', () => {
  test('should handle error when accessToken callback throws', async () => {
    // Create a failing accessToken callback
    const failingAccessToken = vi.fn().mockRejectedValue(new Error('Token fetch failed'))
    
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      accessToken: failingAccessToken,
    })
    
    // setAuth should not throw even when accessToken callback fails
    await assert.doesNotReject(async () => {
      await socket.setAuth()
    }, 'setAuth should not throw when accessToken callback fails')
    
    // Should fall back to using accessTokenValue
    assert.equal(socket.accessTokenValue, null, 'Should use null when callback fails')
  })
  
  test('should handle error when accessToken callback throws synchronously', async () => {
    // Create a failing accessToken callback that throws synchronously
    const failingAccessToken = vi.fn().mockImplementation(() => {
      throw new Error('Synchronous token fetch failed')
    })
    
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      accessToken: failingAccessToken,
    })
    
    // setAuth should not throw even when accessToken callback fails synchronously
    await assert.doesNotReject(async () => {
      await socket.setAuth()
    }, 'setAuth should not throw when accessToken callback fails synchronously')
    
    // Should fall back to using accessTokenValue
    assert.equal(socket.accessTokenValue, null, 'Should use null when callback fails')
  })
  
  test('should successfully use accessToken callback when it works', async () => {
    const testToken = 'test-token-123'
    const workingAccessToken = vi.fn().mockResolvedValue(testToken)
    
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      accessToken: workingAccessToken,
    })
    
    await socket.setAuth()
    
    assert.equal(socket.accessTokenValue, testToken, 'Should use token from callback')
    assert.ok(workingAccessToken.mock.calls.length === 1, 'Should call accessToken callback')
  })
  
  test('should handle network errors during token fetch gracefully', async () => {
    // Simulate network timeout
    const networkErrorCallback = vi.fn().mockRejectedValue(new Error('Network timeout'))
    
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      accessToken: networkErrorCallback,
    })
    
    // Should handle network errors gracefully
    await assert.doesNotReject(async () => {
      await socket.setAuth()
    }, 'setAuth should handle network errors gracefully')
  })
  
  test('should use provided token parameter instead of callback', async () => {
    const callbackToken = 'callback-token'
    const providedToken = 'provided-token'
    
    const accessTokenCallback = vi.fn().mockResolvedValue(callbackToken)
    
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      accessToken: accessTokenCallback,
    })
    
    await socket.setAuth(providedToken)
    
    // Should use the provided token, not the callback
    assert.equal(socket.accessTokenValue, providedToken, 'Should use provided token')
    assert.ok(accessTokenCallback.mock.calls.length === 0, 'Should not call accessToken callback when token is provided')
  })
})