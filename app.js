const map = L.map("map", {
  zoomControl: false,
  minZoom: 10,
}).setView([43.7001, -79.4163], 11);

L.control
  .zoom({
    position: "bottomright",
  })
  .addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd",
  maxZoom: 20,
  attribution:
    "&copy; OpenStreetMap contributors &copy; CARTO",
}).addTo(map);

map.createPane("wardPane");
map.getPane("wardPane").style.zIndex = "350";
map.createPane("courtPane");
map.getPane("courtPane").style.zIndex = "650";

const state = {
  userLocation: null,
  courts: [],
  visibleCourts: [],
  activeCourtId: null,
  markersById: new Map(),
  subwayLayer: null,
  wardLayer: null,
  torontoBounds: null,
  initialFitDone: false,
};

const elements = {
  locateBtn: document.querySelector("#locateBtn"),
  modeSelect: document.querySelector("#modeSelect"),
  sortSelect: document.querySelector("#sortSelect"),
  distanceRange: document.querySelector("#distanceRange"),
  distanceValue: document.querySelector("#distanceValue"),
  searchInput: document.querySelector("#searchInput"),
  courtCountPills: document.querySelector("#courtCountPills"),
  lightsOnly: document.querySelector("#lightsOnly"),
  publicOnly: document.querySelector("#publicOnly"),
  courtCount: document.querySelector("#courtCount"),
  visibleCount: document.querySelector("#visibleCount"),
  rushWindow: document.querySelector("#rushWindow"),
  statusText: document.querySelector("#statusText"),
  resultsMeta: document.querySelector("#resultsMeta"),
  resultsList: document.querySelector("#resultsList"),
};

const userMarker = L.circleMarker([43.7001, -79.4163], {
  radius: 8,
  color: "#ffffff",
  weight: 3,
  fillColor: "#205c3b",
  fillOpacity: 1,
});

const subwayStyles = {
  D5C82B: { color: "#d5c82b", weight: 6, opacity: 0.85 },
  "008000": { color: "#008000", weight: 6, opacity: 0.85 },
  B300B3: { color: "#b300b3", weight: 6, opacity: 0.85 },
  FF8000: { color: "#ff8000", weight: 6, opacity: 0.85 },
  "808080": { color: "#808080", weight: 6, opacity: 0.85 },
};

boot();

async function boot() {
  wireEvents();
  updateRushWindow();

  try {
    const [tennisResponse, subwayResponse, wardsResponse] = await Promise.all([
      fetch("./data/tennis.geojson"),
      fetch("./data/subway.geojson"),
      fetch("./data/wards.geojson"),
    ]);

    const [tennisData, subwayData, wardsData] = await Promise.all([
      tennisResponse.json(),
      subwayResponse.json(),
      wardsResponse.json(),
    ]);

    state.courts = tennisData.features.map((feature) => normalizeCourt(feature, subwayData));
    elements.courtCount.textContent = String(state.courts.length);

    renderTorontoBoundary(wardsData);
    renderSubway(subwayData);
    renderCourts();
    updateStatus(
      "Loaded official City of Toronto tennis-court data, TTC subway routes, and city limits."
    );
  } catch (error) {
    console.error(error);
    updateStatus(
      "Could not load the local data files. Run this app from a local web server rather than opening index.html directly."
    );
  }
}

function renderTorontoBoundary(wardsData) {
  if (state.wardLayer) {
    map.removeLayer(state.wardLayer);
  }

  state.wardLayer = L.geoJSON(wardsData, {
    pane: "wardPane",
    interactive: false,
    style: {
      color: "#1d6b53",
      weight: 2,
      opacity: 0.55,
      fillOpacity: 0.02,
    },
  }).addTo(map);

  state.torontoBounds = state.wardLayer.getBounds();
  map.setMaxBounds(state.torontoBounds.pad(0.03));
  map.fitBounds(state.torontoBounds.pad(0.01), { animate: false });
}

