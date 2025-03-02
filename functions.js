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
    if (!db) return false
    try {
        let shards = db.query('SELECT id, last24hpings, last24hevents FROM shards').all();

        let updateStatements = [];
        let params = [];

        if (!shards?.length) return false

        // Pour chaque ligne, on prépare les nouvelles valeurs de last24hpings et last24hevents
        shards.forEach((shard, index) => {
            let last24hpings = JSON.parse(shard.last24hpings || '[]');
            let last24hevents = JSON.parse(shard.last24hevents || '[]');

            // Filtrer les pings et événements des dernières 24 heures
            last24hpings = filterRecentData(last24hpings);
            last24hevents = filterRecentData(last24hevents);

            // Préparer la mise à jour pour cette ligne
            updateStatements.push(`
        WHEN ? THEN ? 
    `);

            params.push(shard.id, JSON.stringify(last24hpings));
            params.push(shard.id, JSON.stringify(last24hevents));
        });

        // Créer la requête UPDATE
        let query = `
            UPDATE shards
            SET 
                last24hpings = CASE id ${updateStatements.join(' ')} ELSE last24hpings END,
                last24hevents = CASE id ${updateStatements.join(' ')} ELSE last24hevents END
            WHERE id IN (${shards.map(() => '?').join(', ')})
        `;

        // Exécuter la mise à jour en une seule requête
        db.query(query).run(...params, ...shards.map(shard => shard.id));
        return true
    }
    catch (e) {
        promisifiedLog("Error while updating 24h arrays", e)
        return false
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



module.exports = {
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