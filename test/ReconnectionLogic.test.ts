import assert from 'assert'
import { describe, beforeEach, afterEach, test } from 'vitest'
import RealtimeClient from '../src/RealtimeClient'
import { WebSocket } from 'mock-socket'

const url = 'ws://localhost:4000/socket'

describe('Reconnection Logic Tests', () => {
  let socket: RealtimeClient

  beforeEach(() => {
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      params: { apikey: '123456789' },
    })
  })

  afterEach(() => {
    socket.disconnect()
  })

  describe('Network failure scenarios', () => {
    test('should handle network failure and schedule reconnection', async () => {
      socket.connect()
      
      // Simulate network failure by closing with abnormal code
      const closeEvent = new CloseEvent('close', {
        code: 1006, // Abnormal closure
        reason: 'Network error',
        wasClean: false,
      })
      
      socket.conn?.onclose?.(closeEvent)
      
      // Verify reconnection is scheduled
      assert.ok(socket.reconnectTimer.timer)
    })

    test('should not schedule reconnection on manual disconnect', () => {
      socket.connect()
      socket.disconnect()
      
      // Verify no reconnection is scheduled
      assert.equal(socket.reconnectTimer.timer, undefined)
    })
  })

  describe('Connection state management', () => {
    test('should track connection states correctly', () => {
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isConnecting, false)
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isDisconnecting, false)
      
      socket.connect()
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isConnecting, true)
      
      socket.disconnect()
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isDisconnecting, true)
    })

    test('should handle connection state transitions on WebSocket events', () => {
      socket.connect()
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isConnecting, true)
      
      // Simulate connection open
      const openEvent = new Event('open')
      socket.conn?.onopen?.(openEvent)
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isConnecting, false)
      
      // Simulate connection close
      const closeEvent = new CloseEvent('close', {
        code: 1000,
        reason: 'Normal close',
        wasClean: true,
      })
      socket.conn?.onclose?.(closeEvent)
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isDisconnecting, false)
    })
  })

  describe('Race condition prevention', () => {
    test('should prevent multiple simultaneous connection attempts', () => {
      // Make multiple rapid connection attempts
      socket.connect()
      socket.connect()
      socket.connect()
      
      // Should only have one connection attempt
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isConnecting, true)
      assert.ok(socket.conn)
    })

    test('should prevent connection during disconnection', () => {
      socket.connect()
      socket.disconnect()
      
      // Try to connect while disconnecting
      socket.connect()
      
      // Should not interfere with disconnection
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._isDisconnecting, true)
    })
  })

  describe('Heartbeat timeout handling', () => {
    test('should handle heartbeat timeout with reconnection fallback', async () => {
      socket.connect()
      
      // Simulate heartbeat timeout
      socket.pendingHeartbeatRef = 'test-ref'
      
      // Mock connection to prevent actual WebSocket close
      const mockConn = {
        close: () => {},
        readyState: WebSocket.OPEN,
      }
      socket.conn = mockConn as any
      
      // Trigger heartbeat - should detect timeout
      await socket.sendHeartbeat()
      
      // Should have reset manual disconnect flag
      // @ts-ignore - accessing private property for testing
      assert.equal(socket._wasManualDisconnect, false)
    })
  })

  describe('Reconnection timer logic', () => {
    test('should use delay in reconnection callback', async () => {
      socket.connect()
      
      // Mock isConnected to return false initially
      const originalIsConnected = socket.isConnected
      socket.isConnected = () => false
      
      // Track connect calls
      let connectCalls = 0
      const originalConnect = socket.connect
      socket.connect = () => {
        connectCalls++
        return originalConnect.call(socket)
      }
      
      // Trigger reconnection
      socket.reconnectTimer.callback()
      
      // Should not have called connect immediately
      assert.equal(connectCalls, 0)
      
      // Wait for the delay
      await new Promise(resolve => setTimeout(resolve, 20))
      
      // Should have called connect after delay
      assert.equal(connectCalls, 1)
      
      // Restore original methods
      socket.isConnected = originalIsConnected
      socket.connect = originalConnect
    })
  })
})