function wireEvents() {
  elements.locateBtn.addEventListener("click", useMyLocation);
  elements.searchInput.addEventListener("input", renderCourts);
  elements.modeSelect.addEventListener("change", renderCourts);
  elements.sortSelect.addEventListener("change", renderCourts);
  elements.distanceRange.addEventListener("input", () => {
    elements.distanceValue.textContent = `${elements.distanceRange.value} km`;
    renderCourts();
  });
  elements.courtCountPills.addEventListener("click", (e) => {
    const pill = e.target.closest(".count-pill");
    if (!pill) return;
    elements.courtCountPills.querySelectorAll(".count-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    renderCourts();
  });
  elements.lightsOnly.addEventListener("change", renderCourts);
  elements.publicOnly.addEventListener("change", renderCourts);
}

function renderSubway(subwayData) {
  if (state.subwayLayer) {
    map.removeLayer(state.subwayLayer);
  }

  state.subwayLayer = L.geoJSON(subwayData, {
    style: (feature) =>
      subwayStyles[feature.properties.ROUTE_COLOR] || {
        color: "#0b7fab",
        weight: 5,
        opacity: 0.8,
      },
  }).addTo(map);
}

function renderCourts() {
  const maxDistanceKm = Number(elements.distanceRange.value);
  const activePill = elements.courtCountPills.querySelector(".count-pill.active");
  const minCourts = activePill ? Number(activePill.dataset.min) : 1;
  const mode = elements.modeSelect.value;
  const sort = elements.sortSelect.value;
  const searchTerm = elements.searchInput.value.trim().toLowerCase();

  const enriched = state.courts
    .map((court) => enrichCourt(court, mode))
    .filter((court) => {
      if (searchTerm && !court.name.toLowerCase().includes(searchTerm) && !court.address.toLowerCase().includes(searchTerm)) {
        return false;
      }

      if (court.courts < minCourts) {
        return false;
      }

      if (elements.lightsOnly.checked && !court.hasLights) {
        return false;
      }

      if (elements.publicOnly.checked && court.type !== "Public") {
        return false;
      }

      if (state.userLocation && court.distanceKm > maxDistanceKm) {
        return false;
      }

      return true;
    })
    .sort((a, b) => compareCourts(a, b, sort));

  state.visibleCourts = enriched;
  elements.visibleCount.textContent = String(enriched.length);
  elements.resultsMeta.textContent = state.userLocation
    ? `Showing ${enriched.length} courts within ${maxDistanceKm} km of you.`
    : `Showing all ${enriched.length} matching courts across Toronto.`;

  paintMap(enriched);
  paintList(enriched);
}

function paintMap(courts) {
  state.markersById.forEach((marker) => map.removeLayer(marker));
  state.markersById.clear();

  courts.forEach((court) => {
    const marker = L.marker([court.lat, court.lng], {
      pane: "courtPane",
      icon: buildCourtIcon(court),
    }).addTo(map);

    marker.bindPopup(buildPopupHtml(court));
    marker.on("click", () => activateCourt(court.id));
    state.markersById.set(court.id, marker);
  });

  if (!state.initialFitDone) {
    const layersForBounds = [...state.markersById.values()];
    const bounds = L.featureGroup(layersForBounds).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.06), { animate: false });
    }
    state.initialFitDone = true;
  }

  if (state.userLocation && !map.hasLayer(userMarker)) {
    userMarker.addTo(map);
  }
}

function paintList(courts) {
  elements.resultsList.innerHTML = "";
  updateStatus(
    `Loaded city data. Rendering ${courts.length} court markers on the map.`
  );

  if (!courts.length) {
    elements.resultsList.innerHTML =
      '<p class="result-meta">No courts match the current filters. Widen the distance or turn off a filter.</p>';
    return;
  }

  courts.forEach((court) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-card";
    if (court.id === state.activeCourtId) {
      button.classList.add("active");
    }

    button.innerHTML = `
      <div class="result-topline">
        <h3 class="result-title">${escapeHtml(court.name)}</h3>
        <span class="pill ${court.crowdBucket.toLowerCase()}">${court.crowdBucket}</span>
      </div>
      <p class="result-meta">${escapeHtml(court.address)}</p>
      <div class="badge-row">
        <span class="badge">${court.courts} court${court.courts === 1 ? "" : "s"}</span>
        <span class="badge">${court.type}</span>
        <span class="badge">${court.distanceLabel}</span>
        <span class="badge">${court.commuteLabel}</span>
        <span class="badge">${court.subwayLabel}</span>
      </div>
    `;

    button.addEventListener("click", () => activateCourt(court.id, true));
    elements.resultsList.appendChild(button);
  });
}

