import assert from 'assert'
import sinon from 'sinon'
import { describe, beforeEach, afterEach, test, vi } from 'vitest'

import RealtimeClient from '../src/RealtimeClient'
import RealtimeChannel from '../src/RealtimeChannel'
import { Server, WebSocket } from 'mock-socket'
import { CHANNEL_STATES } from '../src/lib/constants'
import Push from '../src/lib/push'

const defaultTimeout = 1000

let channel: RealtimeChannel
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
  channel = socket.channel('test-channel')
})

afterEach(() => {
  vi.resetAllMocks()
  mockServer.stop()
})

describe('Double cleanup in channel teardown', () => {
  test('should handle pushes that have already been destroyed', () => {
    // Create a push and add it to the buffer
    const push = new Push(channel, 'test', {}, 1000)
    channel.pushBuffer.push(push)
    
    // Destroy the push manually (simulating normal completion)
    push.destroy()
    
    // Now teardown should not cause errors when trying to destroy again
    assert.doesNotThrow(() => {
      channel.teardown()
    }, 'Teardown should not throw when destroying already destroyed pushes')
  })
  
  test('should handle missing bindings gracefully in push cleanup', () => {
    // Create a push with a refEvent
    const push = new Push(channel, 'test', {}, 1000)
    push.refEvent = 'test_ref_event'
    channel.pushBuffer.push(push)
    
    // Clear the bindings to simulate the issue
    channel.bindings = {}
    
    // Teardown should not cause errors
    assert.doesNotThrow(() => {
      channel.teardown()
    }, 'Teardown should not throw when bindings are missing')
  })
  
  test('should handle push buffer cleanup safely', () => {
    // Create multiple pushes, some already destroyed
    const push1 = new Push(channel, 'test1', {}, 1000)
    const push2 = new Push(channel, 'test2', {}, 1000)
    const push3 = new Push(channel, 'test3', {}, 1000)
    
    // Add all to buffer
    channel.pushBuffer.push(push1, push2, push3)
    
    // Destroy some manually
    push1.destroy()
    push3.destroy()
    
    // Teardown should handle mixed state gracefully
    assert.doesNotThrow(() => {
      channel.teardown()
    }, 'Teardown should handle mixed push states gracefully')
    
    // Buffer should be empty after teardown
    assert.equal(channel.pushBuffer.length, 0, 'Push buffer should be cleared after teardown')
  })
  
  test('should handle rejoin timer cleanup safely', () => {
    // Mock the rejoin timer
    const mockTimer = {
      timer: setTimeout(() => {}, 1000)
    }
    
    // @ts-ignore - accessing private property for testing
    channel.rejoinTimer = mockTimer
    
    // Teardown should clear the timer
    assert.doesNotThrow(() => {
      channel.teardown()
    }, 'Teardown should handle rejoin timer cleanup safely')
  })
})