import { closure } from './lib/utils'
import { CHANNEL_EVENTS, CHANNEL_STATES } from './lib/constants'
import Push from './lib/push'
import Timer from './lib/timer'
import RealtimeClient from './RealtimeClient'
import { ChangeRecord, GenericObject, Message } from './lib/types'

export default class RealtimeSubscription {
  state: CHANNEL_EVENTS[keyof CHANNEL_EVENTS] = CHANNEL_STATES.closed
  bindings: { event: string; ref: number; callback: Function }[] = []
  bindingRef: number = 0
  timeout: number
  joinedOnce = false
  joinPush: Push
  rejoinTimer: Timer
  pushBuffer: Push[] = []
  stateChangeRefs: string[] = []

  constructor(
    public topic: string,
    public params: GenericObject | (() => GenericObject),
    public socket: RealtimeClient
  ) {
    this.params = closure(params)
    this.timeout = this.socket.timeout
    this.joinPush = new Push(
      this,
      CHANNEL_EVENTS.join,
      this.params(),
      this.timeout
    )
    this.rejoinTimer = new Timer(() => {
      if (this.socket.isConnected()) {
        this.rejoin()
      }
    }, this.socket.rejoinAfterMs)
    this.stateChangeRefs.push(
      this.socket.onError(() => this.rejoinTimer.reset())
    )
    this.stateChangeRefs.push(
      this.socket.onOpen(() => {
        this.rejoinTimer.reset()
        if (this.isErrored()) {
          this.rejoin()
        }
      })
    )
    this.joinPush.receive('ok', () => {
      this.state = CHANNEL_STATES.joined
      this.rejoinTimer.reset()
      this.pushBuffer.forEach((pushEvent: Push) => pushEvent.send())
      this.pushBuffer = []
    })
    this.onClose(() => {
      this.rejoinTimer.reset()
      this.socket.log('channel', `close ${this.topic} ${this.joinRef()}`)
      this.state = CHANNEL_STATES.closed
      this.socket.remove(this)
    })
    this.onError((reason: string) => {
      this.socket.log('channel', `error ${this.topic}`, reason)
      if (this.isJoining()) {
        this.joinPush.reset()
      }
      this.state = CHANNEL_STATES.errored
      if (this.socket.isConnected()) {
        this.rejoinTimer.scheduleTimeout()
      }
    })
    this.joinPush.receive('timeout', () => {
      this.socket.log(
        'channel',
        `timeout ${this.topic} (${this.joinRef()})`,
        this.joinPush.timeout
      )
      const leavePush = new Push(
        this,
        CHANNEL_EVENTS.leave,
        closure({}),
        this.timeout
      )
      leavePush.send()
      this.state = CHANNEL_STATES.errored
      this.joinPush.reset()
      if (this.socket.isConnected()) {
        this.rejoinTimer.scheduleTimeout()
      }
    })
    this.on(CHANNEL_EVENTS.reply, (payload: Message, ref: string) => {
      this.trigger(this.replyEventName(ref), payload)
    })
  }

  /**
   * Joins the channel
   */
  subscribe(timeout: number = this.timeout): Push {
    if (this.joinedOnce) {
      throw new Error(
        "tried to join multiple times. 'subscribe' can only be called a single time per channel instance"
      )
    } else {
      this.timeout = timeout
      this.joinedOnce = true
      this.rejoin()
      return this.joinPush
    }
  }

  /**
   * Hook into channel close
   */
  onClose(callback: Function): void {
    this.on(CHANNEL_EVENTS.close, callback)
  }

  /**
   * Hook into channel errors
   */
  onError(callback: Function): void {
    this.on(CHANNEL_EVENTS.error, (reason: string) => callback(reason))
  }

  /**
   * Subscribes on channel events
   *
   * Subscription returns a ref counter, which can be used later to
   * unsubscribe the exact event listener
   *
   * @example
   * const ref1 = channel.on("event", do_stuff)
   * const ref2 = channel.on("event", do_other_stuff)
   * channel.off("event", ref1)
   * // Since unsubscription, do_stuff won't fire,
   * // while do_other_stuff will keep firing on the "event"
   */
  on(event: string, callback: Function): number {
    const ref = this.bindingRef++
    this.bindings.push({ event, ref, callback })
    return ref
  }

  /**
   * Unsubscribes off of channel events
   *
   * Use the ref returned from a channel.on() to unsubscribe one
   * handler, or pass nothing for the ref to unsubscribe all
   * handlers for the given event.
   *
   * @example
   * // Unsubscribe the do_stuff handler
   * const ref1 = channel.on("event", do_stuff)
   * channel.off("event", ref1)
   *
   * // Unsubscribe all handlers from event
   * channel.off("event")
   */
  off(event: string, ref: number | undefined): void {
    this.bindings = this.bindings.filter((bind) => {
      return !(
        bind.event === event &&
        (typeof ref === 'undefined' || ref === bind.ref)
      )
    })
  }

