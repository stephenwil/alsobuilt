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
      label: 'Voice + MCP notes',
      text: 'Local-first ambient voice note agent that indexes Markdown over MCP with zero cloud dependencies'
    },
    {
      label: 'Terminal coding agent',
      text: 'Open-weights CLI coding agent using local models and MCP tools to refactor multi-file git repos'
    },
    {
      label: 'Offline mobile voice',
      text: 'Offline mobile realtime voice multi-agent companion syncing encrypted memory peer-to-peer'
    }
  ];

  let activeCategory = $state<string>('all');
  let ideaText = $state<string>('');
  let manualAdd = $state<string[]>([]);
  let manualRemove = $state<string[]>([]);
  let showTagPicker = $state<boolean>(false);
  let query = $state<string>('');
  let viewMode = $state<'table' | 'map' | 'cards'>('table');
  let facetArch = $state<string | null>(null);
  let facetLicense = $state<string | null>(null);
  let facetStage = $state<string | null>(null);
  let pinnedSlugs = $state<string[]>([]);
  let selectedSlug = $state<string | null>(null);
  let showPrDrawer = $state<boolean>(false);
  let toast = $state<string>('');
  let urlHydrated = $state<boolean>(false);

  // Live D1 stealth pulse state (hydrated from /api/pulse when served on Cloudflare Pages / Wrangler)
  let pulse = $state<PulseSummary>({ total: 0, byCategory: {}, byVariant: {}, myCategories: [] });
  let d1Bookmark = $state<string>('');
  let myStealthCategories = $state<string[]>([]);
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

  let hasIdea = $derived(ideaText.trim().length > 0 || activeTraits.size > 0);
  let topMatch = $derived(rankedAll[0] ?? null);
  let topScore = $derived(topMatch?.overlap ?? 0);
  let similarCount = $derived(rankedAll.filter((r) => r.overlap >= 40).length);
  let currentPulseCategory = $derived(
    activeCategory === 'all' ? topMatch?.variant.category ?? 'ai-memory' : activeCategory
  );
  let userCountedStealth = $derived(myStealthCategories.includes(currentPulseCategory));
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
    selectedSlug ? (catalog.variants.find((v) => v.slug === selectedSlug) ?? null) : null
  );

  let prGenerated = $derived(
    buildVariantYaml({
      name: prName || 'my-variant',
      category: prCategory,
      repo: prRepo || 'https://github.com/you/my-variant',
      tagline: ideaText.trim() || 'Describe what makes this project distinct',
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
    showToast('Comparing top 2 similar projects below');
    setTimeout(() => {
      document.getElementById('compare-tray')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 40);
  }

  function shareCurrentLink() {
    if (typeof window === 'undefined') return;
    copyText(window.location.href, 'Shareable link copied!');
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
      const data = (await res.json()) as PulseSummary;
      pulse = data;
      if (Array.isArray(data.myCategories)) {
        myStealthCategories = data.myCategories;
      }
    } catch {
      // Static astro dev mode without Wrangler Pages Functions
    }
  }

  async function toggleStealthPulse() {
    if (stealthBusy) return;
    stealthBusy = true;
    const categorySlug = currentPulseCategory;
    const removing = userCountedStealth;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (d1Bookmark) headers['x-d1-bookmark'] = d1Bookmark;

      if (removing) {
        const res = await fetch(`/api/pulse?categorySlug=${encodeURIComponent(categorySlug)}`, {
          method: 'DELETE',
          headers
        });
        if (res.ok) {
          const bm = res.headers.get('x-d1-bookmark');
          if (bm) d1Bookmark = bm;
          myStealthCategories = myStealthCategories.filter((c) => c !== categorySlug);
          await fetchPulse();
          showToast('Removed your anonymous stealth pulse');
        } else {
          myStealthCategories = myStealthCategories.filter((c) => c !== categorySlug);
          pulse = { ...pulse, total: Math.max(0, pulse.total - 1) };
          showToast('Removed local stealth pulse');
        }
      } else {
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
          if (!myStealthCategories.includes(categorySlug)) {
            myStealthCategories = [...myStealthCategories, categorySlug];
          }
          await fetchPulse();
          showToast(
            data.alreadyCountedThisMonth
              ? 'Already counted for this category this month (D1 deduplicated)'
              : 'Added anonymously to Cloudflare D1 stealth pulse!'
          );
        } else {
          if (!myStealthCategories.includes(categorySlug)) {
            myStealthCategories = [...myStealthCategories, categorySlug];
          }
          pulse = { ...pulse, total: pulse.total + 1 };
          showToast('Preview mode: run `npm run preview` to persist to local D1');
        }
      }
    } catch {
      if (removing) {
        myStealthCategories = myStealthCategories.filter((c) => c !== categorySlug);
        pulse = { ...pulse, total: Math.max(0, pulse.total - 1) };
        showToast('Removed local stealth pulse');
      } else {
        if (!myStealthCategories.includes(categorySlug)) {
          myStealthCategories = [...myStealthCategories, categorySlug];
        }
        pulse = { ...pulse, total: pulse.total + 1 };
        showToast('Preview mode: run `npm run preview` to persist to local D1');
      }
    } finally {
      stealthBusy = false;
    }
  }

  function countFacet(field: 'arch' | 'license' | 'stage', val: string): number {
    return categoryVariants.filter((v) => v[field] === val).length;
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const urlIdea = params.get('idea');
    const urlCat = params.get('cat');
    const urlView = params.get('view');

    if (urlIdea) ideaText = urlIdea.slice(0, 300);
    if (urlCat && (urlCat === 'all' || catalog.categories.some((c) => c.slug === urlCat))) {
      activeCategory = urlCat;
    }
    if (urlView === 'table' || urlView === 'map' || urlView === 'cards') {
      viewMode = urlView;
    }
    urlHydrated = true;
    fetchPulse();
  });

  $effect(() => {
    if (!urlHydrated || typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (ideaText.trim()) params.set('idea', ideaText.trim());
    if (activeCategory !== 'all') params.set('cat', activeCategory);
    if (viewMode !== 'table') params.set('view', viewMode);
    const qs = params.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', nextUrl);
    }
  });

  const ARCH_OPTIONS = ['Desktop', 'CLI', 'Web', 'SDK', 'Browser', 'Mobile'];
  const LICENSE_OPTIONS = ['MIT', 'Apache-2', 'AGPL', 'BSD-3', 'Source'];
  const STAGE_OPTIONS = ['Prod', 'Beta', 'Proto', 'Lesson'];
