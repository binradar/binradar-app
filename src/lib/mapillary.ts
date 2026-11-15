// Mapillary's own vector tiles carry every object it detected (a single z14
// tile in a city centre is several MB, of which trash cans are ~1.5 %) and are
// capped at 50,000 requests a day per app. So we ask the search API for just
// the trash cans in view instead, which is a few KB per area.

const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN ?? "";
const API = "https://graph.mapillary.com";

export const mapillaryEnabled = TOKEN !== "";

// Wider views would need too many slow (~10 s) queries.
export const MAPILLARY_MINZOOM = 15;
// Side of the grid cells we query, well below the API's 0.01 square degree limit.
const CELL = 0.01;
const MAX_CELLS = 40;
// The API returns at most this many results and cannot page, so fuller cells
// are split into quarters, down to this depth.
const MAX_RESULTS = 2000;
const MAX_SPLITS = 2;

export type MapillaryStatus = "idle" | "loading" | "zoom-in" | "error";

export interface View {
	zoom: number;
	west: number;
	south: number;
	east: number;
	north: number;
}

interface Detection {
	id: string;
	geometry: GeoJSON.Point;
	last_seen_at: string;
}

// Mapillary writes the offset as "+0000", which only some engines parse.
const parseDate = (s: string) => Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));

export function createMapillaryLoader(update: (data: GeoJSON.FeatureCollection, status: MapillaryStatus) => void) {
	const features = new Map<string, GeoJSON.Feature>();
	// Cells that are loaded or loading; results are kept for the session.
	const cells = new Set<string>();
	let pending = 0;
	let failed = false;
	let zoomIn = false;

	function emit() {
		const status = zoomIn ? "zoom-in" : pending > 0 ? "loading" : failed ? "error" : "idle";
		update({ type: "FeatureCollection", features: [...features.values()] }, status);
	}

	async function query(west: number, south: number, east: number, north: number, depth = 0): Promise<void> {
		const params = new URLSearchParams({
			access_token: TOKEN,
			object_values: "object--trash-can",
			fields: "id,geometry,last_seen_at",
			bbox: [west, south, east, north].map((v) => v.toFixed(5)).join(","),
			limit: String(MAX_RESULTS),
		});
		const response = await fetch(`${API}/map_features?${params}`);
		if (!response.ok) throw new Error(`Mapillary answered ${response.status}`);
		const { data } = (await response.json()) as { data: Detection[] };

		if (data.length >= MAX_RESULTS && depth < MAX_SPLITS) {
			const x = (west + east) / 2;
			const y = (south + north) / 2;
			await Promise.all([
				query(west, south, x, y, depth + 1),
				query(x, south, east, y, depth + 1),
				query(west, y, x, north, depth + 1),
				query(x, y, east, north, depth + 1),
			]);
			return;
		}
		for (const d of data) {
			features.set(d.id, {
				type: "Feature",
				geometry: d.geometry,
				properties: { id: d.id, last_seen: parseDate(d.last_seen_at) },
			});
		}
	}

	return function load(view: View) {
		const x0 = Math.floor(view.west / CELL);
		const x1 = Math.floor(view.east / CELL);
		const y0 = Math.floor(view.south / CELL);
		const y1 = Math.floor(view.north / CELL);
		zoomIn = view.zoom < MAPILLARY_MINZOOM || (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS;
		if (zoomIn) return emit();

		for (let x = x0; x <= x1; x++) {
			for (let y = y0; y <= y1; y++) {
				const key = `${x},${y}`;
				if (cells.has(key)) continue;
				cells.add(key);
				pending++;
				query(x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL)
					.then(() => (failed = false))
					.catch(() => {
						// Retried on the next move.
						cells.delete(key);
						failed = true;
					})
					.finally(() => {
						pending--;
						emit();
					});
			}
		}
		emit();
	};
}

// Links to a photo the detection was made in, or to its location if the
// lookup fails.
export async function photoUrl(id: string, [lng, lat]: [number, number]): Promise<string> {
	const fallback = `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=19`;
	try {
		const params = new URLSearchParams({ access_token: TOKEN, fields: "images" });
		const response = await fetch(`${API}/${id}?${params}`);
		const { images } = (await response.json()) as { images?: { data: { id: string }[] } };
		const image = images?.data[0];
		return image ? `https://www.mapillary.com/app/?pKey=${image.id}&focus=photo` : fallback;
	} catch {
		return fallback;
	}
}
