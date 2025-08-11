import { WebSocketFactory } from './websocket-factory'

export class WebSocketFactoryAuto extends WebSocketFactory {
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
