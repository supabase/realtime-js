import assert from 'assert'
import { Server as WebSocketServer, WebSocket } from 'mock-socket'
import sinon from 'sinon'
import { w3cwebsocket as W3CWebSocket } from 'websocket'
import { Socket } from '../dist/main'

let socket

describe('constructor', () => {
  before(() => {
    window.XMLHttpRequest = sinon.useFakeXMLHttpRequest()
  })

  after(() => {
    window.XMLHttpRequest = null
  })

  it('sets defaults', () => {
    socket = new Socket('wss://example.com/socket')

    assert.equal(socket.channels.length, 0)
    assert.equal(socket.sendBuffer.length, 0)
    assert.equal(socket.ref, 0)
    assert.equal(socket.endPoint, 'wss://example.com/socket/websocket')
    assert.deepEqual(socket.stateChangeCallbacks, {
      open: [],
      close: [],
      error: [],
      message: [],
    })
    assert.equal(socket.transport, W3CWebSocket)
    assert.equal(socket.timeout, 10000)
    assert.equal(socket.longpollerTimeout, 20000)
    assert.equal(socket.heartbeatIntervalMs, 30000)
    assert.equal(typeof socket.logger, 'function')
    assert.equal(typeof socket.reconnectAfterMs, 'function')
  })

  it('overrides some defaults with options', () => {
    const customTransport = function transport() {}
    const customLogger = function logger() {}
    const customReconnect = function reconnect() {}

    socket = new Socket('wss://example.com/socket', {
      timeout: 40000,
      longpollerTimeout: 50000,
      heartbeatIntervalMs: 60000,
      transport: customTransport,
      logger: customLogger,
      reconnectAfterMs: customReconnect,
      params: { one: 'two' },
    })

    assert.equal(socket.timeout, 40000)
    assert.equal(socket.longpollerTimeout, 50000)
    assert.equal(socket.heartbeatIntervalMs, 60000)
    assert.equal(socket.transport, customTransport)
    assert.equal(socket.logger, customLogger)
    assert.equal(socket.reconnectAfterMs, customReconnect)
    assert.deepEqual(socket.params, { one: 'two' })
  })

  describe('with Websocket', () => {
    let mockServer

    before(() => {
      mockServer = new WebSocketServer('wss://example.com/')
    })

    after((done) => {
      mockServer.stop(() => {
        window.WebSocket = null
        done()
      })
    })

    it('defaults to Websocket transport if available', () => {
      socket = new Socket('wss://example.com/socket')
      assert.equal(socket.transport, W3CWebSocket)
    })
  })
})

describe('endpointURL', () => {
  it('returns endpoint for given full url', () => {
    socket = new Socket('wss://example.org/chat')
    assert.equal(
      socket.endPointURL(),
      'wss://example.org/chat/websocket?vsn=1.0.0'
    )
  })

  it('returns endpoint with parameters', () => {
    socket = new Socket('ws://example.org/chat', { params: { foo: 'bar' } })
    assert.equal(
      socket.endPointURL(),
      'ws://example.org/chat/websocket?foo=bar&vsn=1.0.0'
    )
  })

  it('returns endpoint with apikey', () => {
    socket = new Socket('ws://example.org/chat', {
      params: { apikey: '123456789' },
    })
    assert.equal(
      socket.endPointURL(),
      'ws://example.org/chat/websocket?apikey=123456789&vsn=1.0.0'
    )
  })
})

describe('connect with WebSocket', () => {
  let mockServer

  before(() => {
    mockServer = new WebSocketServer('wss://example.com/')
  })

  after((done) => {
    mockServer.stop(() => {
      window.WebSocket = null
      done()
    })
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
  })

  it('establishes websocket connection with endpoint', () => {
    socket.connect()

    let conn = socket.conn
    assert.ok(conn instanceof W3CWebSocket)
    assert.equal(conn.url, socket.endPointURL())
  })

  it('sets callbacks for connection', () => {
    let opens = 0
    socket.onOpen(() => ++opens)
    let closes = 0
    socket.onClose(() => ++closes)
    let lastError
    socket.onError((error) => (lastError = error))
    let lastMessage
    socket.onMessage((message) => (lastMessage = message.payload))

    socket.connect()

    socket.conn.onopen()
    assert.equal(opens, 1)

    socket.conn.onclose()
    assert.equal(closes, 1)

    socket.conn.onerror('error')
    assert.equal(lastError, 'error')

    const data = {
      topic: 'topic',
      event: 'event',
      payload: 'payload',
      status: 'ok',
    }
    socket.conn.onmessage({ data: JSON.stringify(data) })
    assert.equal(lastMessage, 'payload')
  })

  it('is idempotent', () => {
    socket.connect()

    let conn = socket.conn

    socket.connect()

    assert.deepStrictEqual(conn, socket.conn)
  })
})