</script>

<div class="flex flex-col gap-5">
  <!-- HERO: Developer-First Landing + Idea Checker -->
  <section
    class="rounded-2xl bg-[var(--card)] bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.16),transparent_60%)] border border-[var(--primary)]/40 p-6 sm:p-8 flex flex-col gap-5"
  >
    <div class="flex flex-col gap-2.5 max-w-3xl">
      <div class="inline-flex items-center gap-2 self-start px-3 py-1 rounded-full bg-[var(--secondary)]/90 border border-[var(--border)] font-mono text-[11px] text-[var(--muted)]">
        <span class="w-2 h-2 rounded-full bg-[var(--emerald)]"></span>
        <span>Open-source AI build radar · {catalog.variants.length} repos · {pulse.total} building privately</span>
      </div>

      <h1 class="m-0 text-2xl sm:text-4xl font-bold tracking-tight leading-[1.15] text-[var(--fg)]">
        See who's already building your AI idea.
      </h1>

      <p class="m-0 text-sm sm:text-[15px] text-[var(--muted)] leading-relaxed max-w-2xl">
        AI developers keep building the same tools in parallel. Paste a one-sentence pitch to find similar open-source repos, spot what they're missing, and decide whether to contribute, differentiate, or build privately.
      </p>
    </div>

    <!-- Primary Idea Input -->
    <div class="flex flex-col gap-3">
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={ideaText}
          placeholder="What are you thinking of building? e.g. Local-first voice notes app that connects to Obsidian via MCP..."
          class="flex-1 h-12 px-4 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-sm sm:text-[15px] text-[var(--fg)] focus:outline-none focus:border-[var(--primary)] shadow-inner"
        />
        {#if hasIdea}
          <button
            type="button"
            onclick={() => {
              ideaText = '';
              manualAdd = [];
              manualRemove = [];
              showTagPicker = false;
            }}
            class="px-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)] text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
          >
            Clear
          </button>
        {/if}
      </div>

      <!-- Examples (when empty) or Detected Tags (when typing) -->
      <div class="flex items-center justify-between gap-2 flex-wrap">
        {#if !hasIdea}
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs text-[var(--muted)]">Try an example:</span>
            {#each PRESETS as preset}
              <button
                type="button"
                onclick={() => applyPreset(preset.text)}
                class="px-3 py-1 rounded-full bg-[var(--secondary)] border border-[var(--border)] text-xs text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--primary)] cursor-pointer transition"
              >
                {preset.label}
              </button>
            {/each}
          </div>
        {:else}
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs text-[var(--muted)]">Detected tags:</span>
            {#if activeTraits.size === 0}
              <span class="text-xs text-[var(--muted)] italic">none yet</span>
            {:else}
              {#each [...activeTraits] as trait}
                <button
                  type="button"
                  onclick={() => toggleTrait(trait)}
                  title="Click to remove tag"
                  class="px-2.5 py-0.5 rounded-full font-mono text-[11px] bg-[var(--primary)]/15 text-[var(--fg)] border border-[var(--primary)]/60 hover:bg-[var(--primary)]/25 cursor-pointer"
                >
                  {trait} ×
                </button>
              {/each}
            {/if}
          </div>
        {/if}

        <button
          type="button"
          onclick={() => (showTagPicker = !showTagPicker)}
          class="text-xs text-[var(--muted)] hover:text-[var(--fg)] bg-transparent border-0 cursor-pointer underline underline-offset-2"
        >
          {showTagPicker ? 'Hide tag picker' : hasIdea ? '+ Edit tags' : 'Or pick tags manually'}
        </button>
      </div>

      {#if showTagPicker}
        <div class="pt-2.5 border-t border-[var(--border)] flex flex-wrap items-center gap-1.5">
          {#each ALL_TRAITS as trait}
            {@const on = activeTraits.has(trait)}
            <button
              type="button"
              onclick={() => toggleTrait(trait)}
              class="px-2.5 py-0.5 rounded-full font-mono text-[11px] border transition cursor-pointer {on
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-[var(--secondary)] text-[var(--muted)] border-[var(--border)] hover:border-[var(--primary)]'}"
            >
              {on ? '✓ ' : '+ '}{trait}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if !hasIdea}
      <!-- 3-Step Explainer (shown before typing so developers immediately grasp the workflow) -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-[var(--border)]/70">
        <div class="rounded-xl bg-[var(--bg)]/60 border border-[var(--border)]/70 p-3.5">
          <div class="font-mono text-[11px] font-semibold text-[var(--primary)]">01 · Check overlap</div>
          <div class="text-xs text-[var(--muted)] mt-1 leading-relaxed">
            Describe your pitch above and we rank existing open-source repos by architecture and feature overlap.
          </div>
        </div>
        <div class="rounded-xl bg-[var(--bg)]/60 border border-[var(--border)]/70 p-3.5">
          <div class="font-mono text-[11px] font-semibold text-[var(--emerald)]">02 · Spot your angle</div>
          <div class="text-xs text-[var(--muted)] mt-1 leading-relaxed">
            See which capabilities closest repos already cover — and which traits make your idea genuinely distinct.
          </div>
        </div>
        <div class="rounded-xl bg-[var(--bg)]/60 border border-[var(--border)]/70 p-3.5">
          <div class="font-mono text-[11px] font-semibold text-[var(--blue)]">03 · Compare or join in</div>
          <div class="text-xs text-[var(--muted)] mt-1 leading-relaxed">
            Compare top repos side-by-side, anonymously signal you're building privately, or add your repo via PR.
          </div>
        </div>
      </div>
    {:else}
      <!-- Plain-English Match Verdict (replaces the 3-step strip once an idea is entered) -->
      <div class="rounded-xl bg-[var(--secondary)] border border-[var(--border)] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3.5 min-w-0">
          <div class="relative w-14 h-14 shrink-0 flex items-center justify-center">
            <svg width="56" height="56" viewBox="0 0 64 64" class="-rotate-90">
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
              <div class="font-mono text-xs font-bold">{topScore}%</div>
              <div class="text-[8px] uppercase text-[var(--muted)]">match</div>
            </div>
          </div>

          <div class="min-w-0">
            <div class="text-sm font-semibold text-[var(--fg)] flex items-center gap-2 flex-wrap">
              {#if topMatch && topScore >= 70}
                <span>Very similar to <code class="font-mono">{topMatch.variant.name}</code></span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--amber)]/20 text-[var(--amber)]">
                  {similarCount} similar
                </span>
              {:else if topMatch && topScore >= 40}
                <span>{similarCount} similar project{similarCount === 1 ? '' : 's'} — closest is <code class="font-mono">{topMatch.variant.name}</code></span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--blue)]/20 text-[var(--blue)]">
                  Adjacent
                </span>
              {:else if topMatch && topScore > 0}
                <span>Looks distinct — closest is <code class="font-mono">{topMatch.variant.name}</code> ({topScore}%)</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--emerald)]/20 text-[var(--emerald)]">
                  Low overlap
                </span>
              {:else}
                <span>No close matches in this category yet</span>
              {/if}
            </div>

            <div class="text-xs text-[var(--muted)] mt-1 flex flex-wrap items-center gap-1.5">
              {#if wedgeTraits.length > 0 && topMatch}
                <span>What yours adds over <code class="font-mono text-[var(--fg)]">{topMatch.variant.name}</code>:</span>
                {#each wedgeTraits as w}
                  <span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-[var(--emerald)]/15 text-[var(--emerald)] font-semibold">
                    + {w}
                  </span>
                {/each}
              {:else if topMatch && topScore > 0}
                <span>Same core tags as <code class="font-mono">{topMatch.variant.name}</code> — click <strong>+ Edit tags</strong> above to highlight how yours differs.</span>
              {:else}
                <span>Add another keyword (e.g. <code>local</code>, <code>voice</code>, <code>cli</code>, <code>mcp</code>) to compare against the list below.</span>
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
            Compare Top 2
          </button>
          <button
            type="button"
            onclick={() => (viewMode = viewMode === 'map' ? 'table' : 'map')}
            class="px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs font-medium cursor-pointer hover:bg-[var(--bg)]"
          >
            {viewMode === 'map' ? 'Back to List' : 'View on Map'}
          </button>
          <button
            type="button"
            onclick={shareCurrentLink}
            title="Copy a link to this idea check"
            class="px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer hover:bg-[var(--bg)]"
          >
            Share
          </button>
        </div>
      </div>
    {/if}
  </section>

  <!-- Category Strip + Private Builder Toggle -->
  <div class="flex items-center justify-between gap-3 flex-wrap pt-1">
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
      <button
        type="button"
        disabled={stealthBusy}
        aria-pressed={userCountedStealth}
        title={userCountedStealth
          ? 'Click to unselect and remove your anonymous private-builder count'
          : 'Anonymously count yourself as building privately in this category'}
        onclick={toggleStealthPulse}
        class="px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer {userCountedStealth
          ? 'bg-[var(--emerald)]/15 border-[var(--emerald)] text-[var(--emerald)] hover:bg-[var(--emerald)]/25'
          : 'bg-[var(--card)] border-[var(--border)] hover:bg-[var(--secondary)]'}"
      >
        {userCountedStealth ? '✓ Building Privately' : "+ I'm Building Privately"}
      </button>
      <button
        type="button"
        onclick={() => (showPrDrawer = !showPrDrawer)}
        class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-medium cursor-pointer hover:opacity-90"
      >
        {showPrDrawer ? 'Close Form' : '+ Add a Project'}
      </button>
    </div>
  </div>

  <!-- Pre-filled GitHub PR Builder Drawer -->
  {#if showPrDrawer}
    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <div class="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Add an Open-Source Project — creates <code>variants/{prCategory}/{prGenerated.slug}.yaml</code>
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
        <div class="flex gap-2 mt-1 flex-wrap">
          <a
            href={prGenerated.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-medium no-underline hover:opacity-90"
          >
            Open PR on GitHub ↗
          </a>
          <button
            type="button"
            onclick={() => copyText(prGenerated.yaml, 'Project YAML copied')}
            class="px-3 py-1.5 rounded-lg bg-[var(--secondary)] border border-[var(--border)] text-xs cursor-pointer hover:border-[var(--primary)]"
          >
            Copy YAML
          </button>
        </div>
      </div>
      <pre class="m-0 p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[11px] overflow-x-auto">{prGenerated.yaml}</pre>
    </div>
  {/if}

  <!-- Compact Inline Search, Filters & View Switcher -->
  <div class="flex items-center justify-between gap-2 flex-wrap">
    <div class="flex items-center gap-2 flex-wrap flex-1">
      <input
        type="text"
        bind:value={query}
        placeholder="Filter list by name, stack, license..."
        class="h-8 px-3 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs w-52 focus:outline-none focus:border-[var(--primary)]"
      />

      <select
        aria-label="Filter by architecture"
        value={facetArch ?? ''}
        onchange={(e) => (facetArch = (e.target as HTMLSelectElement).value || null)}
        class="h-8 px-2.5 rounded-lg border text-xs cursor-pointer {facetArch
          ? 'bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--fg)]'
          : 'bg-[var(--card)] border-[var(--border)] text-[var(--muted)]'}"
      >
        <option value="">Type: All</option>
        {#each ARCH_OPTIONS as opt}
          <option value={opt}>{opt} ({countFacet('arch', opt)})</option>
        {/each}
      </select>

      <select
        aria-label="Filter by license"
        value={facetLicense ?? ''}
        onchange={(e) => (facetLicense = (e.target as HTMLSelectElement).value || null)}
        class="h-8 px-2.5 rounded-lg border text-xs cursor-pointer {facetLicense
          ? 'bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--fg)]'
          : 'bg-[var(--card)] border-[var(--border)] text-[var(--muted)]'}"
      >
        <option value="">License: All</option>
        {#each LICENSE_OPTIONS as opt}
          <option value={opt}>{opt} ({countFacet('license', opt)})</option>
        {/each}
      </select>

      <select
        aria-label="Filter by stage"
        value={facetStage ?? ''}
        onchange={(e) => (facetStage = (e.target as HTMLSelectElement).value || null)}
        class="h-8 px-2.5 rounded-lg border text-xs cursor-pointer {facetStage
          ? 'bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--fg)]'
          : 'bg-[var(--card)] border-[var(--border)] text-[var(--muted)]'}"
      >
        <option value="">Stage: All</option>
        {#each STAGE_OPTIONS as opt}
          <option value={opt}>{opt} ({countFacet('stage', opt)})</option>
        {/each}
      </select>

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
          Reset
        </button>
      {/if}
    </div>

    <div class="inline-flex bg-[var(--secondary)] border border-[var(--border)] p-0.5 rounded-lg">
      {#each ([
        { id: 'table', label: 'List' },
        { id: 'map', label: 'Map' },
        { id: 'cards', label: 'Cards' }
      ] as const) as mode}
        <button
          type="button"
          onclick={() => (viewMode = mode.id)}
          class="px-3 py-1 rounded-md text-xs font-medium cursor-pointer {viewMode === mode.id
            ? 'bg-[var(--card)] text-[var(--fg)]'
            : 'text-[var(--muted)] hover:text-[var(--fg)]'}"
        >
          {mode.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- VIEW 1: LIST TABLE -->
  {#if viewMode === 'table'}
    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] overflow-x-auto">
      <table class="w-full border-collapse text-left">
        <thead>
          <tr class="bg-[var(--secondary)] text-[10px] uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)]">
            <th class="py-2.5 px-3">Project</th>
            <th class="py-2.5 px-3 w-20">Match</th>
            <th class="py-2.5 px-3 w-28">Stars / Private</th>
            <th class="py-2.5 px-3 w-20">Stage</th>
            <th class="py-2.5 px-3 w-40 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#if hasIdea}
            <tr class="bg-[var(--primary)]/10 border-b border-[var(--border)]">
              <td class="py-2.5 px-3">
                <div class="flex items-center gap-2">
                  <span class="font-mono font-bold text-xs text-[var(--primary)]">★ YOUR IDEA</span>
                  <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[10px] font-mono text-[var(--muted)]">Draft</span>
                </div>
                <div class="text-xs mt-0.5 text-[var(--fg)] line-clamp-1">{ideaText || 'Custom tag combination'}</div>
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
                {userCountedStealth ? 'Private ✓' : 'Local only'}
              </td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-[var(--blue)]/20 text-[var(--blue)]">Draft</span>
              </td>
              <td class="py-2.5 px-3 text-right">
                <button
                  type="button"
                  onclick={diffTop2}
                  class="px-2.5 py-1 rounded-md bg-[var(--secondary)] border border-[var(--border)] text-[11px] font-medium hover:border-[var(--primary)] cursor-pointer"
                >
                  Compare Top 2
                </button>
              </td>
            </tr>
          {/if}

          {#if filteredRanked.length === 0}
            <tr>
              <td colspan="5" class="py-8 px-4 text-center text-xs text-[var(--muted)]">
                No projects match these filters.
                <button
                  type="button"
                  onclick={() => {
                    facetArch = null;
                    facetLicense = null;
                    facetStage = null;
                    query = '';
                  }}
                  class="ml-1 text-[var(--primary)] underline bg-transparent border-0 cursor-pointer"
                >
                  Reset filters
                </button>
              </td>
            </tr>
          {:else}
            {#each filteredRanked as { variant: v, overlap }}
              {@const isPinned = pinnedSlugs.includes(v.slug)}
              {@const stealthHere = pulse.byVariant[v.slug] ?? 0}
              <tr class="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--secondary)]/50 transition-colors">
                <td class="py-3 px-3">
                  <div class="flex items-center gap-2 flex-wrap">
                    <a
                      href={v.repo}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="font-mono font-semibold text-xs text-[var(--fg)] no-underline hover:text-[var(--primary)] hover:underline"
                    >
                      {v.name}
                    </a>
                    <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] font-mono text-[10px] text-[var(--muted)]">{v.arch}</span>
                    <span class="px-1.5 py-0.5 rounded bg-[var(--secondary)] font-mono text-[10px] text-[var(--muted)]">{v.license}</span>
                    <span class="font-mono text-[10px] text-[var(--muted)] hidden sm:inline">{v.stack}</span>
                  </div>
                  <div class="text-xs text-[var(--muted)] mt-0.5">{v.tagline}</div>
                  {#if v.lesson}
                    <div class="mt-1 text-[11px] text-[var(--amber)] bg-[var(--amber)]/10 border border-[var(--amber)]/25 rounded px-2 py-1 leading-snug">
                      <span class="font-mono font-semibold uppercase tracking-wide text-[10px] mr-1">Lesson:</span>{v.lesson}
                    </div>
                  {/if}
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
                <td class="py-3 px-3">
                  {#if hasIdea}
                    <span class="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold {overlap >= 65
                      ? 'bg-[var(--amber)]/20 text-[var(--amber)]'
                      : overlap >= 35
                        ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                        : 'bg-[var(--secondary)] text-[var(--muted)]'}">
                      {overlap}%
                    </span>
                  {:else}
                    <span class="font-mono text-[11px] text-[var(--muted)]">—</span>
                  {/if}
                </td>
                <td class="py-3 px-3 font-mono text-[11px]">
                  <div>★ {v.stars >= 1000 ? `${(v.stars / 1000).toFixed(1)}k` : v.stars}</div>
                  <div class="text-[10px] text-[var(--muted)]">{stealthHere} private</div>
                </td>
                <td class="py-3 px-3">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase {v.stage === 'Prod'
                    ? 'bg-[var(--emerald)]/20 text-[var(--emerald)]'
                    : v.stage === 'Beta'
                      ? 'bg-[var(--blue)]/20 text-[var(--blue)]'
                      : 'bg-[var(--purple)]/20 text-[var(--purple)]'}">
                    {v.stage}
                  </span>
                </td>
                <td class="py-3 px-3 text-right">
                  <div class="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onclick={() => togglePin(v.slug)}
                      class="px-2.5 py-1 rounded-md border text-[11px] font-medium cursor-pointer transition {isPinned
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                        : 'bg-[var(--secondary)] text-[var(--fg)] border-[var(--border)] hover:border-[var(--primary)]'}"
                    >
                      {isPinned ? '✓ Comparing' : 'Compare'}
                    </button>
                    <a
                      href={v.repo}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="px-2 py-1 rounded-md bg-[var(--secondary)] border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--primary)] no-underline"
                      title="Open GitHub repository"
                    >
                      GitHub ↗
                    </a>
                  </div>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  {:else if viewMode === 'map'}
    <!-- VIEW 2: LANDSCAPE MAP -->
    <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between text-xs text-[var(--muted)] flex-wrap gap-2">
        <span class="uppercase font-semibold tracking-wider text-[11px] text-[var(--fg)]">
          {hasIdea ? 'Idea Map — Your Idea Plotted Live' : 'Project Landscape Map'}
        </span>
        <span>{hasIdea ? 'Dashed lines = closest matches · Click any dot for links' : 'Type an idea above to plot yours · Click any dot for details'}</span>
      </div>
      <svg viewBox="0 0 760 320" class="w-full h-[320px] rounded-lg bg-[var(--bg)] border border-[var(--border)]">
        <line x1="380" y1="24" x2="380" y2="296" stroke="var(--border)" stroke-dasharray="3 4" />
        <line x1="28" y1="160" x2="732" y2="160" stroke="var(--border)" stroke-dasharray="3 4" />
        <text x="36" y="308" font-size="10" fill="var(--muted)" font-family="monospace">← LOCAL-FIRST</text>
        <text x="724" y="308" text-anchor="end" font-size="10" fill="var(--muted)" font-family="monospace">CLOUD / SELF-HOSTED →</text>
        <text x="16" y="36" font-size="10" fill="var(--muted)" font-family="monospace">MULTI-AGENT ↑</text>

        {#if hasIdea}
          {#each rankedAll.slice(0, 3) as { variant: v, overlap }}
            {@const vx = 42 + v.x * 676}
            {@const vy = 284 - v.y * 248}
            <line x1={userSvg.x} y1={userSvg.y} x2={vx} y2={vy} stroke="var(--primary)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.75" />
            <text x={(userSvg.x + vx) / 2} y={(userSvg.y + vy) / 2 - 4} text-anchor="middle" font-size="10" font-family="monospace" fill="var(--primary)">
              {overlap}%
            </text>
          {/each}
        {/if}

        {#each filteredRanked as { variant: v, overlap }}
          {@const cx = 42 + v.x * 676}
          {@const cy = 284 - v.y * 248}
          {@const r = 6 + Math.min(8, Math.sqrt(v.stars) / 26)}
          <g class="cursor-pointer" onclick={() => (selectedSlug = v.slug)}>
            <circle
              cx={cx}
              cy={cy}
              {r}
              fill={selectedSlug === v.slug ? 'var(--emerald)' : 'var(--blue)'}
              fill-opacity="0.86"
              stroke="var(--card)"
              stroke-width="1.5"
            />
            <text x={cx} y={cy - r - 5} text-anchor="middle" font-size="10.5" font-family="monospace" fill="var(--fg)">
              {hasIdea ? `${v.name} (${overlap}%)` : v.name}
            </text>
          </g>
        {/each}

        {#if hasIdea}
          <!-- YOUR IDEA node -->
          <circle cx={userSvg.x} cy={userSvg.y} r="18" fill="var(--primary)" fill-opacity="0.16" />
          <circle cx={userSvg.x} cy={userSvg.y} r="6" fill="var(--primary)" stroke="#fff" stroke-width="1.5" />
          <rect x={userSvg.x - 38} y={userSvg.y + 12} width="76" height="17" rx="4" fill="var(--primary)" />
          <text x={userSvg.x} y={userSvg.y + 24} text-anchor="middle" font-size="9.5" font-weight="700" font-family="monospace" fill="#fff">
            ★ YOUR IDEA
          </text>
        {/if}
      </svg>

      {#if selectedVariant}
        <div class="rounded-lg bg-[var(--secondary)] border border-[var(--border)] p-3 flex items-center justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-bold text-xs">{selectedVariant.name}</span>
              <span class="font-mono text-[10px] text-[var(--muted)]">{selectedVariant.arch} · {selectedVariant.stack} · {selectedVariant.license}</span>
            </div>
            <p class="m-0 mt-0.5 text-xs text-[var(--muted)]">{selectedVariant.tagline}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onclick={() => togglePin(selectedVariant.slug)}
              class="px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer {pinnedSlugs.includes(selectedVariant.slug)
                ? 'bg-[var(--primary)] text-white border-0'
                : 'bg-[var(--card)] border border-[var(--border)]'}"
            >
              {pinnedSlugs.includes(selectedVariant.slug) ? '✓ Comparing' : 'Compare'}
            </button>
            <a
              href={selectedVariant.repo}
              target="_blank"
              rel="noopener noreferrer"
              class="px-2.5 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs no-underline hover:border-[var(--primary)]"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <!-- VIEW 3: CARDS -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      {#each filteredRanked as { variant: v, overlap }}
        {@const isPinned = pinnedSlugs.includes(v.slug)}
        <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 flex flex-col gap-2.5 hover:border-[var(--primary)]/60 transition">
          <div class="flex items-start justify-between gap-2">
            <div>
              <a
                href={v.repo}
                target="_blank"
                rel="noopener noreferrer"
                class="font-mono font-semibold text-sm text-[var(--fg)] no-underline hover:text-[var(--primary)] hover:underline"
              >
                {v.name}
              </a>
              <div class="text-[11px] text-[var(--muted)] font-mono">{v.arch} · {v.stack} · {v.license} · ★ {v.stars >= 1000 ? `${(v.stars / 1000).toFixed(1)}k` : v.stars}</div>
            </div>
            {#if hasIdea}
              <span class="px-2.5 py-0.5 rounded-full font-mono text-xs font-bold bg-[var(--blue)]/20 text-[var(--blue)]">{overlap}%</span>
            {/if}
          </div>
          <p class="m-0 text-xs text-[var(--muted)]">{v.tagline}</p>
          {#if v.lesson}
            <div class="text-[11px] text-[var(--amber)] bg-[var(--amber)]/10 border border-[var(--amber)]/25 rounded px-2 py-1 leading-snug">
              <span class="font-mono font-semibold uppercase tracking-wide text-[10px] mr-1">Lesson:</span>{v.lesson}
            </div>
          {/if}
          <div class="flex items-center justify-between gap-2 pt-1 flex-wrap mt-auto">
            <div class="flex flex-wrap gap-1">
              {#each v.traits as t}
                <span class="px-1.5 py-0.5 rounded font-mono text-[10px] {activeTraits.has(t)
                  ? 'bg-[var(--emerald)]/20 border border-[var(--emerald)]'
                  : 'bg-[var(--secondary)] text-[var(--muted)]'}">
                  {t}
                </span>
              {/each}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onclick={() => togglePin(v.slug)}
                class="px-2.5 py-1 rounded-md border text-[11px] font-medium cursor-pointer {isPinned
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-[var(--secondary)] border-[var(--border)] hover:border-[var(--primary)]'}"
              >
                {isPinned ? '✓ Comparing' : 'Compare'}
              </button>
              <a
                href={v.repo}
                target="_blank"
                rel="noopener noreferrer"
                class="px-2 py-1 rounded-md bg-[var(--secondary)] border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--fg)] no-underline"
              >
                GitHub ↗
              </a>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- SIDE-BY-SIDE COMPARISON TRAY (opens on demand when projects are selected) -->
  {#if pinnedVariants.length > 0}
    <section id="compare-tray" class="rounded-xl bg-[var(--card)] border border-[var(--primary)]/40 p-4">
      <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
        <span class="text-xs font-semibold uppercase tracking-wider text-[var(--fg)]">
          Side-by-Side Comparison ({pinnedVariants.length}/2 selected)
        </span>
        <div class="flex gap-2">
          {#if hasIdea}
            <button
              type="button"
              onclick={() => copyText(buildCollisionReceipt(rankedAll, activeTraits), 'Comparison summary copied!')}
              class="px-2.5 py-1 rounded bg-[var(--secondary)] border border-[var(--border)] text-xs cursor-pointer hover:border-[var(--primary)]"
            >
              Copy Summary
            </button>
          {/if}
          <button
            type="button"
            onclick={() => (pinnedSlugs = [])}
            class="px-2.5 py-1 rounded bg-[var(--secondary)] border border-[var(--border)] text-xs text-[var(--muted)] hover:text-[var(--fg)] cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="border-b border-[var(--border)]">
              <th class="p-2 text-left bg-[var(--secondary)] w-28 text-[10px] uppercase text-[var(--muted)]">Dimension</th>
              {#if hasIdea}
                <th class="p-2 text-left bg-[var(--primary)]/20 font-mono">★ YOUR IDEA</th>
              {/if}
              {#each pinnedVariants as pv}
                <th class="p-2 text-left bg-[var(--secondary)] font-mono">
                  <a href={pv.repo} target="_blank" rel="noopener noreferrer" class="no-underline hover:underline">
                    {pv.name} ↗
                  </a>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-[var(--border)]">
              <td class="p-2 bg-[var(--secondary)] text-[10px] uppercase font-semibold text-[var(--muted)]">Pitch</td>
              {#if hasIdea}
                <td class="p-2 bg-[var(--primary)]/5">{ideaText || 'Custom tags'}</td>
              {/if}
              {#each pinnedVariants as pv}<td class="p-2">{pv.tagline}</td>{/each}
            </tr>
            {#if hasIdea}
              <tr class="border-b border-[var(--border)]">
                <td class="p-2 bg-[var(--secondary)] text-[10px] uppercase font-semibold text-[var(--muted)]">What yours adds</td>
                <td class="p-2 bg-[var(--primary)]/5 text-[var(--muted)]">Tags they don't cover →</td>
                {#each pinnedVariants as pv}
                  {@const diff = [...activeTraits].filter((t) => !pv.traits.includes(t))}
                  <td class="p-2 bg-[var(--emerald)]/10 font-mono text-[11px] text-[var(--emerald)]">
                    {diff.length ? diff.map((d) => `+ ${d}`).join(', ') : 'Same core tags'}
                  </td>
                {/each}
              </tr>
            {/if}
            <tr>
              <td class="p-2 bg-[var(--secondary)] text-[10px] uppercase font-semibold text-[var(--muted)]">Stack</td>
              {#if hasIdea}
                <td class="p-2 bg-[var(--primary)]/5 text-[var(--muted)]">Your choice</td>
              {/if}
              {#each pinnedVariants as pv}<td class="p-2 font-mono text-[11px]">{pv.arch} · {pv.stack} ({pv.license})</td>{/each}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>

{#if toast}
  <div class="fixed bottom-4 right-4 px-3.5 py-2 rounded-lg bg-[var(--primary)] text-white text-xs font-medium shadow-lg z-50">
    {toast}
  </div>
{/if}
