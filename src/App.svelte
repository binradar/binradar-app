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
	import { MediaQuery } from "svelte/reactivity";

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

	const prefersDark = new MediaQuery("prefers-color-scheme: dark");
	const theme: Theme = $derived(themeSetting === "auto" ? (prefersDark.current ? "dark" : "light") : themeSetting);
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
		// Tapping the map brings it back into view.
		expanded = false;
	}

	// Phones get a sheet over the map that rests with its top part showing
	// (title, hint, selection) and is tapped or dragged up for the rest.
	const wide = new MediaQuery("min-width: 768px");
	let panel: HTMLElement;
	let sheetHeight = $state(0);
	let peekHeight = $state(0);
	let moreHeight = $state(0);
	let safeArea = $state(0);
	let dragOffset = $state<number | null>(null);
	const peek = $derived(peekHeight + safeArea);
	const collapsedOffset = $derived(Math.max(0, sheetHeight - peek));
	const offset = $derived(dragOffset ?? (expanded ? 0 : collapsedOffset));
	// Only a sheet taller than the screen allows scrolls its lower part.
	const scrolls = $derived(expanded && peekHeight + moreHeight > sheetHeight + 1);

	$effect(() => {
		if (!expanded) panel.scrollTo({ top: 0, behavior: "smooth" });
	});

	let drag: { id: number; startY: number; startOffset: number; moved: boolean; y: number; time: number; velocity: number } | undefined;
	// A drag can end in a click on whatever it started on, which must not count.
	let swallowClick = false;

	function dragStart(e: PointerEvent) {
		swallowClick = false;
		if (wide.current || !e.isPrimary || e.button !== 0) return;
		if (scrolls && (e.target as Element).closest(".more")) return;
		// Read from the screen, so a sheet can be caught mid-animation.
		const { m42 } = new DOMMatrix(getComputedStyle(panel).transform);
		drag = { id: e.pointerId, startY: e.clientY, startOffset: m42, moved: false, y: e.clientY, time: e.timeStamp, velocity: 0 };
	}

	function dragMove(e: PointerEvent) {
		if (e.pointerId !== drag?.id) return;
		const dy = e.clientY - drag.startY;
		if (!drag.moved) {
			// Small wobbles are still taps.
			if (Math.abs(dy) < 8) return;
			drag.moved = true;
			panel.setPointerCapture(e.pointerId);
		}
		drag.velocity = (e.clientY - drag.y) / Math.max(1, e.timeStamp - drag.time);
		drag.y = e.clientY;
		drag.time = e.timeStamp;
		dragOffset = Math.min(Math.max(drag.startOffset + dy, 0), collapsedOffset);
	}

	function dragEnd(e: PointerEvent) {
		if (e.pointerId !== drag?.id) return;
		if (drag.moved && dragOffset !== null) {
			// A flick goes where it points; otherwise the sheet settles at the closer end.
			const velocity = e.timeStamp - drag.time < 100 ? drag.velocity : 0;
			expanded = Math.abs(velocity) > 0.4 ? velocity < 0 : dragOffset < collapsedOffset / 2;
			swallowClick = true;
		}
		drag = undefined;
		dragOffset = null;
	}

	function dropClick(e: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		e.stopPropagation();
		e.preventDefault();
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
			inset={wide.current ? 0 : peek}
			onselect={select}
			onview={(v) => (view = v)}
		/>
	</main>

	<aside
		class="panel"
		class:expanded
		class:dragging={dragOffset !== null}
		class:scrolls
		style:--offset={sheetHeight ? `${offset}px` : undefined}
		bind:this={panel}
		bind:offsetHeight={sheetHeight}
		onpointerdown={dragStart}
		onpointermove={dragMove}
		onpointerup={dragEnd}
		onpointercancel={dragEnd}
		onclickcapture={dropClick}
	>
		<div class="peek" bind:offsetHeight={peekHeight}>
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
						{#if selection.properties.recycling}
							<p>Accepts: {String(selection.properties.recycling).replaceAll(";", ", ").replaceAll("_", " ")}</p>
						{/if}
						{#if selection.properties.recycling_type}<p>Type: {selection.properties.recycling_type}</p>{/if}
						{#if selection.properties.opening_hours}<p>Open: {selection.properties.opening_hours}</p>{/if}
						{#if selection.properties.operator}<p class="muted">Operated by {selection.properties.operator}</p>{/if}
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
		</div>

		<div class="more" bind:offsetHeight={moreHeight} inert={!expanded && !wide.current}>
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

	<!-- Measures the strip the home indicator covers, which the resting sheet must clear. -->
	<div class="safe-area" bind:offsetHeight={safeArea}></div>
</div>

<style>
	.app {
		position: relative;
		display: flex;
		height: 100dvh;
		overflow: hidden;
	}
	.map {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.panel {
		background: var(--surface);
	}
	.peek {
		padding: 4px 16px 16px;
	}
	.more {
		padding: 0 16px calc(16px + env(safe-area-inset-bottom));
	}
	.more section:first-child {
		margin-top: 0;
	}
	.safe-area {
		position: absolute;
		inset: auto 0 0;
		height: env(safe-area-inset-bottom);
		visibility: hidden;
		pointer-events: none;
	}

	/* Phones: a sheet over the map, dragged or tapped open for the settings. */
	@media (max-width: 767px) {
		.panel {
			position: absolute;
			inset: auto 0 0;
			max-height: 85dvh;
			overflow: hidden;
			border-radius: 14px 14px 0 0;
			box-shadow:
				0 0 0 1px var(--border),
				0 -2px 14px rgb(0 0 0 / 0.15);
			transform: translateY(var(--offset, 100%));
			transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
		}
		.panel.dragging {
			transition: none;
		}
		.panel.scrolls {
			overflow-y: auto;
			overscroll-behavior: contain;
		}
		/* Gestures on the sheet move it, except where its content scrolls. */
		.peek,
		.more {
			touch-action: none;
		}
		.scrolls .more {
			touch-action: pan-y;
		}
		.peek {
			-webkit-user-select: none;
			user-select: none;
		}
		.more {
			transition: opacity 0.2s;
		}
		.panel:not(.expanded, .dragging) .more {
			opacity: 0;
		}
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
	/* Wider screens: a sidebar with everything visible. */
	@media (min-width: 768px) {
		.app {
			flex-direction: row-reverse;
		}
		.panel {
			flex: none;
			width: 340px;
			overflow-y: auto;
			border-right: 1px solid var(--border);
		}
		.peek {
			padding: 20px 20px 16px;
		}
		.more {
			padding: 0 20px 20px;
		}
		.handle {
			display: none;
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