describe('disconnect', () => {
  let mockServer

  before(() => {
    mockServer = new WebSocketServer('wss://example.com/')
  })

  after((done) => {
    mockServer.stop(() => {
      window.WebSocket = null
      done()
    })
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
  })

  it('removes existing connection', () => {
    socket.connect()
    socket.disconnect()

    assert.equal(socket.conn, null)
  })

  it('calls callback', () => {
    let count = 0
    socket.connect()
    socket.disconnect(() => count++)

    assert.equal(count, 1)
  })

  it('calls connection close callback', () => {
    socket.connect()
    const spy = sinon.spy(socket.conn, 'close')

    socket.disconnect(null, 'code', 'reason')

    assert(spy.calledWith('code', 'reason'))
  })

  it('does not throw when no connection', () => {
    assert.doesNotThrow(() => {
      socket.disconnect()
    })
  })
})

describe('connectionState', () => {
  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
  })

  it('defaults to closed', () => {
    assert.equal(socket.connectionState(), 'closed')
  })

  // TODO: fix for W3CWebSocket
  it.skip('returns closed if readyState unrecognized', () => {
    socket.connect()

    socket.conn.readyState = 5678
    assert.equal(socket.connectionState(), 'closed')
  })

  // TODO: fix for W3CWebSocket
  it.skip('returns connecting', () => {
    socket.connect()

    socket.conn.readyState = 0
    assert.equal(socket.connectionState(), 'connecting')
    assert.ok(!socket.isConnected(), 'is not connected')
  })

  // TODO: fix for W3CWebSocket
  it.skip('returns open', () => {
    socket.connect()

    socket.conn.readyState = 1
    assert.equal(socket.connectionState(), 'open')
    assert.ok(socket.isConnected(), 'is connected')
  })

  // TODO: fix for W3CWebSocket
  it.skip('returns closing', () => {
    socket.connect()

    socket.conn.readyState = 2
    assert.equal(socket.connectionState(), 'closing')
    assert.ok(!socket.isConnected(), 'is not connected')
  })

  // TODO: fix for W3CWebSocket
  it.skip('returns closed', () => {
    socket.connect()

    socket.conn.readyState = 3
    assert.equal(socket.connectionState(), 'closed')
    assert.ok(!socket.isConnected(), 'is not connected')
  })
})

describe('channel', () => {
  let channel

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
  })

  it('returns channel with given topic and params', () => {
    channel = socket.channel('topic', { one: 'two' })

    assert.deepStrictEqual(channel.socket, socket)
    assert.equal(channel.topic, 'topic')
    assert.deepEqual(channel.params, { one: 'two' })
  })

  it('adds channel to sockets channels list', () => {
    assert.equal(socket.channels.length, 0)

    channel = socket.channel('topic', { one: 'two' })

    assert.equal(socket.channels.length, 1)

    const [foundChannel] = socket.channels
    assert.deepStrictEqual(foundChannel, channel)
  })
})

describe('remove', () => {
  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
  })

  it('removes given channel from channels', () => {
    const channel1 = socket.channel('topic-1')
    const channel2 = socket.channel('topic-2')

    sinon.stub(channel1, 'joinRef').returns(1)
    sinon.stub(channel2, 'joinRef').returns(2)

    socket.remove(channel1)

    assert.equal(socket.channels.length, 1)

    const [foundChannel] = socket.channels
    assert.deepStrictEqual(foundChannel, channel2)
  })
})

describe('push', () => {
  const data = {
    topic: 'topic',
    event: 'event',
    payload: 'payload',
    ref: 'ref',
  }
  const json =
    '{"topic":"topic","event":"event","payload":"payload","ref":"ref"}'

  before(() => {
    window.XMLHttpRequest = sinon.useFakeXMLHttpRequest()
  })

  after(() => {
    window.XMLHttpRequest = null
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
  })

  // TODO: fix for W3CWebSocket
  it.skip('sends data to connection when connected', () => {
    socket.connect()
    socket.conn.readyState = 1 // open

    const spy = sinon.spy(socket.conn, 'send')

    socket.push(data)

    assert.ok(spy.calledWith(json))
  })

  // TODO: fix for W3CWebSocket
  it.skip('buffers data when not connected', () => {
    socket.connect()
    socket.conn.readyState = 0 // connecting

    const spy = sinon.spy(socket.conn, 'send')

    assert.equal(socket.sendBuffer.length, 0)

    socket.push(data)

    assert.ok(spy.neverCalledWith(json))
    assert.equal(socket.sendBuffer.length, 1)

    const [callback] = socket.sendBuffer
    callback()
    assert.ok(spy.calledWith(json))
  })
})

