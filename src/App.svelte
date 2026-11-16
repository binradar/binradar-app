<script lang="ts">
	import { MediaQuery } from "svelte/reactivity";
	import MapView, { type Selection } from "./lib/MapView.svelte";
	import { findPhoto, mapillaryEnabled, viewerUrl } from "./lib/mapillary";
	import { directionsLinks } from "./lib/directions";
	import { findPhotos, streetLevelLinks, type Photos } from "./lib/streetLevel";
	import { BINS_MINZOOM, BIN_CLASSES, MAPILLARY_COLOR, STALE_BEFORE, type BinClass, type Theme } from "./lib/style";

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

	let zoom = $state<number>();
	let selection = $state.raw<Selection | null>(null);
	let expanded = $state(false);

	// The viewer link shows right away and gains the photo once Mapillary names one.
	let photo = $state<string>();
	$effect(() => {
		photo = undefined;
		if (selection?.kind !== "mapillary") return;
		const current = selection;
		findPhoto(String(current.properties.id)).then((id) => {
			if (selection === current) photo = id;
		});
	});
	const viewer = $derived(
		selection?.kind === "mapillary" ? viewerUrl(String(selection.properties.id), selection.lngLat, photo) : undefined,
	);

	const binClass = $derived(
		selection?.kind === "bin" ? (BIN_CLASSES[selection.properties.class as BinClass] ?? BIN_CLASSES.waste_basket) : undefined,
	);
	// recycling_type=container or =centre goes into the title, "Recycling
	// container"; any other value gets a line of its own.
	const recyclingType = $derived(selection?.kind === "bin" ? selection.properties.recycling_type : undefined);
	const titledType = $derived(recyclingType === "container" || recyclingType === "centre");
	// What goes in, from waste=* and recycling:*=yes alike, as words:
	// "trash;dog_excrement" reads "trash, dog excrement".
	const accepts = $derived.by(() => {
		if (selection?.kind !== "bin") return undefined;
		const { waste, recycling } = selection.properties;
		const values = [waste, recycling].filter(Boolean).flatMap((value) => String(value).split(";"));
		return [...new Set(values.map((value) => value.trim().replaceAll("_", " ")))].join(", ");
	});
	// Where a bin=yes bin is, from the object it was tagged on (the tiles'
	// list in process.lua): "highway=bus_stop" reads "At bus stop
	// Alexanderplatz". The name in the tiles is that object's.
	const HOST_LABELS: Record<string, string> = {
		"highway=bus_stop": "bus stop",
		"railway=tram_stop": "tram stop",
		"highway=platform": "stop",
		"public_transport=platform": "stop",
		"public_transport=stop_position": "stop",
		"vending=excrement_bags": "dog waste bag dispenser",
		"amenity=shelter": "shelter",
		"amenity=bench": "bench",
		"amenity=parking": "car park",
		"highway=street_lamp": "street lamp",
	};
	const host = $derived.by(() => {
		const tag = selection?.kind === "bin" ? selection.properties.host : undefined;
		if (typeof tag !== "string") return undefined;
		const label = HOST_LABELS[tag] ?? tag.slice(tag.indexOf("=") + 1).replaceAll("_", " ");
		const name = selection?.properties.name;
		return name ? `At ${label} ${name}` : `At ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
	});
	const directions = $derived(selection ? directionsLinks(selection.lngLat) : []);
	// Likewise the street-level links, as each service names a photo nearby.
	let nearby = $state<Photos>({});
	$effect(() => {
		nearby = {};
		if (!selection) return;
		const current = selection;
		const found = (photos: Photos) => {
			if (selection === current) nearby = { ...nearby, ...photos };
		};
		findPhotos(current.lngLat, found, { mapillary: current.kind !== "mapillary" });
	});
	const streetLevel = $derived.by(() => {
		if (!selection) return [];
		const links = streetLevelLinks(selection.lngLat, nearby);
		// Detections link the Mapillary photo they were made in already.
		return selection.kind === "mapillary" ? links.filter(({ label }) => label !== "Mapillary") : links;
	});
	const formatDate = (ms: unknown) => new Date(Number(ms)).toLocaleDateString("en", { year: "numeric", month: "long" });

	function select(next: Selection | null) {
		selection = next;
		// Tapping the map brings it back into view.
		expanded = false;
	}

	function zoomed(z: number) {
		zoom = z;
		// Zoomed out too far to see bins, none stays selected. A picked spot
		// does not depend on them.
		if (z < BINS_MINZOOM && selection?.kind !== "place") selection = null;
	}

	// Phones get a sheet over the map that rests showing its top part (title,
	// hint, selection) and is dragged or tapped open for the settings; wider
	// screens a sidebar. The sheet is as tall as the screen and moves by its
	// offset: how much of it is pushed below the bottom edge.
	const wide = new MediaQuery("min-width: 768px");
	let sheet = $state<HTMLElement>();
	let more = $state<HTMLElement>();
	let sheetHeight = $state(0);
	let peekHeight = $state(0);
	let settingsHeight = $state(0);
	let safeArea = $state(0);
	const peek = $derived(peekHeight + safeArea);
	// Open, the sheet fits its content; content about as tall as the screen
	// fills it instead, and scrolls only if it does not fit.
	const content = $derived(peekHeight + settingsHeight);
	const fills = $derived(content > sheetHeight * 0.9);
	const scrolls = $derived(content > sheetHeight);
	const restOffset = $derived(sheetHeight - peek);
	const openOffset = $derived(fills ? 0 : sheetHeight - content);
	let dragOffset = $state<number | null>(null);
	const offset = $derived(dragOffset ?? (expanded ? openOffset : restOffset));

	$effect(() => {
		if (!expanded) more?.scrollTo({ top: 0, behavior: "smooth" });
	});

	// Past either end the sheet still gives, less the further it is pulled.
	const rubberBand = (distance: number, limit = 120) => limit * (1 - 1 / ((distance * 0.55) / limit + 1));
	function resist(raw: number) {
		if (raw < openOffset) return openOffset - rubberBand(openOffset - raw);
		if (raw > restOffset) return restOffset + rubberBand(raw - restOffset);
		return raw;
	}

	let drag: { id: number; startY: number; startOffset: number; raw: number; moved: boolean; y: number; time: number; velocity: number } | undefined;
	// A drag can end in a click on whatever it started on, which must not count.
	let dragged = false;

	function press(e: PointerEvent) {
		dragged = false;
		if (!sheet || !e.isPrimary || e.button !== 0) return;
		// Settings that scroll are scrolled, and the sheet moved by its top part.
		if (expanded && scrolls && (e.target as Element).closest(".more")) return;
		// Read from the screen, so a sheet can be caught mid-animation.
		const { m42 } = new DOMMatrix(getComputedStyle(sheet).transform);
		drag = { id: e.pointerId, startY: e.clientY, startOffset: m42, raw: m42, moved: false, y: e.clientY, time: e.timeStamp, velocity: 0 };
	}

	function move(e: PointerEvent) {
		if (!sheet || e.pointerId !== drag?.id) return;
		const dy = e.clientY - drag.startY;
		if (!drag.moved) {
			// Small wobbles are still taps.
			if (Math.abs(dy) < 6) return;
			drag.moved = true;
			sheet.setPointerCapture(e.pointerId);
		}
		drag.velocity = (e.clientY - drag.y) / Math.max(1, e.timeStamp - drag.time);
		drag.y = e.clientY;
		drag.time = e.timeStamp;
		drag.raw = drag.startOffset + dy;
		dragOffset = resist(drag.raw);
	}

	function release(e: PointerEvent) {
		if (e.pointerId !== drag?.id) return;
		if (drag.moved) {
			// A flick goes where it points; otherwise the sheet settles at the
			// closer end.
			const velocity = e.timeStamp - drag.time < 100 ? drag.velocity : 0;
			expanded = Math.abs(velocity) > 0.4 ? velocity < 0 : drag.raw < (openOffset + restOffset) / 2;
			dragged = true;
		}
		drag = undefined;
		dragOffset = null;
	}

	function dropClick(e: MouseEvent) {
		if (!dragged) return;
		dragged = false;
		e.stopPropagation();
		e.preventDefault();
	}
</script>

<!-- Collapsed, one open at a time; open stays as the user left it from one
     selection to the next unless `open` itself changes. -->
{#snippet linkGroup(title: string, links: { label: string; url: string }[], open = false)}
	<details class="group" name="links" {open}>
		<summary>{title}</summary>
		<p class="links">
			{#each links as { label, url } (label)}
				<!-- A geo: link in a new tab would leave an empty one behind. -->
				<a href={url} target={url.startsWith("http") ? "_blank" : undefined} rel="noopener">{label}</a>
			{/each}
		</p>
	</details>
{/snippet}

{#snippet top()}
	{#if !selection}
		<header><h1>BinRadar</h1></header>
	{/if}

	{#if zoom !== undefined && zoom < BINS_MINZOOM}
		<p class="hint">Zoom in to see bins.</p>
	{/if}

	{#if selection}
		<section class="details">
			<button class="close" onclick={() => (selection = null)} aria-label="Close">×</button>
			{#if selection.kind === "bin" && binClass}
				<h2><span class="dot" style:background={binClass.color}></span>{titledType ? `${binClass.label} ${recyclingType}` : binClass.label}</h2>
				{#if host}
					<p>{host}</p>
				{:else if selection.properties.name}
					<p>{selection.properties.name}</p>
				{/if}
				{#if accepts}<p>Accepts {accepts}</p>{/if}
				{#if recyclingType && !titledType}<p>Type: {recyclingType}</p>{/if}
				{#if selection.properties.opening_hours}<p>Open: {selection.properties.opening_hours}</p>{/if}
				<!-- The host line says as much already. -->
				{#if selection.properties.precision === "low" && !host}<p class="muted">Only tagged as bin=yes in OpenStreetMap.</p>{/if}
				<p class="muted">
					{#if selection.properties.operator}Operated by {selection.properties.operator} ·{/if}
					<a href="https://www.openstreetmap.org/node/{selection.properties.id}" target="_blank" rel="noopener">
						View on OpenStreetMap
					</a>
				</p>
			{:else if selection.kind === "mapillary"}
				<h2><span class="dot ring" style:border-color={MAPILLARY_COLOR}></span>Trash can on Mapillary</h2>
				<p>Detected in street-level photos, not confirmed in OpenStreetMap.</p>
				<p class="muted">
					<span class:stale={Number(selection.properties.last_seen_at) < STALE_BEFORE}>
						Last seen {formatDate(selection.properties.last_seen_at)}
					</span>
					· <a href={viewer} target="_blank" rel="noopener">View on Mapillary</a>
				</p>
			{:else}
				<h2>Selected spot</h2>
				<p class="muted">{selection.lngLat[1].toFixed(5)}, {selection.lngLat[0].toFixed(5)}</p>
			{/if}
			<div class="groups">
				{@render linkGroup("Directions", directions)}
				<!-- A spot is picked to look at it. -->
				{@render linkGroup("Street-level photos", streetLevel, selection.kind === "place")}
			</div>
		</section>
	{/if}
{/snippet}

{#snippet settings()}
	<section>
		<h2>Layers</h2>
		<label><input type="checkbox" bind:checked={showBins} /> Bins from OpenStreetMap</label>
		<ul class="legend">
			{#each Object.values(BIN_CLASSES) as { label, color } (label)}
				<li><span class="dot" style:background={color}></span>{label}</li>
			{/each}
		</ul>
		<label class:disabled={!mapillaryEnabled}>
			<input type="checkbox" bind:checked={showMapillary} disabled={!mapillaryEnabled} />
			Trash cans detected by Mapillary
		</label>
		<ul class="legend">
			<li>
				<span class="dot ring" style:border-color={MAPILLARY_COLOR}></span>Faded if not seen since {new Date(STALE_BEFORE).getUTCFullYear()}
			</li>
		</ul>
		{#if !mapillaryEnabled}
			<p class="note muted">No Mapillary token configured.</p>
		{:else if showMapillary}
			<p class="note muted">Loads several MB per area in city centres.</p>
		{/if}
		<p class="note muted">Right-click or long-press the map to see street-level photos of any spot.</p>
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
{/snippet}

<div class="app">
	<main class="map">
		<MapView
			{theme}
			bins={showBins}
			mapillary={showMapillary}
			{selection}
			inset={wide.current ? 0 : peek}
			onselect={select}
			onzoom={zoomed}
		/>
	</main>

	{#if wide.current}
		<aside class="sidebar">
			{@render top()}
			<div class="settings">{@render settings()}</div>
		</aside>
	{:else}
		<aside
			class="sheet"
			class:expanded
			class:dragging={dragOffset !== null}
			aria-label="BinRadar"
			style:transform={sheetHeight ? `translate3d(0, ${offset}px, 0)` : undefined}
			bind:this={sheet}
			bind:offsetHeight={sheetHeight}
			onpointerdown={press}
			onpointermove={move}
			onpointerup={release}
			onpointercancel={release}
			onclickcapture={dropClick}
		>
			<div class="peek" bind:offsetHeight={peekHeight}>
				<button class="handle" onclick={() => (expanded = !expanded)} aria-expanded={expanded} aria-label="Toggle settings">
					<span></span>
				</button>
				{@render top()}
			</div>
			<div class="more" class:scrolls bind:this={more} inert={!expanded}>
				<div class="settings" bind:offsetHeight={settingsHeight}>{@render settings()}</div>
			</div>
		</aside>
	{/if}

	<!-- Measures the strip the home indicator covers, which the resting sheet must clear. -->
	<div class="safe-area" bind:offsetHeight={safeArea}></div>
</div>

<style>
	.app {
		position: relative;
		display: flex;
		flex-direction: row-reverse;
		height: 100dvh;
		overflow: hidden;
	}
	.map {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.safe-area {
		position: absolute;
		inset: auto 0 0;
		height: env(safe-area-inset-bottom);
		visibility: hidden;
		pointer-events: none;
	}

	/* Wider screens: a sidebar with everything visible. */
	.sidebar {
		flex: none;
		width: 340px;
		overflow-y: auto;
		padding: 20px;
		background: var(--surface);
		border-right: 1px solid var(--border);
	}

	/* Phones: a full-height sheet, moved by transform. */
	.sheet {
		position: fixed;
		inset: auto 0 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--surface);
		border-radius: 14px 14px 0 0;
		box-shadow:
			0 0 0 1px var(--border),
			0 -2px 14px rgb(0 0 0 / 0.15);
		transform: translate3d(0, 100%, 0);
		transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1);
		touch-action: none;
		will-change: transform;
	}
	/* Fills the gap below a sheet pulled up past the top of the screen. */
	.sheet::after {
		content: "";
		position: absolute;
		inset: 100% 0 auto;
		height: 100%;
		background: inherit;
	}
	.sheet.dragging {
		transition: none;
	}
	.peek {
		padding: 4px 16px 16px;
		-webkit-user-select: none;
		user-select: none;
	}
	.more {
		transition: opacity 0.2s;
	}
	.sheet:not(.expanded, .dragging) .more {
		opacity: 0;
	}
	.more.scrolls {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
	}
	.more .settings {
		padding: 0 16px calc(16px + env(safe-area-inset-bottom));
	}
	.settings > :global(section:first-child) {
		margin-top: 0;
	}
	.sidebar .settings > :global(section:first-child) {
		margin-top: 16px;
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

	header h1 {
		margin: 0;
		font-size: 1.25rem;
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
		margin: 0;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--accent-soft);
	}
	/* The details take the header's place at the top. */
	.details {
		margin-top: 0;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	header + .hint,
	.hint + .details {
		margin-top: 12px;
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
		flex-wrap: wrap;
		gap: 4px 16px;
		margin: 0 0 6px 14px;
	}
	/* Wraps after the operator as a whole. */
	.details .muted a {
		white-space: nowrap;
	}
	.groups {
		margin-top: 8px;
	}
	summary {
		padding: 4px 0;
		color: var(--muted);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.note {
		margin-top: 8px;
		font-size: 0.9rem;
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
	label input {
		flex: none;
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: var(--accent);
	}
	/* Under its layer's checkbox, lined up with the label. */
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 14px;
		margin: 0 0 6px;
		padding: 0 0 0 24px;
		list-style: none;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
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
