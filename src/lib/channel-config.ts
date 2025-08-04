import type { RealtimeChannelOptions } from '../RealtimeChannel'

/**
 * Default configuration for RealtimeChannel
 */
export const DEFAULT_CHANNEL_CONFIG = {
  broadcast: { ack: false, self: false },
  presence: { key: '', enabled: false },
  private: false,
} as const

/**
 * Maximum number of pushes to buffer before dropping oldest ones
 */
export const MAX_PUSH_BUFFER_SIZE = 100

/**
 * Merges user-provided channel options with defaults
 * @param userConfig User-provided configuration options
 * @returns Merged configuration with defaults applied
 */
export function mergeChannelConfig(userConfig?: RealtimeChannelOptions['config']) {
  return {
    ...DEFAULT_CHANNEL_CONFIG,
    ...userConfig,
    // Ensure nested objects are properly merged
    broadcast: { ...DEFAULT_CHANNEL_CONFIG.broadcast, ...userConfig?.broadcast },
    presence: { ...DEFAULT_CHANNEL_CONFIG.presence, ...userConfig?.presence },
  }
}

/**
 * Determines if presence should be enabled based on bindings
 * @param bindings Channel bindings object
 * @returns Whether presence should be enabled
 */
export function shouldEnablePresence(bindings: { [key: string]: any[] }): boolean {
  return !!(bindings.presence && bindings.presence.length > 0)
}