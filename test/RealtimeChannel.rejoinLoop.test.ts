import assert from 'assert'
import sinon from 'sinon'
import { describe, beforeEach, afterEach, test, vi } from 'vitest'

import RealtimeClient from '../src/RealtimeClient'
import RealtimeChannel from '../src/RealtimeChannel'
import { CHANNEL_STATES } from '../src/lib/constants'
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
  })
})

afterEach(() => {
  vi.resetAllMocks()
  mockServer.stop()
  clock.restore()
})

describe('Rejoin loop infinite loop bug', () => {
  test('should demonstrate infinite loop in rejoin logic when socket disconnected', async () => {
    // Create channel and set it to errored state to trigger rejoin
    const channel = socket.channel('test-channel')
    
    // Mock socket to always return false for isConnected
    vi.spyOn(socket, 'isConnected').mockReturnValue(false)
    
    // Mock socket connection
    vi.spyOn(socket, 'connect').mockImplementation(() => {})
    
    // Track rejoin attempts
    let rejoinAttempts = 0
    const originalRejoin = channel['_rejoin']
    vi.spyOn(channel as any, '_rejoin').mockImplementation((...args) => {
      rejoinAttempts++
      return originalRejoin.apply(channel, args)
    })
    
    // Set channel to errored state which should trigger rejoin timer
    channel.state = CHANNEL_STATES.errored
    
    // Trigger the rejoin process
    channel['_rejoinUntilConnected']()
    
    // Fast forward time to trigger multiple rejoin attempts
    clock.tick(1000) // First attempt
    clock.tick(2000) // Second attempt  
    clock.tick(5000) // Third attempt
    clock.tick(10000) // Fourth attempt
    clock.tick(10000) // Fifth attempt
    
    // Since socket is never connected, rejoin should NOT be called
    // This is the bug - _rejoin is called even when socket is disconnected
    assert.equal(rejoinAttempts, 0, 'Should not call _rejoin when socket is disconnected')
    
    // But the timer should keep scheduling itself, creating the infinite loop
    assert.ok(channel.rejoinTimer.timer, 'Timer should still be scheduled')
    assert.ok(channel.rejoinTimer.tries > 0, 'Timer should have made attempts')
  })
  
  test('should not schedule rejoin timer when channel is leaving', async () => {
    // Create channel
    const channel = socket.channel('test-channel')
    
    // Mock socket to be disconnected
    vi.spyOn(socket, 'isConnected').mockReturnValue(false)
    
    // Set channel to leaving state
    channel.state = CHANNEL_STATES.leaving
    
    // Track timer scheduling
    const scheduleTimeoutSpy = vi.spyOn(channel.rejoinTimer, 'scheduleTimeout')
    
    // Trigger rejoin - this should not schedule timer when leaving
    channel['_rejoinUntilConnected']()
    
    // With the fix, timer should not be scheduled when leaving
    assert.equal(scheduleTimeoutSpy.mock.calls.length, 0, 'Timer should not be scheduled when leaving')
  })
  
  test('should properly handle rejoin when socket reconnects', async () => {
    // Create channel and set it to errored state
    const channel = socket.channel('test-channel')
    
    // Initially socket is disconnected
    let connected = false
    vi.spyOn(socket, 'isConnected').mockImplementation(() => connected)
    
    // Mock socket connection
    vi.spyOn(socket, 'connect').mockImplementation(() => {})
    
    // Track rejoin attempts
    let rejoinAttempts = 0
    const originalRejoin = channel['_rejoin']
    vi.spyOn(channel as any, '_rejoin').mockImplementation((...args) => {
      rejoinAttempts++
      return originalRejoin.apply(channel, args)
    })
    
    // Set channel to errored state
    channel.state = CHANNEL_STATES.errored
    
    // Trigger rejoin process
    channel['_rejoinUntilConnected']()
    
    // Fast forward time - no rejoin should happen while disconnected
    clock.tick(1000)
    assert.equal(rejoinAttempts, 0, 'No rejoin while disconnected')
    
    // Now connect the socket
    connected = true
    
    // Fast forward time again - now rejoin should happen
    clock.tick(2000)
    assert.ok(rejoinAttempts > 0, 'Rejoin should happen when socket connects')
  })
  
  test('should stop rejoin timer when channel is closed', async () => {
    // Create channel and set it to errored state
    const channel = socket.channel('test-channel')
    
    // Mock socket to be disconnected
    vi.spyOn(socket, 'isConnected').mockReturnValue(false)
    
    // Set channel to errored state to trigger rejoin
    channel.state = CHANNEL_STATES.errored
    
    // Trigger rejoin process
    channel['_rejoinUntilConnected']()
    
    // Verify timer is scheduled
    assert.ok(channel.rejoinTimer.timer, 'Timer should be scheduled')
    
    // Now close the channel and trigger close callback
    channel.state = CHANNEL_STATES.closed
    channel['_trigger']('phx_close', 'leave', channel['_joinRef']())
    
    // Timer should be stopped/reset when channel is closed
    // After the fix, the timer should be cleared
    assert.equal(channel.rejoinTimer.tries, 0, 'Timer tries should be reset')
  })
  
  test('should reset rejoin timer when channel unsubscribes', async () => {
    // Create channel and set it to errored state
    const channel = socket.channel('test-channel')
    
    // Mock socket to be disconnected
    vi.spyOn(socket, 'isConnected').mockReturnValue(false)
    
    // Set channel to errored state to trigger rejoin
    channel.state = CHANNEL_STATES.errored
    
    // Trigger rejoin process
    channel['_rejoinUntilConnected']()
    
    // Verify timer is scheduled
    assert.ok(channel.rejoinTimer.timer, 'Timer should be scheduled')
    
    // Now unsubscribe from the channel
    channel.unsubscribe()
    
    // Timer should be reset when unsubscribing
    assert.equal(channel.rejoinTimer.tries, 0, 'Timer tries should be reset')
  })
})