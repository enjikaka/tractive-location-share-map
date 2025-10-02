import { Tractive } from "./services/tractive.ts";

async function checksum(data: string) {
    const encodedData = textEncoder.encode(data);
    const hashBuffer = await crypto.subtle.digest("SHA-1", encodedData.buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
        "",
    );

    return hashHex;
}

const eventTarget = new EventTarget();

async function saveTrackersPosition() {
    const kv = await Deno.openKv();

    const email = Deno.env.get("TRACTIVE_ACCOUNT_EMAIL");
    const password = Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD");
    const trackerId = Deno.env.get("TRACTIVE_TRACKER_ID");
    const trackerNames = Deno.env.get("TRACTIVE_TRACKER_NAMES");

    if (!email) {
        throw new ReferenceError("TRACTIVE_ACCOUNT_EMAIL not set.");
    }

    if (!password) {
        throw new ReferenceError("TRACTIVE_ACCOUNT_PASSWORD not set.");
    }

    if (!trackerId) {
        throw new ReferenceError("TRACTIVE_TRACKER_ID not set.");
    }

    if (!trackerNames) {
        throw new ReferenceError("TRACTIVE_TRACKER_NAMES not set.");
    }

    const tractive = new Tractive(Deno.env.get("TRACTIVE_ACCOUNT_EMAIL")!, Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD")!);

    const trackerIds = trackerId.split(",");
    const _trackerNames = trackerNames.split(",");

    const trackers = trackerIds.map((trackerId, index) => ({
        id: trackerId,
        name: _trackerNames[index],
    }));

    await Promise.all(trackers.map(obj => fetchAndSaveTracker(obj, kv, tractive)));
}

async function fetchAndSaveTracker(tracker: { id: string; name: string }, kv: Deno.Kv, tractive: Tractive) {
    console.log(`Getting tracker location and hardware for ${tracker.id}`);
    try {
        const trackerLocation = await tractive.getTrackerLocation(tracker.id);
        const trackerHardware = await tractive.getTrackerHardware(tracker.id);

        if (trackerLocation && trackerHardware &&
            trackerLocation.latlong && trackerLocation.pos_uncertainty !== undefined &&
            trackerLocation.time !== undefined && trackerHardware.time !== undefined &&
            trackerHardware.battery_level !== undefined) {
            const name = tracker.name;
            const id = tracker.id;
            const latitude = trackerLocation.latlong[0];
            const longitude = trackerLocation.latlong[1];
            const positionUncertainty = trackerLocation.pos_uncertainty;
            const locationUpdateTime = trackerLocation.time;
            const batteryUpdateTime = trackerHardware.time;
            const batteryLevel = trackerHardware.battery_level;

            await kv.set(["trackers", tracker.id], {
                id,
                name,
                batteryUpdateTime,
                locationUpdateTime,
                latitude,
                longitude,
                positionUncertainty,
                batteryLevel,
            });
        }
    } catch (error) {
        console.error(
            `Error getting tracker location and hardware for ${tracker.id}: ${error}`,
        );
    }
}

Deno.cron("save trackers position", "*/30 * * * *", saveTrackersPosition);

const html = String.raw;
const textEncoder = new TextEncoder();
const createEvent = (eventName: string, data: object, id?: string) =>
    textEncoder.encode(
        (id ? `id: ${id}\n` : "") +
        `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`,
    );

async function handleIndex(_request: Request) {
    const kv = await Deno.openKv();
    const entries = kv.list<{
        id: string,
        name: string | undefined,
        batteryUpdateTime: number,
        locationUpdateTime: number,
        latitude: number,
        longitude: number,
        positionUncertainty: number,
        batteryLevel: number,
    }>({ prefix: ["trackers"] });

    const trackers = [];

    for await (const entry of entries) {
        if (entry.value.name !== undefined) {
            trackers.push(entry.value);
        }
    }

    const body = html`
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Vart är djuret?</title>
                <meta name="description" content="Hitta det med GPSen!">
                <link
                    rel="stylesheet"
                    href="https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.css"
                    crossorigin=""
                />
                <style>
                header {font-family:-system-ui,sans-serif; position: absolute; top: 0; left: 0; right: 0; height: 48px;display:grid;place-items: center;background-color: purple;color: white; font-weight: bold}
                #map {position: absolute; top: 48px; left: 0; right: 0; bottom: 0 }
                </style>
                <script type="importmap">
                    {
                        "imports": {
                            "leaflet": "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.js"
                        }
                    }
                </script>
            </head>
            <body>
                <header>Vart är djuret?</header>
                <div id="map"></div>
                <script type="module" src="js/app.js"></script>
            </body>
        </html>
    `;

    return new Response(body, {
        status: 200,
        headers: new Headers({
            "content-type": "text/html",
        }),
    });
}

async function observeLocationUpdates(trackerIds: string[]) {
    const db = await Deno.openKv();

    for (const trackerId of trackerIds) {
        const stream = db.watch([["trackers", trackerId]]);

        for await (const entries of stream) {
            const entry = entries.pop();
            if (!entry) continue;
            const { value } = entry;

            if (!value) continue;

            const newChecksum = await checksum(JSON.stringify(value));

            eventTarget.dispatchEvent(
                new CustomEvent("location-update", {
                    detail: {
                        ...(value as object),
                        checksum: newChecksum,
                    },
                }),
            );
        }
    }
}

async function handleLive(request: Request) {
    const db = await Deno.openKv();

    const lastEventId = request.headers.get("Last-Event-ID") ?? undefined;

    const trackerIds = Deno.env.get("TRACTIVE_TRACKER_ID")?.split(",") ?? [];
    observeLocationUpdates(trackerIds);

    let handleLocationUpdate: ((e: Event) => void) | null = null;

    const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
            (async () => {
                for (const trackerId of trackerIds) {
                    const entry = await db.get(["trackers", trackerId]);

                    if (entry && entry.value) {
                        const newChecksum = await checksum(JSON.stringify(entry.value));

                        controller.enqueue(createEvent("location", entry.value, newChecksum));
                    }
                }
            })();

            handleLocationUpdate = (e: Event) => {
                if (e instanceof CustomEvent) {
                    if (e.detail.checksum !== lastEventId) {
                        try {
                            // Check if the controller is still open before enqueuing
                            if (controller.desiredSize !== null) {
                                controller.enqueue(
                                    createEvent(
                                        "location",
                                        e.detail,
                                        e.detail.checksum,
                                    ),
                                );
                            }
                        } catch (error) {
                            console.error("Error enqueuing data:", error);
                            // Remove the event listener if there's an error
                            if (handleLocationUpdate) {
                                eventTarget.removeEventListener("location-update", handleLocationUpdate);
                                handleLocationUpdate = null;
                            }
                        }
                    }
                }
            };

            eventTarget.addEventListener("location-update", handleLocationUpdate);

            // Handle abort signal when client disconnects
            request.signal.addEventListener("abort", () => {
                if (handleLocationUpdate) {
                    eventTarget.removeEventListener("location-update", handleLocationUpdate);
                    handleLocationUpdate = null;
                }
                try {
                    controller.close();
                } catch (_error) {
                    // Controller might already be closed, ignore the error
                }
            });
        },
        cancel: () => {
            // Clean up when the stream is cancelled
            if (handleLocationUpdate) {
                eventTarget.removeEventListener("location-update", handleLocationUpdate);
                handleLocationUpdate = null;
            }
        },
    });

    return new Response(body, {
        status: 200,
        headers: new Headers({
            "Connection": "Keep-Alive",
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
        }),
    });
}

saveTrackersPosition().catch(console.error);

Deno.serve((req: Request) => {
    const url = new URL(req.url);

    if (url.pathname === "/live") {
        return handleLive(req);
    }

    if (url.pathname === "/js/app.js") {
        return new Response(Deno.readFileSync(new URL("js/app.js", import.meta.url)), {
            headers: new Headers({
                "content-type": "text/javascript",
            }),
        });
    }

    return handleIndex(req);
});
