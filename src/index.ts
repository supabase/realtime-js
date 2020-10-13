/**
 * 
Phoenix Channels JavaScript client

## Socket Connection

A single connection is established to the server and
channels are multiplexed over the connection.
Connect to the server using the `Socket` class:

    let socket = new Socket("/socket", {params: {userToken: "123"}})
    socket.connect()

The `Socket` constructor takes the mount point of the socket,
the authentication params, as well as options that can be found in
the Socket docs, such as configuring the heartbeat.

## Channels

Channels are isolated, concurrent processes on the server that
subscribe to topics and broker events between the client and server.
To join a channel, you must provide the topic, and channel params for
authorization. Here's an example chat room example where `"new_msg"`
events are listened for, messages are pushed to the server, and
the channel is joined with ok/error/timeout matches:

    let channel = socket.channel("room:123", {token: roomToken})
    channel.on("new_msg", msg => console.log("Got message", msg) )
    $input.onEnter( e => {
      channel.push("new_msg", {body: e.target.val}, 10000)
       .receive("ok", (msg) => console.log("created message", msg) )
       .receive("error", (reasons) => console.log("create failed", reasons) )
       .receive("timeout", () => console.log("Networking issue...") )
    })
    channel.join()
      .receive("ok", ({messages}) => console.log("catching up", messages) )
      .receive("error", ({reason}) => console.log("failed join", reason) )
      .receive("timeout", () => console.log("Networking issue. Still waiting...") )


## Joining

Creating a channel with `socket.channel(topic, params)`, binds the params to
`channel.params`, which are sent up on `channel.join()`.
Subsequent rejoins will send up the modified params for
updating authorization params, or passing up last_message_id information.
Successful joins receive an "ok" status, while unsuccessful joins
receive "error".

## Duplicate Join Subscriptions

While the client may join any number of topics on any number of channels,
the client may only hold a single subscription for each unique topic at any
given time. When attempting to create a duplicate subscription,
the server will close the existing channel, log a warning, and
spawn a new channel for the topic. The client will have their
`channel.onClose` callbacks fired for the existing channel, and the new
channel join will have its receive hooks processed as normal.

## Pushing Messages

From the previous example, we can see that pushing messages to the server
can be done with `channel.push(eventName, payload)` and we can optionally
receive responses from the push. Additionally, we can use
`receive("timeout", callback)` to abort waiting for our other `receive` hooks
 and take action after some period of waiting. The default timeout is 5000ms.


## Socket Hooks

Lifecycle events of the multiplexed connection can be hooked into via
`socket.onError()` and `socket.onClose()` events, ie:

    socket.onError( () => console.log("there was an error with the connection!") )
    socket.onClose( () => console.log("the connection dropped") )


## Channel Hooks

For each joined channel, you can bind to `onError` and `onClose` events
to monitor the channel lifecycle, ie:

    channel.onError( () => console.log("there was an error!") )
    channel.onClose( () => console.log("the channel has gone away gracefully") )

### onError hooks

`onError` hooks are invoked if the socket connection drops, or the channel
crashes on the server. In either case, a channel rejoin is attempted
automatically in an exponential backoff manner.

### onClose hooks

`onClose` hooks are invoked only in two cases. 1) the channel explicitly
closed on the server, or 2). The client explicitly closed, by calling
`channel.leave()`


## Presence

The `Presence` object provides features for syncing presence information
from the server with the client and handling presences joining and leaving.

### Syncing initial state from the server

`Presence.syncState` is used to sync the list of presences on the server
with the client's state. An optional `onJoin` and `onLeave` callback can
be provided to react to changes in the client's local presences across
disconnects and reconnects with the server.

`Presence.syncDiff` is used to sync a diff of presence join and leave
events from the server, as they happen. Like `syncState`, `syncDiff`
accepts optional `onJoin` and `onLeave` callbacks to react to a user
joining or leaving from a device.

*/

export { default as Channel } from './channel'
export { default as Socket } from './socket'
