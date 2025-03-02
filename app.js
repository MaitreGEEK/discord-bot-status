const { apiPort, databasePath, responsePeriod } = require("./specificConfig.json")
const { init_database, routineCheckShards, updateShard, promisifiedLog, promisifiedError } = require("./functions")
const { apiUrl, getShardStatus, setShardStatus, getAllShards } = require("./functions");

(async () => {
    const fdatabasePath = process.argv.includes("dev") ? "test-shards.db" : (process.env.DATABASE_PATH || databasePath || "shards.db")
    init_database(fdatabasePath)
    promisifiedLog("Database ready!", "opened from", fdatabasePath)

    const fresponsePeriod = process.env.RESPONSE_PERIOD || responsePeriod || 60; // 1 minute (exemple)
    setInterval(() => {
        routineCheckShards(fresponsePeriod)
    }, fresponsePeriod * 1000);
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
                return ""
            },
            "POST": async req => {
                let body = await req.json();
                body.id = req.params.id

                let response = updateShard(body)
                if (response) return new Response(JSON.stringify({ success: true }, { headers: { 'Content-Type': 'application/json' }, status: 200 }));
                else return new Response(JSON.stringify({ success: false, cause: "Internal Server Error" }), { headers: { 'Content-Type': 'application/json' }, status: 500 });
            },
            "DELETE": async req => {
                return ""
            }
        },
        "/status": {
            "GET": async req => {
                return ""
            }
        },
        "/reset": {
            "DELETE": async req => {
                return ""
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
promisifiedLog(`Discord Bot Status ${version} running on ${process.env.API_URL || apiUrl || `http://localhost:${server.port}`}`);