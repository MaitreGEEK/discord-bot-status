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
        if (!shard?.id && shard.id != 0) return false;
        let existingShard = getShard(shard.id);
        let currentTime = Date.now()
        shard.ping = shard.ping == 0 ? 0 : shard.ping || null

        if (!existingShard) {
            db.query(`INSERT INTO shards (id, uptime, ping, status, last24hpings, last24hevents, server, version, update_time) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(
                    shard.id,
                    shard.status === 'up' ? Date.now() : null,
                    shard.ping,
                    shard.status || 'down',
                    JSON.stringify(shard.last24hpings || [{ "t": currentTime, "ping": shard.ping }]),
                    JSON.stringify(shard.last24hevents || [{ "t": currentTime, "event": shard.status || 'down' }]),
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
            values.push(shard.ping);

            updates.push(`last24hpings = json_insert(last24hpings, "$[#]", json_object('t', ?, 'ping', ?))`);
            values.push(currentTime, shard.ping);

            updates.push(`last24hevents = json_insert(last24hevents, "$[#]", json_object('t', ?, 'event', "up"))`);
            values.push(currentTime);

            updates.push(`uptime = CASE WHEN uptime IS NULL THEN ? ELSE uptime END,update_time=?`);
            values.push(Date.now(), Date.now());
        } else {
            updates.push(`status = "down"`);
            updates.push(`ping = NULL`);
            updates.push(`uptime = NULL`);
            updates.push(`update_time = NULL`);

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

const filterRecentData = (data) => {
    return data.filter(i => i.t >= Date.now() - 24 * 60 * 60 * 1000);
}

async function checkTimeForAllshards() {
    if (!db) return false;
    try {
        let shards = db.query('SELECT id, last24hpings, last24hevents FROM shards').all();

        if (!shards?.length) return false;

        let updatePings = [];
        let updateEvents = [];
        let paramsPings = [];
        let paramsEvents = [];
        let ids = [];

        // Construire les valeurs pour chaque shard
        shards.forEach((shard) => {
            let last24hpings = JSON.parse(shard.last24hpings || '[]');
            let last24hevents = JSON.parse(shard.last24hevents || '[]');

            last24hpings = filterRecentData(last24hpings);
            last24hevents = filterRecentData(last24hevents);

            updatePings.push(`WHEN ? THEN ?`);
            updateEvents.push(`WHEN ? THEN ?`);

            paramsPings.push(shard.id, JSON.stringify(last24hpings));
            paramsEvents.push(shard.id, JSON.stringify(last24hevents));

            ids.push(shard.id);
        });

        let query = `
            UPDATE shards
            SET 
                last24hpings = CASE id ${updatePings.join(' ')} ELSE last24hpings END,
                last24hevents = CASE id ${updateEvents.join(' ')} ELSE last24hevents END
            WHERE id IN (${ids.map(() => '?').join(', ')})
        `;

        db.query(query).run(...paramsPings, ...paramsEvents, ...ids);
        return true;
    } catch (e) {
        promisifiedLog("Error while updating 24h arrays", e);
        return false;
    }
}



function routineCheckShards(responsePeriod) {
    if (!db) return false
    try {
        let now = Date.now();
        db.query(`
                UPDATE shards 
                SET status = 'down', 
                    uptime = NULL, 
                    update_time = NULL, 
                    ping = NULL, 
                    last24hevents = json_insert(last24hevents, "$[#]", json_object('t', ?, 'event', "down"))
                WHERE update_time IS NOT NULL 
                    AND (? - update_time) > ?
                `)
            .run(now, now, responsePeriod * 1000);
        return true
    } catch (error) {
        promisifiedError("Error while doing the routine check shards", error);
        return false
    }
}

function sanitizeSQL(str) {
    if (typeof str !== 'string') {
        return str;
    }
    // Liste des caractères à échapper
    return str
        .replace(/\\/g, '\\\\')  // échappe les barres obliques inverses
        .replace(/'/g, "''")      // échappe les apostrophes
        .replace(/"/g, '\\"')     // échappe les guillemets
        .replace(/;/g, '\\;')     // échappe les points-virgules
        .replace(/--/g, '\\--')   // échappe les commentaires SQL
        .replace(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|--|ALTER|CREATE|TRUNCATE|REPLACE)\b/gi, ''); // Élimine les mots-clés SQL
}

const statusEmoji = { "down": "❌", "up": "🟢" }
async function getStatusShards() {
    if (!db) return null
    try {
        let shards = getAllShards()

        if (!shards?.length) return ["No shards listed... Start sending data to the api via the /shard endpoint!"]

        if (shards.length == 1) return [(await getShardStatus(shards[0], true))]

        shards.sort((a, b) => a.id - b.id);

        return (await Promise.all(shards.map(async shard => {
            return getShardStatus(shard)
        })))
    }
    catch (e) {
        promisifiedError("Error while gettting shard status", e)
        return null
    }
}

function average(numbers) {
    if (!numbers?.length && !Array.isArray(numbers)) return 0;  // Prévenir la division par zéro
    return Math.floor(numbers.reduce((acc, num) => acc + num, 0) / numbers.length);
}

async function formatUptime(seconds) {
    if (!seconds && seconds != 0) return ""
    let days = Math.floor(seconds / 86400);
    seconds %= 86400;
    let hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    let minutes = Math.floor(seconds / 60);
    seconds %= 60
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

async function getShardStatus(shard, solo = false) {
    try {
        if (!shard?.id && shard.id != 0) return ""
        shard.last24hpings = JSON.parse(shard.last24hpings).map(i => i.ping);
        shard.name = solo ? "Bot Status" : `Shard ${shard.id}`

        return `\`v${shard.version}\` - ${shard.name} &nbsp; **status:** ${statusEmoji[shard.status || 'down']} ${shard.status == "up" ? `**up:** \`${!!shard.uptime ? await formatUptime(Math.floor((Date.now() - shard.uptime) / 1000)) : 'none'}\` **ping:** \`${shard.ping}ms\` **24h average ping:** \`${average(shard.last24hpings)}ms\`` : ""}`
    }
    catch (e) {
        promisifiedError("Error while getting shard status", e)
        return ""
    }
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

async function updateShards(shards) {
    try {
        if (!db) return false;

        await Promise.all(shards.map(shard => {
            if (!shard) return
            else return updateShard(shard)
        }))

        return true
    } catch (error) {
        promisifiedError("Error while updating shards", error);
        return false;
    }
}

async function getStatusPageHtml(shards, T, metadata = "") {
    let shardsHtml;
    if (!shards?.length) shardsHtml = "<p>No shards listed... Start sending data to the api via the /shard endpoint!</p>"
    else {
        if (shards.length == 1) shardsHtml = await getShardStatusHtml(shards[0], T, true)
        shards.sort((a, b) => a.id - b.id);

        shardsHtml = (await Promise.all(shards.map(async (shard) => {
            let shardHtml = await getShardStatusHtml(shard, T)
            return shardHtml
        }))).join("");
    }


    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="author" content="MaitreGEEK">          
          ${metadata}
          <link rel="stylesheet" href="./styles.css">
          <link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@300;400;700&display=swap" rel="stylesheet">
          <link rel="icon" href="./favicon.ico">
          <title>Bot Status</title>
        </head>
        <body>
          <div id="content">
            <h1>Bot Status</h1>
            <ul>
              ${shardsHtml}
            </ul>
          </div>
        </body>
      </html>
    `;
}
const { marked } = require("marked");

