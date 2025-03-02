const { Database } = require("bun:sqlite");

function init_database(dbFile) {
    db = new Database(dbFile);
    db.query(`CREATE TABLE IF NOT EXISTS shards (
    id TEXT PRIMARY KEY,
    uptime TEXT DEFAULT NULL,
    update_time TEXT DEFAULT NULL,
    ping INTEGER DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'down',
    last24hpings TEXT DEFAULT '[]',
    last24hevents TEXT DEFAULT '[]',
    server TEXT,
    version TEXT
)`).run();
    return true
}

function updateShard(shard) {
    try {
        if (!db) return false
        if (!shard?.id) return false;
        let existingShard = getShard(shard.id);
        let currentTime = Date.now()

        if (!existingShard) {
            db.query(`INSERT INTO shards (id, uptime, ping, status, last24hpings, last24hevents, server, version, update_time) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(
                    shard.id,
                    shard.status === 'up' ? Date.now() : null,
                    shard.ping || null,
                    shard.status || 'down',
                    JSON.stringify(shard.last24hpings || []),
                    JSON.stringify(shard.last24hevents || []),
                    shard.server || null,
                    shard.version || null,
                    currentTime
                );
            return true;
        }

        let query = `UPDATE shards SET `;
        let updates = [];
        let values = [];

        if (shard.status === 'up') {
            updates.push(`status = "up"`);
            updates.push(`ping = ?`);
            shard.ping = shard.ping == 0 ? 0 : shard.ping || null
            values.push(shard.ping);

            updates.push(`last24hpings = json_insert(last24hpings, "$[#]", json_object('t', ?, 'ping', ?))`);
            values.push(currentTime, shard.ping);

            updates.push(`last24hevents = json_insert(last24hevents, "$[#]", json_object('t', ?, 'event', "up"))`);
            values.push(currentTime);

            updates.push(`uptime = CASE WHEN uptime IS NULL THEN ? ELSE uptime END`);
            values.push(Date.now());
        } else {
            updates.push(`status = "down"`);
            updates.push(`ping = NULL`);
            updates.push(`uptime = NULL`);

            updates.push(`last24hevents = json_insert(last24hevents, "$[#]", json_object('t', ?, 'event', "down"))`);
            values.push(currentTime);
        }

        if (shard.server) {
            updates.push(`server = ?`);
            values.push(shard.server);
        }

        if (shard.version) {
            updates.push(`version = ?`);
            values.push(shard.version);
        }

        updates.push(`update_time = ?`);
        values.push(currentTime);

        values.push(shard.id);

        db.query(`${query} ${updates.join(', ')} WHERE id = ?`).run(...values);
        return true;
    } catch (error) {
        promisifiedError("Error while updating shard", error);
        return false;
    }
}


function getAllShards() {
    if (!db) return null
    try {
        return db.query('SELECT * FROM shards').all();
    } catch (error) {
        promisifiedError("Error while getting all shards", error);
        return null
    }
}

function getShard(id) {
    if (!db) return null
    try {
        return db.query('SELECT * FROM shards WHERE id = ?').get(id);
    } catch (error) {
        promisifiedError("Error while getting shard", error);
        return null
    }
}

function deleteShard(id) {
    if (!db) return false

    try {
        db.query('DELETE FROM shards WHERE id = ?').run(id);
        return true;
    } catch (error) {
        promisifiedError("Error while deleting shard", error);
        return false
    }
}

/**
 * **Reset the database by removing all elements**
 * @returns {Boolean} Wether the database is successfully removed or not
 */
function resetDatabase() {
    if (!db) return false
    try {
        db.query('DELETE FROM shards').run();
        return true;
    } catch (error) {
        promisifiedError("Error while reseting database", error);
        return false
    }
}

function routineCheckShards(responsePeriod) {
    if (!db) return false
    try {
        let now = Date.now()
        db.query(`UPDATE shards SET status = 'down', uptime_time=NULL,ping=NULL,last24hevents = json_insert(last24hevents, "$[#]", json_object('t', ?, 'event', "down")) WHERE update_time IS NOT NULL AND strftime('%s', ?) - strftime('%s', update_time) > ?`)
            .run(now, now, responsePeriod);
        return true
    } catch (error) {
        promisifiedError("Error while doing the routine check shards", error);
        return false
    }
}

const statusEmoji = { "down": "❌", "up": "🟢" }
async function getStatusShards() {
    if (!db) return null
    let shards = getAllShards()

    if (!shards?.length) return ["No shards listed... Start sending data to the api via the /shard endpoint!"]

    let message = (await Promise.all(shards.map(async shard => {
        if (!shard) return ""
        shard.url = new URL(shard.url)
        shard.last24hpings = JSON.parse(shard.last24hpings).map(i => i.ping);
        return `\`v${shard.version}\` - [${shard.url.hostname}](${shard.url}) &nbsp; **status:** ${statusEmoji[shard.status || 'down']} ${shard.status == "up" ? `**up:** \`${!!shard.uptime ? await formatUptime(Math.floor((Date.now() - cobalt.uptime) / 1000)) : 'none'}\` **ping:** \`${cobalt.ping}ms\` **24h average ping:** \`${average(cobalt.last24hpings)}ms\`` : ""}`

    })))

    return message
}

async function promisifiedLog(...args) {
    return new Promise(async (resolve) => {
        console.log(await date(), ...args);
        resolve();
    });
}

async function promisifiedError(...args) {
    return new Promise(async (resolve) => {
        console.error(await date(), ...args);
        resolve();
    });
}
async function date() {
    let d = new Date();
    let pad = num => num.toString().padStart(2, '0');

    let date = `${d.getFullYear()}-${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
    let time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    let fullDate = `[${date}||${time}]`;

    return fullDate;
}

module.exports = {
    promisifiedError,
    promisifiedLog,
    init_database,
    updateShard,
    getAllShards,
    getShard,
    deleteShard,
    resetDatabase,
    routineCheckShards,
    getStatusShards
}