# Realtime Client

Listens to changes in a PostgreSQL Database and broadcasts them over websockets.

# Usage

This is for usage with Supabase Realtime server.

Basic usage:

```js
import { Socket } from '@supabase/realtime-js'

var socket = new Socket(process.env.REALTIME_URL)
socket.connect()

// Listen to only INSERTS on the 'users' table in the 'public' schema
var allChanges = this.socket.channel('realtime:public:users')
  .on('INSERT', payload => { console.log('Update received!', payload) })
  .subscribe()

// Listen to all changes from the 'public' schema
var allChanges = this.socket.channel('realtime:public')
  .on('*', payload => { console.log('Update received!', payload) })
  .subscribe()

// Listen to all changes in the database
let allChanges = this.socket.channel('realtime:*')
  .on('*', payload => { console.log('Update received!', payload) })
  .subscribe()
```

See full instructions this repository: [Supabase Realtime](https://github.com/supabase/realtime).

# Credits

- Original Node.js client was made by Mario Campa of [phoenix-channels](github.com/mcampa/phoenix-client).
- API was made by authors of the [Phoenix Framework](http://www.phoenixframework.org/). See their website for complete list of authors.

# License

MIT. License is the same as [phoenix-channels](https://github.com/mcampa/phoenix-client) and [Phoenix Framework](https://phoenixframework.org/).

