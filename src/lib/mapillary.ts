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

// Opens Mapillary's viewer with only trash can detections shown: in a photo
// of the detection with it selected, or, without a photo, on the map there.
export function viewerUrl(id: string, [lng, lat]: [number, number], photo?: string): string {
	const params = new URLSearchParams(photo ? { pKey: photo, focus: "photo", mapFeatureKey: id } : { focus: "map" });
	params.set("lat", String(lat));
	params.set("lng", String(lng));
	params.set("z", "17");
	params.set("mapFeature[]", "object--trash-can");
	return `https://www.mapillary.com/app/?${params}`;
}

// A photo the detection was made in, if Mapillary answers.
export async function findPhoto(id: string): Promise<string | undefined> {
	try {
		const params = new URLSearchParams({ access_token: TOKEN, fields: "images" });
		const response = await fetch(`${API}/${id}?${params}`);
		const { images } = (await response.json()) as { images?: { data: { id: string }[] } };
		return images?.data[0]?.id;
	} catch {
		return undefined;
	}
}
