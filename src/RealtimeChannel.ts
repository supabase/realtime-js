import { CHANNEL_EVENTS, CHANNEL_STATES } from './lib/constants'
import Push from './lib/push'
import type RealtimeClient from './RealtimeClient'
import Timer from './lib/timer'
import RealtimePresence, {
  REALTIME_PRESENCE_LISTEN_EVENTS,
} from './RealtimePresence'
import type {
  RealtimePresenceJoinPayload,
  RealtimePresenceLeavePayload,
  RealtimePresenceState,
} from './RealtimePresence'
import * as Transformers from './lib/transformers'
import { httpEndpointURL } from './lib/transformers'
import {
  mergeChannelConfig,
  shouldEnablePresence,
  MAX_PUSH_BUFFER_SIZE,
} from './lib/channel-config'

export type RealtimeChannelOptions = {
  config: {
    /**
     * self option enables client to receive message it broadcast
     * ack option instructs server to acknowledge that broadcast message was received
     */
    broadcast?: { self?: boolean; ack?: boolean }
    /**
     * key option is used to track presence payload across clients
     */
    presence?: { key?: string; enabled?: boolean }
    /**
     * defines if the channel is private or not and if RLS policies will be used to check data
     */
    private?: boolean
  }
}

type RealtimePostgresChangesPayloadBase = {
  schema: string
  table: string
  commit_timestamp: string
  errors: string[]
}

export type RealtimePostgresInsertPayload<T extends { [key: string]: any }> =
  RealtimePostgresChangesPayloadBase & {
    eventType: `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT}`
    new: T
    old: {}
  }

export type RealtimePostgresUpdatePayload<T extends { [key: string]: any }> =
  RealtimePostgresChangesPayloadBase & {
    eventType: `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.UPDATE}`
    new: T
    old: Partial<T>
  }

export type RealtimePostgresDeletePayload<T extends { [key: string]: any }> =
  RealtimePostgresChangesPayloadBase & {
    eventType: `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.DELETE}`
    new: {}
    old: Partial<T>
  }

export type RealtimePostgresChangesPayload<T extends { [key: string]: any }> =
  | RealtimePostgresInsertPayload<T>
  | RealtimePostgresUpdatePayload<T>
  | RealtimePostgresDeletePayload<T>

export type RealtimePostgresChangesFilter<
  T extends `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT}`
> = {
  /**
   * The type of database change to listen to.
   */
  event: T
  /**
   * The database schema to listen to.
   */
  schema: string
  /**
   * The database table to listen to.
   */
  table?: string
  /**
   * Receive database changes when filter is matched.
   */
  filter?: string
}

export type RealtimeChannelSendResponse = 'ok' | 'timed out' | 'error'

export enum REALTIME_POSTGRES_CHANGES_LISTEN_EVENT {
  ALL = '*',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export enum REALTIME_LISTEN_TYPES {
  BROADCAST = 'broadcast',
  PRESENCE = 'presence',
  POSTGRES_CHANGES = 'postgres_changes',
  SYSTEM = 'system',
}

// Consolidated type mapping using conditional types for proper inference
type RealtimeListenerPayload<
  TType extends REALTIME_LISTEN_TYPES,
  TFilter,
  T = any
> =
  // Presence event payloads
  TType extends REALTIME_LISTEN_TYPES.PRESENCE
    ? TFilter extends { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.SYNC}` }
      ? void
      : TFilter extends { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.JOIN}` }
      ? RealtimePresenceJoinPayload<T>
      : TFilter extends { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.LEAVE}` }
      ? RealtimePresenceLeavePayload<T>
      : never
    : // Postgres changes payloads
    TType extends REALTIME_LISTEN_TYPES.POSTGRES_CHANGES
    ? TFilter extends RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL}`>
      ? RealtimePostgresChangesPayload<T>
      : TFilter extends RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT}`>
      ? RealtimePostgresInsertPayload<T>
      : TFilter extends RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.UPDATE}`>
      ? RealtimePostgresUpdatePayload<T>
      : TFilter extends RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.DELETE}`>
      ? RealtimePostgresDeletePayload<T>
      : never
    : // Broadcast payloads
    TType extends REALTIME_LISTEN_TYPES.BROADCAST
    ? {
        type: `${REALTIME_LISTEN_TYPES.BROADCAST}`
        event: string
        [key: string]: any
      }
    : // System payloads
    TType extends REALTIME_LISTEN_TYPES.SYSTEM
    ? any
    : // Fallback
      any

// Valid filter types for each listener type
type RealtimeListenerFilter<TType extends REALTIME_LISTEN_TYPES> =
  TType extends REALTIME_LISTEN_TYPES.PRESENCE
    ? { event: `${REALTIME_PRESENCE_LISTEN_EVENTS}` }
    : TType extends REALTIME_LISTEN_TYPES.POSTGRES_CHANGES
    ? RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT}`>
    : TType extends REALTIME_LISTEN_TYPES.BROADCAST
    ? { event: string }
    : TType extends REALTIME_LISTEN_TYPES.SYSTEM
    ? {}
    : { event: string; [key: string]: string }

