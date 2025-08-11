// TODO(@mandarini): Remove this file in v3.0.0 - also update package.json exports

import { WebSocketFactory } from './websocket-factory'

/**
 * WebSocketFactoryAuto extends WebSocketFactory with automatic WebSocket detection.
 *
 * @deprecated This class will be removed in v3.0.0. The main export will require
 * explicit WebSocket transport for Node.js < 22 environments.
 */
export class WebSocketFactoryAuto extends WebSocketFactory {
  // Static flag to track if warning has been shown
  private static hasShownDeprecationWarning = false

  /**
   * Dynamic require for 'ws' package
   * @private
   */
  private static dynamicRequire(moduleId: string): any {
    try {
      if (typeof require !== 'undefined') {
        return require(moduleId)
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Show deprecation warning once per process
   * @private
   */
  private static showDeprecationWarning() {
    if (!this.hasShownDeprecationWarning) {
      this.hasShownDeprecationWarning = true
      console.warn(
        '[DEPRECATED] @supabase/realtime-js/auto will be removed in v3.0.0. ' +
          'Use explicit transport instead: ' +
          'https://supabase.com/docs/guides/realtime/js-client#nodejs-support'
      )
    }
  }

  /**
   * Override getWebSocketConstructor to add dynamic 'ws' loading for Node.js
   */
  public static getWebSocketConstructor(): typeof WebSocket {
    try {
      // First try the base class (handles browser, Node.js 22+, edge cases, etc.)
      return super.getWebSocketConstructor()
    } catch (error) {
      // If base class fails and we're in Node.js, try dynamic 'ws' import
      if (
        typeof process !== 'undefined' &&
        process.versions &&
        process.versions.node
      ) {
        try {
          const ws = this.dynamicRequire('ws')
          if (ws) {
            return ws.WebSocket ?? ws
          }
        } catch {}
      }
      // Re-throw original error if dynamic import fails
      throw error
    }
  }
}

export default WebSocketFactoryAuto
