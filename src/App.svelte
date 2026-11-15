<script lang="ts">
	import MapView, { type Selection } from "./lib/MapView.svelte";
	import {
		MAPILLARY_MINZOOM,
		createMapillaryLoader,
		mapillaryEnabled,
		photoUrl,
		type MapillaryStatus,
		type View,
	} from "./lib/mapillary";
	import { BINS_MINZOOM, BIN_CLASSES, EMPTY, MAPILLARY_COLOR, STALE_BEFORE, type BinClass, type Theme } from "./lib/style";

	type ThemeSetting = "auto" | Theme;

	// Per-device preferences; the app works the same without storage.
	function stored<T>(key: string, fallback: T): T {
		try {
			const value = localStorage.getItem(`binradar:${key}`);
			return value === null ? fallback : JSON.parse(value);
		} catch {
			return fallback;
		}
	}
	function store(key: string, value: unknown) {
		try {
			localStorage.setItem(`binradar:${key}`, JSON.stringify(value));
		} catch {}
	}

	const THEMES: ThemeSetting[] = ["auto", "light", "dark"];
	let themeSetting = $state(stored<ThemeSetting>("theme", "auto"));
	let showBins = $state(stored("bins", true));
	let showMapillary = $state(mapillaryEnabled && stored("mapillary", false));
	$effect(() => store("theme", themeSetting));
	$effect(() => store("bins", showBins));
	$effect(() => store("mapillary", showMapillary));

	const darkQuery = matchMedia("(prefers-color-scheme: dark)");
	let prefersDark = $state(darkQuery.matches);
	$effect(() => {
		const listener = () => (prefersDark = darkQuery.matches);
		darkQuery.addEventListener("change", listener);
		return () => darkQuery.removeEventListener("change", listener);
	});
	const theme: Theme = $derived(themeSetting === "auto" ? (prefersDark ? "dark" : "light") : themeSetting);
	$effect(() => {
		document.documentElement.dataset.theme = theme;
	});

	let view = $state.raw<View>();
	let selection = $state.raw<Selection | null>(null);
	let expanded = $state(false);

	let mapillaryData = $state.raw(EMPTY);
	let mapillaryStatus = $state<MapillaryStatus>("idle");
	const loadMapillary = createMapillaryLoader((data, status) => {
		mapillaryData = data;
		mapillaryStatus = status;
	});
	$effect(() => {
		if (showMapillary && view) loadMapillary(view);
	});

	let photo = $state<string>();
	$effect(() => {
		photo = undefined;
		if (selection?.kind !== "mapillary") return;
		const current = selection;
		photoUrl(String(current.properties.id), current.lngLat).then((url) => {
			if (selection === current) photo = url;
		});
	});

	const binClass = $derived(
		selection?.kind === "bin" ? (BIN_CLASSES[selection.properties.class as BinClass] ?? BIN_CLASSES.waste_basket) : undefined,
	);
	const directions = $derived(
		selection &&
			`https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B${selection.lngLat[1]}%2C${selection.lngLat[0]}`,
	);
	const formatDate = (ms: unknown) => new Date(Number(ms)).toLocaleDateString("en", { year: "numeric", month: "long" });

	function select(next: Selection | null) {
		selection = next;
		if (next) expanded = false;
	}
</script>

