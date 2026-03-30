import { serveFile } from "@std/http/file-server";
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

interface KVHistory {
  readonly id: string;
  readonly latlngs: number[][];
  readonly latestUpdateTime: number | null;
}

const email = Deno.env.get("TRACTIVE_ACCOUNT_EMAIL");
const password = Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD");

if (!email) {
  throw new ReferenceError("TRACTIVE_ACCOUNT_EMAIL not set.");
}

if (!password) {
  throw new ReferenceError("TRACTIVE_ACCOUNT_PASSWORD not set.");
}

const html = String.raw;
const textEncoder = new TextEncoder();

async function checksum(data: string) {
  const encodedData = textEncoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-1", encodedData.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const eventTarget = new EventTarget();
const tractive = new Tractive(
  Deno.env.get("TRACTIVE_ACCOUNT_EMAIL")!,
  Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD")!,
);
const watcherKv = await Deno.openKv();
const activeLocationWatchers = new Set<string>();
const activeHistoryWatchers = new Set<string>();

const getLocationEventId = (value: KVTracker) =>
  `location:${value.id}:${value.locationUpdateTime}:${value.batteryUpdateTime}`;

const getHistoryEventId = (value: KVHistory) =>
  `history:${value.id}:${value.latestUpdateTime ?? 0}:${value.latlngs.length}`;

async function updateTrackers() {
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
    trackers.map((obj) => fetchAndSaveTracker(obj, kv)),
  )
    .finally(() => kv.close());
}

