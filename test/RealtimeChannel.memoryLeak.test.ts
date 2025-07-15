import assert from 'assert'
import sinon from 'sinon'
import { describe, beforeEach, afterEach, test, vi } from 'vitest'

import RealtimeClient from '../src/RealtimeClient'
import RealtimeChannel from '../src/RealtimeChannel'
import { Server, WebSocket } from 'mock-socket'
import { CHANNEL_STATES } from '../src/lib/constants'
import { REALTIME_LISTEN_TYPES } from '../src/RealtimeChannel'

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

describe('Memory leak in presence event handlers', () => {
  test('should demonstrate memory leak when presence callbacks are added to joined channel', async () => {
    // Set channel state to joined to trigger the resubscribe logic
    channel.state = CHANNEL_STATES.joined
    
    // Add initial presence callback
    const callback1 = vi.fn()
    channel.on(REALTIME_LISTEN_TYPES.PRESENCE, { event: 'sync' }, callback1)
    
    // Check initial binding count
    const initialBindingCount = channel.bindings.presence?.length || 0
    assert.equal(initialBindingCount, 1, 'Should have 1 initial binding')
    
    // Mock the unsubscribe to NOT clear bindings (simulating the bug)
    vi.spyOn(channel, 'unsubscribe').mockResolvedValue('ok')
    vi.spyOn(channel, 'subscribe').mockReturnValue(channel)
    
    // Add another presence callback - this should trigger resubscribe
    const callback2 = vi.fn()
    channel.on(REALTIME_LISTEN_TYPES.PRESENCE, { event: 'join' }, callback2)
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // The problem: bindings accumulate because unsubscribe doesn't clear them
    const finalBindingCount = channel.bindings.presence?.length || 0
    assert.equal(finalBindingCount, 2, 'Bindings should accumulate (demonstrating the bug)')
    
    // Add a third callback - this will trigger another resubscribe
    const callback3 = vi.fn()
    channel.on(REALTIME_LISTEN_TYPES.PRESENCE, { event: 'leave' }, callback3)
    
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // More bindings accumulate
    const thirdBindingCount = channel.bindings.presence?.length || 0
    assert.equal(thirdBindingCount, 3, 'More bindings accumulate with each resubscribe')
  })
  
  test('should fix memory leak by only resubscribing when presence is first enabled', async () => {
    // Set channel state to joined to trigger the resubscribe logic
    channel.state = CHANNEL_STATES.joined
    
    // Create a counter to track resubscribe calls
    let resubscribeCount = 0
    
    // Mock unsubscribe and subscribe to track calls
    const originalUnsubscribe = channel.unsubscribe
    const originalSubscribe = channel.subscribe
    
    channel.unsubscribe = vi.fn().mockImplementation(async () => {
      resubscribeCount++
      return 'ok'
    })
    
    channel.subscribe = vi.fn().mockImplementation(() => {
      return channel
    })
    
    // Add first presence callback - this should trigger resubscribe (enabling presence)
    const callback1 = vi.fn()
    
    console.log('Before first callback - presence bindings:', channel.bindings.presence?.length || 0)
    channel.on(REALTIME_LISTEN_TYPES.PRESENCE, { event: 'sync' }, callback1)
    console.log('After first callback - presence bindings:', channel.bindings.presence?.length || 0)
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Should have resubscribed once (enabling presence)
    console.log('Resubscribe count after first callback:', resubscribeCount)
    assert.equal(resubscribeCount, 1, 'Should resubscribe when enabling presence')
    
    // Add second presence callback - this should NOT trigger resubscribe
    const callback2 = vi.fn()
    channel.on(REALTIME_LISTEN_TYPES.PRESENCE, { event: 'join' }, callback2)
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Should not have resubscribed again (presence already enabled)
    console.log('Resubscribe count after second callback:', resubscribeCount)
    assert.equal(resubscribeCount, 1, 'Should not resubscribe when presence already enabled')
    
    // Add third presence callback - this should also NOT trigger resubscribe
    const callback3 = vi.fn()
    channel.on(REALTIME_LISTEN_TYPES.PRESENCE, { event: 'leave' }, callback3)
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Should still not have resubscribed
    console.log('Resubscribe count after third callback:', resubscribeCount)
    assert.equal(resubscribeCount, 1, 'Should not resubscribe for additional presence callbacks')
    
    // Verify all callbacks are properly registered
    assert.equal(channel.bindings.presence?.length, 3, 'All three presence callbacks should be registered')
    
    // Restore original methods
    channel.unsubscribe = originalUnsubscribe
    channel.subscribe = originalSubscribe
  })
})