import { Tractive } from "./services/tractive.ts";

interface KVTracker {
  readonly id: string;
  readonly name: string;
  readonly batteryUpdateTime: number;
  readonly locationUpdateTime: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly positionUncertainty: number;
  readonly batteryLevel: number;
}

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
const tractive = new Tractive(
  Deno.env.get("TRACTIVE_ACCOUNT_EMAIL")!,
  Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD")!,
);

async function saveTrackersPosition() {
  const email = Deno.env.get("TRACTIVE_ACCOUNT_EMAIL");
  const password = Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD");

  if (!email) {
    throw new ReferenceError("TRACTIVE_ACCOUNT_EMAIL not set.");
  }

  if (!password) {
    throw new ReferenceError("TRACTIVE_ACCOUNT_PASSWORD not set.");
  }

  await tractive.login();

  const objects = await tractive.getTrackableObjects();

  const fullObjects = await Promise.all(
    objects.map((object) => tractive.getTrackableObject(object._id)),
  );

  const trackers = fullObjects.map((object) => ({
    id: object.device_id,
    name: object.details.name,
  }));

  const kv = await Deno.openKv();

  await Promise.all(
    trackers.map((obj) => fetchAndSaveTracker(obj, kv, tractive)),
  )
    .finally(() => kv.close());
}

async function fetchAndSaveTracker(
  tracker: { id: string; name: string },
  kv: Deno.Kv,
  tractive: Tractive,
) {
  console.log(`Getting tracker location and hardware for ${tracker.id}`);
  try {
    const trackerLocation = await tractive.getTrackerLocation(tracker.id);
    const trackerHardware = await tractive.getTrackerHardware(tracker.id);

    if (
      trackerLocation && trackerHardware &&
      trackerLocation.latlong &&
      trackerLocation.pos_uncertainty !== undefined &&
      trackerLocation.time !== undefined &&
      trackerHardware.time !== undefined &&
      trackerHardware.battery_level !== undefined
    ) {
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
    id: string;
    name: string | undefined;
    batteryUpdateTime: number;
    locationUpdateTime: number;
    latitude: number;
    longitude: number;
    positionUncertainty: number;
    batteryLevel: number;
  }>({ prefix: ["trackers"] });

  const trackers = [];

  for await (const entry of entries) {
    if (entry.value.name !== undefined) {
      trackers.push(entry.value);
    }
  }

  await kv.close();

  const body = html`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Var är djuret?</title>
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
        <header>Var är djuret?</header>
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
      async function sendInitialLocationUpdate(kvTracker: KVTracker) {
        const newChecksum = await checksum(JSON.stringify(kvTracker));

        controller.enqueue(createEvent("location", kvTracker, newChecksum));
      }

      async function sendTrackerHistory(kvTracker: KVTracker) {
        await tractive.login();
        const histories = await tractive.getTrackerHistory(
          kvTracker.id,
          new Date(Date.now() - 86_400_000), // minus 24h
          new Date(Date.now()),
        );

        const compressedHistory = {
            id: kvTracker.id,
            latlngs: histories.flat().map(entry => entry.latlong)
        }

        controller.enqueue(createEvent("history", compressedHistory));
      }

      (async () => {
        for (const trackerId of trackerIds) {
          const entry = await db.get<KVTracker>(["trackers", trackerId]);

          if (entry && entry.value) {
            await sendInitialLocationUpdate(entry.value);
            await sendTrackerHistory(entry.value);
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
                eventTarget.removeEventListener(
                  "location-update",
                  handleLocationUpdate,
                );
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
          eventTarget.removeEventListener(
            "location-update",
            handleLocationUpdate,
          );
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
        eventTarget.removeEventListener(
          "location-update",
          handleLocationUpdate,
        );
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
    return new Response(
      Deno.readFileSync(new URL("js/app.js", import.meta.url)),
      {
        headers: new Headers({
          "content-type": "text/javascript",
        }),
      },
    );
  }

  return handleIndex(req);
});

/*
const tractive = new Tractive(Deno.env.get("TRACTIVE_ACCOUNT_EMAIL")!, Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD")!);

const history = await tractive.getTrackerHistory("ALDNQMED", new Date("2025-10-04"), new Date("2025-10-05"));

console.log(history);
*/
