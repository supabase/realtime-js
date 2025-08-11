// Re-export everything from the main index
export * from './index'

// Override WebSocket factory with auto-detection version
export { default as WebSocketFactory } from './lib/websocket-factory-auto'
