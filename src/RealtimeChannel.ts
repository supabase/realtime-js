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
    presence?: { key?: string }
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

export type RealtimeChannelSendResponse =
  | 'ok'
  | 'timed out'
  | 'rate limited'
  | 'error'

export enum REALTIME_POSTGRES_CHANGES_LISTEN_EVENT {
  ALL = '*',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export enum REALTIME_LISTEN_TYPES {
  BROADCAST = 'broadcast',
  PRESENCE = 'presence',
  /**
   * listen to Postgres changes.
   */
  POSTGRES_CHANGES = 'postgres_changes',
}

export enum REALTIME_SUBSCRIBE_STATES {
  SUBSCRIBED = 'SUBSCRIBED',
  TIMED_OUT = 'TIMED_OUT',
  CLOSED = 'CLOSED',
  CHANNEL_ERROR = 'CHANNEL_ERROR',
}

/** A channel is the basic building block of Realtime
 * and narrows the scope of data flow to subscribed clients.
 * You can think of a channel as a chatroom where participants are able to see who's online
 * and send and receive messages.
 **/
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
  state = CHANNEL_STATES.closed
  joinedOnce = false
  joinPush: Push
  rejoinTimer: Timer
  pushBuffer: Push[] = []
  presence: RealtimePresence
  broadcastEndpointURL: string
  subTopic: string

  constructor(
    /** Topic name can be any string. */
    public topic: string,
    public params: RealtimeChannelOptions = { config: {} },
    public socket: RealtimeClient
  ) {
    this.subTopic = topic.replace(/^realtime:/i, '')

    this.params.config = {
      ...{
        broadcast: { ack: false, self: false },
        presence: { key: '' },
      },
      ...params.config,
    }
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
    this._onError((reason: string) => {
      if (this._isLeaving() || this._isClosed()) {
        return
      }
      this.socket.log('channel', `error ${this.topic}`, reason)
      this.state = CHANNEL_STATES.errored
      this.rejoinTimer.scheduleTimeout()
    })
    this.joinPush.receive('timeout', () => {
      if (!this._isJoining()) {
        return
      }
      this.socket.log('channel', `timeout ${this.topic}`, this.joinPush.timeout)
      this.state = CHANNEL_STATES.errored
      this.rejoinTimer.scheduleTimeout()
    })
    this._on(CHANNEL_EVENTS.reply, {}, (payload: any, ref: string) => {
      this._trigger(this._replyEventName(ref), payload)
    })

    this.presence = new RealtimePresence(this)

    this.broadcastEndpointURL = this._broadcastEndpointURL()
  }

