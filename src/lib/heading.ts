import type { GeolocateControl, Map } from "maplibre-gl";

// Which way the phone points, in degrees clockwise from north: the top of the
// screen while it lies flat, its back while it is held upright, and a mix of
// both in between, where the two point the same way.

const RAD = Math.PI / 180;

// From the spec's absolute alpha, beta and gamma, which rotate the earth's
// east-north-up axes into the device's (Z, then X', then Y''). Screen up is
// (sin s, cos s, 0) in device axes, the back (0, 0, -1).
function fromAngles(alpha: number, beta: number, gamma: number, screen: number): number {
	const [sa, ca] = [Math.sin(alpha * RAD), Math.cos(alpha * RAD)];
	const [sb, cb] = [Math.sin(beta * RAD), Math.cos(beta * RAD)];
	const [sg, cg] = [Math.sin(gamma * RAD), Math.cos(gamma * RAD)];
	const [ss, cs] = [Math.sin(screen * RAD), Math.cos(screen * RAD)];
	const east = ss * (ca * cg - sa * sb * sg) - cs * sa * cb - (ca * sg + sa * sb * cg);
	const north = ss * (sa * cg + ca * sb * sg) + cs * ca * cb - (sa * sg - ca * sb * cg);
	return Math.atan2(east, north) / RAD;
}

// Safari on iOS asks first, and only during a tap; its alpha does not point
// north, but webkitCompassHeading names the heading of the phone's top.
// Chrome on Android sends absolute angles as an event of their own.
function watchHeading(onheading: (degrees: number) => void): () => void {
	if (typeof DeviceOrientationEvent === "undefined") return () => {};
	const type = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
	const listener = (e: DeviceOrientationEvent) => {
		const angle = screen.orientation?.angle ?? 0;
		const compass = (e as { webkitCompassHeading?: number }).webkitCompassHeading;
		let degrees: number | undefined;
		if (compass != null && compass >= 0) degrees = compass + angle;
		else if (e.absolute && e.alpha != null && e.beta != null && e.gamma != null)
			degrees = fromAngles(e.alpha, e.beta, e.gamma, angle);
		if (degrees !== undefined) onheading((degrees + 360) % 360);
	};
	let stopped = false;
	const ask = (DeviceOrientationEvent as { requestPermission?: () => Promise<PermissionState> }).requestPermission;
	(ask ? ask() : Promise.resolve("granted"))
		.then((state) => {
			if (state === "granted" && !stopped) window.addEventListener(type, listener);
		})
		.catch(() => {});
	return () => {
		stopped = true;
		window.removeEventListener(type, listener);
	};
}

// Gives MapLibre's location dot a beam that turns with the phone. The beam
// goes inside the dot, which places, hides and greys it. Watches the compass
// only while the dot is shown, from the tap on the locate button on: that tap
// is when Safari on iOS lets us ask for it.
export function addHeadingBeam(map: Map, geolocate: GeolocateControl): () => void {
	const beam = document.createElement("div");
	beam.className = "heading-beam";
	beam.hidden = true;
	let heading: number | undefined;
	let unwatch: (() => void) | undefined;

	// The dot stays upright on screen, so the beam makes up for the map's bearing.
	const draw = () => {
		if (heading === undefined) return;
		beam.style.transform = `rotate(${heading - map.getBearing()}deg)`;
		beam.hidden = false;
	};
	map.on("rotate", draw);

	geolocate.on("trackuserlocationstart", () => {
		if (unwatch) return;
		geolocate._dotElement.append(beam);
		unwatch = watchHeading((degrees) => {
			heading = degrees;
			draw();
		});
	});
	// Panning the map away ends tracking too, but keeps the dot; only turning
	// it off, or a denied location, removes it.
	const stop = () => {
		if (geolocate._watchState !== "OFF") return;
		unwatch?.();
		unwatch = undefined;
		heading = undefined;
		beam.hidden = true;
	};
	geolocate.on("trackuserlocationend", stop);
	geolocate.on("error", stop);
	return () => unwatch?.();
}
