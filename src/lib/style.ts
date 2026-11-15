import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

export type Theme = "light" | "dark";

export const BASEMAPS: Record<Theme, string> = {
	light: "https://tiles.openfreemap.org/styles/positron",
	dark: "https://tiles.openfreemap.org/styles/dark",
};

// The bins (built in binradar/binradar-tiles) exist at zoom 14 only; MapLibre
// overzooms them above that and shows nothing below.
export const BINS_MINZOOM = 14;
const BINS_TILES = "https://binradar.github.io/binradar-tiles/bins/{z}/{x}/{y}.pbf";

export const BIN_CLASSES = {
	waste_basket: { label: "Waste basket", color: "#1971c2" },
	recycling: { label: "Recycling", color: "#2b8a3e" },
	waste_disposal: { label: "Waste disposal", color: "#e8590c" },
} as const;
export type BinClass = keyof typeof BIN_CLASSES;

export const MAPILLARY_COLOR = "#9c36b5";
// Detections not seen since then are drawn faded: the bin may well be gone.
export const STALE_BEFORE = Date.UTC(2020, 0, 1);

export const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export interface Overlays {
	bins: boolean;
	mapillary: boolean;
	mapillaryData: GeoJSON.FeatureCollection;
	selected: GeoJSON.FeatureCollection;
}

const radius: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 14, 4, 18, 9];
const visibility = (on: boolean) => (on ? "visible" : "none");

// Adds our sources and layers on top of a basemap style. Used for every style
// load, so the overlays survive switching between light and dark.
export function withOverlays(style: StyleSpecification, overlays: Overlays): StyleSpecification {
	const layers: LayerSpecification[] = [
		{
			id: "mapillary",
			type: "circle",
			source: "mapillary",
			layout: { visibility: visibility(overlays.mapillary) },
			paint: {
				"circle-radius": radius,
				"circle-color": MAPILLARY_COLOR,
				"circle-opacity": 0.15,
				"circle-stroke-color": MAPILLARY_COLOR,
				"circle-stroke-width": 2,
				"circle-stroke-opacity": ["case", ["<", ["get", "last_seen"], STALE_BEFORE], 0.35, 1],
			},
		},
		{
			id: "bins",
			type: "circle",
			source: "bins",
			"source-layer": "bins",
			layout: { visibility: visibility(overlays.bins) },
			paint: {
				"circle-radius": radius,
				"circle-color": [
					"match", ["get", "class"],
					"recycling", BIN_CLASSES.recycling.color,
					"waste_disposal", BIN_CLASSES.waste_disposal.color,
					BIN_CLASSES.waste_basket.color,
				],
				// bin=yes proxies are a weaker signal than a proper amenity tag.
				"circle-opacity": ["case", ["==", ["get", "precision"], "low"], 0.5, 1],
				"circle-stroke-color": "#ffffff",
				"circle-stroke-width": 1.5,
			},
		},
		{
			id: "selected",
			type: "circle",
			source: "selected",
			paint: {
				"circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 9, 18, 15],
				"circle-color": "transparent",
				"circle-stroke-color": "#fab005",
				"circle-stroke-width": 3,
			},
		},
	];

	return {
		...style,
		sources: {
			...style.sources,
			bins: { type: "vector", tiles: [BINS_TILES], minzoom: BINS_MINZOOM, maxzoom: BINS_MINZOOM },
			mapillary: {
				type: "geojson",
				data: overlays.mapillaryData,
				attribution: '<a href="https://www.mapillary.com" target="_blank">© Mapillary</a>',
			},
			selected: { type: "geojson", data: overlays.selected },
		},
		layers: [...style.layers, ...layers],
	};
}
