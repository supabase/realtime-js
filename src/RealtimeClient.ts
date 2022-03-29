import {
  CHANNEL_EVENTS,
  DEFAULT_TIMEOUT,
  DEFAULT_VSN,
  SOCKET_STATES,
  WS_CLOSE_NORMAL,
  DEFAULT_HEADERS,
} from './lib/constants'
import {
  Decode,
  Encode,
  GenericObject,
  Message,
  Options,
  ReAfterMs,
  VSN
} from './lib/types'
import { IMessageEvent, w3cwebsocket as WebSocket } from 'websocket'
import { OutgoingHttpHeaders } from 'http'
import Timer from './lib/timer'
import RealtimeSubscription from './RealtimeSubscription'
import Serializer from './lib/serializer'
import { closure } from './lib/utils'

export default class RealtimeClient {
  stateChangeCallbacks: Record<string, [string, Function][]> = {
    open: [],
    close: [],
    error: [],
    message: [],
  }
  channels: RealtimeSubscription[] = []
  sendBuffer: Function[] = []
  ref: number = 0
  timeout: number = DEFAULT_TIMEOUT
  establishedConnections: number = 0
  closeWasClean: boolean = false
  encode: Encode
  decode: Decode
  heartbeatIntervalMs: number = 30000
  rejoinAfterMs: ReAfterMs
  reconnectAfterMs: ReAfterMs
  logger: Function = () => {}
  params: () => GenericObject
  endPoint: string
  headers: OutgoingHttpHeaders = DEFAULT_HEADERS
  heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  pendingHeartbeatRef: string | null = null
  reconnectTimer: Timer
  conn: WebSocket | null = null
  vsn: VSN = DEFAULT_VSN
  accessToken: string | null = null

  /**
   * Initializes the Socket
   *
   * For IE8 support use an ES5-shim (https://github.com/es-shims/es5-shim)
   *
   * @param endPoint - The string WebSocket endpoint, ie, `"ws://example.com/socket"`,
   *                                               `"wss://example.com"`
   *                                               `"/socket"` (inherited host & protocol)
   * @param opts - Optional configuration
   * @param opts.encode - The function to encode outgoing messages.
   * Defaults to JSON encoder.
   * @param opts.decode - The function to decode incoming messages.
   * Defaults to JSON:
   * ```javascript
   * (payload, callback) => callback(JSON.parse(payload))
   * ```
   * @param opts.timeout - The default timeout in milliseconds to trigger push timeouts.
   * Defaults `DEFAULT_TIMEOUT`
   * @param opts.heartbeatIntervalMs - The millisecond interval to send a heartbeat message.
   * @param opts.reconnectAfterMs - The optional function that returns the millisecond
   * socket reconnect interval.
   * Defaults to stepped backoff of:
   * ```javascript
   * function(tries){
   *   return [10, 50, 100, 150, 200, 250, 500, 1000, 2000][tries - 1] || 5000
   * }
   * ```
   * @param opts.rejoinAfterMs - The optional function that returns the millsecond
   * rejoin interval for individual channels.
   * ```javascript
   * function(tries){
   *   return [1000, 2000, 5000][tries - 1] || 10000
   * }
   * ```
   * @param opts.logger - The optional function for specialized logging, eg:
   * ```javascript
   * function(kind, msg, data) {
   *   console.log(`${kind}: ${msg}`, data)
   * }
   * ```
   * @param opts.params - The optional params to pass when connecting.
   * @param opts.vsn - The serializer's protocol version to send on connect.
   * Defaults to DEFAULT_VSN.
   * @param opts.headers - The optional headers to pass when connecting.
   */
  constructor(endPoint: string, opts: Options = {}) {
    if (opts.timeout) this.timeout = opts.timeout
    if (opts.heartbeatIntervalMs)
      this.heartbeatIntervalMs = opts.heartbeatIntervalMs
    if (opts.logger) this.logger = opts.logger
    if (opts.vsn) this.vsn = opts.vsn
    this.params = closure(opts?.params || {})
    this.endPoint = `${endPoint}/websocket`
    this.rejoinAfterMs = (tries) => {
      if (opts.rejoinAfterMs) {
        return opts.rejoinAfterMs(tries)
      } else {
        return [1000, 2000, 5000][tries - 1] || 10000
      }
    }
    this.reconnectAfterMs = (tries) => {
      if (opts.reconnectAfterMs) {
        return opts.reconnectAfterMs(tries)
      } else {
        return [10, 50, 100, 150, 200, 250, 500, 1000, 2000][tries - 1] || 5000
      }
    }
    const serializer = new Serializer()
    this.encode = opts.encode || serializer.encode.bind(serializer)
    this.decode = opts.decode || serializer.decode.bind(serializer)
    this.reconnectTimer = new Timer(() => {
      this._teardown(() => this.connect())
    }, this.reconnectAfterMs)
    this.headers = { ...this.headers, ...(opts.headers || {}) }
  }

