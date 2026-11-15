<script lang="ts" module>
	export interface Selection {
		kind: "bin" | "mapillary";
		lngLat: [number, number];
		properties: Record<string, unknown>;
	}
</script>

<script lang="ts">
	import { GeolocateControl, Map, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
	import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
	import "maplibre-gl/dist/maplibre-gl.css";
	import { onMount, untrack } from "svelte";
	import type { View } from "./mapillary";
	import { BASEMAPS, EMPTY, withOverlays, type Theme } from "./style";

	// The worker is looked up next to MapLibre's own module, which bundling moves.
	setWorkerUrl(workerUrl);

	interface Props {
		theme: Theme;
		bins: boolean;
		mapillary: boolean;
		mapillaryData: GeoJSON.FeatureCollection;
		selection: Selection | null;
		onselect: (selection: Selection | null) => void;
		onview: (view: View) => void;
	}

	let { theme, bins, mapillary, mapillaryData, selection, onselect, onview }: Props = $props();

	const VIEW_KEY = "binradar:view";
	const LAYERS = ["bins", "mapillary"];

	let container: HTMLDivElement;
	let map: Map | undefined = $state.raw();

	function selectedData(): GeoJSON.FeatureCollection {
		if (!selection) return EMPTY;
		return {
			type: "FeatureCollection",
			features: [{ type: "Feature", geometry: { type: "Point", coordinates: selection.lngLat }, properties: {} }],
		};
	}

	function emitView(m: Map) {
		const bounds = m.getBounds();
		const view = {
			zoom: m.getZoom(),
			west: bounds.getWest(),
			south: bounds.getSouth(),
			east: bounds.getEast(),
			north: bounds.getNorth(),
		};
		onview(view);
		try {
			localStorage.setItem(VIEW_KEY, JSON.stringify({ center: m.getCenter().toArray(), zoom: view.zoom }));
		} catch {}
	}

	onMount(() => {
		let start = { center: [13.405, 52.52] as [number, number], zoom: 15 };
		try {
			start = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "") ?? start;
		} catch {}

		const m = new Map({ container, ...start, attributionControl: { compact: true } });
		m.addControl(new NavigationControl({ showCompass: false }));
		m.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }));

		m.on("load", () => emitView(m));
		m.on("moveend", () => emitView(m));
		m.on("click", (e) => {
			const { x, y } = e.point;
			const layers = LAYERS.filter((id) => m.getLayer(id));
			// A few pixels of slack, so bins are easy to hit with a finger.
			const [feature] = m.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]], { layers });
			onselect(
				feature
					? {
							kind: feature.layer.id === "bins" ? "bin" : "mapillary",
							lngLat: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
							properties: { ...feature.properties, id: feature.properties.id ?? feature.id },
						}
					: null,
			);
		});
		for (const id of LAYERS) {
			m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
			m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
		}

		map = m;
		return () => m.remove();
	});

	// Swaps the basemap whenever the theme changes, adding our overlays back in
	// their current state.
	$effect(() => {
		map?.setStyle(BASEMAPS[theme], {
			transformStyle: (_, next) =>
				untrack(() => withOverlays(next, { bins, mapillary, mapillaryData, selected: selectedData() })),
		});
	});

	// Each effect reads its prop before touching the map: while the style is
	// still loading the layer is missing, and a prop read only after that check
	// would never become a dependency.
	$effect(() => {
		const visibility = bins ? "visible" : "none";
		if (map?.getLayer("bins")) map.setLayoutProperty("bins", "visibility", visibility);
	});
	$effect(() => {
		const visibility = mapillary ? "visible" : "none";
		if (map?.getLayer("mapillary")) map.setLayoutProperty("mapillary", "visibility", visibility);
	});
	$effect(() => {
		const data = mapillaryData;
		map?.getSource<GeoJSONSource>("mapillary")?.setData(data);
	});
	$effect(() => {
		const data = selectedData();
		map?.getSource<GeoJSONSource>("selected")?.setData(data);
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		position: absolute;
		inset: 0;
	}
</style>