export enum REALTIME_SUBSCRIBE_STATES {
  SUBSCRIBED = 'SUBSCRIBED',
  TIMED_OUT = 'TIMED_OUT',
  CLOSED = 'CLOSED',
  CHANNEL_ERROR = 'CHANNEL_ERROR',
}

export const REALTIME_CHANNEL_STATES = CHANNEL_STATES

interface PostgresChangesFilters {
  postgres_changes: {
    id: string
    event: string
    schema?: string
    table?: string
    filter?: string
  }[]
}
/** A channel is the basic building block of Realtime
 * and narrows the scope of data flow to subscribed clients.
 * You can think of a channel as a chatroom where participants are able to see who's online
 * and send and receive messages.
 */
export default class RealtimeChannel {
  bindings: {
    [key: string]: {
      type: string
      filter: { [key: string]: any }
      callback: Function
      id?: string
    }[]
  } = {}
  timeout: number
  state: CHANNEL_STATES = CHANNEL_STATES.closed
  joinedOnce = false
  joinPush: Push
  rejoinTimer: Timer
  pushBuffer: Push[] = []
  presence: RealtimePresence
  broadcastEndpointURL: string
  subTopic: string
  private: boolean

  constructor(
    /** Topic name can be any string. */
    public topic: string,
    public params: RealtimeChannelOptions = { config: {} },
    public socket: RealtimeClient
  ) {
    this.subTopic = topic.replace(/^realtime:/i, '')
    this.params.config = mergeChannelConfig(params.config)
    this.timeout = this.socket.timeout
    this.joinPush = new Push(
      this,
      CHANNEL_EVENTS.join,
      this.params,
      this.timeout
    )

    this.rejoinTimer = new Timer(
      () => this._rejoinUntilConnected(),
      this.socket.reconnectAfterMs
    )

    this.joinPush.receive('ok', () => {
      this.state = CHANNEL_STATES.joined
      this.rejoinTimer.reset()
      this.pushBuffer.forEach((pushEvent: Push) => pushEvent.send())
      this.pushBuffer = []
    })

    this._onClose(() => {
      this.rejoinTimer.reset()
      this.socket.log('channel', `close ${this.topic} ${this._joinRef()}`)
      this.state = CHANNEL_STATES.closed
      this.socket._remove(this)
    })

    this._onError((reason: string) => this._handleChannelError('error', reason))
    this.joinPush.receive('timeout', () => {
      if (!this._isJoining()) {
        return
      }
      this._handleChannelError('timeout', this.joinPush.timeout)
    })

    this.joinPush.receive('error', (reason: any) =>
      this._handleChannelError('error', reason)
    )

    this._on(CHANNEL_EVENTS.reply, {}, (payload: any, ref: string) =>
      this._trigger(this._replyEventName(ref), payload)
    )

    this.presence = new RealtimePresence(this)

    this.broadcastEndpointURL = httpEndpointURL(this.socket.endPoint)
    this.private = this.params.config.private || false
  }

