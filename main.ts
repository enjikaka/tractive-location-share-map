import tractive from "npm:tractive@1.2.1";

// Type definitions for tracker data
interface TrackerLocation {
    latlong: [number, number];
    pos_uncertainty: number;
    time: number;
    address?: unknown;
}

interface TrackerHardware {
    time: number;
    battery_level: number;
}

// Handle unhandled promise rejections
globalThis.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    console.error("Unhandled promise rejection:", event.reason);
    event.preventDefault(); // Prevent the default behavior of crashing
});

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
    console.log("Saving trackers position...");
    const kv = await Deno.openKv();
    const isAuthorized = tractive.isAuthenticated();

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

    if (!isAuthorized) {
        await tractive.connect(
            email,
            password,
        );
    }

    const trackerIds = trackerId.split(",");
    const _trackerNames = trackerNames.split(",");

    const trackers = trackerIds.map((trackerId, index) => ({
        id: trackerId,
        name: _trackerNames[index],
    }));

    await Promise.all(trackers.map(obj => fetchAndSaveTracker(obj, kv)));
}

async function fetchAndSaveTracker (tracker: { id: string; name: string }, kv: Deno.Kv) {
    console.log(`Getting tracker location and hardware for ${tracker.id}`);
    try {
        const trackerLocation = await new Promise<TrackerLocation | null>((resolve) => {
            tractive.getTrackerLocation(tracker.id)
                .then(resolve)
                .catch((error: unknown) => {
                    console.error(
                        `Error getting tracker location for ${tracker.id}: ${error}`,
                    );
                    resolve(null);
                });
        });
        
        const trackerHardware = await new Promise<TrackerHardware | null>((resolve) => {
            tractive.getTrackerHardware(tracker.id)
                .then(resolve)
                .catch((error: unknown) => {
                    console.error(
                        `Error getting tracker hardware for ${tracker.id}: ${error}`,
                    );
                    resolve(null);
                });
        });

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
            `Error getting tracker location and hardware for ${_trackerId}: ${error}`,
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
    const entries = kv.list({ prefix: ["trackers"] });

    const trackers = [];

    for await (const entry of entries) {
        trackers.push(entry.value);
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
                    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
                    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
                    crossorigin=""
                />
                <script
                    src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
                    integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
                    crossorigin=""
                ></script>
                <style>
                header {font-family:-system-ui,sans-serif; position: absolute; top: 0; left: 0; right: 0; height: 48px;display:grid;place-items: center;background-color: purple;color: white; font-weight: bold}
                #map {position: absolute; top: 48px; left: 0; right: 0; bottom: 0 }
                </style>
                <script>
                window.gpsTrackers = ${JSON.stringify(trackers)};
                </script>
            </head>
            <body>
                <header>Vart är djuret?</header>
                <div id="map"></div>
                <script>
                const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                });

                const viss = L.tileLayer.wms('https://mapslantmateriet.havochvatten.se/topowebb/wms/v1?', {
                    layers: 'topowebbkartan',
                    detectRetina: true
                });

                const map = L.map('map', { crs: L.CRS.EPSG3857, continuousWorld: true, layers: [osm, viss] }).setView([0,0], 15);

                L.control.layers({ "OpenStreetMap": osm, "Lantmäteriet": viss }).addTo(map);

                const markers = {};

                for (const tracker of window.gpsTrackers) {
                    const marker = L.marker([tracker.latitude, tracker.longitude]).addTo(map);
                    const circle = L.circle([tracker.latitude, tracker.longitude], { radius: tracker.positionUncertainty }).addTo(map);
                    const popup = L.popup();
                    popup.setContent('Namn: '+tracker.name+'<br>Batterinivå: '+tracker.batteryLevel+' % ('+new Date(tracker.batteryUpdateTime * 1000).toLocaleString()+').<br>Positionen uppdaterades senast: ' + new Date(tracker.locationUpdateTime * 1000).toLocaleString() + '.<br>Positionens osäkerhet: ' + tracker.positionUncertainty + ' meter.');
                    marker.bindPopup(popup);
                    markers[tracker.id] = { marker, circle, popup };
                }

                const eventSourceURL = '/live?trackerIds=' + window.gpsTrackers.map(x => x.id).filter(Boolean).join(',');
                const eventSource = new EventSource(eventSourceURL);

                eventSource.addEventListener('location', locationEvent => {
                    const data = JSON.parse(locationEvent.data);
                    markers[data.id].marker.setLatLng(L.latLng(data.latitude, data.longitude));
                    markers[data.id].circle.setLatLng(L.latLng(data.latitude, data.longitude));
                    markers[data.id].circle.setRadius(data.positionUncertainty);
                    markers[data.id].popup.setContent('Namn: '+data.name+'<br>Batterinivå: '+data.batteryLevel+' % ('+new Date(data.batteryUpdateTime * 1000).toLocaleString()+').<br>Positionen uppdaterades senast: ' + new Date(data.locationUpdateTime * 1000).toLocaleString() + '.<br>Positionens osäkerhet: ' + data.positionUncertainty + ' meter.');
                });

                const lastMarker = markers[Object.keys(markers)[0]];
                map.panTo(new L.LatLng(lastMarker.marker.getLatLng().lat, lastMarker.marker.getLatLng().lng));
                </script>
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

function handleLive(request: Request) {
    const lastEventId = request.headers.get("Last-Event-ID") ?? undefined;

    const trackerIds =
        new URL(request.url).searchParams.get("trackerIds")?.split(",") ?? [];
    observeLocationUpdates(trackerIds);

    const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
            eventTarget.addEventListener("location-update", (e) => {
                if (e instanceof CustomEvent) {
                    if (e.detail.checksum !== lastEventId) {
                        controller.enqueue(
                            createEvent(
                                "location",
                                e.detail,
                                e.detail.checksum,
                            ),
                        );
                    }
                }
            });
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

async function deleteEsmerelda() {
    const kv = await Deno.openKv();

    try {
        await kv.delete(["trackers", "esmerelda"]);
    } catch (error) {
        console.error(`Error deleting esmerelda: ${error}`);
    }
}

deleteEsmerelda();

Deno.serve((req: Request) => {
    const url = new URL(req.url);

    if (url.pathname === "/live") {
        return handleLive(req);
    }

    return handleIndex(req);
});
