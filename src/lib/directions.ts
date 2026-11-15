// Walking directions to a spot in each service's own app or site, starting
// from wherever the user is.
export function directionsLinks([lng, lat]: [number, number]): { label: string; url: string }[] {
	const [y, x] = [lat.toFixed(6), lng.toFixed(6)];
	return [
		// Unified Maps URL, iOS 18.4 and macOS 15.4 onwards; elsewhere maps.apple.com.
		{ label: "Apple Maps", url: `https://maps.apple.com/directions?destination=${y},${x}&mode=walking` },
		{ label: "Google Maps", url: `https://www.google.com/maps/dir/?api=1&destination=${y},${x}&travelmode=walking` },
		{
			label: "OpenStreetMap",
			url: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B${y}%2C${x}`,
		},
	];
}
