import { useState } from 'react'
import {
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_KEY,
} from '../lib/constants'

import { Socket } from '@supabase/realtime-js'

var socket = new Socket(NEXT_PUBLIC_SUPABASE_URL, {
  params: { apikey: NEXT_PUBLIC_SUPABASE_KEY },
})
socket.connect()

socket.onOpen(() => console.log('Socket opened.'))
socket.onClose(() => console.log('Socket closed.'))
socket.onError((e) => console.log('Socket error', e.message))

export default function IndexPage() {
  let [inserts, setInserts] = useState([])
  let [updates, setUpdates] = useState([])
  let [deletes, setDeletes] = useState([])

  var publicSchema = socket.channel('realtime:public')
  publicSchema.on('INSERT', (e) => setInserts([...inserts, e]))
  publicSchema.on('UPDATE', (e) => setUpdates([...updates, e]))
  publicSchema.on('DELETE', (e) => setDeletes([...deletes, e]))
  publicSchema
    .subscribe()
    .receive('ok', () => console.log('Connected.'))
    .receive('error', () => console.log('Failed.'))
    .receive('timeout', () => console.log('Timed out, retrying.'))

  return (
    <div className="w-full h-full flex">
      <div className="col w-1/3">
        <div>
          <h3 className="font-mono">INSERTS</h3>
          {inserts.map((x) => (
            <pre
              key={x.commit_timestamp}
              className="text-xs overflow-scroll border border-black rounded-md m-2 p-2"
              style={{ maxHeight: 200 }}
            >
              {JSON.stringify(x, null, 2)}
            </pre>
          ))}
        </div>
      </div>
      <div className="col w-1/3">
        <div>
          <h3 className="font-mono">UPDATES</h3>
          {updates.map((x) => (
            <pre
              key={x.commit_timestamp}
              className="text-xs overflow-scroll border border-black rounded-md m-2 p-2"
              style={{ maxHeight: 200 }}
            >
              {JSON.stringify(x, null, 2)}
            </pre>
          ))}
        </div>
      </div>
      <div className="col w-1/3">
        <div>
          <h3 className="font-mono">DELETES</h3>
          {deletes.map((x) => (
            <pre
              key={x.commit_timestamp}
              className="text-xs overflow-scroll border border-black rounded-md m-2 p-2"
              style={{ maxHeight: 200 }}
            >
              {JSON.stringify(x, null, 2)}
            </pre>
          ))}
        </div>
      </div>
    </div>
  )
}