describe('makeRef', () => {
  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
  })

  it('returns next message ref', () => {
    assert.strictEqual(socket.ref, 0)
    assert.strictEqual(socket.makeRef(), '1')
    assert.strictEqual(socket.ref, 1)
    assert.strictEqual(socket.makeRef(), '2')
    assert.strictEqual(socket.ref, 2)
  })

  it('restarts for overflow', () => {
    socket.ref = Number.MAX_SAFE_INTEGER + 1

    assert.strictEqual(socket.makeRef(), '0')
    assert.strictEqual(socket.ref, 0)
  })
})

describe('sendHeartbeat', () => {
  before(() => {
    window.XMLHttpRequest = sinon.useFakeXMLHttpRequest()
  })

  after(() => {
    window.XMLHttpRequest = null
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
    socket.connect()
  })

  // TODO: fix for W3CWebSocket
  it.skip("closes socket when heartbeat is not ack'd within heartbeat window", () => {
    let closed = false
    socket.conn.readyState = 1 // open
    socket.conn.onclose = () => (closed = true)
    socket.sendHeartbeat()
    assert.equal(closed, false)

    socket.sendHeartbeat()
    assert.equal(closed, true)
  })

  // TODO: fix for W3CWebSocket
  it.skip('pushes heartbeat data when connected', () => {
    socket.conn.readyState = 1 // open

    const spy = sinon.spy(socket.conn, 'send')
    const data =
      '{"topic":"phoenix","event":"heartbeat","payload":{},"ref":"1"}'

    socket.sendHeartbeat()
    assert.ok(spy.calledWith(data))
  })

  // TODO: fix for W3CWebSocket
  it.skip('no ops when not connected', () => {
    socket.conn.readyState = 0 // connecting

    const spy = sinon.spy(socket.conn, 'send')
    const data =
      '{"topic":"phoenix","event":"heartbeat","payload":{},"ref":"1"}'

    socket.sendHeartbeat()
    assert.ok(spy.neverCalledWith(data))
  })
})

describe('flushSendBuffer', () => {
  before(() => {
    window.XMLHttpRequest = sinon.useFakeXMLHttpRequest()
  })

  after(() => {
    window.XMLHttpRequest = null
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket')
    socket.connect()
  })

  // TODO: fix for W3CWebSocket
  it.skip('calls callbacks in buffer when connected', () => {
    socket.conn.readyState = 1 // open
    const spy1 = sinon.spy()
    const spy2 = sinon.spy()
    const spy3 = sinon.spy()
    socket.sendBuffer.push(spy1)
    socket.sendBuffer.push(spy2)

    socket.flushSendBuffer()

    assert.ok(spy1.calledOnce)
    assert.ok(spy2.calledOnce)
    assert.equal(spy3.callCount, 0)
  })

  // TODO: fix for W3CWebSocket
  it.skip('empties sendBuffer', () => {
    socket.conn.readyState = 1 // open
    socket.sendBuffer.push(() => {})

    socket.flushSendBuffer()

    assert.deepEqual(socket.sendBuffer.length, 0)
  })
})

describe('onConnOpen', () => {
  let mockServer

  before(() => {
    mockServer = new WebSocketServer('wss://example.com/')
  })

  after((done) => {
    mockServer.stop(() => {
      window.WebSocket = null
      done()
    })
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket', {
      reconnectAfterMs: () => 100000,
    })
    socket.connect()
  })

  // TODO: fix for W3CWebSocket

  it.skip('flushes the send buffer', () => {
    socket.conn.readyState = 1 // open
    const spy = sinon.spy()
    socket.sendBuffer.push(spy)

    socket.onConnOpen()

    assert.ok(spy.calledOnce)
  })

  it('resets reconnectTimer', () => {
    const spy = sinon.spy(socket.reconnectTimer, 'reset')

    socket.onConnOpen()

    assert.ok(spy.calledOnce)
  })

  it('triggers onOpen callback', () => {
    const spy = sinon.spy()

    socket.onOpen(spy)

    socket.onConnOpen()

    assert.ok(spy.calledOnce)
  })
})

