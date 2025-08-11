// TODO(@mandarini): Remove this file in v3.0.0 - also update package.json exports
/**
 * @deprecated This auto-detection export will be removed in v3.0.0
 * Use the main export with explicit transport instead:
 *
 * import { RealtimeClient } from "@supabase/realtime-js"
 * import ws from "ws"
 * const client = new RealtimeClient(url, { transport: ws })
 */

export * from './index'

// Override WebSocket factory with auto-detection version
export { default as WebSocketFactory } from './lib/websocket-factory-auto'
