import L, { Map, Control, TileLayer, Marker, Circle, Popup, LatLng } from 'leaflet';

const osm = new TileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
});

const viss = new TileLayer.WMS('https://mapslantmateriet.havochvatten.se/topowebb/wms/v1?', {
    layers: 'topowebbkartan',
    detectRetina: true
});

const map = new Map('map', { crs: L.CRS.EPSG3857, continuousWorld: true, layers: [osm, viss] }).setView([0, 0], 15);

new Control.Layers({ "OpenStreetMap": osm, "Lantmäteriet": viss }).addTo(map);

const markers = {};

for (const tracker of window.gpsTrackers) {
    const marker = new Marker([tracker.latitude, tracker.longitude]).addTo(map);
    const circle = new Circle([tracker.latitude, tracker.longitude], { radius: tracker.positionUncertainty }).addTo(map);
    const popup = new Popup();
    popup.setContent('Namn: ' + tracker.name + '<br>Batterinivå: ' + tracker.batteryLevel + ' % (' + new Date(tracker.batteryUpdateTime * 1000).toLocaleString() + ').<br>Positionen uppdaterades senast: ' + new Date(tracker.locationUpdateTime * 1000).toLocaleString() + '.<br>Positionens osäkerhet: ' + tracker.positionUncertainty + ' meter.');
    marker.bindPopup(popup);
    markers[tracker.id] = { marker, circle, popup };
}

const eventSourceURL = '/live?trackerIds=' + window.gpsTrackers.map(x => x.id).filter(Boolean).join(',');
const eventSource = new EventSource(eventSourceURL);

eventSource.addEventListener('location', locationEvent => {
    const data = JSON.parse(locationEvent.data);
    markers[data.id].marker.setLatLng(new LatLng(data.latitude, data.longitude));
    markers[data.id].circle.setLatLng(new LatLng(data.latitude, data.longitude));
    markers[data.id].circle.setRadius(data.positionUncertainty);
    markers[data.id].popup.setContent('Namn: ' + data.name + '<br>Batterinivå: ' + data.batteryLevel + ' % (' + new Date(data.batteryUpdateTime * 1000).toLocaleString() + ').<br>Positionen uppdaterades senast: ' + new Date(data.locationUpdateTime * 1000).toLocaleString() + '.<br>Positionens osäkerhet: ' + data.positionUncertainty + ' meter.');
});

const lastMarker = markers[Object.keys(markers)[0]];

map.panTo(new LatLng(lastMarker.marker.getLatLng().lat, lastMarker.marker.getLatLng().lng));