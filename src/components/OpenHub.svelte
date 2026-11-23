<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogIndex, PulseSummary, Variant } from '../lib/types';
  import {
    ALL_TRAITS,
    buildCollisionReceipt,
    buildVariantYaml,
    computeUserCoords,
    detectTraits,
    rankVariants
  } from '../lib/similarity';

  interface Props {
    catalog: CatalogIndex;
  }

  let { catalog }: Props = $props();

  const PRESETS = [
    {
      label: 'Voice + MCP vault',
      text: 'Local-first ambient voice note agent that indexes Markdown over MCP with zero cloud dependencies'
    },
    {
      label: 'Git terminal agent',
      text: 'Open-weights CLI coding agent using local models and MCP tools to refactor multi-file git repos'
    },
    {
      label: 'Mobile voice swarm',
      text: 'Offline mobile realtime voice multi-agent companion syncing encrypted memory peer-to-peer'
    }
  ];

  let activeCategory = $state<string>('all');
  let ideaText = $state<string>(PRESETS[0].text);
  let manualAdd = $state<string[]>([]);
  let manualRemove = $state<string[]>([]);
  let query = $state<string>('');
  let viewMode = $state<'table' | 'map' | 'cards'>('table');
  let facetArch = $state<string | null>(null);
  let facetLicense = $state<string | null>(null);
  let facetStage = $state<string | null>(null);
  let pinnedSlugs = $state<string[]>(['khoj', 'cline']);
  let selectedSlug = $state<string>('khoj');
  let showPrDrawer = $state<boolean>(false);
  let toast = $state<string>('');

  // Live D1 stealth pulse state (hydrated from /api/pulse when served on Cloudflare Pages / Wrangler)
  let pulse = $state<PulseSummary>({ total: 0, byCategory: {}, byVariant: {} });
  let d1Bookmark = $state<string>('');
  let userCountedStealth = $state<boolean>(false);
  let stealthBusy = $state<boolean>(false);

  // PR Builder inputs
  let prName = $state<string>('my-ai-variant');
  let prCategory = $state<string>('ai-memory');
  let prRepo = $state<string>('https://github.com/you/my-ai-variant');
  let prStack = $state<string>('TypeScript + SQLite');
  let prArch = $state<string>('Desktop');
  let prLicense = $state<string>('MIT');

  let autoTraits = $derived(detectTraits(ideaText));
  let activeTraits = $derived.by(() => {
    const out = new Set<string>();
    for (const t of autoTraits) if (!manualRemove.includes(t)) out.add(t);
    for (const t of manualAdd) out.add(t);
    return out;
  });

  let categoryVariants = $derived(
    activeCategory === 'all'
      ? catalog.variants
      : catalog.variants.filter((v) => v.category === activeCategory)
  );

  let rankedAll = $derived(rankVariants(categoryVariants, ideaText, activeTraits));

  let filteredRanked = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return rankedAll.filter(({ variant: v }) => {
      if (facetArch && v.arch !== facetArch) return false;
      if (facetLicense && v.license !== facetLicense) return false;
      if (facetStage && v.stage !== facetStage) return false;
      if (q) {
        const hay = `${v.name} ${v.tagline} ${v.stack} ${v.arch} ${v.license} ${v.traits.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  let topMatch = $derived(rankedAll[0] ?? null);
  let topScore = $derived(topMatch?.overlap ?? 0);
  let wedgeTraits = $derived.by(() => {
    if (!topMatch) return [...activeTraits];
    return [...activeTraits].filter((t) => !topMatch.variant.traits.includes(t));
  });

  let userCoords = $derived(computeUserCoords(rankedAll, activeTraits));
  let userSvg = $derived({ x: 42 + userCoords.x * 676, y: 284 - userCoords.y * 248 });

  let pinnedVariants = $derived(
    pinnedSlugs
      .map((slug) => catalog.variants.find((v) => v.slug === slug))
      .filter((v): v is Variant => Boolean(v))
  );

  let selectedVariant = $derived(
    catalog.variants.find((v) => v.slug === selectedSlug) ?? catalog.variants[0]
  );

  let prGenerated = $derived(
    buildVariantYaml({
      name: prName || 'my-variant',
      category: prCategory,
      repo: prRepo || 'https://github.com/you/my-variant',
      tagline: ideaText.trim() || 'Describe what makes this variant distinct',
      arch: prArch,
      model: activeTraits.has('local-first') ? 'Local LLM' : 'Hybrid',
      license: prLicense,
      stage: 'Proto',
      stack: prStack || 'TypeScript',
      traits: [...activeTraits]
    })
  );

  function showToast(msg: string) {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = '';
    }, 2200);
  }

  function toggleTrait(t: string) {
    if (activeTraits.has(t)) {
      manualAdd = manualAdd.filter((x) => x !== t);
      if (autoTraits.includes(t) && !manualRemove.includes(t)) {
        manualRemove = [...manualRemove, t];
      }
    } else {
      manualRemove = manualRemove.filter((x) => x !== t);
      if (!manualAdd.includes(t)) manualAdd = [...manualAdd, t];
    }
  }

  function applyPreset(text: string) {
    ideaText = text;
    manualAdd = [];
    manualRemove = [];
  }

  function togglePin(slug: string) {
    if (pinnedSlugs.includes(slug)) {
      pinnedSlugs = pinnedSlugs.filter((s) => s !== slug);
    } else {
      pinnedSlugs = [...pinnedSlugs.slice(-1), slug];
    }
  }

  function diffTop2() {
    pinnedSlugs = rankedAll.slice(0, 2).map((r) => r.variant.slug);
    showToast('Pinned top 2 collisions to diff tray');
  }

  async function copyText(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard fallback silent
    }
    showToast(msg);
  }

  async function fetchPulse() {
    try {
      const headers: Record<string, string> = {};
      if (d1Bookmark) headers['x-d1-bookmark'] = d1Bookmark;
      const res = await fetch('/api/pulse', { headers });
      if (!res.ok) return;
      const bm = res.headers.get('x-d1-bookmark');
      if (bm) d1Bookmark = bm;
      pulse = (await res.json()) as PulseSummary;
    } catch {
      // Static astro dev mode without Wrangler Pages Functions
    }
  }

  async function submitStealthPulse() {
    if (stealthBusy) return;
    stealthBusy = true;
    const categorySlug = activeCategory === 'all' ? topMatch?.variant.category ?? 'ai-memory' : activeCategory;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (d1Bookmark) headers['x-d1-bookmark'] = d1Bookmark;
      const res = await fetch('/api/pulse', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          categorySlug,
          nearestVariantSlug: topMatch?.variant.slug ?? null,
          traits: [...activeTraits]
        })
      });
      if (res.ok) {
        const bm = res.headers.get('x-d1-bookmark');
        if (bm) d1Bookmark = bm;
        const data = (await res.json()) as { recorded: boolean; alreadyCountedThisMonth: boolean; total: number };
        userCountedStealth = true;
        await fetchPulse();
        showToast(
          data.alreadyCountedThisMonth
            ? 'Already counted for this category this month (D1 deduplicated)'
            : 'Added anonymously to Cloudflare D1 stealth pulse!'
        );
      } else {
        userCountedStealth = true;
        pulse = { ...pulse, total: pulse.total + 1 };
        showToast('Preview mode: run `npm run preview` to persist to local D1');
      }
    } catch {
      userCountedStealth = true;
      pulse = { ...pulse, total: pulse.total + 1 };
      showToast('Preview mode: run `npm run preview` to persist to local D1');
    } finally {
      stealthBusy = false;
    }
  }

  function countFacet(field: 'arch' | 'license' | 'stage', val: string): number {
    return categoryVariants.filter((v) => v[field] === val).length;
  }

  onMount(() => {
    fetchPulse();
  });

  const ARCH_OPTIONS = ['Desktop', 'CLI', 'Web', 'SDK', 'Browser'];
  const LICENSE_OPTIONS = ['MIT', 'Apache-2', 'AGPL', 'BSD-3'];
  const STAGE_OPTIONS = ['Prod', 'Beta', 'Proto', 'Lesson'];
</script>

<div class="flex flex-col gap-4">
  <!-- Category Filter Strip + Live Stealth Pulse -->
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div class="flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        onclick={() => (activeCategory = 'all')}
        class="px-3 py-1.5 rounded-full text-xs font-medium border transition cursor-pointer {activeCategory === 'all'
          ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
          : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--fg)]'}"
      >
        All AI ({catalog.variants.length})
      </button>
      {#each catalog.categories as cat}
        <button
          type="button"
          onclick={() => (activeCategory = cat.slug)}
          class="px-3 py-1.5 rounded-full text-xs font-medium border transition cursor-pointer {activeCategory === cat.slug
            ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
            : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--fg)]'}"
        >
          {cat.name}
        </button>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--secondary)] border border-[var(--border)] font-mono text-[11px] text-[var(--muted)]">
        <span class="w-2 h-2 rounded-full bg-[var(--emerald)]"></span>
        {catalog.variants.length} public · {pulse.total} stealth
      </span>
      <button
        type="button"
        disabled={stealthBusy}
        onclick={submitStealthPulse}
        class="px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer {userCountedStealth
          ? 'bg-[var(--emerald)]/15 border-[var(--emerald)] text-[var(--emerald)]'
          : 'bg-[var(--card)] border-[var(--border)] hover:bg-[var(--secondary)]'}"
      >
        {userCountedStealth ? '✓ Building Privately' : "+ I'm Building Privately"}
      </button>
    </div>
  </div>

  <!-- HERO: Test My Idea Collision Sandbox -->
  <section class="rounded-xl bg-[var(--card)] border border-[var(--primary)]/50 p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg)]">
        Test My Idea — Drop your pitch to map parallel builds &amp; whitespace
      </span>
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="text-[11px] text-[var(--muted)]">Try:</span>
        {#each PRESETS as preset}
          <button
            type="button"
            onclick={() => applyPreset(preset.text)}
            class="px-2 py-0.5 rounded bg-[var(--secondary)] border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--primary)] cursor-pointer"
          >
            {preset.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex gap-2">
      <input
        type="text"
        bind:value={ideaText}
        placeholder="Describe your AI project idea in 1–2 sentences (or paste a README intro)..."
        class="flex-1 h-10 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--fg)] focus:outline-none focus:border-[var(--primary)]"
      />
      <button
        type="button"
        onclick={() => {
          ideaText = '';
          manualAdd = [];
          manualRemove = [];
        }}
        class="px-3 rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-xs text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
      >
        Clear
      </button>
    </div>

    <!-- Trait pills -->
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-[11px] text-[var(--muted)] mr-1">Traits:</span>
      {#each ALL_TRAITS as trait}
        {@const on = activeTraits.has(trait)}
        <button
          type="button"
          onclick={() => toggleTrait(trait)}
          class="px-2.5 py-0.5 rounded-full font-mono text-[11px] border transition cursor-pointer {on
            ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
            : 'bg-[var(--secondary)] text-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)]'}"
        >
          {on ? '✓ ' : ''}{trait}
        </button>
      {/each}
    </div>

    <!-- Collision Report Banner -->
    <div class="rounded-lg bg-[var(--secondary)] border border-[var(--border)] p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div class="flex items-center gap-3.5 min-w-0">
        <div class="relative w-16 h-16 shrink-0 flex items-center justify-center">
          <svg width="64" height="64" viewBox="0 0 64 64" class="-rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border)" stroke-width="5" />
            <circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke={topScore >= 70 ? 'var(--amber)' : topScore >= 40 ? 'var(--blue)' : 'var(--emerald)'}
              stroke-width="5"
              stroke-dasharray={`${((topScore / 100) * 2 * Math.PI * 26).toFixed(1)} ${(2 * Math.PI * 26).toFixed(1)}`}
              stroke-linecap="round"
            />
          </svg>
          <div class="absolute text-center leading-tight">
            <div class="font-mono text-sm font-bold">{topScore}%</div>
            <div class="text-[8px] uppercase text-[var(--muted)]">overlap</div>
          </div>
        </div>

        <div class="min-w-0">
          <div class="text-xs font-semibold flex items-center gap-2 flex-wrap">
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase {topScore >= 70
                ? 'bg-[var(--amber)]/20 text-[var(--amber)]'
                : topScore >= 40
                  ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                  : 'bg-[var(--emerald)]/20 text-[var(--emerald)]'}"
            >
              {topScore >= 70 ? 'High Collision' : topScore >= 40 ? 'Adjacent Niche' : 'Open Whitespace'}
            </span>
            {#if topMatch}
              <span>
                Closest: <code class="font-mono text-[var(--fg)]">{topMatch.variant.name}</code> ({topMatch.overlap}%)
              </span>
            {/if}
          </div>
          <div class="text-xs text-[var(--muted)] mt-1 flex flex-wrap items-center gap-1.5">
            {#if wedgeTraits.length > 0 && topMatch}
              <span>Your wedge vs <code>{topMatch.variant.name}</code>:</span>
              {#each wedgeTraits as w}
                <span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-[var(--emerald)]/15 text-[var(--emerald)] font-semibold">
                  + {w}
                </span>
              {/each}
            {:else}
              <span>Toggle an extra trait above (e.g. <code>mobile</code>, <code>voice</code>, <code>rust</code>) to carve a unique wedge.</span>
            {/if}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onclick={diffTop2}
          class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-medium cursor-pointer hover:opacity-90"
        >
          Diff vs Top 2
        </button>
        <button
          type="button"
          onclick={() => (viewMode = viewMode === 'map' ? 'table' : 'map')}
          class="px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs font-medium cursor-pointer hover:bg-[var(--bg)]"
        >
          {viewMode === 'map' ? 'Back to Table' : 'See on Map'}
        </button>
      </div>
    </div>
  </section>

  <!-- Search + View Switcher + PR Button -->
  <div class="flex items-center justify-between gap-2 flex-wrap">
    <div class="flex items-center gap-2 flex-wrap flex-1">
      <input
        type="text"
        bind:value={query}
        placeholder="Filter variants, stacks, licenses..."
        class="h-9 px-3 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs w-56 focus:outline-none focus:border-[var(--primary)]"
      />
      <div class="inline-flex bg-[var(--secondary)] border border-[var(--border)] p-0.5 rounded-lg">
        {#each (['table', 'map', 'cards'] as const) as mode}
          <button
            type="button"
            onclick={() => (viewMode = mode)}
            class="px-3 py-1 rounded-md text-xs font-medium capitalize cursor-pointer {viewMode === mode
              ? 'bg-[var(--card)] text-[var(--fg)]'
              : 'text-[var(--muted)] hover:text-[var(--fg)]'}"
          >
            {mode}
          </button>
        {/each}
      </div>
      <span class="text-xs text-[var(--muted)]">{filteredRanked.length} / {categoryVariants.length} shown</span>
      {#if facetArch || facetLicense || facetStage || query}
        <button
          type="button"
          onclick={() => {
            facetArch = null;
            facetLicense = null;
            facetStage = null;
            query = '';
          }}
          class="text-xs text-[var(--primary)] underline cursor-pointer bg-transparent border-0"
        >
          Reset filters
        </button>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <a
        href="/vault"
        class="px-3 py-1.5 rounded-lg border border-[var(--purple)]/50 bg-[var(--purple)]/10 text-xs font-medium text-[var(--fg)] no-underline hover:bg-[var(--purple)]/20"
      >
        Save to Private Vault →
      </a>
      <button
        type="button"
        onclick={() => (showPrDrawer = !showPrDrawer)}
        class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-medium cursor-pointer hover:opacity-90"
      >
        + Submit Variant PR
      </button>
    </div>
  </div>

  <!-- Pre-filled Variant PR Builder Drawer -->
  {#if showPrDrawer}
    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <div class="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Zero-Ops Contribution — Generates <code>variants/{prCategory}/{prGenerated.slug}.yaml</code>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input bind:value={prName} placeholder="Project name" class="h-8 px-2.5 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
          <select bind:value={prCategory} class="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
            {#each catalog.categories as cat}
              <option value={cat.slug}>{cat.name}</option>
            {/each}
          </select>
        </div>
        <input bind:value={prRepo} placeholder="https://github.com/..." class="h-8 px-2.5 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
        <div class="grid grid-cols-3 gap-2">
          <input bind:value={prStack} placeholder="Stack" class="h-8 px-2.5 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
          <select bind:value={prArch} class="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
            {#each ARCH_OPTIONS as a}<option value={a}>{a}</option>{/each}
          </select>
          <select bind:value={prLicense} class="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
            {#each LICENSE_OPTIONS as l}<option value={l}>{l}</option>{/each}
          </select>
        </div>
        <div class="flex gap-2 mt-1">
          <button
            type="button"
            onclick={() => copyText(prGenerated.yaml, 'Variant YAML copied')}
            class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-medium cursor-pointer"
          >
            Copy YAML
          </button>
          <button
            type="button"
            onclick={() => copyText(prGenerated.prUrl, 'Pre-filled GitHub PR URL copied')}
            class="px-3 py-1.5 rounded-lg bg-[var(--secondary)] border border-[var(--border)] text-xs cursor-pointer"
          >
            Copy GitHub PR URL
          </button>
        </div>
      </div>
      <pre class="m-0 p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[11px] overflow-x-auto">{prGenerated.yaml}</pre>
    </div>
  {/if}

  <!-- Cross-Filtering Mini-Histograms -->
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-3">
      <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Architecture</div>
      {#each ARCH_OPTIONS as opt}
        {@const c = countFacet('arch', opt)}
        <button
          type="button"
          onclick={() => (facetArch = facetArch === opt ? null : opt)}
          class="w-full grid grid-cols-[64px_1fr_20px] items-center gap-2 py-0.5 px-1 rounded text-left text-xs cursor-pointer border-0 {facetArch === opt
            ? 'bg-[var(--primary)]/20 text-[var(--fg)]'
            : 'bg-transparent text-[var(--fg)] hover:bg-[var(--secondary)]'}"
        >
          <span class="truncate">{opt}</span>
          <span class="h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden block">
            <span class="h-full block bg-[var(--blue)]" style="width:{Math.round((c / Math.max(categoryVariants.length, 1)) * 100)}%"></span>
          </span>
          <span class="font-mono text-[10px] text-right text-[var(--muted)]">{c}</span>
        </button>
      {/each}
    </div>

    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-3">
      <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">License</div>
      {#each LICENSE_OPTIONS as opt}
        {@const c = countFacet('license', opt)}
        <button
          type="button"
          onclick={() => (facetLicense = facetLicense === opt ? null : opt)}
          class="w-full grid grid-cols-[64px_1fr_20px] items-center gap-2 py-0.5 px-1 rounded text-left text-xs cursor-pointer border-0 {facetLicense === opt
            ? 'bg-[var(--primary)]/20 text-[var(--fg)]'
            : 'bg-transparent text-[var(--fg)] hover:bg-[var(--secondary)]'}"
        >
          <span class="truncate">{opt}</span>
          <span class="h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden block">
            <span class="h-full block bg-[var(--amber)]" style="width:{Math.round((c / Math.max(categoryVariants.length, 1)) * 100)}%"></span>
          </span>
          <span class="font-mono text-[10px] text-right text-[var(--muted)]">{c}</span>
        </button>
      {/each}
    </div>

    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-3">
      <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Status</div>
      {#each STAGE_OPTIONS as opt}
        {@const c = countFacet('stage', opt)}
        <button
          type="button"
          onclick={() => (facetStage = facetStage === opt ? null : opt)}
          class="w-full grid grid-cols-[64px_1fr_20px] items-center gap-2 py-0.5 px-1 rounded text-left text-xs cursor-pointer border-0 {facetStage === opt
            ? 'bg-[var(--primary)]/20 text-[var(--fg)]'
            : 'bg-transparent text-[var(--fg)] hover:bg-[var(--secondary)]'}"
        >
          <span class="truncate">{opt}</span>
          <span class="h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden block">
            <span class="h-full block bg-[var(--purple)]" style="width:{Math.round((c / Math.max(categoryVariants.length, 1)) * 100)}%"></span>
          </span>
          <span class="font-mono text-[10px] text-right text-[var(--muted)]">{c}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- VIEW 1: TABLE -->
  {#if viewMode === 'table'}
    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] overflow-x-auto">
      <table class="w-full border-collapse text-left">
        <thead>
          <tr class="bg-[var(--secondary)] text-[10px] uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)]">
            <th class="py-2.5 px-3 w-10 text-center">Pin</th>
            <th class="py-2.5 px-3">Variant &amp; Distinct Angle</th>
            <th class="py-2.5 px-3 w-24">Overlap</th>
            <th class="py-2.5 px-3 w-32">Stars / Stealth</th>
            <th class="py-2.5 px-3 w-20">Status</th>
          </tr>
        </thead>
        <tbody>
          {#if ideaText.trim() || activeTraits.size > 0}
            <tr class="bg-[var(--primary)]/10 border-b border-[var(--border)]">
              <td class="py-2.5 px-3 text-center text-[var(--primary)]">★</td>
              <td class="py-2.5 px-3">
                <div class="flex items-center gap-2">
                  <span class="font-mono font-bold text-xs text-[var(--primary)]">YOUR IDEA</span>
                  <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[10px] font-mono text-[var(--muted)]">Draft Pitch</span>
                </div>
                <div class="text-xs mt-0.5 text-[var(--fg)] line-clamp-1">{ideaText || 'Custom trait combination'}</div>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  {#each [...activeTraits] as t}
                    <span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-[var(--primary)]/20 border border-[var(--primary)]/50">{t}</span>
                  {/each}
                </div>
              </td>
              <td class="py-2.5 px-3">
                <span class="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold bg-[var(--primary)] text-white">YOU</span>
              </td>
              <td class="py-2.5 px-3 font-mono text-[11px] text-[var(--muted)]">
                {userCountedStealth ? 'Stealth ✓' : 'Local draft'}
              </td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-[var(--blue)]/20 text-[var(--blue)]">Sandbox</span>
              </td>
            </tr>
          {/if}

          {#each filteredRanked as { variant: v, overlap }}
            {@const isPinned = pinnedSlugs.includes(v.slug)}
            {@const stealthHere = pulse.byVariant[v.slug] ?? 0}
            <tr
              onclick={() => (selectedSlug = v.slug)}
              class="border-b border-[var(--border)] last:border-b-0 cursor-pointer hover:bg-[var(--secondary)]/60 {selectedSlug === v.slug ? 'bg-[var(--primary)]/8' : ''}"
            >
              <td class="py-2.5 px-3 text-center">
                <button
                  type="button"
                  onclick={(e) => {
                    e.stopPropagation();
                    togglePin(v.slug);
                  }}
                  class="w-6 h-6 rounded border text-xs cursor-pointer {isPinned
                    ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                    : 'bg-transparent text-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)]'}"
                >
                  {isPinned ? '✓' : '+'}
                </button>
              </td>
              <td class="py-2.5 px-3">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono font-semibold text-xs">{v.name}</span>
                  <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] font-mono text-[10px] text-[var(--muted)]">{v.arch}</span>
                  <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] font-mono text-[10px] text-[var(--muted)]">{v.license}</span>
                </div>
                <div class="text-xs text-[var(--muted)] mt-0.5">{v.tagline}</div>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  {#each v.traits as t}
                    <span class="px-1.5 py-0.5 rounded font-mono text-[10px] {activeTraits.has(t)
                      ? 'bg-[var(--emerald)]/20 border border-[var(--emerald)] text-[var(--fg)] font-semibold'
                      : 'bg-[var(--secondary)] text-[var(--muted)]'}">
                      {t}
                    </span>
                  {/each}
                </div>
              </td>
              <td class="py-2.5 px-3">
                <span class="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold {overlap >= 65
                  ? 'bg-[var(--amber)]/20 text-[var(--amber)]'
                  : overlap >= 35
                    ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                    : 'bg-[var(--secondary)] text-[var(--muted)]'}">
                  {overlap}%
                </span>
              </td>
              <td class="py-2.5 px-3 font-mono text-[11px]">
                <div>★ {v.stars >= 1000 ? `${(v.stars / 1000).toFixed(1)}k` : v.stars}</div>
                <div class="text-[10px] text-[var(--muted)]">{stealthHere} stealth</div>
              </td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase {v.stage === 'Prod'
                  ? 'bg-[var(--emerald)]/20 text-[var(--emerald)]'
                  : v.stage === 'Beta'
                    ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                    : 'bg-[var(--purple)]/20 text-[var(--purple)]'}">
                  {v.stage}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if viewMode === 'map'}
    <!-- VIEW 2: CONSTELLATION MAP -->
    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4">
      <div class="flex items-center justify-between mb-2 text-xs text-[var(--muted)]">
        <span class="uppercase font-semibold tracking-wider text-[11px] text-[var(--fg)]">Idea Constellation — Your Idea Plotted Live</span>
        <span>Dashed rays = closest collisions</span>
      </div>
      <svg viewBox="0 0 760 320" class="w-full h-[320px] rounded-lg bg-[var(--bg)] border border-[var(--border)]">
        <line x1="380" y1="24" x2="380" y2="296" stroke="var(--border)" stroke-dasharray="3 4" />
        <line x1="28" y1="160" x2="732" y2="160" stroke="var(--border)" stroke-dasharray="3 4" />
        <text x="36" y="308" font-size="10" fill="var(--muted)" font-family="monospace">← LOCAL-FIRST</text>
        <text x="724" y="308" text-anchor="end" font-size="10" fill="var(--muted)" font-family="monospace">CLOUD / SELF-HOSTED →</text>
        <text x="16" y="36" font-size="10" fill="var(--muted)" font-family="monospace">MULTI-AGENT ↑</text>

        {#each rankedAll.slice(0, 3) as { variant: v, overlap }}
          {@const vx = 42 + v.x * 676}
          {@const vy = 284 - v.y * 248}
          <line x1={userSvg.x} y1={userSvg.y} x2={vx} y2={vy} stroke="var(--primary)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.75" />
          <text x={(userSvg.x + vx) / 2} y={(userSvg.y + vy) / 2 - 4} text-anchor="middle" font-size="10" font-family="monospace" fill="var(--primary)">
            {overlap}%
          </text>
        {/each}

        {#each rankedAll as { variant: v, overlap }}
          {@const cx = 42 + v.x * 676}
          {@const cy = 284 - v.y * 248}
          {@const r = 6 + Math.min(8, Math.sqrt(v.stars) / 26)}
          <g class="cursor-pointer" onclick={() => (selectedSlug = v.slug)}>
            <circle cx={cx} cy={cy} {r} fill="var(--blue)" fill-opacity="0.82" stroke="var(--card)" stroke-width="1.5" />
            <text x={cx} y={cy - r - 5} text-anchor="middle" font-size="10.5" font-family="monospace" fill="var(--fg)">
              {v.name} ({overlap}%)
            </text>
          </g>
        {/each}

        <!-- YOUR IDEA node -->
        <circle cx={userSvg.x} cy={userSvg.y} r="18" fill="var(--primary)" fill-opacity="0.16" />
        <circle cx={userSvg.x} cy={userSvg.y} r="6" fill="var(--primary)" stroke="#fff" stroke-width="1.5" />
        <rect x={userSvg.x - 38} y={userSvg.y + 12} width="76" height="17" rx="4" fill="var(--primary)" />
        <text x={userSvg.x} y={userSvg.y + 24} text-anchor="middle" font-size="9.5" font-weight="700" font-family="monospace" fill="#fff">
          ★ YOUR IDEA
        </text>
      </svg>
    </div>
  {:else}
    <!-- VIEW 3: CARDS -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      {#each filteredRanked as { variant: v, overlap }}
        <div
          onclick={() => (selectedSlug = v.slug)}
          class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 flex flex-col gap-2 cursor-pointer hover:border-[var(--primary)]"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="font-mono font-semibold text-sm">{v.name}</div>
              <div class="text-[11px] text-[var(--muted)] font-mono">{v.arch} · {v.stack} · {v.license}</div>
            </div>
            <span class="px-2.5 py-0.5 rounded-full font-mono text-xs font-bold bg-[var(--blue)]/20 text-[var(--blue)]">{overlap}%</span>
          </div>
          <p class="m-0 text-xs text-[var(--muted)]">{v.tagline}</p>
          <div class="flex flex-wrap gap-1">
            {#each v.traits as t}
              <span class="px-1.5 py-0.5 rounded font-mono text-[10px] {activeTraits.has(t)
                ? 'bg-[var(--emerald)]/20 border border-[var(--emerald)]'
                : 'bg-[var(--secondary)] text-[var(--muted)]'}">
                {t}
              </span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- SIDE-BY-SIDE DIFF TRAY -->
  {#if pinnedVariants.length > 0}
    <section class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4">
      <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
        <span class="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Your Idea vs Pinned Variants ({pinnedVariants.length}/2)
        </span>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={() => copyText(buildCollisionReceipt(rankedAll, activeTraits), 'Collision receipt copied!')}
            class="px-2.5 py-1 rounded bg-[var(--secondary)] border border-[var(--border)] text-xs cursor-pointer"
          >
            Copy Collision Receipt
          </button>
          <button
            type="button"
            onclick={() => (pinnedSlugs = [])}
            class="px-2.5 py-1 rounded bg-[var(--secondary)] border border-[var(--border)] text-xs cursor-pointer"
          >
            Clear Pins
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="border-b border-[var(--border)]">
              <th class="p-2 text-left bg-[var(--secondary)] w-24 text-[10px] uppercase text-[var(--muted)]">Dimension</th>
              <th class="p-2 text-left bg-[var(--primary)]/20 font-mono">★ YOUR IDEA</th>
              {#each pinnedVariants as pv}
                <th class="p-2 text-left bg-[var(--secondary)] font-mono">{pv.name}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-[var(--border)]">
              <td class="p-2 bg-[var(--secondary)] text-[10px] uppercase font-semibold text-[var(--muted)]">Pitch</td>
              <td class="p-2 bg-[var(--primary)]/5">{ideaText || 'Custom traits'}</td>
              {#each pinnedVariants as pv}<td class="p-2">{pv.tagline}</td>{/each}
            </tr>
            <tr class="border-b border-[var(--border)]">
              <td class="p-2 bg-[var(--secondary)] text-[10px] uppercase font-semibold text-[var(--muted)]">Your Wedge</td>
              <td class="p-2 bg-[var(--primary)]/5 text-[var(--muted)]">What they lack →</td>
              {#each pinnedVariants as pv}
                {@const diff = [...activeTraits].filter((t) => !pv.traits.includes(t))}
                <td class="p-2 bg-[var(--amber)]/10 font-mono text-[11px]">
                  {diff.length ? diff.map((d) => `+ ${d}`).join(', ') : 'Full overlap'}
                </td>
              {/each}
            </tr>
            <tr>
              <td class="p-2 bg-[var(--secondary)] text-[10px] uppercase font-semibold text-[var(--muted)]">Stack</td>
              <td class="p-2 bg-[var(--primary)]/5">Your choice</td>
              {#each pinnedVariants as pv}<td class="p-2 font-mono text-[11px]">{pv.arch} · {pv.stack} ({pv.license})</td>{/each}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <!-- INSPECTOR FOOTER -->
  {#if selectedVariant}
    <section class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-mono font-bold text-sm">{selectedVariant.name}</span>
          <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] font-mono text-[10px] text-[var(--muted)]">{selectedVariant.stack}</span>
          <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] font-mono text-[10px] text-[var(--muted)]">{selectedVariant.license}</span>
        </div>
        <p class="m-0 mt-1 text-xs text-[var(--muted)]">{selectedVariant.tagline}</p>
      </div>
      <div class="flex items-center gap-2">
        <a
          href={selectedVariant.repo}
          target="_blank"
          rel="noopener noreferrer"
          class="px-3 py-1.5 rounded-lg bg-[var(--secondary)] border border-[var(--border)] text-xs no-underline hover:border-[var(--primary)]"
        >
          Open GitHub Repo ↗
        </a>
        <button
          type="button"
          onclick={() => togglePin(selectedVariant.slug)}
          class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs cursor-pointer"
        >
          {pinnedSlugs.includes(selectedVariant.slug) ? '✓ Pinned in Diff' : '+ Pin to Diff'}
        </button>
      </div>
    </section>
  {/if}
</div>

{#if toast}
  <div class="fixed bottom-4 right-4 px-3.5 py-2 rounded-lg bg-[var(--primary)] text-white text-xs font-medium shadow-lg z-50">
    {toast}
  </div>
{/if}
