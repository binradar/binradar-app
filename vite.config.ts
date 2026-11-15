import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const DAY = 24 * 60 * 60;

export default defineConfig({
	// Served from GitHub Pages at https://binradar.github.io/binradar-app/.
	base: "/binradar-app/",
	// MapLibre alone is about 1 MB minified.
	build: { chunkSizeWarningLimit: 1500 },
	plugins: [
		svelte(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["favicon.svg", "apple-touch-icon.png"],
			manifest: {
				name: "BinRadar",
				short_name: "BinRadar",
				description: "Find the nearest public waste bin.",
				theme_color: "#1971c2",
				background_color: "#ffffff",
				display: "standalone",
				icons: [
					{ src: "pwa-192.png", sizes: "192x192", type: "image/png" },
					{ src: "pwa-512.png", sizes: "512x512", type: "image/png" },
					{ src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,mjs,css,html,svg,png}"],
				// MapLibre and its worker are larger than workbox's 2 MiB default.
				maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
				runtimeCaching: [
					{
						// Vector tiles under a versioned planet path, fonts and sprites.
						urlPattern: ({ url }) =>
							url.origin === "https://tiles.openfreemap.org" &&
							/^\/(planet\/[^/]+\/|fonts\/|sprites\/)/.test(url.pathname),
						handler: "CacheFirst",
						options: {
							cacheName: "openfreemap",
							expiration: { maxEntries: 5000, maxAgeSeconds: 30 * DAY },
							cacheableResponse: { statuses: [200] },
						},
					},
					{
						// Styles and TileJSON, which point at the current planet version.
						urlPattern: ({ url }) => url.origin === "https://tiles.openfreemap.org",
						handler: "StaleWhileRevalidate",
						options: { cacheName: "openfreemap-styles" },
					},
					{
						urlPattern: ({ url }) => url.href.startsWith("https://binradar.github.io/binradar-tiles/"),
						handler: "StaleWhileRevalidate",
						options: {
							cacheName: "bins",
							expiration: { maxEntries: 5000, maxAgeSeconds: 7 * DAY },
							cacheableResponse: { statuses: [200] },
						},
					},
					// Mapillary is left out on purpose: its API answers "no-store".
				],
			},
		}),
	],
});
