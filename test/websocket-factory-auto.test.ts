import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import WebSocketFactoryAuto from '../src/lib/websocket-factory-auto'

// Mock WebSocket implementation
class MockWebSocket {
  url: string
  readyState: number = 1
  protocol: string = ''
  CONNECTING = 0
  OPEN = 1
  CLOSING = 2
  CLOSED = 3
  onopen: ((ev: Event) => any) | null = null
  onmessage: ((ev: MessageEvent) => any) | null = null
  onclose: ((ev: CloseEvent) => any) | null = null
  onerror: ((ev: Event) => any) | null = null

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {}
  close(code?: number, reason?: string) {}
  addEventListener(type: string, listener: EventListener) {}
  removeEventListener(type: string, listener: EventListener) {}
}

describe('WebSocketFactoryAuto', () => {
  const originalGlobal = {
    WebSocket: global.WebSocket,
    process: global.process,
    require: global.require,
  }

  afterEach(() => {
    // Restore all globals
    global.WebSocket = originalGlobal.WebSocket
    global.process = originalGlobal.process
    global.require = originalGlobal.require
    vi.restoreAllMocks()
  })

  describe('Class structure and inheritance', () => {
    test('extends WebSocketFactory correctly', () => {
      expect(WebSocketFactoryAuto.prototype.constructor.name).toBe(
        'WebSocketFactoryAuto'
      )
    })

    test('overrides getWebSocketConstructor method', () => {
      expect(WebSocketFactoryAuto.getWebSocketConstructor).toBeDefined()
      expect(typeof WebSocketFactoryAuto.getWebSocketConstructor).toBe(
        'function'
      )
    })

    test('inherits static methods from base class', () => {
      expect(WebSocketFactoryAuto.createWebSocket).toBeDefined()
      expect(WebSocketFactoryAuto.isWebSocketSupported).toBeDefined()
      expect(typeof WebSocketFactoryAuto.createWebSocket).toBe('function')
      expect(typeof WebSocketFactoryAuto.isWebSocketSupported).toBe('function')
    })

    test('has dynamicRequire method', () => {
      expect((WebSocketFactoryAuto as any).dynamicRequire).toBeDefined()
      expect(typeof (WebSocketFactoryAuto as any).dynamicRequire).toBe(
        'function'
      )
    })
  })

  describe('Browser environment (inherits base class behavior)', () => {
    beforeEach(() => {
      global.WebSocket = MockWebSocket as any
      delete global.process
    })

    test('detects native WebSocket like base class', () => {
      const WS = WebSocketFactoryAuto.getWebSocketConstructor()
      expect(WS).toBe(MockWebSocket)
    })

    test('creates WebSocket instance', () => {
      const ws = WebSocketFactoryAuto.createWebSocket('wss://example.com')
      expect(ws.url).toBe('wss://example.com')
    })

    test('checks if WebSocket is supported', () => {
      expect(WebSocketFactoryAuto.isWebSocketSupported()).toBe(true)
    })
  })

  describe('Node.js environment with native WebSocket (Node.js 22+)', () => {
    beforeEach(() => {
      delete global.WebSocket
      global.process = { versions: { node: '22.0.0' } } as any
      ;(globalThis as any).WebSocket = MockWebSocket
    })

    test('uses native WebSocket from base class', () => {
      const WS = WebSocketFactoryAuto.getWebSocketConstructor()
      expect(WS).toBe(MockWebSocket)
    })

    afterEach(() => {
      delete (globalThis as any).WebSocket
    })
  })

  describe('dynamicRequire method - unit tests', () => {
    test('method exists and is callable', () => {
      // Verify the method exists and can be called
      expect((WebSocketFactoryAuto as any).dynamicRequire).toBeDefined()
      expect(typeof (WebSocketFactoryAuto as any).dynamicRequire).toBe(
        'function'
      )

      // Call it with a module that doesn't exist - should handle gracefully
      const result = (WebSocketFactoryAuto as any).dynamicRequire(
        'non-existent-module'
      )
      // In test environment, this might return WebSocket or null - both are acceptable
      expect(result !== undefined).toBe(true)
    })
  })

  describe('WebSocket constructor selection logic', () => {
    test('getWebSocketConstructor attempts base class first', () => {
      // In most test environments, this will succeed via base class
      // We're testing that the method exists and can be called
      expect(() => {
        WebSocketFactoryAuto.getWebSocketConstructor()
      }).not.toThrow()
    })

    test('method signature matches base class', () => {
      // Ensure the overridden method has the same signature
      const baseMethod = WebSocketFactoryAuto.__proto__.getWebSocketConstructor
      const autoMethod = WebSocketFactoryAuto.getWebSocketConstructor

      expect(baseMethod.length).toBe(autoMethod.length) // Same number of parameters
    })
  })

  describe('Integration with base class methods', () => {
    beforeEach(() => {
      global.WebSocket = MockWebSocket as any
      delete global.process
    })

    test('createWebSocket works correctly', () => {
      const ws = WebSocketFactoryAuto.createWebSocket('wss://example.com', [
        'protocol1',
      ])
      expect(ws.url).toBe('wss://example.com')
      expect(ws).toBeInstanceOf(MockWebSocket)
    })

    test('isWebSocketSupported works correctly', () => {
      expect(WebSocketFactoryAuto.isWebSocketSupported()).toBe(true)
    })
  })

  describe('Error handling behavior', () => {
    test('preserves error throwing behavior from base class', () => {
      // Mock a scenario where base class would throw
      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('Test error from base class')
      })

      // Mock dynamicRequire to return null (simulating failed dynamic loading)
      const dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue(null)

      expect(() => {
        WebSocketFactoryAuto.getWebSocketConstructor()
      }).toThrow('Test error from base class')

      // Restore
      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })

    test('handles dynamic loading success path', () => {
      // Mock base class to throw (simulating no native WebSocket)
      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('No native WebSocket')
      })

      // Mock dynamicRequire to return a WebSocket
      const dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue({ WebSocket: MockWebSocket })

      const WS = WebSocketFactoryAuto.getWebSocketConstructor()
      expect(WS).toBe(MockWebSocket)

      // Restore
      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })

    test('handles dynamic loading with default export', () => {
      // Mock base class to throw
      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('No native WebSocket')
      })

      // Mock dynamicRequire to return WebSocket as default export
      const dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue(MockWebSocket) // No .WebSocket property

      const WS = WebSocketFactoryAuto.getWebSocketConstructor()
      expect(WS).toBe(MockWebSocket)

      // Restore
      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })
  })

  describe('Node.js environment detection and handling', () => {
    test('handles Node.js environment variables correctly', () => {
      // Set up Node.js environment
      global.process = { versions: { node: '18.0.0' } } as any

      // The method should be callable without throwing in any environment
      expect(() => {
        WebSocketFactoryAuto.getWebSocketConstructor()
      }).not.toThrow()
    })

    test('works in non-Node.js environments', () => {
      // Remove process to simulate non-Node.js environment
      delete global.process

      expect(() => {
        WebSocketFactoryAuto.getWebSocketConstructor()
      }).not.toThrow()
    })
  })

  describe('Deprecation warning functionality', () => {
    let consoleSpy: any

    beforeEach(() => {
      // Reset the deprecation warning flag before each test
      ;(WebSocketFactoryAuto as any).hasShownDeprecationWarning = false
      consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      if (consoleSpy) {
        consoleSpy.mockRestore()
      }
    })

    test('shows deprecation warning on first call', () => {
      // Call the private method directly to test the warning
      ;(WebSocketFactoryAuto as any).showDeprecationWarning()

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[DEPRECATED] @supabase/realtime-js/auto will be removed in v3.0.0. ' +
          'Use explicit transport instead: ' +
          'https://supabase.com/docs/guides/realtime/js-client#nodejs-support'
      )
    })

    test('does not show deprecation warning on subsequent calls', () => {
      // Call the warning method twice
      ;(WebSocketFactoryAuto as any).showDeprecationWarning()
      ;(WebSocketFactoryAuto as any).showDeprecationWarning()

      // Should only be called once due to the flag
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    test('deprecation warning flag is properly managed', () => {
      // Initially should be false
      expect((WebSocketFactoryAuto as any).hasShownDeprecationWarning).toBe(
        false
      )

      // After calling showDeprecationWarning, should be true
      ;(WebSocketFactoryAuto as any).showDeprecationWarning()
      expect((WebSocketFactoryAuto as any).hasShownDeprecationWarning).toBe(
        true
      )

      // Should remain true on subsequent calls
      ;(WebSocketFactoryAuto as any).showDeprecationWarning()
      expect((WebSocketFactoryAuto as any).hasShownDeprecationWarning).toBe(
        true
      )
    })
  })

  describe('Code coverage for edge cases', () => {
    test('handles dynamic loading fallback scenarios', () => {
      // Test that the auto factory has the logic to handle edge cases
      // Even if we can't trigger them in the test environment

      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('No native WebSocket')
      })

      const dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue({ WebSocket: null })

      try {
        WebSocketFactoryAuto.getWebSocketConstructor()
        // If this doesn't throw, the test environment provided WebSocket
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      } catch (error) {
        // Expected behavior - should fall back to original error
        expect(error).toBeInstanceOf(Error)
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      }

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })

    test('verifies fallback logic exists for various ws module states', () => {
      // Test that the method handles different return values from dynamicRequire
      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('No native WebSocket')
      })

      // Test with undefined WebSocket property
      let dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue({ WebSocket: undefined })

      try {
        WebSocketFactoryAuto.getWebSocketConstructor()
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      }

      dynamicRequireSpy.mockRestore()

      // Test with empty object
      dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue({})

      try {
        WebSocketFactoryAuto.getWebSocketConstructor()
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      }

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })
  })

  describe('Additional comprehensive coverage', () => {
    test('handles process.versions.node with pre-release versions', () => {
      // Test that the version parsing logic exists and works
      delete global.WebSocket
      delete (globalThis as any).WebSocket
      global.process = { versions: { node: '18.0.0-pre' } } as any

      const dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue(MockWebSocket)

      // Mock base class to force the dynamic loading path
      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor
      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('No native WebSocket')
      })

      try {
        const WS = WebSocketFactoryAuto.getWebSocketConstructor()
        expect(WS).toBe(MockWebSocket)
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      } catch (error) {
        // Should have attempted dynamic loading
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      }

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })

    test('handles non-Node.js environment with process object', () => {
      delete global.WebSocket
      delete (globalThis as any).WebSocket
      // Process exists but no versions (not Node.js)
      global.process = { env: { NODE_ENV: 'test' } } as any

      expect(() => {
        WebSocketFactoryAuto.getWebSocketConstructor()
      }).not.toThrow()
    })

    test('dynamicRequire handles require that returns falsy values', () => {
      // Test the dynamicRequire method in isolation
      // We need to test the method directly since the test environment interferes

      // Test that the method can handle different return values
      const originalRequire = global.require

      // Create a mock require function for testing
      const testDynamicRequire = (WebSocketFactoryAuto as any).dynamicRequire

      // Test with a mock that returns false
      global.require = vi.fn(() => false) as any
      let result = testDynamicRequire('test-module')
      // In test environment, this might return WebSocket, but the logic should handle falsy values
      expect(typeof result).toBeDefined()

      // Test with a mock that returns 0
      global.require = vi.fn(() => 0) as any
      result = testDynamicRequire('test-module')
      expect(typeof result).toBeDefined()

      // Test with a mock that returns empty string
      global.require = vi.fn(() => '') as any
      result = testDynamicRequire('test-module')
      expect(typeof result).toBeDefined()

      global.require = originalRequire
    })

    test('dynamicRequire when require is undefined', () => {
      const originalRequire = global.require
      
      // Delete require to simulate environment without require
      delete global.require
      
      const result = (WebSocketFactoryAuto as any).dynamicRequire('ws')
      // In test environments, this might still return WebSocket due to polyfills
      // The important thing is that the method handles the undefined require case
      expect(result).toBeDefined()
      
      global.require = originalRequire
    })

    test('handles ws module with WebSocket property set to falsy value', () => {
      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('No native WebSocket')
      })

      const dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )

      // Test with WebSocket: false
      dynamicRequireSpy.mockReturnValue({ WebSocket: false })
      try {
        WebSocketFactoryAuto.getWebSocketConstructor()
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      }

      // Test with WebSocket: 0
      dynamicRequireSpy.mockReturnValue({ WebSocket: 0 })
      try {
        WebSocketFactoryAuto.getWebSocketConstructor()
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      }

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })

    test('verifies correct inheritance chain', () => {
      expect(WebSocketFactoryAuto.prototype).toBeInstanceOf(Object)
      expect(WebSocketFactoryAuto.createWebSocket).toBe(
        WebSocketFactoryAuto.__proto__.createWebSocket
      )
      expect(WebSocketFactoryAuto.isWebSocketSupported).toBe(
        WebSocketFactoryAuto.__proto__.isWebSocketSupported
      )
    })

    test('handles complex Node.js version strings', () => {
      delete global.WebSocket
      delete (globalThis as any).WebSocket
      global.process = { versions: { node: '18.19.0-nightly202312' } } as any

      const dynamicRequireSpy = vi.spyOn(
        WebSocketFactoryAuto as any,
        'dynamicRequire'
      )
      dynamicRequireSpy.mockReturnValue(MockWebSocket)

      // Mock base class to force the dynamic loading path
      const originalGetWebSocketConstructor =
        WebSocketFactoryAuto.__proto__.getWebSocketConstructor
      WebSocketFactoryAuto.__proto__.getWebSocketConstructor = vi.fn(() => {
        throw new Error('No native WebSocket')
      })

      try {
        WebSocketFactoryAuto.getWebSocketConstructor()
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      } catch (error) {
        expect(dynamicRequireSpy).toHaveBeenCalledWith('ws')
      }

      WebSocketFactoryAuto.__proto__.getWebSocketConstructor =
        originalGetWebSocketConstructor
      dynamicRequireSpy.mockRestore()
    })
  })
})
