// We'll use importScripts to load the Supabase client from a CDN
importScripts(
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/dist/umd/supabase.min.js'
)

let supabaseClient
let channel
let local_channelId

self.onmessage = async (event) => {
  if (event.data.type === 'init') {
    const { supabaseUrl, supabaseKey, channelId } = event.data

    // Create the Supabase client
    supabaseClient = supabase.createClient(supabaseUrl, supabaseKey)

    // Create and subscribe to the channel
    channel = supabaseClient.channel(channelId)
    local_channelId = channelId

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Worker: Subscribed to the channel!')
        startOperations()
      }
    })
  }
}

function startOperations() {
  // Start sending heartbeats every 30 seconds
  setInterval(sendHeartbeat, 30000)

  // Start sending messages every 2 seconds
  setInterval(sendChannelMessage, 10000)
}

function sendHeartbeat() {
  const heartbeatPayload = {
    event: 'heartbeat',
    topic: local_channelId,
    payload: {},
    ref: Date.now().toString(),
  }

  if (channel) {
    channel.send(heartbeatPayload)
    console.log('Heartbeat sent', heartbeatPayload)
  } else {
    console.error('Supabase client or realtime not initialized')
  }
}

function sendChannelMessage() {
  channel.send({
    type: 'broadcast',
    event: 'message',
    payload: {
      text: 'Hello from Web Worker!',
      timestamp: new Date().toISOString(),
    },
  })
  console.log('Channel message sent')
}