async function fetchAndSaveTracker(
  tracker: { id: string; name: string },
  kv: Deno.Kv
) {
  const existingEntry = await kv.get<KVTracker>(["trackers", tracker.id]);

  if (existingEntry.value && existingEntry.value.locationUpdateTime) {
    const age = Date.now() - (existingEntry.value.locationUpdateTime * 1000);

    if (age < 1_800_000) { // 30 minutes
      console.log(
        `Skipping tracker ${tracker.id}, last update was les than 30 minutes ago.`,
      );

      return;
    }
  }

  console.log(`Getting tracker location and hardware for ${tracker.id}`);

  try {
    const histories = await tractive.getTrackerHistory(
      tracker.id,
      new Date(Date.now() - 86_400_000), // minus 24h
      new Date(Date.now()),
    );

    const flattenedHistory = histories
      .flat()
      .sort((a, b) => ((a.time ?? 0) - (b.time ?? 0)));
    const latlngs = flattenedHistory.map((entry) => entry.latlong);
    const latestUpdateTime = flattenedHistory.reduce(
      (max, entry) => Math.max(max, entry.time ?? 0),
      0,
    );

    const distance = latlngs.reduce((total, curr, index, arr) => {
      if (index === 0) return 0;
      const prev = arr[index - 1];
      const R = 6371e3; // metres
      const φ1 = (prev[0] * Math.PI) / 180; // φ, λ in radians
      const φ2 = (curr[0] * Math.PI) / 180;
      const Δφ = ((curr[0] - prev[0]) * Math.PI) / 180;
      const Δλ = ((curr[1] - prev[1]) * Math.PI) / 180;

      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      const d = R * c; // in metres
      return total + d;
    }, 0);

    const compressedHistory = {
      id: tracker.id,
      latlngs,
      latestUpdateTime: flattenedHistory.length > 0 ? latestUpdateTime : null,
      distance,
    };

    await kv.set(["histories", tracker.id], compressedHistory);
  } catch (error) {
    console.error(
      `Error getting tracker history ${tracker.id}: ${error}`,
    );
  }

  try {
    const [trackerLocation, trackerHardware] = await Promise.all([
      tractive.getTrackerLocation(tracker.id),
      tractive.getTrackerHardware(tracker.id),
    ]);

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

const createEvent = (eventName: string, data: object, id?: string) =>
  textEncoder.encode(
    (id ? `id: ${id}\n` : "") +
    `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`,
  );

async function handleIndex(_request: Request) {
  const kv = await Deno.openKv();
  const entries = kv.list<KVTracker>({ prefix: ["trackers"] });

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
        <link rel="stylesheet" href="css/main.css" />
        <script type="importmap">
        {
          "imports": {
            "leaflet": "https://unpkg.com/leaflet@2.0.0-alpha.1/dist/leaflet.js",
            "webact": "https://unpkg.com/webact@0.2.23/index.js"
          }
        }
        </script>
      </head>
      <body>
        <header>Var är djuret?</header>
        <div id="map"></div>
        <dialog id="cards"></dialog>
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

function observeLocationUpdates(trackerIds: string[]) {
  for (const rawId of trackerIds) {
    const trackerId = rawId.trim();
    if (!trackerId || activeLocationWatchers.has(trackerId)) continue;

    activeLocationWatchers.add(trackerId);

    void (async () => {
      try {
        const stream = watcherKv.watch([["trackers", trackerId]]);

        for await (const entries of stream) {
          const entry = entries.pop();
          if (!entry) continue;
          const { value } = entry;

          if (!value) continue;

          const payload = value as KVTracker;
          const eventId = await checksum(getLocationEventId(payload));

          eventTarget.dispatchEvent(
            new CustomEvent("location-update", {
              detail: {
                value: payload,
                eventId,
              },
            }),
          );
        }
      } catch (error) {
        console.error(
          `Location watcher for ${trackerId} stopped: ${error}`,
        );
      } finally {
        activeLocationWatchers.delete(trackerId);
      }
    })();
  }
}

function observeHistoryUpdates(trackerIds: string[]) {
  for (const rawId of trackerIds) {
    const trackerId = rawId.trim();
    if (!trackerId || activeHistoryWatchers.has(trackerId)) continue;

    activeHistoryWatchers.add(trackerId);

    void (async () => {
      try {
        const stream = watcherKv.watch([["histories", trackerId]]);

        for await (const entries of stream) {
          const entry = entries.pop();
          if (!entry) continue;
          const { value } = entry;

          if (!value) continue;

          const payload = value as KVHistory;
          const eventId = await checksum(getHistoryEventId(payload));

          eventTarget.dispatchEvent(
            new CustomEvent("history-update", {
              detail: {
                value: payload,
                eventId,
              },
            }),
          );
        }
      } catch (error) {
        console.error(`History watcher for ${trackerId} stopped: ${error}`);
      } finally {
        activeHistoryWatchers.delete(trackerId);
      }
    })();
  }
}

async function handleLive(request: Request) {
  void updateTrackers().catch((e) => {
  console.error("updateTrackers failed", e);
});

  const db = await Deno.openKv();

  const lastEventId = request.headers.get("Last-Event-ID") ?? undefined;

  const trackerIds = (Deno.env.get("TRACTIVE_TRACKER_ID") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  observeLocationUpdates(trackerIds);
  observeHistoryUpdates(trackerIds);

  let handleLocationUpdate: ((e: Event) => void) | null = null;
  let handleHistoryUpdate: ((e: Event) => void) | null = null;
  let interval: number;

  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      let closed = false;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;

        try {
          controller.enqueue(chunk);
        } catch (e) {
          console.error("enqueue failed", e);
          closed = true;
          try { controller.close(); } catch { }
        }
      };

      interval = setInterval(() => {
        safeEnqueue(textEncoder.encode(`: keepalive\n\n`));
      }, 15000);

      async function sendInitialLocationUpdate(kvTracker: KVTracker) {
        const eventId = await checksum(getLocationEventId(kvTracker));

        safeEnqueue(createEvent("location", kvTracker, eventId));
      }

      (async () => {
        try {
          await Promise.all(
            trackerIds.map(async (trackerId) => {
              const [
                trackerEntry,
                historyEntry,
              ] = await Promise.all([
                db.get<KVTracker>(["trackers", trackerId]),
                db.get<KVHistory>([
                  "histories",
                  trackerId,
                ]),
              ]);

              if (trackerEntry && trackerEntry.value) {
                await sendInitialLocationUpdate(trackerEntry.value);
              }

              if (historyEntry && historyEntry.value) {
                const historyEventId = await checksum(
                  getHistoryEventId(historyEntry.value),
                );
                safeEnqueue(
                  createEvent("history", historyEntry.value, historyEventId),
                );
              }
            }),
          );
        } catch (error) {
          console.error("initial send failed", error);
          closed = true;
          try { controller.close(); } catch { }
        }
      })();

      handleHistoryUpdate = (e: Event) => {
        if (e instanceof CustomEvent) {
          const { eventId, value } = e.detail as {
            eventId: string;
            value: KVHistory;
          };
          if (eventId !== lastEventId) {
            try {
              safeEnqueue(
                createEvent(
                  "history",
                  value,
                  eventId,
                ),
              );
            } catch (error) {
              console.error("Error enqueuing data:", error);
              // Remove the event listener if there's an error
              if (handleHistoryUpdate) {
                eventTarget.removeEventListener(
                  "history-update",
                  handleHistoryUpdate,
                );
                handleHistoryUpdate = null;
              }
            }
          }
        }
      };

      handleLocationUpdate = (e: Event) => {
        if (e instanceof CustomEvent) {
          const { eventId, value } = e.detail as {
            eventId: string;
            value: KVTracker;
          };
          if (eventId !== lastEventId) {
            try {
              safeEnqueue(
                createEvent(
                  "location",
                  value,
                  eventId,
                ),
              );
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
      eventTarget.addEventListener("history-update", handleHistoryUpdate);

      // Handle abort signal when client disconnects
      request.signal.addEventListener("abort", () => {
        closed = true;

        clearInterval(interval);

        if (handleLocationUpdate) {
          eventTarget.removeEventListener(
            "location-update",
            handleLocationUpdate,
          );
          handleLocationUpdate = null;
        }

        if (handleHistoryUpdate) {
          eventTarget.removeEventListener(
            "history-update",
            handleHistoryUpdate,
          );
          handleHistoryUpdate = null;
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
      if (handleHistoryUpdate) {
        eventTarget.removeEventListener(
          "history-update",
          handleHistoryUpdate,
        );
        handleHistoryUpdate = null;
      }

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
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "X-Accel-Buffering": "no",
    }),
  });
}

Deno.serve((req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/live") {
    return handleLive(req);
  }

  if (url.pathname.includes("/js/") || url.pathname.includes("/css/")) {
    return serveFile(req, Deno.cwd() + "/static" + url.pathname);
  }

  return handleIndex(req);
});

/*
const tractive = new Tractive(Deno.env.get("TRACTIVE_ACCOUNT_EMAIL")!, Deno.env.get("TRACTIVE_ACCOUNT_PASSWORD")!);

const history = await tractive.getTrackerHistory("ALDNQMED", new Date("2025-10-04"), new Date("2025-10-05"));

console.log(history);
*/
