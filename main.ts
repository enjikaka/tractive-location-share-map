import tractive from 'npm:tractive';

async function checksum (data: string) {
  const encodedData = textEncoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-1', encodedData.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

const eventTarget = new EventTarget();

Deno.cron("save esmeralda position", "* * * * *", async () => {
    const kv = await Deno.openKv();
    const isAuthorized = tractive.isAuthenticated();

    const email = Deno.env.get('TRACTIVE_ACCOUNT_EMAIL');
    const password = Deno.env.get('TRACTIVE_ACCOUNT_PASSWORD');
    const trackerId = Deno.env.get('TRACTIVE_TRACKER_ID');

    if (!email) {
        throw new ReferenceError('TRACTIVE_ACCOUNT_EMAIL not set.');
    }

    if (!password) {
        throw new ReferenceError('TRACTIVE_ACCOUNT_PASSWORD not set.');
    }

    if (!trackerId) {
        throw new ReferenceError('TRACTIVE_TRACKER_ID not set.');
    }

    if (!isAuthorized) {
        await tractive.connect(
            email,
            password
        );
    }

    const trackerLocation = await tractive.getTrackerLocation(trackerId);
    const trackerHardware = await tractive.getTrackerHardware(trackerId);

    console.log(trackerHardware);

    const latitude = trackerLocation.latlong[0];
    const longitude = trackerLocation.latlong[1];
    const positionUncertainty = trackerLocation.pos_uncertainty;
    const time = trackerLocation.time;

    await kv.set(['trackers', 'esmeralda'], { time, latitude, longitude, positionUncertainty });
});

const html = String.raw;
const textEncoder = new TextEncoder();
const createEvent = (eventName: string, data: Object, id?: string) =>
  textEncoder.encode((id ? `id: ${id}\n` : '') + `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);

async function handleIndex (request: Request) {
    const kv = await Deno.openKv();
    const { value } = await kv.get(['trackers', 'esmeralda']);
    const { latitude, longitude, positionUncertainty } = value;

    const body = html`
    <!doctype html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Vart är Esmeralda?</title>
        <meta name="description" content="Hitta henne med GPSen!">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
        <style>
        header {font-family:-system-ui,sans-serif; position: absolute; top: 0; left: 0; right: 0; height: 48px;display:grid;place-items: center;background-color: purple;color: white; font-weight: bold}
        #map {position: absolute; top: 48px; left: 0; right: 0; bottom: 0 }
        </style>
    </head>
    <body>
        <header>Vart är Esmeralda?</header>
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

        const map = L.map('map', { crs: L.CRS.EPSG3857, continuousWorld: true, layers: [osm, viss] }).setView([${latitude}, ${longitude}], 15);

        L.control.layers({ "OpenStreetMap": osm, "Lantmäteriet": viss }).addTo(map);

        const marker = L.marker([${latitude}, ${longitude}]).addTo(map);
        const circle = L.circle([${latitude}, ${longitude}], { radius: ${positionUncertainty} }).addTo(map);

        const eventSource = new EventSource('/live');

        eventSource.addEventListener('location', locationEvent => {
            const data = JSON.parse(locationEvent.data);
            marker.setLatLng(L.latLng(data.latitude, data.longitude));
            circle.setLatLng(L.latLng(data.latitude, data.longitude));
            circle.setRadius(data.positionUncertainty);
        });
        </script>
    </body>
    </html>
    `;

    return new Response(body, {
        status: 200,
        headers: new Headers({
            'content-type': 'text/html'
        })
    });
}

async function observeLocationUpdates () {
    const db = await Deno.openKv();

    const stream = db.watch([["trackers", "esmeralda"]]);

    for await (const entries of stream) {
        const { value } = entries.pop();

        const { latitude, longitude, positionUncertainty, time } = value;
        const newChecksum = await checksum(time+','+latitude+','+longitude);

        eventTarget.dispatchEvent(new CustomEvent('location-update', {
            detail: {
                latitude,
                longitude,
                positionUncertainty,
                time,
                checksum: newChecksum
            }
        }));
    }
}

async function handleLive (request: Request) {
    const lastEventId = request.headers.get('Last-Event-ID') ?? undefined;

    observeLocationUpdates();

    const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
            eventTarget.addEventListener('location-update', e => {
                if (e instanceof CustomEvent) {
                    if (e.detail.checksum !== lastEventId) {
                        controller.enqueue(createEvent('location', { lat: e.detail.lat, long: e.detail.long }, e.detail.checksum));
                    }
                }
            });
        }
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

Deno.serve(async (req: Request) => {
    const url = new URL(req.url);

    if (url.pathname === '/live') {
        return handleLive(req);
    }

    return handleIndex(req);
});