  /**
   * The fully qualified socket url
   */
  endPointURL(): string {
    const url = new URL(this.endPoint, `https://${this.endPoint}`)
    const protocol = url.protocol.match(/^https|^wss/) ? 'wss' : 'ws'
    const params = new URLSearchParams({
      ...Object.fromEntries(url.searchParams),
      ...Object.fromEntries(new URLSearchParams(this.params())),
    })
    params.set('vsn', this.vsn)

    return `${protocol}://${url.host}?${params}`
  }

  /**
   * Disconnects the socket
   *
   * See https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Status_codes for valid status codes.
   *
   * @param callback - A callback which is called after socket is disconnected (Optional).
   * @param code - A status code for disconnection (Optional).
   * @param reason - A textual description of the reason to disconnect. (Optional)
   */
  async disconnect(
    callback?: Function,
    code?: number,
    reason?: string
  ): Promise<{ error: null | Error }> {
    this.closeWasClean = true
    this.reconnectTimer.reset()
    return await this._teardown(callback, code, reason)
  }

  /**
   * Connects the socket.
   */
  async connect(): Promise<{ error: null | Error }> {
    if (this.conn) {
      return Promise.resolve({ error: null })
    }

    this.closeWasClean = false
    this.conn = new WebSocket(this.endPointURL(), [], '', this.headers)
    this.conn.binaryType = 'arraybuffer'
    this.conn.onopen = async () => {
      this._onConnOpen()
      return { error: null }
    }
    this.conn.onerror = async (error) => {
      this._onConnError(error)
      return { error }
    }
    this.conn.onmessage = (event) => this._onConnMessage(event)
    this.conn.onclose = (event) => this._onConnClose(event)

    return new Promise((resolve) => {
      ;[this.conn!.onopen, this.conn!.onerror].forEach(
        async (statusPromise) => {
          const status = (await statusPromise) as unknown as {
            error: null | Error
          }
          resolve(status)
        }
      )
    })
  }

  /**
   * Logs the message. Override `this.logger` for specialized logging.
   */
  log(kind: string, msg: string, data?: unknown): void {
    this.logger(kind, msg, data)
  }

  /**
   * Registers callbacks for connection open events.
   * @param callback A function to be called when the event occurs.
   * @example socket.onOpen(() => console.log("Socket opened."))
   */
  onOpen(callback: Function): string {
    const ref = this.makeRef()
    this.stateChangeCallbacks.open.push([ref, callback])
    return ref
  }

  /**
   * Registers callbacks for connection close events.
   * @param callback A function to be called when the event occurs.
   * @example socket.onClose(() => console.log("Socket closed."))
   */
  onClose(callback: Function): string {
    const ref = this.makeRef()
    this.stateChangeCallbacks.close.push([ref, callback])
    return ref
  }

  /**
   * Registers callbacks for connection error events.
   * @param callback A function to be called when the event occurs.
   * @example socket.onError((error) => console.log("An error occurred", error))
   */
  onError(callback: Function): string {
    const ref = this.makeRef()
    this.stateChangeCallbacks.error.push([ref, callback])
    return ref
  }

  /**
   * Registers callbacks for connection message events.
   * @param callback A function to be called when the event occurs.
   * @example socket.onMessage((message) => console.log(message))
   */
  onMessage(callback: Function): string {
    const ref = this.makeRef()
    this.stateChangeCallbacks.message.push([ref, callback])
    return ref
  }