  /** Subscribe registers your client with the server */
  subscribe(
    callback?: (status: `${REALTIME_SUBSCRIBE_STATES}`, err?: Error) => void,
    timeout = this.timeout
  ): RealtimeChannel {
    if (!this.socket.isConnected()) {
      this.socket.connect()
    }

    if (this.joinedOnce) {
      throw `tried to subscribe multiple times. 'subscribe' can only be called a single time per channel instance`
    } else {
      const {
        config: { broadcast, presence },
      } = this.params
      this._onError((e: Error) => callback && callback('CHANNEL_ERROR', e))
      this._onClose(() => callback && callback('CLOSED'))

      const accessTokenPayload: { access_token?: string } = {}
      const config = {
        broadcast,
        presence,
        postgres_changes:
          this.bindings.postgres_changes?.map((r) => r.filter) ?? [],
      }

      if (this.socket.accessToken) {
        accessTokenPayload.access_token = this.socket.accessToken
      }

      this.updateJoinPayload({ ...{ config }, ...accessTokenPayload })

      this.joinedOnce = true
      this._rejoin(timeout)

      this.joinPush
        .receive(
          'ok',
          ({
            postgres_changes: serverPostgresFilters,
          }: {
            postgres_changes: {
              id: string
              event: string
              schema?: string
              table?: string
              filter?: string
            }[]
          }) => {
            this.socket.accessToken &&
              this.socket.setAuth(this.socket.accessToken)

            if (serverPostgresFilters === undefined) {
              callback && callback('SUBSCRIBED')
              return
            } else {
              const clientPostgresBindings = this.bindings.postgres_changes
              const bindingsLen = clientPostgresBindings?.length ?? 0
              const newPostgresBindings = []

              for (let i = 0; i < bindingsLen; i++) {
                const clientPostgresBinding = clientPostgresBindings[i]
                const {
                  filter: { event, schema, table, filter },
                } = clientPostgresBinding
                const serverPostgresFilter =
                  serverPostgresFilters && serverPostgresFilters[i]

                if (
                  serverPostgresFilter &&
                  serverPostgresFilter.event === event &&
                  serverPostgresFilter.schema === schema &&
                  serverPostgresFilter.table === table &&
                  serverPostgresFilter.filter === filter
                ) {
                  newPostgresBindings.push({
                    ...clientPostgresBinding,
                    id: serverPostgresFilter.id,
                  })
                } else {
                  this.unsubscribe()
                  callback &&
                    callback(
                      'CHANNEL_ERROR',
                      new Error(
                        'mismatch between server and client bindings for postgres changes'
                      )
                    )
                  return
                }
              }

              this.bindings.postgres_changes = newPostgresBindings

              callback && callback('SUBSCRIBED')
              return
            }
          }
        )
        .receive('error', (error: { [key: string]: any }) => {
          callback &&
            callback(
              'CHANNEL_ERROR',
              new Error(
                JSON.stringify(Object.values(error).join(', ') || 'error')
              )
            )
          return
        })
        .receive('timeout', () => {
          callback && callback('TIMED_OUT')
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
   */
  on(
    type: `${REALTIME_LISTEN_TYPES.PRESENCE}`,
    filter: { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.SYNC}` },
    callback: () => void
  ): RealtimeChannel
  on<T extends { [key: string]: any }>(
    type: `${REALTIME_LISTEN_TYPES.PRESENCE}`,
    filter: { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.JOIN}` },
    callback: (payload: RealtimePresenceJoinPayload<T>) => void
  ): RealtimeChannel
  on<T extends { [key: string]: any }>(
    type: `${REALTIME_LISTEN_TYPES.PRESENCE}`,
    filter: { event: `${REALTIME_PRESENCE_LISTEN_EVENTS.LEAVE}` },
    callback: (payload: RealtimePresenceLeavePayload<T>) => void
  ): RealtimeChannel
  on<T extends { [key: string]: any }>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL}`>,
    callback: (payload: RealtimePostgresChangesPayload<T>) => void
  ): RealtimeChannel
  on<T extends { [key: string]: any }>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT}`>,
    callback: (payload: RealtimePostgresInsertPayload<T>) => void
  ): RealtimeChannel
  on<T extends { [key: string]: any }>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.UPDATE}`>,
    callback: (payload: RealtimePostgresUpdatePayload<T>) => void
  ): RealtimeChannel
  on<T extends { [key: string]: any }>(
    type: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`,
    filter: RealtimePostgresChangesFilter<`${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.DELETE}`>,
    callback: (payload: RealtimePostgresDeletePayload<T>) => void
  ): RealtimeChannel
  /**
   * The following is placed here to display on supabase.com/docs/reference/javascript/subscribe.
   * @param type One of "broadcast", "presence", or "postgres_changes".
   * @param filter Custom object specific to the Realtime feature detailing which payloads to receive.
   * @param callback Function to be invoked when event handler is triggered.
   */
  on(
    type: `${REALTIME_LISTEN_TYPES.BROADCAST}`,
    filter: { event: string },
    callback: (payload: {
      type: `${REALTIME_LISTEN_TYPES.BROADCAST}`
      event: string
      [key: string]: any
    }) => void
  ): RealtimeChannel
  on(
    type: `${REALTIME_LISTEN_TYPES}`,
    filter: { event: string; [key: string]: string },
    callback: (payload: any) => void
  ): RealtimeChannel {
    return this._on(type, filter, callback)
  }

  async send(
    payload: { type: string; [key: string]: any },
    opts: { [key: string]: any } = {}
  ): Promise<RealtimeChannelSendResponse> {
    if (!this._canPush() && payload.type === 'broadcast') {
      const { event, payload: endpoint_payload } = payload
      const options = {
        method: 'POST',
        headers: {
          apikey: this.socket.accessToken ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { topic: this.subTopic, event, payload: endpoint_payload },
          ],
        }),
      }

      try {
        const response = await this._fetchWithTimeout(
          this.broadcastEndpointURL,
          options,
          opts.timeout ?? this.timeout
        )

        if (response.ok) {
          return 'ok'
        } else {
          return 'error'
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          return 'timed out'
        } else {
          return 'error'
        }
      }
    } else {
      return new Promise((resolve) => {
        const push = this._push(
          payload.type,
          payload,
          opts.timeout || this.timeout
        )

        if (push.rateLimited) {
          resolve('rate limited')
        }

        if (
          payload.type === 'broadcast' &&
          !this.params?.config?.broadcast?.ack
        ) {
          resolve('ok')
        }

        push.receive('ok', () => resolve('ok'))
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

    this.rejoinTimer.reset()
    // Destroy joinPush to avoid connection timeouts during unscription phase
    this.joinPush.destroy()

    return new Promise((resolve) => {
      const leavePush = new Push(this, CHANNEL_EVENTS.leave, {}, timeout)

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
          resolve('error')
        })

      leavePush.send()

      if (!this._canPush()) {
        leavePush.trigger('ok', {})
      }
    })
  }

  /** @internal */
  _broadcastEndpointURL(): string {
    let url = this.socket.endPoint
    url = url.replace(/^ws/i, 'http')
    url = url.replace(/(\/socket\/websocket|\/socket|\/websocket)\/?$/i, '')
    return url.replace(/\/+$/, '') + '/api/broadcast'
  }

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
      this.pushBuffer.push(pushEvent)
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
    const { close, error, leave, join } = CHANNEL_EVENTS
    const events: string[] = [close, error, leave, join]
    if (ref && events.indexOf(typeLower) >= 0 && ref !== this._joinRef()) {
      return
    }
    let handledPayload = this._onMessage(typeLower, payload, ref)
    if (payload && !handledPayload) {
      throw 'channel onMessage callbacks must return the payload, modified or unmodified'
    }

    if (['insert', 'update', 'delete'].includes(typeLower)) {
      this.bindings.postgres_changes
        ?.filter((bind) => {
          return (
            bind.filter?.event === '*' ||
            bind.filter?.event?.toLocaleLowerCase() === typeLower
          )
        })
        .map((bind) => bind.callback(handledPayload, ref))
    } else {
      this.bindings[typeLower]
        ?.filter((bind) => {
          if (
            ['broadcast', 'presence', 'postgres_changes'].includes(typeLower)
          ) {
            if ('id' in bind) {
              const bindId = bind.id
              const bindEvent = bind.filter?.event
              return (
                bindId &&
                payload.ids?.includes(bindId) &&
                (bindEvent === '*' ||
                  bindEvent?.toLocaleLowerCase() ===
                    payload.data?.type.toLocaleLowerCase())
              )
            } else {
              const bindEvent = bind?.filter?.event?.toLocaleLowerCase()
              return (
                bindEvent === '*' ||
                bindEvent === payload?.event?.toLocaleLowerCase()
              )
            }
          } else {
            return bind.type.toLocaleLowerCase() === typeLower
          }
        })
        .map((bind) => {
          if (typeof handledPayload === 'object' && 'ids' in handledPayload) {
            const postgresChanges = handledPayload.data
            const { schema, table, commit_timestamp, type, errors } =
              postgresChanges
            const enrichedPayload = {
              schema: schema,
              table: table,
              commit_timestamp: commit_timestamp,
              eventType: type,
              new: {},
              old: {},
              errors: errors,
            }
            handledPayload = {
              ...enrichedPayload,
              ...this._getPayloadRecords(postgresChanges),
            }
          }
          bind.callback(handledPayload, ref)
        })
    }
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

    this.bindings[typeLower] = this.bindings[typeLower].filter((bind) => {
      return !(
        bind.type?.toLocaleLowerCase() === typeLower &&
        RealtimeChannel.isEqual(bind.filter, filter)
      )
    })
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
