<script lang="ts">
	import { MediaQuery } from "svelte/reactivity";
	import { innerHeight } from "svelte/reactivity/window";
	import { Drawer } from "vaul-svelte";
	import MapView, { type Selection } from "./lib/MapView.svelte";
	import { mapillaryEnabled, photoUrl } from "./lib/mapillary";
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

	// Phones get a sheet over the map that rests showing its top part (title,
	// hint, selection) and snaps open for the settings; wider screens a sidebar.
	const wide = new MediaQuery("min-width: 768px");
	let peekHeight = $state(0);
	let settingsHeight = $state(0);
	let safeArea = $state(0);
	const peek = $derived(peekHeight + safeArea);
	// Open, the sheet fits its content, or fills the screen and scrolls if
	// that is too tall.
	const snapPoints = $derived.by(() => {
		const full = peekHeight + settingsHeight;
		return [`${peek}px`, full < (innerHeight.current ?? 0) * 0.9 ? `${full}px` : 1];
	});

	// A drag can end in a click on whatever it started on, which must not count.
	let dragged = false;
	function dropClick(e: MouseEvent) {
		if (!dragged) return;
		dragged = false;
		e.stopPropagation();
		e.preventDefault();
	}
</script>

{#snippet top()}
	<header>
		<h1>BinRadar</h1>
		<p>Find the nearest public waste bin.</p>
	</header>

	{#if zoom !== undefined && zoom < BINS_MINZOOM}
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
				<p class:stale={Number(selection.properties.last_seen_at) < STALE_BEFORE}>
					Last seen {formatDate(selection.properties.last_seen_at)}
				</p>
				<p class="links">
					<a href={directions} target="_blank" rel="noopener">Directions</a>
					{#if photo}<a href={photo} target="_blank" rel="noopener">Photo on Mapillary</a>{/if}
				</p>
			{/if}
		</section>
	{/if}
{/snippet}

{#snippet settings()}
	<section>
		<h2>Layers</h2>
		<label><input type="checkbox" bind:checked={showBins} /> Bins from OpenStreetMap</label>
		<label class:disabled={!mapillaryEnabled}>
			<input type="checkbox" bind:checked={showMapillary} disabled={!mapillaryEnabled} />
			Trash cans detected by Mapillary
		</label>
		{#if !mapillaryEnabled}
			<p class="muted">No Mapillary token configured.</p>
		{:else if showMapillary}
			<p class="muted">Loads several MB per area in city centres.</p>
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
			onzoom={(z) => (zoom = z)}
		/>
	</main>

	{#if wide.current}
		<aside class="sidebar">
			{@render top()}
			<div class="settings">{@render settings()}</div>
		</aside>
	{:else}
		<!-- Always open and non-modal: the map behind stays usable. -->
		<Drawer.Root
			open
			modal={false}
			dismissible={false}
			noBodyStyles
			{snapPoints}
			bind:activeSnapPoint={() => snapPoints[expanded ? 1 : 0], (point) => (expanded = snapPoints.indexOf(point ?? "") > 0)}
			onDrag={() => (dragged = true)}
		>
			<Drawer.Content
				class="sheet"
				aria-label="BinRadar"
				trapFocus={false}
				onEscapeKeydown={(e) => e.preventDefault()}
				onpointerdown={() => (dragged = false)}
				onclickcapture={dropClick}
			>
				<div class="peek" bind:offsetHeight={peekHeight}>
					<button class="handle" onclick={() => (expanded = !expanded)} aria-expanded={expanded} aria-label="Toggle settings">
						<span></span>
					</button>
					{@render top()}
				</div>
				<div class="more" class:collapsed={!expanded} class:scrolls={snapPoints[1] === 1} inert={!expanded}>
					<div class="settings" bind:offsetHeight={settingsHeight}>{@render settings()}</div>
				</div>
			</Drawer.Content>
		</Drawer.Root>
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

	/* Phones: a full-height sheet that vaul slides to its snap points. */
	.app :global(.sheet) {
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
		outline: none;
	}
	.peek {
		padding: 4px 16px 16px;
	}
	.more {
		transition: opacity 0.2s;
	}
	.more.scrolls {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.more .settings {
		padding: 0 16px calc(16px + env(safe-area-inset-bottom));
	}
	:global(.sheet:not(.vaul-dragging)) .collapsed {
		opacity: 0;
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