  /**
   * Sends a message `event` to phoenix with the payload `payload`.
   * Phoenix receives this in the `handle_in(event, payload, socket)`
   * function. if phoenix replies or it times out (default 10000ms),
   * then optionally the reply can be received.
   *
   * @example
   * channel.push("event")
   *   .receive("ok", payload => console.log("phoenix replied:", payload))
   *   .receive("error", err => console.log("phoenix errored", err))
   *   .receive("timeout", () => console.log("timed out pushing"))
   */
  push(
    event: CHANNEL_EVENTS,
    payload: GenericObject,
    timeout: number = this.timeout
  ): Push {
    if (!this.joinedOnce) {
      throw new Error(
        `tried to push '${event}' to '${this.topic}' before joining. Use channel.subscribe() before pushing events`
      )
    }
    const pushEvent = new Push(this, event, closure(payload || {}), timeout)
    if (this.canPush()) {
      pushEvent.send()
    } else {
      pushEvent.startTimeout()
      this.pushBuffer.push(pushEvent)
    }

    return pushEvent
  }

  /** Leaves the channel
   *
   * Unsubscribes from server events, and
   * instructs channel to terminate on server
   *
   * Triggers onClose() hooks
   *
   * To receive leave acknowledgements, use the `receive`
   * hook to bind to the server ack, ie:
   *
   * @example
   * channel.unsubscribe().receive("ok", () => alert("left!") )
   */
  unsubscribe(timeout: number = this.timeout): Push {
    this.rejoinTimer.reset()
    this.joinPush.cancelTimeout()

    this.state = CHANNEL_STATES.leaving
    const onClose = () => {
      this.socket.log('channel', `leave ${this.topic}`)
      this.trigger(CHANNEL_EVENTS.close, 'leave')
    }
    let leavePush = new Push(this, CHANNEL_EVENTS.leave, closure({}), timeout)
    leavePush.receive('ok', () => onClose()).receive('timeout', () => onClose())
    leavePush.send()
    if (!this.canPush()) {
      leavePush.trigger('ok', {})
    }

    return leavePush
  }

  /**
   * Overridable message hook
   *
   * Receives all events for specialized message handling
   * before dispatching to the channel callbacks.
   *
   * Must return the payload, modified or unmodified
   */
  onMessage(
    _event: string,
    payload?: GenericObject,
    _ref?: string,
    _joinRef?: string
  ) {
    return payload
  }

  isMember(
    topic: string,
    event: string,
    payload: GenericObject,
    joinRef: string
  ) {
    if (this.topic !== topic) {
      return false
    }

    if (joinRef && joinRef !== this.joinRef()) {
      this.socket.log('channel', 'dropping outdated message', {
        topic,
        event,
        payload,
        joinRef,
      })
      return false
    } else {
      return true
    }
  }

  trigger(
    event: string,
    payload?: GenericObject,
    ref?: string,
    joinRef?: string
  ) {
    const handledPayload = this.onMessage(event, payload, ref, joinRef)
    if (payload && !handledPayload) {
      throw new Error(
        'channel onMessage callbacks must return the payload, modified or unmodified'
      )
    }

    this.bindings
      .filter((bind) => {
        // Bind INSERT, UPDATE, and DELETE events if wildcard is specified
        if (bind.event === '*') {
          return event === (payload as ChangeRecord)?.type
        } else {
          return event === bind.event
        }
      })
      .forEach((bind) =>
        bind.callback(handledPayload, ref, joinRef || this.joinRef())
      )
  }

  replyEventName(ref: string): string {
    return `chan_reply_${ref}`
  }

  isClosed(): boolean {
    return this.state === CHANNEL_STATES.closed
  }

  isErrored(): boolean {
    return this.state === CHANNEL_STATES.errored
  }

  isJoined(): boolean {
    return this.state === CHANNEL_STATES.joined
  }

  isJoining(): boolean {
    return this.state === CHANNEL_STATES.joining
  }

  isLeaving(): boolean {
    return this.state === CHANNEL_STATES.leaving
  }

  updateJoinPayload(payload: GenericObject): void {
    this.joinPush.updatePayload(payload)
  }

  joinRef(): string | null {
    return this.joinPush.ref
  }

  private canPush(): boolean {
    return this.socket.isConnected() && this.isJoined()
  }

  private rejoin(timeout: number = this.timeout) {
    if (this.isLeaving()) {
      return
    }
    this.socket.leaveOpenTopic(this.topic)
    this.state = CHANNEL_STATES.joining
    this.joinPush.resend(timeout)
  }
}
