# Realtime Client

Listens to changes in a PostgreSQL Database and via websockets.

## Usage

This is for usage with Supabase [Realtime](https://github.com/supabase/realtime) server.

#### Creating a Socket connection

You can set up one connection to be used across the whole app.

```js
import { Socket } from '@supabase/realtime-js'

var socket = new Socket(process.env.REALTIME_URL)
socket.connect()
```

**Socket events**

```js
socket.onOpen(() => console.log('Socket opened.'))
socket.onClose(() => console.log('Socket closed.'))
socket.onError((e) => console.log('Socket error', e.message))
```

#### Subscribing to events

You can listen to `INSERT`, `UPDATE`, `DELETE`, or all `*` events.

You can subscribe to events:

- For the whole database: `realtime`
- For a particular schema: `realtime:{SCHEMA}`. eg: `realtime:public`
- For a particular table: `realtime:{SCHEMA}:{TABLE}`. eg: `realtime:public:users`
- For individual columns: `realtime:{SCHEMA}:{TABLE}:{COL}.eq.{VAL}`. eg: `realtime:public:users:id.eq.1`


```js
var publicSchema = socket.channel('realtime:public')
publicSchema.on('*', (e) => console.log(e))
publicSchema.on('INSERT', (e) => console.log(e))
publicSchema.on('UPDATE', (e) => console.log(e))
publicSchema.on('DELETE', (e) => console.log(e))
publicSchema.subscribe()

var usersTable = socket.channel('realtime:public:users')
usersTable.on('*', (e) => console.log(e))
usersTable.on('INSERT', (e) => console.log(e))
usersTable.on('UPDATE', (e) => console.log(e))
usersTable.on('DELETE', (e) => console.log(e))
usersTable.subscribe()
```

**Subscription events**

```js

publicSchema
  .subscribe()
  .receive('ok', () => console.log('Connected.'))
  .receive('error', () => console.log('Failed.'))
  .receive('timeout', () => console.log('Timed out, retrying.'))

```



## Credits

- Original Node.js client was made by Mario Campa of [phoenix-channels](github.com/mcampa/phoenix-client).
- API was made by authors of the [Phoenix Framework](http://www.phoenixframework.org/). See their website for complete list of authors.

## License

MIT. License is the same as [phoenix-channels](https://github.com/mcampa/phoenix-client) and [Phoenix Framework](https://phoenixframework.org/).

