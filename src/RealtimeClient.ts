import { w3cwebsocket } from 'websocket'
import {
  VSN,
  CHANNEL_EVENTS,
  TRANSPORTS,
  SOCKET_STATES,
  DEFAULT_TIMEOUT,
  WS_CLOSE_NORMAL,
  DEFAULT_HEADERS,
  CONNECTION_STATE,
} from './lib/constants'
import Timer from './lib/timer'
import Serializer from './lib/serializer'
import RealtimeChannel from './RealtimeChannel'
import type { RealtimeChannelOptions } from './RealtimeChannel'

type Fetch = typeof fetch

export type RealtimeClientOptions = {
  transport?: WebSocket
  timeout?: number
  heartbeatIntervalMs?: number
  logger?: Function
  encode?: Function
  decode?: Function
  reconnectAfterMs?: Function
  headers?: { [key: string]: string }
  params?: { [key: string]: any }
  log_level?: 'info' | 'debug' | 'warn' | 'error'
  fetch?: Fetch
}

export type RealtimeMessage = {
  topic: string
  event: string
  payload: any
  ref: string
  join_ref?: string
}

export type RealtimeRemoveChannelResponse = 'ok' | 'timed out' | 'error'

const noop = () => {}

export default class RealtimeClient {
  accessToken: string | null = null
  channels: RealtimeChannel[] = []
  endPoint: string = ''
  headers?: { [key: string]: string } = DEFAULT_HEADERS
  params?: { [key: string]: string } = {}
  timeout: number = DEFAULT_TIMEOUT
  transport: any = w3cwebsocket
  heartbeatIntervalMs: number = 30000
  heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined
  pendingHeartbeatRef: string | null = null
  ref: number = 0
  reconnectTimer: Timer
  logger: Function = noop
  encode: Function
  decode: Function
  reconnectAfterMs: Function
  conn: WebSocket | null = null
  sendBuffer: Function[] = []
  serializer: Serializer = new Serializer()
  stateChangeCallbacks: {
    open: Function[]
    close: Function[]
    error: Function[]
    message: Function[]
  } = {
    open: [],
    close: [],
    error: [],
    message: [],
  }
  fetch: Fetch

  /**
   * Initializes the Socket.
   *
   * @param endPoint The string WebSocket endpoint, ie, "ws://example.com/socket", "wss://example.com", "/socket" (inherited host & protocol)
   * @param options.transport The Websocket Transport, for example WebSocket.
   * @param options.timeout The default timeout in milliseconds to trigger push timeouts.
   * @param options.params The optional params to pass when connecting.
   * @param options.headers The optional headers to pass when connecting.
   * @param options.heartbeatIntervalMs The millisec interval to send a heartbeat message.
   * @param options.logger The optional function for specialized logging, ie: logger: (kind, msg, data) => { console.log(`${kind}: ${msg}`, data) }
   * @param options.encode The function to encode outgoing messages. Defaults to JSON: (payload, callback) => callback(JSON.stringify(payload))
   * @param options.decode The function to decode incoming messages. Defaults to Serializer's decode.
   * @param options.reconnectAfterMs he optional function that returns the millsec reconnect interval. Defaults to stepped backoff off.
   */
  constructor(endPoint: string, options?: RealtimeClientOptions) {
    this.endPoint = `${endPoint}/${TRANSPORTS.websocket}`

    if (options?.params) this.params = options.params
    if (options?.headers) this.headers = { ...this.headers, ...options.headers }
    if (options?.timeout) this.timeout = options.timeout
    if (options?.logger) this.logger = options.logger
    if (options?.transport) this.transport = options.transport
    if (options?.heartbeatIntervalMs)
      this.heartbeatIntervalMs = options.heartbeatIntervalMs

    const accessToken = options?.params?.apikey
    if (accessToken) this.accessToken = accessToken

    this.reconnectAfterMs = options?.reconnectAfterMs
      ? options.reconnectAfterMs
      : (tries: number) => {
          return [1000, 2000, 5000, 10000][tries - 1] || 10000
        }
    this.encode = options?.encode
      ? options.encode
      : (payload: JSON, callback: Function) => {
          return callback(JSON.stringify(payload))
        }
    this.decode = options?.decode
      ? options.decode
      : this.serializer.decode.bind(this.serializer)
    this.reconnectTimer = new Timer(async () => {
      this.disconnect()
      this.connect()
    }, this.reconnectAfterMs)

    this.fetch = this._resolveFetch(options?.fetch)
  }

