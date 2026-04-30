# TennisBud Toronto

Mobile-first web app prototype for finding Toronto tennis courts by:

- distance from your location
- number of courts at each park
- transit context via TTC subway routes
- estimated court busyness

## Run it

Start a local web server from this folder.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Data sources

- City of Toronto: Tennis Courts Facilities GeoJSON
- City of Toronto GIS: TTC Subway Route GeoJSON

Both files are checked into `./data`.

## Current model

Crowd level is a heuristic based on:

- time of day
- weekday vs weekend
- court count
- lights
- club vs public court type
- rough centrality
- proximity to subway lines

## Next upgrades

- add TTC stations, GO stations, and streetcar corridors
- add real routing with TTC or Google/Mapbox directions APIs
- add historical crowd signals from bookings, check-ins, or user reports
- add saved favourites and shareable court links