describe('onConnClose', () => {
  let mockServer

  before(() => {
    mockServer = new WebSocketServer('wss://example.com/')
  })

  after((done) => {
    mockServer.stop(() => {
      window.WebSocket = null
      done()
    })
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket', {
      reconnectAfterMs: () => 100000,
    })
    socket.connect()
  })

  it('schedules reconnectTimer timeout', () => {
    const spy = sinon.spy(socket.reconnectTimer, 'scheduleTimeout')

    socket.onConnClose()

    assert.ok(spy.calledOnce)
  })

  it('triggers onClose callback', () => {
    const spy = sinon.spy()

    socket.onClose(spy)

    socket.onConnClose('event')

    assert.ok(spy.calledWith('event'))
  })

  it('triggers channel error', () => {
    const channel = socket.channel('topic')
    const spy = sinon.spy(channel, 'trigger')

    socket.onConnClose()

    assert.ok(spy.calledWith('phx_error'))
  })
})

describe('onConnError', () => {
  let mockServer

  before(() => {
    mockServer = new WebSocketServer('wss://example.com/')
  })

  after((done) => {
    mockServer.stop(() => {
      window.WebSocket = null
      done()
    })
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket', {
      reconnectAfterMs: () => 100000,
    })
    socket.connect()
  })

  it('triggers onClose callback', () => {
    const spy = sinon.spy()

    socket.onError(spy)

    socket.onConnError('error')

    assert.ok(spy.calledWith('error'))
  })

  it('triggers channel error', () => {
    const channel = socket.channel('topic')
    const spy = sinon.spy(channel, 'trigger')

    socket.onConnError('error')

    assert.ok(spy.calledWith('phx_error'))
  })
})

describe('onConnMessage', () => {
  let mockServer

  before(() => {
    mockServer = new WebSocketServer('wss://example.com/')
  })

  after((done) => {
    mockServer.stop(() => {
      window.WebSocket = null
      done()
    })
  })

  beforeEach(() => {
    socket = new Socket('wss://example.com/socket', {
      reconnectAfterMs: () => 100000,
    })
    socket.connect()
  })

  it('parses raw message and triggers channel event', () => {
    const message =
      '{"topic":"topic","event":"event","payload":"payload","ref":"ref"}'
    const data = { data: message }

    const targetChannel = socket.channel('topic')
    const otherChannel = socket.channel('off-topic')

    const targetSpy = sinon.spy(targetChannel, 'trigger')
    const otherSpy = sinon.spy(otherChannel, 'trigger')

    socket.onConnMessage(data)

    assert.ok(targetSpy.calledWith('event', 'payload', 'ref'))
    assert.equal(targetSpy.callCount, 1)
    assert.equal(otherSpy.callCount, 0)
  })

  it('triggers onMessage callback', () => {
    const message =
      '{"topic":"topic","event":"event","payload":"payload","ref":"ref"}'
    const data = { data: message }
    const spy = sinon.spy()

    socket.onMessage(spy)

    socket.onConnMessage(data)

    assert.ok(
      spy.calledWith({
        topic: 'topic',
        event: 'event',
        payload: 'payload',
        ref: 'ref',
      })
    )
  })
})

describe('custom encoder and decoder', () => {
  it('encodes to JSON by default', () => {
    socket = new Socket('wss://example.com/socket')
    let payload = { foo: 'bar' }

    socket.encode(payload, (encoded) => {
      assert.deepStrictEqual(encoded, JSON.stringify(payload))
    })
  })

  it('allows custom encoding when using WebSocket transport', () => {
    let encoder = (payload, callback) => callback('encode works')
    socket = new Socket('wss://example.com/socket', {
      transport: WebSocket,
      encode: encoder,
    })

    socket.encode({ foo: 'bar' }, (encoded) => {
      assert.deepStrictEqual(encoded, 'encode works')
    })
  })

  it('decodes JSON by default', () => {
    socket = new Socket('wss://example.com/socket')
    let payload = JSON.stringify({ foo: 'bar' })

    socket.decode(payload, (decoded) => {
      assert.deepStrictEqual(decoded, { foo: 'bar' })
    })
  })

  it('allows custom decoding when using WebSocket transport', () => {
    let decoder = (payload, callback) => callback('decode works')
    socket = new Socket('wss://example.com/socket', {
      transport: WebSocket,
      decode: decoder,
    })

    socket.decode('...esoteric format...', (decoded) => {
      assert.deepStrictEqual(decoded, 'decode works')
    })
  })
})
