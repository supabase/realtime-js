import assert from 'assert'
import sinon from 'sinon'
import { describe, beforeEach, afterEach, test, vi } from 'vitest'

import RealtimeClient from '../src/RealtimeClient'
import { Server, WebSocket } from 'mock-socket'

const defaultTimeout = 1000

let socket: RealtimeClient
let mockServer: Server
let projectRef: string
let url: string

beforeEach(() => {
  projectRef = 'test-project'
  url = `wss://${projectRef}/socket`
  mockServer = new Server(url)
})

afterEach(() => {
  vi.resetAllMocks()
  mockServer.stop()
})

describe('Worker memory leak bugs', () => {
  test('should properly terminate worker on disconnect', async () => {
    // Mock window.Worker first
    vi.stubGlobal('window', { Worker: class MockWorker {} })
    
    // Track created and revoked URLs
    const createdUrls: string[] = []
    const revokedUrls: string[] = []
    
    // Mock URL.createObjectURL to track blob URLs
    vi.stubGlobal('URL', {
      createObjectURL: (blob: any) => {
        const url = `blob:${Math.random()}`
        createdUrls.push(url)
        return url
      },
      revokeObjectURL: (url: string) => {
        revokedUrls.push(url)
      }
    })

    // Mock Worker constructor
    const workers: Worker[] = []
    const originalWorker = global.Worker
    vi.stubGlobal('Worker', class MockWorker {
      onmessage: any
      onerror: any
      terminated = false
      
      constructor(url: string) {
        workers.push(this as any)
        return this
      }
      
      postMessage(data: any) {
        // Simulate worker message
      }
      
      terminate() {
        this.terminated = true
      }
    })

    // Create socket with worker enabled
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      worker: true,
    })

    // Connect to create worker
    socket.connect()
    
    // Simulate connection opened
    socket['_onConnOpen']()
    
    // Wait for worker to be created
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Verify worker was created
    assert.ok(socket.workerRef, 'Worker should be created')
    assert.ok(workers.length > 0, 'Worker should be instantiated')
    assert.ok(createdUrls.length > 0, 'Blob URL should be created')
    
    // Disconnect
    socket.disconnect()
    
    // After fix: worker should be terminated on disconnect
    assert.ok(workers[0].terminated, 'Worker should be terminated on disconnect')
    
    // After fix: blob URL should be revoked
    assert.ok(revokedUrls.length > 0, 'Blob URL should be revoked')
    
    // After fix: worker reference should be cleared
    assert.equal(socket.workerRef, undefined, 'Worker reference should be cleared')
    
    // Restore global Worker
    vi.unstubAllGlobals()
  })
  
  test('should properly clean up workers across multiple connect/disconnect cycles', async () => {
    // Mock window.Worker first
    vi.stubGlobal('window', { Worker: class MockWorker {} })
    
    // Track created workers and blob URLs
    const workers: any[] = []
    const createdUrls: string[] = []
    
    vi.stubGlobal('URL', {
      createObjectURL: (blob: any) => {
        const url = `blob:${Math.random()}`
        createdUrls.push(url)
        return url
      },
      revokeObjectURL: (url: string) => {}
    })

    vi.stubGlobal('Worker', class MockWorker {
      onmessage: any
      onerror: any
      terminated = false
      
      constructor(url: string) {
        workers.push(this)
        return this
      }
      
      postMessage(data: any) {}
      
      terminate() {
        this.terminated = true
      }
    })

    // Create socket with worker enabled
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      worker: true,
    })

    // Multiple connect/disconnect cycles
    for (let i = 0; i < 3; i++) {
      socket.connect()
      socket['_onConnOpen']()
      await new Promise(resolve => setTimeout(resolve, 10))
      socket.disconnect()
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    // After fix: Since workerRef is properly cleared on disconnect, multiple workers are created
    // and each is properly terminated, preventing memory leaks
    assert.ok(workers.length === 3, 'Multiple workers created due to proper cleanup')
    
    // Count terminated workers
    const terminatedCount = workers.filter(w => w.terminated).length
    assert.ok(terminatedCount === 3, 'All workers terminated (memory leak fixed)')
    
    // After fix: blob URLs created and revoked
    assert.ok(createdUrls.length === 3, 'Blob URLs created and properly cleaned up')
    
    vi.unstubAllGlobals()
  })
  
  test('should properly clean up worker reference when connection fails', async () => {
    // Mock window.Worker first
    vi.stubGlobal('window', { Worker: class MockWorker {} })
    
    // Mock URL API
    vi.stubGlobal('URL', {
      createObjectURL: (blob: any) => `blob:${Math.random()}`,
      revokeObjectURL: (url: string) => {}
    })
    
    // Mock Worker to throw error
    const workers: any[] = []
    vi.stubGlobal('Worker', class MockWorker {
      onmessage: any
      onerror: any
      terminated = false
      
      constructor(url: string) {
        workers.push(this)
        // Simulate worker error
        setTimeout(() => {
          if (this.onerror) {
            this.onerror({ message: 'Worker failed' })
          }
        }, 5)
        return this
      }
      
      postMessage(data: any) {}
      
      terminate() {
        this.terminated = true
      }
    })

    // Create socket with worker enabled
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      worker: true,
    })

    // Connect and trigger worker error
    socket.connect()
    socket['_onConnOpen']()
    
    // Wait for worker error
    await new Promise(resolve => setTimeout(resolve, 20))
    
    // Verify worker was created and terminated due to error
    assert.ok(workers.length > 0, 'Worker should be created')
    assert.ok(workers[0].terminated, 'Worker should be terminated on error')
    
    // After fix: worker reference is cleared after termination
    assert.equal(socket.workerRef, undefined, 'Worker reference cleared after termination')
    
    vi.unstubAllGlobals()
  })
  
  test('should properly clean up worker resources', async () => {
    // This test will verify the fix works correctly
    // (will be updated after implementing the fix)
    
    // Mock window.Worker first
    vi.stubGlobal('window', { Worker: class MockWorker {} })
    
    // Track created workers and blob URLs
    const workers: any[] = []
    const createdUrls: string[] = []
    const revokedUrls: string[] = []
    
    vi.stubGlobal('URL', {
      createObjectURL: (blob: any) => {
        const url = `blob:${Math.random()}`
        createdUrls.push(url)
        return url
      },
      revokeObjectURL: (url: string) => {
        revokedUrls.push(url)
      }
    })

    vi.stubGlobal('Worker', class MockWorker {
      onmessage: any
      onerror: any
      terminated = false
      
      constructor(url: string) {
        workers.push(this)
        return this
      }
      
      postMessage(data: any) {}
      
      terminate() {
        this.terminated = true
      }
    })

    // Create socket with worker enabled
    socket = new RealtimeClient(url, {
      transport: WebSocket,
      timeout: defaultTimeout,
      worker: true,
    })

    // Connect and disconnect
    socket.connect()
    socket['_onConnOpen']()
    await new Promise(resolve => setTimeout(resolve, 10))
    socket.disconnect()
    
    // After fix: worker should be properly cleaned up
    assert.ok(workers[0].terminated, 'Worker should be terminated on disconnect')
    assert.ok(revokedUrls.length > 0, 'Blob URL should be revoked')
    assert.equal(socket.workerRef, undefined, 'Worker reference should be cleared')
    
    vi.unstubAllGlobals()
  })
})