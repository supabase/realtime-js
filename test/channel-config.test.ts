import { describe, test } from 'vitest'
import assert from 'assert'
import { 
  DEFAULT_CHANNEL_CONFIG, 
  mergeChannelConfig, 
  shouldEnablePresence,
  MAX_PUSH_BUFFER_SIZE
} from '../src/lib/channel-config'

describe('channel-config utilities', () => {
  describe('DEFAULT_CHANNEL_CONFIG', () => {
    test('should have correct default values', () => {
      assert.deepEqual(DEFAULT_CHANNEL_CONFIG, {
        broadcast: { ack: false, self: false },
        presence: { key: '', enabled: false },
        private: false,
      })
    })
  })

  describe('mergeChannelConfig', () => {
    test('should return defaults when no config provided', () => {
      const result = mergeChannelConfig()
      assert.deepEqual(result, DEFAULT_CHANNEL_CONFIG)
    })

    test('should return defaults when empty config provided', () => {
      const result = mergeChannelConfig({})
      assert.deepEqual(result, DEFAULT_CHANNEL_CONFIG)
    })

    test('should merge top-level config properties', () => {
      const userConfig = { private: true }
      const result = mergeChannelConfig(userConfig)
      
      assert.deepEqual(result, {
        broadcast: { ack: false, self: false },
        presence: { key: '', enabled: false },
        private: true,
      })
    })

    test('should merge nested broadcast config', () => {
      const userConfig = { broadcast: { ack: true } }
      const result = mergeChannelConfig(userConfig)
      
      assert.deepEqual(result, {
        broadcast: { ack: true, self: false },
        presence: { key: '', enabled: false },
        private: false,
      })
    })

    test('should merge nested presence config', () => {
      const userConfig = { presence: { key: 'user123', enabled: true } }
      const result = mergeChannelConfig(userConfig)
      
      assert.deepEqual(result, {
        broadcast: { ack: false, self: false },
        presence: { key: 'user123', enabled: true },
        private: false,
      })
    })

    test('should merge complex nested config', () => {
      const userConfig = {
        broadcast: { ack: true, self: true },
        presence: { key: 'session456' },
        private: true,
      }
      const result = mergeChannelConfig(userConfig)
      
      assert.deepEqual(result, {
        broadcast: { ack: true, self: true },
        presence: { key: 'session456', enabled: false },
        private: true,
      })
    })

    test('should not mutate input config', () => {
      const userConfig = { broadcast: { ack: true } }
      const originalConfig = JSON.parse(JSON.stringify(userConfig))
      
      mergeChannelConfig(userConfig)
      
      assert.deepEqual(userConfig, originalConfig)
    })
  })

  describe('shouldEnablePresence', () => {
    test('should return false when no presence bindings exist', () => {
      const bindings = { broadcast: [] }
      assert.equal(shouldEnablePresence(bindings), false)
    })

    test('should return false when presence bindings array is empty', () => {
      const bindings = { presence: [] }
      assert.equal(shouldEnablePresence(bindings), false)
    })

    test('should return true when presence bindings exist', () => {
      const bindings = { 
        presence: [
          { type: 'presence', filter: { event: 'join' }, callback: () => {} }
        ] 
      }
      assert.equal(shouldEnablePresence(bindings), true)
    })

    test('should return true when multiple presence bindings exist', () => {
      const bindings = { 
        presence: [
          { type: 'presence', filter: { event: 'join' }, callback: () => {} },
          { type: 'presence', filter: { event: 'leave' }, callback: () => {} }
        ] 
      }
      assert.equal(shouldEnablePresence(bindings), true)
    })

    test('should handle undefined bindings gracefully', () => {
      const bindings = {}
      assert.equal(shouldEnablePresence(bindings), false)
    })
  })

  describe('MAX_PUSH_BUFFER_SIZE', () => {
    test('should be a reasonable positive number', () => {
      assert.equal(typeof MAX_PUSH_BUFFER_SIZE, 'number')
      assert.ok(MAX_PUSH_BUFFER_SIZE > 0)
      assert.ok(MAX_PUSH_BUFFER_SIZE <= 1000) // Reasonable upper bound
    })
  })
})