async function getShardStatusHtml(shard, period, solo = false) {
    try {
        if (!shard?.id && shard.id != 0) return "";

        shard.last24hevents = JSON.parse(shard.last24hevents)
        shard.last24hpings = JSON.parse(shard.last24hpings).map(i => i.ping);
        shard.name = solo ? "Bot Status" : `Shard ${shard.id}`;

        let status = shard.status || 'down';
        let uptimeText = shard.status == "up" ? marked(`**up:** \`${!!shard.uptime ? await formatUptime(Math.floor((Date.now() - shard.uptime) / 1000)) : 'none'}\``) : '';
        let pingText = shard.status == "up" ? marked(`**ping:** \`${shard.ping}ms\`\n\n**24h average ping:** \`${average(shard.last24hpings)}ms\``) : '';
        let versionText = shard.version ? `- v${shard.version}` : '';

        let segmentsCount = 50;
        let segmentDuration = (period * 1000) / segmentsCount;

        let segmentTimestamps = Array.from({ length: segmentsCount }, (_, index) =>
            Date.now() - (period * 1000 - index * segmentDuration)
        );

        const getStatusForTimestamp = (timeEvent) => {
            let status = "down"; // default state

            for (let event of shard.last24hevents) {
                if (event.t > timeEvent) break;
                status = event.event;
            }

            return status;
        };
        let segmentStatuses = segmentTimestamps.map(getStatusForTimestamp);

        //lastEventTime + x*period = Date à x%  

        let eventBars = segmentStatuses.map((status, index) => {
            let label = "";

            if (index === 0) label = `<div class="event-label left">${formatPeriod(period)} ago</div>`;
            if (index === segmentStatuses.length - 1) label = `<div class="event-label right">now</div>`;

            return `
                <div class="event-bar ${status}" style="left: ${((index + 1) / (segmentsCount + 1)) * 100}%"
                    title="Event at: ${new Date(segmentTimestamps[index]).toISOString()}">
                </div>
                ${label}
            `;
        }).join('');


        return `
            <div class="shard-container ${status}">
                <div class="shard-header">
                    <span class="shard-name"><strong>${shard.name}</strong> ${versionText}</span>
                    <span class="shard-status ${status}">${statusEmoji[status]}</span>
                </div>
                <div class="shard-details">
                    ${uptimeText}
                    ${pingText}
                </div>
                <div class="event-timeline">
                    ${eventBars}
                </div>
            </div>
        `;
    } catch (e) {
        promisifiedError("Error while getting shard status", e);
        return "";
    }
}

const formatPeriod = (seconds) => {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`; // Jours
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`; // Heures
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m`; // Minutes
    return `${seconds}s`; // Secondes
};

function checkAuthToken(headers, validToken) {
    let authHeader = headers.get("Authorization");
    if (!authHeader) return false;
    let token = authHeader.replace("Bearer ", "").trim();
    return token === validToken;
}


module.exports = {
    checkAuthToken,
    getStatusPageHtml,
    updateShards,
    promisifiedError,
    promisifiedLog,
    init_database,
    updateShard,
    getAllShards,
    getShard,
    deleteShard,
    resetDatabase,
    routineCheckShards,
    getStatusShards,
    sanitizeSQL,
    checkTimeForAllshards
}