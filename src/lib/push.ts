import RealtimeSubscription from '../RealtimeSubscription'
import { GenericObject } from './types'
import { closure } from './utils'

export default class Push {
  payload: () => GenericObject
  receivedResp: {
    status: string
    response: Record<string, string>
  } | null = null
  timeoutTimer: ReturnType<typeof setTimeout> | undefined = undefined
  recHooks: {
    status: string
    callback: Function
  }[] = []
  sent: boolean = false
  ref: string | null = null
  refEvent: string | null = null

  /**
   * Initializes the Push
   *
   * @param channel The Channel
   * @param event The event, for example `"phx_join"`
   * @param payload The payload, for example `{user_id: 123}`
   * @param timeout The push timeout in milliseconds
   */
  constructor(
    public channel: RealtimeSubscription,
    public event: string,
    payload: GenericObject | (() => GenericObject) | undefined,
    public timeout: number
  ) {
    this.payload = closure(payload || {})
  }

  resend(timeout: number): void {
    this.timeout = timeout
    this.reset()
    this.send()
  }

  send(): void {
    if (this._hasReceived('timeout')) {
      return
    }
    this.startTimeout()
    this.sent = true
    this.channel.socket.push({
      topic: this.channel.topic,
      event: this.event,
      payload: this.payload(),
      ref: this.ref,
      join_ref: this.channel.joinRef(),
    })
  }

  updatePayload(payload: GenericObject): void {
    this.payload = closure({ ...this.payload, ...payload })
  }

  receive(status: string, callback: Function): Push {
    if (this._hasReceived(status)) {
      callback(this.receivedResp?.response)
    }

    this.recHooks.push({ status, callback })
    return this
  }

  reset(): void {
    this._cancelRefEvent()
    this.ref = null
    this.refEvent = null
    this.receivedResp = null
    this.sent = false
  }

  startTimeout(): void {
    if (this.timeoutTimer) {
      this._cancelTimeout()
    }
    this.ref = this.channel.socket.makeRef()
    this.refEvent = this.channel.replyEventName(this.ref)

    this.channel.on(
      this.refEvent,
      (payload: { status: string; response: Record<string, string> }) => {
        this._cancelRefEvent()
        this._cancelTimeout()
        this.receivedResp = payload
        this._matchReceive(payload)
      }
    )

    this.timeoutTimer = setTimeout(() => {
      this.trigger('timeout', {})
    }, this.timeout)
  }

  trigger(status: string, response: GenericObject) {
    this.channel.trigger(this.refEvent, { status, response })
  }

  private _cancelRefEvent() {
    if (!this.refEvent) {
      return
    }
    this.channel.off(this.refEvent)
  }

  private _cancelTimeout() {
    this.timeoutTimer && clearTimeout(this.timeoutTimer)
    this.timeoutTimer = undefined
  }

  private _matchReceive({
    status,
    response,
  }: {
    status: string
    response: Record<string, string>
  }) {
    this.recHooks
      .filter((h) => h.status === status)
      .forEach((h) => h.callback(response))
  }

  private _hasReceived(status: string): boolean {
    return !!this.receivedResp && this.receivedResp.status === status
  }
}