  /**
   * Connects the socket, unless already connected.
   */
  connect(): void {
    if (this.conn) {
      return
    }

    this.conn = new this.transport(this._endPointURL(), [], null, this.headers)

    if (this.conn) {
      this.conn.binaryType = 'arraybuffer'
      this.conn.onopen = () => this._onConnOpen()
      this.conn.onerror = (error) => this._onConnError(error as ErrorEvent)
      this.conn.onmessage = (event) => this._onConnMessage(event)
      this.conn.onclose = (event) => this._onConnClose(event)
    }
  }

  /**
   * Disconnects the socket.
   *
   * @param code A numeric status code to send on disconnect.
   * @param reason A custom reason for the disconnect.
   */
  disconnect(code?: number, reason?: string): void {
    if (this.conn) {
      this.conn.onclose = function () {} // noop
      if (code) {
        this.conn.close(code, reason ?? '')
      } else {
        this.conn.close()
      }
      this.conn = null
      // remove open handles
      this.heartbeatTimer && clearInterval(this.heartbeatTimer)
      this.reconnectTimer.reset()
    }
  }

  /**
   * Returns all created channels
   */
  getChannels(): RealtimeChannel[] {
    return this.channels
  }

  /**
   * Unsubscribes and removes a single channel
   * @param channel A RealtimeChannel instance
   */
  async removeChannel(
    channel: RealtimeChannel
  ): Promise<RealtimeRemoveChannelResponse> {
    const status = await channel.unsubscribe()
    if (this.channels.length === 0) {
      this.disconnect()
    }
    return status
  }

  /**
   * Unsubscribes and removes all channels
   */
  async removeAllChannels(): Promise<RealtimeRemoveChannelResponse[]> {
    const values_1 = await Promise.all(
      this.channels.map((channel) => channel.unsubscribe())
    )
    this.disconnect()
    return values_1
  }

  /**
   * Logs the message.
   *
   * For customized logging, `this.logger` can be overridden.
   */
  log(kind: string, msg: string, data?: any) {
    this.logger(kind, msg, data)
  }

  /**
   * Returns the current state of the socket.
   */
  connectionState(): CONNECTION_STATE {
    switch (this.conn && this.conn.readyState) {
      case SOCKET_STATES.connecting:
        return CONNECTION_STATE.Connecting
      case SOCKET_STATES.open:
        return CONNECTION_STATE.Open
      case SOCKET_STATES.closing:
        return CONNECTION_STATE.Closing
      default:
        return CONNECTION_STATE.Closed
    }
  }

  /**
   * Returns `true` is the connection is open.
   */
  isConnected(): boolean {
    return this.connectionState() === CONNECTION_STATE.Open
  }

  channel(
    topic: string,
    params: RealtimeChannelOptions = { config: {} }
  ): RealtimeChannel {
    const chan = new RealtimeChannel(`realtime:${topic}`, params, this)
    this.channels.push(chan)
    return chan
  }

  /**
   * Push out a message if the socket is connected.
   *
   * If the socket is not connected, the message gets enqueued within a local buffer, and sent out when a connection is next established.
   */
  push(data: RealtimeMessage): void {
    const { topic, event, payload, ref } = data
    const callback = () => {
      this.encode(data, (result: any) => {
        this.conn?.send(result)
      })
    }
    this.log('push', `${topic} ${event} (${ref})`, payload)
    if (this.isConnected()) {
      callback()
    } else {
      this.sendBuffer.push(callback)
    }
  }

  /**
   * Sets the JWT access token used for channel subscription authorization and Realtime RLS.
   *
   * @param token A JWT string.
   */
  setAuth(token: string | null): void {
    this.accessToken = token

    this.channels.forEach((channel) => {
      token && channel.updateJoinPayload({ access_token: token })

      if (channel.joinedOnce && channel._isJoined()) {
        channel._push(CHANNEL_EVENTS.access_token, { access_token: token })
      }
    })
  }

  /**
   * Use either custom fetch, if provided, or default fetch to make HTTP requests
   *
   * @internal
   */
  _resolveFetch = (customFetch?: Fetch): Fetch => {
    let _fetch: Fetch
    if (customFetch) {
      _fetch = customFetch
    } else if (typeof fetch === 'undefined') {
      _fetch = (...args) =>
        import('@supabase/node-fetch' as any).then(({ default: fetch }) =>
          fetch(...args)
        )
    } else {
      _fetch = fetch
    }
    return (...args) => _fetch(...args)
  }