  /**
   * Removes a subscription from the socket.
   *
   * @param channel An open subscription.
   */
  remove(channel: RealtimeSubscription) {
    this.off(channel.stateChangeRefs)
    this.channels = this.channels.filter(
      (c: RealtimeSubscription) => c.joinRef() !== channel.joinRef()
    )
  }

  /**
   * Removes `onOpen`, `onClose`, `onError,` and `onMessage` registrations.
   *
   * @param {refs} - list of refs returned by calls to
   *                 `onOpen`, `onClose`, `onError,` and `onMessage`
   */
  off(refs: string[]): void {
    for (const key in this.stateChangeCallbacks) {
      this.stateChangeCallbacks[key] = this.stateChangeCallbacks[key].filter(
        ([ref]) => {
          return refs.indexOf(ref) === -1
        }
      )
    }
  }

  /**
   * Initiates a new channel for the given topic
   */
  channel(
    topic: string,
    chanParams: { [key: string]: any } = {}
  ): RealtimeSubscription {
    let chan = new RealtimeSubscription(topic, chanParams, this)
    this.channels.push(chan)
    return chan
  }

  push(data: Message) {
    let { topic, event, payload, ref, join_ref } = data
    this.log('push', `${topic} ${event} (${join_ref}, ${ref})`, payload)

    if (this.isConnected()) {
      this.encode(data, (result: ArrayBuffer | string) =>
        this.conn?.send(result)
      )
    } else {
      this.sendBuffer.push(() =>
        this.encode(data, (result: ArrayBuffer | string) =>
          this.conn?.send(result)
        )
      )
    }
  }

  /**
   * Return the next message ref, accounting for overflows
   */
  makeRef(): string {
    const newRef = this.ref + 1
    if (newRef === this.ref) {
      this.ref = 0
    } else {
      this.ref = newRef
    }

    return this.ref.toString()
  }

  /**
   * Sets the JWT access token used for channel subscription authorization and Realtime RLS.
   *
   * @param token A JWT string.
   */
  setAuth(token: string | null): void {
    this.accessToken = token

    this.push({
      topic: 'set_token',
      event: CHANNEL_EVENTS.access_token,
      payload: { access_token: token },
      ref: this.ref.toString()
    })

    this.channels.forEach((channel) => {
      channel.updateJoinPayload({ user_token: token })
    })
  }

  leaveOpenTopic(topic: string): void {
    let dupChannel = this.channels.find(
      (c) => c.topic === topic && (c.isJoined() || c.isJoining())
    )
    if (dupChannel) {
      this.log('transport', `leaving duplicate topic "${topic}"`)
      dupChannel.unsubscribe()
    }
  }

  /**
   * Retuns `true` is the connection is open.
   */
  isConnected(): boolean {
    return this._connectionState() === 'open'
  }

  private _onConnOpen(): void {
    this.log('transport', `connected to ${this.endPointURL()}`)
    this.closeWasClean = false
    this.establishedConnections++
    this._flushSendBuffer()
    this.reconnectTimer.reset()
    this._resetHeartbeat()
    this.stateChangeCallbacks.open.forEach(([_, callback]) => callback())
  }

  private _heartbeatTimeout() {
    if (this.pendingHeartbeatRef) {
      this.pendingHeartbeatRef = null
      this.log(
        'transport',
        'heartbeat timeout. Attempting to re-establish connection'
      )
      this._abnormalClose('heartbeat timeout')
    }
  }

  private _onConnMessage(rawMessage: IMessageEvent): void {
    this.decode(rawMessage.data, (msg: Message) => {
      const { topic, event, payload, ref, join_ref } = msg

      if (ref && ref === this.pendingHeartbeatRef) {
        this.heartbeatTimer && clearTimeout(this.heartbeatTimer)
        this.pendingHeartbeatRef = null
        setTimeout(() => this._sendHeartbeat(), this.heartbeatIntervalMs)
      } else if (event === payload?.type) {
        this._resetHeartbeat()
      }

      this.log(
        'receive',
        `${payload.status || ''} ${topic} ${event} ${
          (ref && '(' + ref + ')') || ''
        }`,
        payload
      )

      this.channels.forEach((channel) => {
        if (channel.isMember(topic, event, payload, join_ref)) {
          channel.trigger(event, payload, ref, join_ref)
        }
      })

      this.stateChangeCallbacks.message.forEach(([_, callback]) =>
        callback(msg)
      )
    })
  }

