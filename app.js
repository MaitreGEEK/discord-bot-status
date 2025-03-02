const { apiPort, databasePath, responsePeriod, apiUrl } = require("./specificConfig.json");
const { init_database, routineCheckShards, updateShard, promisifiedLog, promisifiedError, getStatusShards, resetDatabase, getShard, sanitizeSQL, deleteShard, getAllShards, checkTimeForAllshards, updateShards, getStatusPageHtml } = require("./functions.js");
const fdatabasePath = process.argv.includes("dev") ? "test-shards.db" : (process.env.DATABASE_PATH || databasePath || "shards.db")
const fresponsePeriod = process.env.RESPONSE_PERIOD || responsePeriod || 60; // 1 minute (exemple)

(async () => {
    init_database(fdatabasePath)
    promisifiedLog("Database ready!", "Opened from", fdatabasePath)

    routineCheckShards(fresponsePeriod)
    setInterval(() => {
        routineCheckShards(fresponsePeriod)
    }, fresponsePeriod * 1000);

    checkTimeForAllshards() //Check for the 24h pings and events if they are still 24h away from now
    setInterval(() => {
        checkTimeForAllshards()
    }, 3_600_000);
})();


const server = Bun.serve({
    port: process.env.API_PORT || apiPort || 6071,
    routes: {
        "/*": Response.redirect("/status"),
        "/styles.css": new Response(await Bun.file("./styles.css").bytes(), {
            headers: {
                "Content-Type": 'text/css',
            },
        }),
        "/favicon.ico": new Response(await Bun.file("./favicon.ico").bytes(), {
            headers: {
                "Content-Type": "image/x-icon",
            },
        }),
        "/ping": handlePing,
        "/shard/:id": {
            "GET": async req => {
                let shard = getShard(sanitizeSQL(req.params.id))
                if (shard) return new Response(JSON.stringify({ success: true, shard }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            },
            "POST": async req => {
                let shard = await req.json();
                shard.id = sanitizeSQL(req.params.id)

                if (shard.status) shard.status = "up"

                let response = updateShard(shard)
                if (response) return new Response(JSON.stringify({ success: true }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            },
            "DELETE": async req => {
                let response = deleteShard(sanitizeSQL(req.params.id))
                if (response) return new Response(JSON.stringify({ success: true }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            }
        },
        "/shards": {
            'GET': async () => {
                let shards = getAllShards()
                if (shards) return new Response(JSON.stringify({ success: true, shards }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            },
            'POST': async req => {
                let shards = await req.json()
                if (!shards)  return new Response(JSON.stringify({ success: false, cause: "Request Empty" }), { headers: { 'Content-Type': 'application/json' }, status: 400 });

                //UPdate all shards
                let response = await updateShards(shards)
                if (response) return new Response(JSON.stringify({ success: true }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            },
            'DELETE': async () => {
                let response = resetDatabase()
                if (response) return new Response(JSON.stringify({ success: true }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            }
        },
        "/status": {
            "GET": async () => {
                let shards = await getAllShards()
                if (!shards) return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
                return new Response(await getStatusPageHtml(shards, fresponsePeriod*20), { headers: { 'Content-Type': 'text/html' } });
            }
        },
        "/reset": {
            "DELETE": async () => {
                let response = resetDatabase()
                if (response) return new Response(JSON.stringify({ success: true }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            }
        }
    },
    dev: process.argv.includes("dev")
});


async function handlePing() {
    try {
        return new Response(
            JSON.stringify({ timestamp: Date.now() }),
            {
                headers: {
                    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'Surrogate-Control': 'no-store',
                    'Content-Type': 'application/json',
                },
                status: 200
            }
        );
    } catch (error) {
        promisifiedError("API ping error:", error);
        return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
    }
}
const { version } = require("./package.json")
promisifiedLog(`Discord Bot Status v${version} running on ${process.env.API_URL || apiUrl || `http://localhost:${server.port}`}`);