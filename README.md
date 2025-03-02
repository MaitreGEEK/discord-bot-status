# discord-bot-status  
Simple and fast web app with an API to let your users know if the bot is up or down.  

## Routes  

- `GET /shard/:shardId` → Returns the status of the shard (running or down)  
- `POST /shard/:shardId` → Modifies the status of the shard *Creates the shard if it doesn’t exist*  
- `DELETE /shard/:shardId` → Deletes the shard

- `DELETE /reset` → Resets the database

- `GET /status` → Status page displaying all shards and their states  

- `GET /styles.css` → CSS stylesheet for the website
- `GET /favicon.ico` → icon for the website

## Functionality  

- SQLite database
- Uses `Bun.serve` for the server

- A shard will look like this : 
```
id: its id, for non shards apps it will always be 0
uptime: timestamp from when it was last up
ping: in ms 
status: down or up
last24hpings: an array of objects with all the pings from the last 24h with their timestamp
last24hevents: an array of objects with all the status from the last 24h with their timestamp
server: optional where this shard is hosted
version: this shard version (if your bot has versions enabled it's a good idea to have this so you can know if some shards are in new or old versions)
```

## Files  

- `app.js`  
- `functions.js`  
- `styles.css`  
- `package.json`