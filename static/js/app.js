import L, { Polyline, Map, Control, TileLayer, Marker, Circle, LatLng } from 'leaflet';

import './tracker-card/tracker-card.js';

let hasPanned = false;

const osm = new TileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
});

const viss = new TileLayer.WMS('https://mapslantmateriet.havochvatten.se/topowebb/wms/v1?', {
    layers: 'topowebbkartan',
    detectRetina: true
});

const map = new Map('map', { crs: L.CRS.EPSG3857, continuousWorld: true, layers: [osm] }).setView([0, 0], 15);

new Control.Layers({ "OpenStreetMap": osm, "Lantmäteriet": viss }).addTo(map);

const markers = {};
const historyPaths = {};
const cards = {};

const $cards = document.querySelector('#cards');

$cards.addEventListener("click", (e) => {
    if (e.target === $cards) {
        $cards.close();
    }
});

const openCards = () => $cards.showModal();

function getOrCreateCard(tracker) {
    if (cards[tracker.id]) {
        return cards[tracker.id];
    }

    const trackerCard = document.createElement('tracker-card');

    trackerCard.innerHTML = `
        <span slot="name">${tracker.name}</span>
        <span slot="batteryLevel">${tracker.batteryLevel}</span>
        <span slot="batteryUpdateTime">${new Date(tracker.batteryUpdateTime * 1000).toLocaleString()}</span>
        <span slot="locationUpdateTime">${new Date(tracker.locationUpdateTime * 1000).toLocaleString()}</span>
        <span slot="positionUncertainty">${tracker.positionUncertainty}</span>
    `;

    trackerCard.id = tracker.id;

    $cards.appendChild(trackerCard);

    cards[tracker.id] = trackerCard;
}

function getOrCreateMarkerForTracker(tracker) {
    if (markers[tracker.id]) {
        return markers[tracker.id];
    }

    const marker = new Marker([tracker.latitude, tracker.longitude]);

    marker.on('click', openCards);

    marker.addTo(map);
    const circle = new Circle([tracker.latitude, tracker.longitude], { radius: tracker.positionUncertainty }).addTo(map);
    markers[tracker.id] = { marker, circle };

    return markers[tracker.id];
}

function updateOrCreateHistoryPathForTracker(history) {
    if (historyPaths[history.id]) {
        const path = historyPaths[history.id];

        path.setLatLngs(data.latlngs);
        path.redraw();

        return path;
    }

    const path = new Polyline(history.latlngs, { color: 'red' });

    path.addTo(map);

    historyPaths[history.id] = path;

    return path;
}

const eventSourceURL = '/live';
const eventSource = new EventSource(eventSourceURL);

eventSource.addEventListener('location', locationEvent => {
    const data = JSON.parse(locationEvent.data);

    getOrCreateCard(data);
    const { marker, circle } = getOrCreateMarkerForTracker(data);

    const coords = new LatLng(data.latitude, data.longitude);

    marker.setLatLng(coords);
    circle.setLatLng(coords);
    circle.setRadius(data.positionUncertainty);

    const trackerCard = document.getElementById(data.id);

    if (trackerCard) {
        trackerCard.querySelector('[slot="batteryLevel"]').textContent = data.batteryLevel;
        trackerCard.querySelector('[slot="batteryUpdateTime"]').textContent = new Date(data.batteryUpdateTime * 1000).toLocaleString();
        trackerCard.querySelector('[slot="locationUpdateTime"]').textContent = new Date(data.locationUpdateTime * 1000).toLocaleString();
        trackerCard.querySelector('[slot="positionUncertainty"]').textContent = data.positionUncertainty;
    }

    if (!hasPanned) {
        map.panTo(coords);
        hasPanned = true;
    }
});

eventSource.addEventListener('history', historyEvent => {
    const data = JSON.parse(historyEvent.data);
    updateOrCreateHistoryPathForTracker(data);
});
