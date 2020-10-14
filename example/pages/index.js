import { useEffect, useState } from 'react'
import {
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_KEY,
} from '../lib/constants'

import { Socket } from '@supabase/realtime-js'

var socket = new Socket(NEXT_PUBLIC_SUPABASE_URL, {
  params: { apikey: NEXT_PUBLIC_SUPABASE_KEY },
})

var publicSchema = socket.channel('realtime:public')

export default function IndexPage() {
  let [inserts, setInserts] = useState([])
  let [updates, setUpdates] = useState([])
  let [deletes, setDeletes] = useState([])
  let [socketStatus, setSocketStatus] = useState('')
  let [channelStatus, setChannelStatus] = useState(publicSchema.state)

  

  useEffect(() => {
    publicSchema.on('INSERT', (e) => setInserts([...inserts, e]))
    publicSchema.on('UPDATE', (e) => setUpdates([...updates, e]))
    publicSchema.on('DELETE', (e) => setDeletes([...deletes, e]))

    // Socket events
    socket.onOpen(() => setSocketStatus('OPEN'))
    socket.onClose(() => setSocketStatus('CLOSED'))
    socket.onError((e) => {
      setSocketStatus('ERROR')
      console.log('Socket error', e.message)
    })

    // Channel events
    publicSchema.onError(() => setChannelStatus('ERROR'))
    publicSchema.onClose(() => setChannelStatus('Closed gracefully.'))
    publicSchema
      .subscribe()
      .receive('ok', () => setChannelStatus('CONNECTED'))
      .receive('error', () => setChannelStatus('FAILED'))
      .receive('timeout', () => setChannelStatus('Timed out, retrying.'))
  }, [])

  socket.connect()

  return (
    <div className="p-2">
      <div className="border-b py-8">
        <h4>SOCKET STATUS: {socketStatus}</h4>
        <h4>CHANNEL STATUS: {channelStatus}</h4>
      </div>
      <div className="w-full h-full flex py-8">
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
    </div>
  )
}
