import { findNearbyImage } from "./mapillary";

// Opens a spot in each service's own app or site. Links only: Google's terms
// forbid showing Street View on the same screen as a non-Google map (Maps
// Platform Terms 3.2.3(e)), and Apple's Look Around viewer needs a paid
// MapKit token.
//
// Google and Apple pick the closest panorama themselves. Mapillary and
// Panoramax open their map until a lookup names a photo. KartaView stays on
// its map, where a click on a track opens its viewer: that viewer has no URL
// of its own, and its photo pages (/details/<sequence>/<index>) fail with a
// 500 from api.kartaview.org (2026-11).

const PANORAMAX = "https://api.panoramax.xyz";

export interface Photos {
	mapillary?: string;
	panoramax?: string;
}

export function streetLevelLinks([lng, lat]: [number, number], photos: Photos = {}): { label: string; url: string }[] {
	const [y, x] = [lat.toFixed(6), lng.toFixed(6)];
	return [
		// Unified Maps URL, iOS 18.4 and macOS 15.4 onwards; elsewhere maps.apple.com.
		{ label: "Look Around", url: `https://maps.apple.com/look-around?coordinate=${y},${x}` },
		{ label: "Street View", url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${y},${x}` },
		{
			label: "Mapillary",
			url: photos.mapillary
				? `https://www.mapillary.com/app/?pKey=${photos.mapillary}&focus=photo`
				: `https://www.mapillary.com/app/?lat=${y}&lng=${x}&z=17`,
		},
		{
			label: "Panoramax",
			url: photos.panoramax
				? `${PANORAMAX}/?pic=${photos.panoramax}&map=17/${y}/${x}`
				: `${PANORAMAX}/?focus=map&map=17/${y}/${x}`,
		},
		{ label: "KartaView", url: `https://kartaview.org/map/@${y},${x},17z` },
	];
}

// A picture showing the spot: a 360° one, or one looking towards it, from a
// few metres away. Panoramax answers in a fraction of a second but covers
// mostly France.
async function findPanoramaxPicture([lng, lat]: [number, number]): Promise<string | undefined> {
	try {
		const params = new URLSearchParams({ place_position: `${lng},${lat}`, place_distance: "3-30", limit: "1" });
		const response = await fetch(`${PANORAMAX}/api/search?${params}`);
		const { features } = (await response.json()) as { features?: { id: string }[] };
		return features?.[0]?.id;
	} catch {
		return undefined;
	}
}

// Calls back once per service that finds a photo.
export function findPhotos(lngLat: [number, number], found: (photos: Photos) => void, { mapillary = true } = {}) {
	if (mapillary) findNearbyImage(lngLat).then((id) => id && found({ mapillary: id }));
	findPanoramaxPicture(lngLat).then((id) => id && found({ panoramax: id }));
}
