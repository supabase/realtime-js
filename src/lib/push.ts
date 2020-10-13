import { DEFAULT_TIMEOUT } from './constants'
import Channel from '../channel'

export default class Push {
  sent: boolean = false
  timeoutTimer: number | undefined = undefined
  ref: string = ''
  receivedResp: {
    status: string
    response: Function
  } | null = null
  recHooks: {
    status: string
    callback: Function
  }[] = []
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
    public channel: Channel,
    public event: string,
    public payload: any = {},
    public timeout: number = DEFAULT_TIMEOUT
  ) {}

  resend(timeout: number) {
    this.timeout = timeout
    this.cancelRefEvent()
    this.ref = ''
    this.refEvent = null
    this.receivedResp = null
    this.sent = false
    this.send()
  }

  send() {
    if (this.hasReceived('timeout')) {
      return
    }
    this.startTimeout()
    this.sent = true
    this.channel.socket.push({
      topic: this.channel.topic,
      event: this.event,
      payload: this.payload,
      ref: this.ref,
    })
  }

  receive(status: string, callback: Function) {
    if (this.hasReceived(status)) {
      callback(this.receivedResp?.response)
    }

    this.recHooks.push({ status, callback })
    return this
  }

  // private

  matchReceive({ status, response }: { status: string; response: Function }) {
    this.recHooks
      .filter((h) => h.status === status)
      .forEach((h) => h.callback(response))
  }

  cancelRefEvent() {
    if (!this.refEvent) {
      return
    }
    this.channel.off(this.refEvent)
  }

  cancelTimeout() {
    clearTimeout(this.timeoutTimer)
    this.timeoutTimer = undefined
  }

  startTimeout() {
    if (this.timeoutTimer) {
      return
    }
    this.ref = this.channel.socket.makeRef()
    this.refEvent = this.channel.replyEventName(this.ref)

    this.channel.on(this.refEvent, (payload: any) => {
      this.cancelRefEvent()
      this.cancelTimeout()
      this.receivedResp = payload
      this.matchReceive(payload)
    })

    this.timeoutTimer = <any>setTimeout(() => {
      this.trigger('timeout', {})
    }, this.timeout)
  }

  hasReceived(status: string) {
    return this.receivedResp && this.receivedResp.status === status
  }

  trigger(status: string, response: any) {
    if (this.refEvent) this.channel.trigger(this.refEvent, { status, response })
  }
}