function activateCourt(courtId, openPopup = false) {
  state.activeCourtId = courtId;
  const court = state.visibleCourts.find((item) => item.id === courtId);
  const marker = state.markersById.get(courtId);

  if (!court || !marker) {
    return;
  }

  map.panTo([court.lat, court.lng]);
  if (openPopup) {
    marker.openPopup();
  }

  paintList(state.visibleCourts);
}

function normalizeCourt(feature, subwayData) {
  const rawCoords = feature.geometry.type === "MultiPoint"
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates;
  const [lng, lat] = rawCoords;
  const properties = feature.properties;
  const courts = Number(properties.Courts) || 0;
  const nearestSubwayKm = nearestLineDistanceKm([lat, lng], subwayData.features);

  return {
    id: properties.ID,
    name: properties.Name,
    type: properties.Type || "Public",
    hasLights: properties.Lights === "Yes",
    courts,
    phone: properties.Phone || "311",
    clubName: properties.ClubName || "",
    clubWebsite: properties.ClubWebsite || "",
    clubInfo: properties.ClubInfo || "",
    address: (properties.LocationAddress || "").trim(),
    winterPlay: properties.WinterPlay || "No",
    lat,
    lng,
    nearestSubwayKm,
  };
}

function enrichCourt(court, mode) {
  const origin = state.userLocation || { lat: 43.7001, lng: -79.4163 };
  const distanceKm = haversineKm(origin.lat, origin.lng, court.lat, court.lng);
  const commuteMinutes = estimateCommuteMinutes(distanceKm, mode, court.nearestSubwayKm);
  const crowdScore = estimateCrowdScore(court, distanceKm);

  return {
    ...court,
    distanceKm,
    distanceLabel: `${distanceKm.toFixed(1)} km away`,
    commuteMinutes,
    commuteLabel: `${commuteMinutes} min ${mode}`,
    subwayLabel:
      court.nearestSubwayKm < 0.8
        ? "near subway"
        : court.nearestSubwayKm < 2
          ? "subway reachable"
          : "transit weaker",
    crowdScore,
    crowdBucket:
      crowdScore >= 72 ? "Busy" : crowdScore >= 45 ? "Medium" : "Lower crowd",
    smartScore:
      100 -
      Math.min(60, distanceKm * 3.3) -
      Math.min(28, commuteMinutes * 0.55) -
      crowdScore * 0.25 +
      Math.min(14, court.courts * 2),
  };
}

function estimateCommuteMinutes(distanceKm, mode, subwayKm) {
  const speedKmPerHour = {
    walk: 4.8,
    bike: 15,
    drive: 24,
    transit: 18,
  }[mode];

  const base = (distanceKm / speedKmPerHour) * 60;

  if (mode === "drive") {
    return Math.max(5, Math.round(base + commuteRushPenalty()));
  }

  if (mode === "transit") {
    const accessPenalty = subwayKm < 0.8 ? 4 : subwayKm < 2 ? 8 : 14;
    return Math.max(8, Math.round(base + accessPenalty));
  }

  return Math.max(4, Math.round(base));
}

function estimateCrowdScore(court, distanceKm) {
  const now = new Date();
  const hour = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const eveningLift = hour >= 17 && hour <= 21 ? 22 : 0;
  const weekendLift = isWeekend ? 15 : 0;
  const centralityLift = Math.max(0, 12 - distanceKm);
  const subwayLift = court.nearestSubwayKm < 0.8 ? 13 : court.nearestSubwayKm < 2 ? 7 : 2;
  const lightsLift = court.hasLights && hour >= 18 ? 10 : 0;
  const supplyRelief = Math.min(18, court.courts * 3.2);
  const clubRelief = court.type === "Club" ? 7 : 0;

  return clamp(
    24 +
      eveningLift +
      weekendLift +
      centralityLift +
      subwayLift +
      lightsLift -
      supplyRelief -
      clubRelief +
      commuteRushPenalty(),
    8,
    95
  );
}