<div class="app">
	<main class="map">
		<MapView
			{theme}
			bins={showBins}
			mapillary={showMapillary}
			{mapillaryData}
			{selection}
			onselect={select}
			onview={(v) => (view = v)}
		/>
	</main>

	<aside class="panel" class:expanded>
		<button class="handle" onclick={() => (expanded = !expanded)} aria-expanded={expanded} aria-label="Toggle settings">
			<span></span>
		</button>

		<header>
			<h1>BinRadar</h1>
			<p>Find the nearest public waste bin.</p>
		</header>

		{#if view && view.zoom < BINS_MINZOOM}
			<p class="hint">Zoom in to see bins.</p>
		{/if}

		{#if selection}
			<section class="details">
				<button class="close" onclick={() => (selection = null)} aria-label="Close">×</button>
				{#if selection.kind === "bin" && binClass}
					<h2><span class="dot" style:background={binClass.color}></span>{binClass.label}</h2>
					{#if selection.properties.name}<p>{selection.properties.name}</p>{/if}
					{#if selection.properties.waste}<p>Accepts: {String(selection.properties.waste).replaceAll(";", ", ")}</p>{/if}
					{#if selection.properties.recycling_type}<p>Type: {selection.properties.recycling_type}</p>{/if}
					{#if selection.properties.opening_hours}<p>Open: {selection.properties.opening_hours}</p>{/if}
					{#if selection.properties.precision === "low"}<p class="muted">Only tagged as bin=yes in OpenStreetMap.</p>{/if}
					<p class="links">
						<a href={directions} target="_blank" rel="noopener">Directions</a>
						<a href="https://www.openstreetmap.org/node/{selection.properties.id}" target="_blank" rel="noopener">OpenStreetMap</a>
					</p>
				{:else}
					<h2><span class="dot ring" style:border-color={MAPILLARY_COLOR}></span>Trash can on Mapillary</h2>
					<p>Detected in street-level photos, not confirmed in OpenStreetMap.</p>
					<p class:stale={Number(selection.properties.last_seen) < STALE_BEFORE}>
						Last seen {formatDate(selection.properties.last_seen)}
					</p>
					<p class="links">
						<a href={directions} target="_blank" rel="noopener">Directions</a>
						{#if photo}<a href={photo} target="_blank" rel="noopener">Photo on Mapillary</a>{/if}
					</p>
				{/if}
			</section>
		{/if}

		<div class="more">
			<section>
				<h2>Layers</h2>
				<label><input type="checkbox" bind:checked={showBins} /> Bins from OpenStreetMap</label>
				<label class:disabled={!mapillaryEnabled}>
					<input type="checkbox" bind:checked={showMapillary} disabled={!mapillaryEnabled} />
					Trash cans detected by Mapillary
				</label>
				{#if !mapillaryEnabled}
					<p class="muted">No Mapillary token configured.</p>
				{:else if showMapillary && mapillaryStatus === "zoom-in"}
					<p class="muted">Zoom in to level {MAPILLARY_MINZOOM} to load Mapillary detections.</p>
				{:else if showMapillary && mapillaryStatus === "loading"}
					<p class="muted">Loading Mapillary detections…</p>
				{:else if showMapillary && mapillaryStatus === "error"}
					<p class="muted">Couldn't load all Mapillary detections; moving the map retries.</p>
				{/if}
			</section>

			<section>
				<h2>Legend</h2>
				<ul class="legend">
					{#each Object.values(BIN_CLASSES) as { label, color } (label)}
						<li><span class="dot" style:background={color}></span>{label}</li>
					{/each}
					<li><span class="dot ring" style:border-color={MAPILLARY_COLOR}></span>Mapillary detection</li>
				</ul>
			</section>

			<section>
				<h2>Theme</h2>
				<div class="segmented" role="radiogroup" aria-label="Theme">
					{#each THEMES as option (option)}
						<button role="radio" aria-checked={themeSetting === option} onclick={() => (themeSetting = option)}>
							{option[0].toUpperCase() + option.slice(1)}
						</button>
					{/each}
				</div>
			</section>
		</div>
	</aside>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
	.map {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	/* Phones: a bottom sheet under the map that expands for the settings. */
	.panel {
		position: relative;
		max-height: 60dvh;
		overflow-y: auto;
		padding: 4px 16px calc(12px + env(safe-area-inset-bottom));
		background: var(--surface);
		border-top: 1px solid var(--border);
	}
	.handle {
		display: block;
		width: 100%;
		padding: 6px 0 10px;
		background: none;
		border: 0;
		cursor: pointer;
	}
	.handle span {
		display: block;
		width: 40px;
		height: 4px;
		margin: 0 auto;
		border-radius: 2px;
		background: var(--border-strong);
	}
	.more {
		display: none;
	}
	.expanded .more {
		display: block;
	}

	/* Wider screens: a sidebar with everything visible. */
	@media (min-width: 768px) {
		.app {
			flex-direction: row-reverse;
		}
		.panel {
			width: 340px;
			max-height: none;
			padding: 20px;
			border-top: 0;
			border-right: 1px solid var(--border);
		}
		.handle {
			display: none;
		}
		.more {
			display: block;
		}
	}

	header h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	header p {
		margin: 2px 0 0;
		color: var(--muted);
	}
	section {
		position: relative;
		margin-top: 16px;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
		font-size: 0.95rem;
	}
	p {
		margin: 4px 0;
	}
	.hint {
		margin-top: 12px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--accent-soft);
	}
	.details {
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.close {
		position: absolute;
		top: 4px;
		right: 8px;
		padding: 4px 8px;
		background: none;
		border: 0;
		color: var(--muted);
		font-size: 1.4rem;
		cursor: pointer;
	}
	.links {
		display: flex;
		gap: 16px;
		margin-top: 8px;
	}
	.muted,
	.disabled {
		color: var(--muted);
	}
	.stale {
		color: #e8590c;
	}
	label {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
	}
	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}
	.dot {
		flex: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1.5px solid #fff;
		box-shadow: 0 0 0 1px var(--border);
	}
	.dot.ring {
		background: transparent;
		border-width: 2px;
		box-shadow: none;
	}
	.segmented {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.segmented button {
		flex: 1;
		padding: 6px 0;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.segmented button[aria-checked="true"] {
		background: var(--accent);
		color: #fff;
	}
</style>
