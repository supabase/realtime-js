
import { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_KEY } from '../lib/constants'

import { Socket } from '@supabase/realtime-js'

var socket = new Socket(NEXT_PUBLIC_SUPABASE_URL, {
  params: { apikey: NEXT_PUBLIC_SUPABASE_KEY },
})

socket.onOpen(() => console.log('Socket opened.'))
socket.onClose(() => console.log('Socket closed.'))
socket.onError(e => console.log('Socket error', e.m))

// Listen to only INSERTS on the 'users' table in the 'public' schema
var userInserts = socket
  .channel('realtime:public:users')
  .subscribe()
  // .on('INSERT', (payload) => {
  //   console.log('Update received!', payload)
  // })

// // Listen to all changes from the 'public' schema
// var allChanges = socket
//   .channel('realtime:public')
//   .join()
//   .on('*', (payload) => {
//     console.log('Update received!', payload)
//   })


export default function IndexPage() {
  socket.connect()
  // console.log('userInserts', userInserts)

  return <div className="w-full h-full bg-gray-300"></div>
}