function commuteRushPenalty() {
  const hour = new Date().getHours();
  if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18)) {
    return 12;
  }

  if (hour >= 19 && hour <= 21) {
    return 6;
  }

  return 0;
}

function compareCourts(a, b, sort) {
  if (sort === "distance") {
    return a.distanceKm - b.distanceKm;
  }

  if (sort === "courts") {
    return b.courts - a.courts || a.distanceKm - b.distanceKm;
  }

  if (sort === "quiet") {
    return a.crowdScore - b.crowdScore || a.distanceKm - b.distanceKm;
  }

  return b.smartScore - a.smartScore || a.distanceKm - b.distanceKm;
}

function buildPopupHtml(court) {
  const website = court.clubWebsite
    ? `<p class="popup-copy"><a href="${court.clubWebsite}" target="_blank" rel="noreferrer">Club website</a></p>`
    : "";

  return `
    <h3 class="popup-title">${escapeHtml(court.name)}</h3>
    <p class="popup-copy">${escapeHtml(court.address)}</p>
    <p class="popup-copy">${court.courts} court${court.courts === 1 ? "" : "s"} • ${court.type} • ${court.hasLights ? "Lights" : "No lights"}</p>
    <p class="popup-copy">From you: ${court.distanceLabel} • ${court.commuteLabel}</p>
    <p class="popup-copy">Crowd estimate: ${court.crowdBucket} (${Math.round(court.crowdScore)}/100)</p>
    ${website}
  `;
}

function markerRadius(courts) {
  return clamp(8 + courts * 1.2, 10, 20);
}

function buildCourtIcon(court) {
  const radius = markerRadius(court.courts);
  const size = radius * 2;
  const color = crowdColor(court.crowdBucket);
  const label = court.courts > 9 ? "9+" : String(court.courts);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${radius}" cy="${radius}" r="${radius - 2}" fill="${color}" stroke="#14281e" stroke-width="3" />
      <text
        x="50%"
        y="54%"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="${Math.max(11, radius - 1)}"
        font-weight="700"
        fill="#ffffff"
      >${label}</text>
    </svg>
  `;

  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [size, size],
    iconAnchor: [radius, radius],
    popupAnchor: [0, -radius],
    className: "tennis-map-icon",
  });
}

function crowdColor(bucket) {
  if (bucket === "Busy") {
    return "#b5472f";
  }

  if (bucket === "Medium") {
    return "#d4722a";
  }

  return "#205c3b";
}

function useMyLocation() {
  if (!navigator.geolocation) {
    updateStatus("Geolocation is not available in this browser.");
    return;
  }

  updateStatus("Requesting your location...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      userMarker.setLatLng([state.userLocation.lat, state.userLocation.lng]).addTo(map);
      updateStatus("Location locked. Ranking courts from where you are.");
      renderCourts();
    },
    () => {
      updateStatus("Location access was denied. Still showing the city-wide default view.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
    }
  );
}

function updateStatus(message) {
  elements.statusText.textContent = message;
}

function updateRushWindow() {
  const hour = new Date().getHours();
  elements.rushWindow.textContent =
    hour >= 16 && hour <= 21 ? "Active" : hour >= 7 && hour <= 9 ? "Morning bump" : "Calmer";
}

function nearestLineDistanceKm(point, lineFeatures) {
  let best = Number.POSITIVE_INFINITY;

  lineFeatures.forEach((feature) => {
    const lines =
      feature.geometry.type === "MultiLineString"
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];

    lines.forEach((line) => {
      for (let i = 0; i < line.length; i += 1) {
        const [lng, lat] = line[i];
        best = Math.min(best, haversineKm(point[0], point[1], lat, lng));
      }
    });
  });

  return best;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
