// Opens a spot in each service's own app or site. Links only: Google's terms
// forbid showing Street View on the same screen as a non-Google map (Maps
// Platform Terms 3.2.3(e)), and Apple's Look Around viewer needs a paid
// MapKit token. Plain links need no key and send no requests of our own.
export function streetLevelLinks([lng, lat]: [number, number]): { label: string; url: string }[] {
	const [y, x] = [lat.toFixed(6), lng.toFixed(6)];
	return [
		// Opens the panorama closest to the spot.
		{ label: "Street View", url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${y},${x}` },
		// Unified Maps URL, iOS 18.4 and macOS 15.4 onwards; elsewhere maps.apple.com.
		{ label: "Look Around", url: `https://maps.apple.com/look-around?coordinate=${y},${x}` },
		{ label: "Mapillary", url: `https://www.mapillary.com/app/?lat=${y}&lng=${x}&z=17` },
		{ label: "KartaView", url: `https://kartaview.org/map/@${y},${x},17z` },
		{ label: "Panoramax", url: `https://api.panoramax.xyz/?focus=map&map=17/${y}/${x}` },
	];
}