  /**
   * Return the next message ref, accounting for overflows
   *
   * @internal
   */
  _makeRef(): string {
    let newRef = this.ref + 1
    if (newRef === this.ref) {
      this.ref = 0
    } else {
      this.ref = newRef
    }

    return this.ref.toString()
  }

  /**
   * Unsubscribe from channels with the specified topic.
   *
   * @internal
   */
  _leaveOpenTopic(topic: string): void {
    let dupChannel = this.channels.find(
      (c) => c.topic === topic && (c._isJoined() || c._isJoining())
    )
    if (dupChannel) {
      this.log('transport', `leaving duplicate topic "${topic}"`)
      dupChannel.unsubscribe()
    }
  }

  /**
   * Removes a subscription from the socket.
   *
   * @param channel An open subscription.
   *
   * @internal
   */
  _remove(channel: RealtimeChannel) {
    this.channels = this.channels.filter(
      (c: RealtimeChannel) => c._joinRef() !== channel._joinRef()
    )
  }

  /**
   * Returns the URL of the websocket.
   *
   * @internal
   */
  private _endPointURL(): string {
    return this._appendParams(
      this.endPoint,
      Object.assign({}, this.params, { vsn: VSN })
    )
  }

  /** @internal */
  private _onConnMessage(rawMessage: { data: any }) {
    this.decode(rawMessage.data, (msg: RealtimeMessage) => {
      let { topic, event, payload, ref } = msg

      if (
        (ref && ref === this.pendingHeartbeatRef) ||
        event === payload?.type
      ) {
        this.pendingHeartbeatRef = null
      }

      this.log(
        'receive',
        `${payload.status || ''} ${topic} ${event} ${
          (ref && '(' + ref + ')') || ''
        }`,
        payload
      )
      this.channels
        .filter((channel: RealtimeChannel) => channel._isMember(topic))
        .forEach((channel: RealtimeChannel) =>
          channel._trigger(event, payload, ref)
        )
      this.stateChangeCallbacks.message.forEach((callback) => callback(msg))
    })
  }

  /** @internal */
  private _onConnOpen() {
    this.log('transport', `connected to ${this._endPointURL()}`)
    this._flushSendBuffer()
    this.reconnectTimer.reset()
    this.heartbeatTimer && clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(
      () => this._sendHeartbeat(),
      this.heartbeatIntervalMs
    )
    this.stateChangeCallbacks.open.forEach((callback) => callback())!
  }

  /** @internal */
  private _onConnClose(event: any) {
    this.log('transport', 'close', event)
    this._triggerChanError()
    this.heartbeatTimer && clearInterval(this.heartbeatTimer)
    this.reconnectTimer.scheduleTimeout()
    this.stateChangeCallbacks.close.forEach((callback) => callback(event))
  }

  /** @internal */
  private _onConnError(error: ErrorEvent) {
    this.log('transport', error.message)
    this._triggerChanError()
    this.stateChangeCallbacks.error.forEach((callback) => callback(error))
  }

  /** @internal */
  private _triggerChanError() {
    this.channels.forEach((channel: RealtimeChannel) =>
      channel._trigger(CHANNEL_EVENTS.error)
    )
  }

  /** @internal */
  private _appendParams(
    url: string,
    params: { [key: string]: string }
  ): string {
    if (Object.keys(params).length === 0) {
      return url
    }
    const prefix = url.match(/\?/) ? '&' : '?'
    const query = new URLSearchParams(params)

    return `${url}${prefix}${query}`
  }

  /** @internal */
  private _flushSendBuffer() {
    if (this.isConnected() && this.sendBuffer.length > 0) {
      this.sendBuffer.forEach((callback) => callback())
      this.sendBuffer = []
    }
  }
  /** @internal */
  private _sendHeartbeat() {
    if (!this.isConnected()) {
      return
    }
    if (this.pendingHeartbeatRef) {
      this.pendingHeartbeatRef = null
      this.log(
        'transport',
        'heartbeat timeout. Attempting to re-establish connection'
      )
      this.conn?.close(WS_CLOSE_NORMAL, 'hearbeat timeout')
      return
    }
    this.pendingHeartbeatRef = this._makeRef()
    this.push({
      topic: 'phoenix',
      event: 'heartbeat',
      payload: {},
      ref: this.pendingHeartbeatRef,
    })
    this.setAuth(this.accessToken)
  }
}