  /** Subscribe registers your client with the server */
  subscribe(
    callback?: (status: REALTIME_SUBSCRIBE_STATES, err?: Error) => void,
    timeout = this.timeout
  ): RealtimeChannel {
    if (!this.socket.isConnected()) {
      this.socket.connect()
    }
    if (this.state == CHANNEL_STATES.closed) {
      const {
        config: { broadcast, presence, private: isPrivate },
      } = this.params

      const postgres_changes =
        this.bindings.postgres_changes?.map((r) => r.filter) ?? []

      const presence_enabled = shouldEnablePresence(this.bindings)
      const accessTokenPayload: { access_token?: string } = {}
      const config = {
        broadcast,
        presence: { ...presence, enabled: presence_enabled },
        postgres_changes,
        private: isPrivate,
      }

      if (this.socket.accessTokenValue) {
        accessTokenPayload.access_token = this.socket.accessTokenValue
      }

      this._onError((e: Error) =>
        callback?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, e)
      )

      this._onClose(() => callback?.(REALTIME_SUBSCRIBE_STATES.CLOSED))

      this.updateJoinPayload({ ...{ config }, ...accessTokenPayload })

      this.joinedOnce = true
      this._rejoin(timeout)

      this.joinPush
        .receive('ok', async ({ postgres_changes }: PostgresChangesFilters) => {
          this.socket.setAuth()

          if (postgres_changes === undefined) {
            callback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
            return
          }

          try {
            const validatedBindings =
              this._validatePostgresChanges(postgres_changes)
            this.bindings.postgres_changes = validatedBindings
            callback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
          } catch (error) {
            this._handleSubscriptionError(callback, error as Error)
          }
        })
        .receive('error', (error: { [key: string]: any }) => {
          this.state = CHANNEL_STATES.errored
          callback?.(
            REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
            new Error(
              JSON.stringify(Object.values(error).join(', ') || 'error')
            )
          )
          return
        })
        .receive('timeout', () => {
          callback?.(REALTIME_SUBSCRIBE_STATES.TIMED_OUT)
          return
        })
    }
    return this
  }

  presenceState<
    T extends { [key: string]: any } = {}
  >(): RealtimePresenceState<T> {
    return this.presence.state as RealtimePresenceState<T>
  }

  async track(
    payload: { [key: string]: any },
    opts: { [key: string]: any } = {}
  ): Promise<RealtimeChannelSendResponse> {
    return await this.send(
      {
        type: 'presence',
        event: 'track',
        payload,
      },
      opts.timeout || this.timeout
    )
  }

  async untrack(
    opts: { [key: string]: any } = {}
  ): Promise<RealtimeChannelSendResponse> {
    return await this.send(
      {
        type: 'presence',
        event: 'untrack',
      },
      opts
    )
  }

  /**
   * Creates an event handler that listens to changes.
   *
   * @param type One of "broadcast", "presence", "postgres_changes", or "system".
   * @param filter Custom object specific to the Realtime feature detailing which payloads to receive.
   * @param callback Function to be invoked when event handler is triggered.
   */
  on<
    TType extends REALTIME_LISTEN_TYPES,
    TFilter extends RealtimeListenerFilter<TType>,
    T = any
  >(
    type: TType,
    filter: TFilter,
    callback: (payload: RealtimeListenerPayload<TType, TFilter, T>) => void
  ): RealtimeChannel {
    if (
      this.state === CHANNEL_STATES.joined &&
      type === REALTIME_LISTEN_TYPES.PRESENCE
    ) {
      this.socket.log(
        'channel',
        `resubscribe to ${this.topic} due to change in presence callbacks on joined channel`
      )
      this.unsubscribe().then(() => this.subscribe())
    }
    return this._on(type, filter, callback)
  }
  /**
   * Sends a message into the channel.
   *
   * @param args Arguments to send to channel
   * @param args.type The type of event to send
   * @param args.event The name of the event being sent
   * @param args.payload Payload to be sent
   * @param opts Options to be used during the send process
   */
  async send(
    args: {
      type: 'broadcast' | 'presence' | 'postgres_changes'
      event: string
      payload?: any
      [key: string]: any
    },
    opts: { [key: string]: any } = {}
  ): Promise<RealtimeChannelSendResponse> {
    if (!this._canPush() && args.type === 'broadcast') {
      const { event, payload: endpoint_payload } = args
      const authorization = this.socket.accessTokenValue
        ? `Bearer ${this.socket.accessTokenValue}`
        : ''
      const options = {
        method: 'POST',
        headers: {
          Authorization: authorization,
          apikey: this.socket.apiKey ? this.socket.apiKey : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              topic: this.subTopic,
              event,
              payload: endpoint_payload,
              private: this.private,
            },
          ],
        }),
      }

      try {
        const response = await this._fetchWithTimeout(
          this.broadcastEndpointURL,
          options,
          opts.timeout ?? this.timeout
        )

        await response.body?.cancel()
        return response.ok ? 'ok' : 'error'
      } catch (error: any) {
        if (error.name === 'AbortError') {
          return 'timed out'
        } else {
          return 'error'
        }
      }
    } else {
      return new Promise((resolve) => {
        const push = this._push(args.type, args, opts.timeout || this.timeout)

        if (args.type === 'broadcast' && !this.params?.config?.broadcast?.ack) {
          resolve('ok')
        }

        push.receive('ok', () => resolve('ok'))
        push.receive('error', () => resolve('error'))
        push.receive('timeout', () => resolve('timed out'))
      })
    }
  }

  updateJoinPayload(payload: { [key: string]: any }): void {
    this.joinPush.updatePayload(payload)
  }

  /**
   * Leaves the channel.
   *
   * Unsubscribes from server events, and instructs channel to terminate on server.
   * Triggers onClose() hooks.
   *
   * To receive leave acknowledgements, use the a `receive` hook to bind to the server ack, ie:
   * channel.unsubscribe().receive("ok", () => alert("left!") )
   */
  unsubscribe(timeout = this.timeout): Promise<'ok' | 'timed out' | 'error'> {
    this.state = CHANNEL_STATES.leaving
    const onClose = () => {
      this.socket.log('channel', `leave ${this.topic}`)
      this._trigger(CHANNEL_EVENTS.close, 'leave', this._joinRef())
    }

    this.joinPush.destroy()

    let leavePush: Push | null = null

    return new Promise<RealtimeChannelSendResponse>((resolve) => {
      leavePush = new Push(this, CHANNEL_EVENTS.leave, {}, timeout)
      leavePush
        .receive('ok', () => {
          onClose()
          resolve('ok')
        })
        .receive('timeout', () => {
          onClose()
          resolve('timed out')
        })
        .receive('error', () => {
          onClose()
          resolve('error')
        })

      leavePush.send()
      if (!this._canPush()) {
        leavePush.trigger('ok', {})
      }
    }).finally(() => {
      leavePush?.destroy()
      this.state = CHANNEL_STATES.closed
    })
  }
  /**
   * Teardown the channel.
   *
   * Destroys and stops related timers, cleans up bindings and pushes.
   * Safe to call multiple times.
   */
  teardown() {
    this.pushBuffer.forEach((push: Push) => push.destroy())
    this.pushBuffer = []
    this.joinPush.destroy()
    this.rejoinTimer.reset()
    this.bindings = {}
    this.state = CHANNEL_STATES.closed
  }

  /** @internal */

  async _fetchWithTimeout(
    url: string,
    options: { [key: string]: any },
    timeout: number
  ) {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeout)

    const response = await this.socket.fetch(url, {
      ...options,
      signal: controller.signal,
    })

    clearTimeout(id)

    return response
  }

  /** @internal */
  _push(
    event: string,
    payload: { [key: string]: any },
    timeout = this.timeout
  ) {
    if (!this.joinedOnce) {
      throw `tried to push '${event}' to '${this.topic}' before joining. Use channel.subscribe() before pushing events`
    }
    let pushEvent = new Push(this, event, payload, timeout)
    if (this._canPush()) {
      pushEvent.send()
    } else {
      pushEvent.startTimeout()
      this._addToPushBuffer(pushEvent)
    }

    return pushEvent
  }

  /**
   * Overridable message hook
   *
   * Receives all events for specialized message handling before dispatching to the channel callbacks.
   * Must return the payload, modified or unmodified.
   *
   * @internal
   */
  _onMessage(_event: string, payload: any, _ref?: string) {
    return payload
  }

  /** @internal */
  _isMember(topic: string): boolean {
    return this.topic === topic
  }

  /** @internal */
  _joinRef(): string {
    return this.joinPush.ref
  }

  /** @internal */
  _trigger(type: string, payload?: any, ref?: string) {
    const typeLower = type.toLocaleLowerCase()

    const channelEvents = ['phx_close', 'phx_error', 'phx_leave', 'phx_join']
    if (ref && channelEvents.includes(typeLower) && ref !== this._joinRef()) {
      return
    }
    const handledPayload = this._processPayload(typeLower, payload, ref)

    if (['insert', 'update', 'delete'].includes(typeLower)) {
      this._triggerPostgresChanges(typeLower, handledPayload, ref)
    } else {
      this._triggerRegularBindings(typeLower, handledPayload, ref, payload)
    }
  }

  /** @internal */
  private _processPayload(typeLower: string, payload: any, ref?: string): any {
    const handledPayload = this._onMessage(typeLower, payload, ref)
    if (payload && !handledPayload) {
      throw new Error(
        'channel onMessage callbacks must return the payload, modified or unmodified'
      )
    }
    return handledPayload
  }

  /** @internal */
  private _triggerPostgresChanges(
    typeLower: string,
    handledPayload: any,
    ref?: string
  ): void {
    this.bindings.postgres_changes
      ?.filter((bind) => {
        const bindEvent = bind.filter?.event?.toLocaleLowerCase()
        return bindEvent === '*' || bindEvent === typeLower
      })
      .forEach((bind) => bind.callback(handledPayload, ref))
  }

  /** @internal */
  private _triggerRegularBindings(
    typeLower: string,
    handledPayload: any,
    ref?: string,
    originalPayload?: any
  ): void {
    const bindings = this.bindings[typeLower]
    if (!bindings) return

    bindings
      .filter((bind) =>
        this._shouldTriggerBinding(bind, typeLower, originalPayload)
      )
      .forEach((bind) => {
        const finalPayload = this._prepareFinalPayload(bind, handledPayload)
        bind.callback(finalPayload, ref)
      })
  }

  /** @internal */
  private _shouldTriggerBinding(
    bind: any,
    typeLower: string,
    payload?: any
  ): boolean {
    // For non-realtime events, just match the type
    if (!['broadcast', 'presence', 'postgres_changes'].includes(typeLower)) {
      return bind.type.toLocaleLowerCase() === typeLower
    }

    // For postgres_changes with ID (server-assigned bindings)
    if ('id' in bind) {
      const bindId = bind.id
      const bindEvent = bind.filter?.event?.toLocaleLowerCase()
      return !!(
        bindId &&
        payload?.ids?.includes(bindId) &&
        (bindEvent === '*' ||
          bindEvent === payload.data?.type?.toLocaleLowerCase())
      )
    }

    // For regular event-based bindings
    const bindEvent = bind.filter?.event?.toLocaleLowerCase()
    return (
      bindEvent === '*' || bindEvent === payload?.event?.toLocaleLowerCase()
    )
  }

  /** @internal */
  private _prepareFinalPayload(_bind: any, handledPayload: any): any {
    // Transform postgres_changes payload if needed
    if (typeof handledPayload === 'object' && 'ids' in handledPayload) {
      const postgresChanges = handledPayload.data
      const { schema, table, commit_timestamp, type, errors } = postgresChanges
      const enrichedPayload = {
        schema,
        table,
        commit_timestamp,
        eventType: type,
        errors,
      }
      return {
        ...enrichedPayload,
        ...this._getPayloadRecords(postgresChanges),
      }
    }
    return handledPayload
  }

  /** @internal */
  private _validatePostgresChanges(serverChanges: any[]): any[] {
    const clientBindings = this.bindings.postgres_changes
    if (!clientBindings || clientBindings.length === 0) {
      return []
    }

    return clientBindings.map((clientBinding, index) => {
      const serverChange = serverChanges[index]
      if (!this._isMatchingPostgresBinding(clientBinding, serverChange)) {
        throw new Error(
          'mismatch between server and client bindings for postgres changes'
        )
      }

      return {
        ...clientBinding,
        id: serverChange.id,
      }
    })
  }

  /** @internal */
  private _isMatchingPostgresBinding(
    clientBinding: any,
    serverChange: any
  ): boolean {
    if (!serverChange) return false

    const {
      filter: { event, schema, table, filter },
    } = clientBinding
    return (
      serverChange.event === event &&
      serverChange.schema === schema &&
      serverChange.table === table &&
      serverChange.filter === filter
    )
  }

  /** @internal */
  private _handleSubscriptionError(
    callback: Function | undefined,
    error: Error
  ): void {
    this.unsubscribe()
    this.state = CHANNEL_STATES.errored
    callback?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, error)
  }

  /** @internal */
  _isClosed(): boolean {
    return this.state === CHANNEL_STATES.closed
  }

  /** @internal */
  _isJoined(): boolean {
    return this.state === CHANNEL_STATES.joined
  }

  /** @internal */
  _isJoining(): boolean {
    return this.state === CHANNEL_STATES.joining
  }

  /** @internal */
  _isLeaving(): boolean {
    return this.state === CHANNEL_STATES.leaving
  }

  /** @internal */
  _replyEventName(ref: string): string {
    return `chan_reply_${ref}`
  }

  /** @internal */
  _on(type: string, filter: { [key: string]: any }, callback: Function) {
    const typeLower = type.toLocaleLowerCase()
    const binding = {
      type: typeLower,
      filter: filter,
      callback: callback,
    }

    if (this.bindings[typeLower]) {
      this.bindings[typeLower].push(binding)
    } else {
      this.bindings[typeLower] = [binding]
    }

    return this
  }

  /** @internal */
  _off(type: string, filter: { [key: string]: any }) {
    const typeLower = type.toLocaleLowerCase()

    if (this.bindings[typeLower]) {
      this.bindings[typeLower] = this.bindings[typeLower].filter((bind) => {
        return !(
          bind.type?.toLocaleLowerCase() === typeLower &&
          RealtimeChannel.isEqual(bind.filter, filter)
        )
      })
    }
    return this
  }

  /** @internal */
  private static isEqual(
    obj1: { [key: string]: string },
    obj2: { [key: string]: string }
  ) {
    if (Object.keys(obj1).length !== Object.keys(obj2).length) {
      return false
    }

    for (const k in obj1) {
      if (obj1[k] !== obj2[k]) {
        return false
      }
    }

    return true
  }

  /** @internal */
  private _rejoinUntilConnected() {
    this.rejoinTimer.scheduleTimeout()
    if (this.socket.isConnected()) {
      this._rejoin()
    }
  }

  /**
   * Registers a callback that will be executed when the channel closes.
   *
   * @internal
   */
  private _onClose(callback: Function) {
    this._on(CHANNEL_EVENTS.close, {}, callback)
  }

  /**
   * Registers a callback that will be executed when the channel encounteres an error.
   *
   * @internal
   */
  private _onError(callback: Function) {
    this._on(CHANNEL_EVENTS.error, {}, (reason: string) => callback(reason))
  }

  /**
   * Handles channel errors with consistent state checks and error handling logic
   *
   * @internal
   */
  private _handleChannelError(eventType: string, reason?: any): void {
    if (this._isLeaving() || this._isClosed()) {
      return
    }
    this.socket.log('channel', `${eventType} ${this.topic}`, reason)
    this.state = CHANNEL_STATES.errored
    this.rejoinTimer.scheduleTimeout()
  }

  /**
   * Adds a push event to the buffer with size limits to prevent memory leaks
   *
   * @internal
   */
  private _addToPushBuffer(pushEvent: Push): void {
    // If buffer is at capacity, remove and destroy oldest push
    if (this.pushBuffer.length >= MAX_PUSH_BUFFER_SIZE) {
      const oldestPush = this.pushBuffer.shift()
      oldestPush?.destroy()

      this.socket.log(
        'channel',
        `push buffer full, discarding oldest push for ${this.topic}`
      )
    }

    this.pushBuffer.push(pushEvent)
  }

  /**
   * Returns `true` if the socket is connected and the channel has been joined.
   *
   * @internal
   */
  private _canPush(): boolean {
    return this.socket.isConnected() && this._isJoined()
  }

  /** @internal */
  private _rejoin(timeout = this.timeout): void {
    if (this._isLeaving()) {
      return
    }
    this.socket._leaveOpenTopic(this.topic)
    this.state = CHANNEL_STATES.joining
    this.joinPush.resend(timeout)
  }

  /** @internal */
  private _getPayloadRecords(payload: any) {
    const records = {
      new: {},
      old: {},
    }

    if (payload.type === 'INSERT' || payload.type === 'UPDATE') {
      records.new = Transformers.convertChangeData(
        payload.columns,
        payload.record
      )
    }

    if (payload.type === 'UPDATE' || payload.type === 'DELETE') {
      records.old = Transformers.convertChangeData(
        payload.columns,
        payload.old_record
      )
    }

    return records
  }
}
