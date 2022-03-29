import { OutgoingHttpHeaders } from 'http'

export type Decode = (msg: ArrayBuffer | string, callback: Function) => any

export type Encode = (msg: Message, callback: Function) => any

export type GenericObject = Record<string, string>

export type Message = {
  payload: ChangePayload | GenericObject | ArrayBuffer
  topic: string
  event: string
  ref: string | null
  join_ref?: string
}

export type ReAfterMs = (tries: number) => number

export type VSN = '1.0.0' | '2.0.0'

export type Options = {
  encode?: Encode
  decode?: Decode
  timeout?: number
  heartbeatIntervalMs?: number
  reconnectAfterMs?: ReAfterMs
  rejoinAfterMs?: ReAfterMs
  logger?: (kind: string, msg: string, data: GenericObject) => any
  params?: GenericObject | (() => GenericObject)
  vsn?: VSN
  headers?: OutgoingHttpHeaders
}

export type ChangePayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  commit_timestamp: string
  schema: string
  table: string
  columns: Column[]
  errors: string[] | null
  record?: Record<string, unknown>
  old_record?: Record<string, unknown>
}

type Column = {
  name: string
  type: string
  flags?: ['key'] | []
  type_modifier?: number
}
