# binradar-app

BinRadar finds the nearest public waste bin: a map PWA for phones and
desktops, served from GitHub Pages at <https://binradar.github.io/binradar-app/>.

Built with Svelte, Vite, TypeScript and MapLibre GL JS.

## Data

| Layer | Source |
| --- | --- |
| Basemap | [OpenFreeMap](https://openfreemap.org) `positron` (light) and `dark`, following the system setting unless picked by hand. |
| Bins | Static z14 vector tiles from [binradar-tiles](https://github.com/binradar/binradar-tiles), built weekly from OpenStreetMap. Only visible from zoom 14. |
| Mapillary | Trash cans detected in Mapillary's street-level photos, off by default. Loaded live from Mapillary's search API from zoom 15, in 0.01° cells kept for the session. |

Mapillary's own vector tiles are not used: they carry every detected object
(one z14 tile in a city centre is several MB, of which trash cans are about
1.5 %) and are capped at 50,000 requests a day per app. The search API
returns just the trash cans, a few KB per cell, but takes around 10 s per
query.

## Development

```sh
npm install
cp .env.example .env.local   # then add a Mapillary client token
npm run dev
```

`npm run check` type-checks, `npm run build` writes the site to `dist/`.
Without a token the Mapillary layer is just disabled.

## Deployment

`.github/workflows/deploy.yml` builds and deploys to Pages on every push to
`main`. The Mapillary token comes from the repository variable
`MAPILLARY_TOKEN`; it is a client token and public in the bundle by design.

## Caching

The service worker precaches the app and caches OpenFreeMap tiles, fonts and
sprites (30 days) and the bin tiles (7 days, revalidated in the background).
Mapillary responses are not cached, since its API answers `no-store`.

## Attribution

Map data © OpenStreetMap contributors (ODbL), basemap by OpenFreeMap /
OpenMapTiles. Mapillary detections are attributed in the map; Mapillary's
terms additionally ask for its logo next to data from its API, which is
still to do.