  private _flushSendBuffer() {
    if (this.isConnected() && this.sendBuffer.length > 0) {
      this.sendBuffer.forEach((callback) => callback())
      this.sendBuffer = []
    }
  }

  private _resetHeartbeat() {
    if (this.conn) {
      return
    }
    this.pendingHeartbeatRef = null
    this.heartbeatTimer && clearTimeout(this.heartbeatTimer)
    setTimeout(() => this._sendHeartbeat(), this.heartbeatIntervalMs)
  }

  private async _teardown(
    callback?: Function,
    code?: number,
    reason?: string
  ): Promise<{ error: null | Error }> {
    if (!this.conn) {
      return await Promise.resolve(callback ? callback() : { error: null }).catch(error => ({ error }))
    }

    return await this._waitForBufferDone(async () => {
      if (this.conn) {
        code ? this.conn.close(code, reason || '') : this.conn.close()
        return Promise.resolve({ error: null })
      }

      return await this._waitForSocketClosed(async () => {
        if (this.conn) {
          this.conn.onclose = () => {} // noop
          this.conn = null
        }

        return await Promise.resolve(callback ? callback() : { error: null }).catch((error) => ({ error }))
      })
    })
  }

  private async _waitForBufferDone(
    callback: Function,
    tries: number = 1
  ): Promise<{ error: null | Error }> {
    if (tries === 5 || !this.conn || !this.conn.bufferedAmount) {
      return Promise.resolve(callback())
        .then(() => ({ error: null }))
        .catch((error) => ({ error }))
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this._waitForBufferDone(callback, tries + 1))
      }, 150 * tries)
    })
  }

  private async _waitForSocketClosed(
    callback: Function,
    tries: number = 1
  ): Promise<{ error: null | Error }> {
    if (
      tries === 5 ||
      !this.conn ||
      this.conn.readyState === SOCKET_STATES.closed
    ) {
      return Promise.resolve(callback())
        .then(() => ({ error: null }))
        .catch((error) => ({ error }))
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this._waitForSocketClosed(callback, tries + 1))
      }, 150 * tries)
    })
  }

  private _onConnClose(event: CloseEventInit): void {
    const closeCode = event && event.code
    this.log('transport', 'close', event)
    this._triggerChanError()
    this.heartbeatTimer && clearTimeout(this.heartbeatTimer)
    if (!this.closeWasClean && closeCode !== 1000) {
      this.reconnectTimer.scheduleTimeout()
    }
    this.stateChangeCallbacks.close.forEach(([_, callback]) => callback(event))
  }

  private _onConnError(error: Error): void {
    this.log('transport', `${error}`)
    const establishedBefore = this.establishedConnections
    this.stateChangeCallbacks.error.forEach(([, callback]) => {
      callback(error, WebSocket, establishedBefore)
    })
    if (establishedBefore > 0) {
      this._triggerChanError()
    }
  }

  private _triggerChanError(): void {
    this.channels.forEach((channel: RealtimeSubscription) => {
      if (!(channel.isErrored() || channel.isLeaving() || channel.isClosed())) {
        channel.trigger(CHANNEL_EVENTS.error)
      }
    })
  }

  /**
   * Returns the current state of the socket.
   */
  private _connectionState(): string {
    switch (this.conn && this.conn.readyState) {
      case SOCKET_STATES.connecting:
        return 'connecting'
      case SOCKET_STATES.open:
        return 'open'
      case SOCKET_STATES.closing:
        return 'closing'
      default:
        return 'closed'
    }
  }

  private _sendHeartbeat() {
    if (this.pendingHeartbeatRef && !this.isConnected()) {
      return
    }
    this.pendingHeartbeatRef = this.makeRef()
    this.push({
      topic: 'phoenix',
      event: 'heartbeat',
      payload: {},
      ref: this.pendingHeartbeatRef,
    })
    this.heartbeatTimer = setTimeout(
      () => this._heartbeatTimeout(),
      this.heartbeatIntervalMs
    )
    this.setAuth(this.accessToken)
  }

  private _abnormalClose(reason: string): void {
    this.closeWasClean = false
    if (this.isConnected()) {
      this.conn && this.conn.close(WS_CLOSE_NORMAL, reason)
    }
  }
}
