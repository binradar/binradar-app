// Mapillary's point tiles carry every object it detected, at zoom 14 only, and
// the map filters them down to trash cans. They are big (a z14 tile in a city
// centre is ~5 MB gzipped, of which trash cans are ~1.5 %) and capped at 50,000
// requests a day per app, but arrive in seconds from a CDN, where the search
// API takes ~10 s for every 0.01° cell.

const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN ?? "";
const API = "https://graph.mapillary.com";

export const mapillaryEnabled = TOKEN !== "";

export const MAPILLARY_TILES = `https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/{z}/{x}/{y}?access_token=${encodeURIComponent(TOKEN)}`;
export const MAPILLARY_ZOOM = 14;

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
