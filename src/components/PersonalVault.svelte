<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogIndex, IdeaStatus, PersonalIdea } from '../lib/types';
  import { ALL_TRAITS, buildVariantYaml, detectTraits, rankVariants } from '../lib/similarity';

  interface Props {
    catalog: CatalogIndex;
  }

  let { catalog }: Props = $props();

  const STORAGE_FALLBACK_KEY = 'alsobuilt_personal_vault_fallback_v1';
  const STATUSES: IdeaStatus[] = ['spark', 'researching', 'building', 'parked', 'shipped'];

  let ideas = $state<PersonalIdea[]>([]);
  let storageMode = $state<'d1' | 'local-fallback'>('d1');
  let ownerEmail = $state<string>('');
  let d1Bookmark = $state<string>('');
  let loading = $state<boolean>(true);
  let saving = $state<boolean>(false);
  let toast = $state<string>('');

  // New idea form
  let title = $state<string>('');
  let pitch = $state<string>('');
  let categorySlug = $state<string>('ai-memory');
  let status = $state<IdeaStatus>('spark');
  let conviction = $state<number>(4);
  let wedgeNotes = $state<string>('');
  let privateNotes = $state<string>('');
  let customTraits = $state<string[]>([]);

  let selectedId = $state<string | null>(null);

  let detected = $derived(detectTraits(pitch));
  let activeTraits = $derived([...new Set([...detected, ...customTraits])]);
  let draftMatches = $derived(
    pitch.trim() || activeTraits.length
      ? rankVariants(catalog.variants, pitch, new Set(activeTraits)).slice(0, 3)
      : []
  );

  let selectedIdea = $derived(ideas.find((i) => i.id === selectedId) ?? ideas[0] ?? null);
  let selectedCollisions = $derived.by(() => {
    if (!selectedIdea) return [];
    return rankVariants(catalog.variants, selectedIdea.pitch, new Set(selectedIdea.traits)).slice(0, 3);
  });

  function showToast(msg: string) {
    toast = msg;
    setTimeout(() => {
      if (toast === msg) toast = '';
    }, 2400);
  }

  function persistLocal(list: PersonalIdea[]) {
    try {
      localStorage.setItem(STORAGE_FALLBACK_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  async function loadIdeas() {
    loading = true;
    try {
      const headers: Record<string, string> = {};
      if (d1Bookmark) headers['x-d1-bookmark'] = d1Bookmark;
      const res = await fetch('/api/vault/ideas', { headers });
      if (res.ok) {
        const bm = res.headers.get('x-d1-bookmark');
        if (bm) d1Bookmark = bm;
        const data = (await res.json()) as { owner: string; ideas: PersonalIdea[] };
        storageMode = 'd1';
        ownerEmail = data.owner;
        ideas = data.ideas;
        if (!selectedId && ideas.length) selectedId = ideas[0].id;
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch {
      storageMode = 'local-fallback';
      try {
        const raw = localStorage.getItem(STORAGE_FALLBACK_KEY);
        ideas = raw ? (JSON.parse(raw) as PersonalIdea[]) : [];
        if (!selectedId && ideas.length) selectedId = ideas[0].id;
      } catch {
        ideas = [];
      }
    } finally {
      loading = false;
    }
  }

  async function createIdea() {
    if (!title.trim() || !pitch.trim()) {
      showToast('Enter both a title and a pitch');
      return;
    }
    saving = true;
    const topOverlap = draftMatches[0]?.overlap ?? 0;

    try {
      if (storageMode === 'd1') {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (d1Bookmark) headers['x-d1-bookmark'] = d1Bookmark;
        const res = await fetch('/api/vault/ideas', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: title.trim(),
            pitch: pitch.trim(),
            categorySlug,
            traits: activeTraits,
            status,
            conviction,
            wedgeNotes: wedgeNotes.trim(),
            privateNotes: privateNotes.trim(),
            lastMaxOverlap: topOverlap
          })
        });
        if (!res.ok) throw new Error('D1 save failed');
        const bm = res.headers.get('x-d1-bookmark');
        if (bm) d1Bookmark = bm;
        const created = (await res.json()) as { id: string };
        await loadIdeas();
        selectedId = created.id;
        showToast('Saved privately to Cloudflare D1 (alsobuilt-vault)');
      } else {
        const now = new Date().toISOString();
        const item: PersonalIdea = {
          id: crypto.randomUUID(),
          title: title.trim(),
          pitch: pitch.trim(),
          categorySlug,
          traits: activeTraits,
          status,
          conviction,
          wedgeNotes: wedgeNotes.trim(),
          privateNotes: privateNotes.trim(),
          lastMaxOverlap: topOverlap,
          lastCheckedAt: now,
          promotedSlug: null,
          createdAt: now,
          updatedAt: now
        };
        ideas = [item, ...ideas];
        persistLocal(ideas);
        selectedId = item.id;
        showToast('Saved to local browser fallback (run `npm run preview` for D1)');
      }

      title = '';
      pitch = '';
      wedgeNotes = '';
      privateNotes = '';
      customTraits = [];
    } catch {
      showToast('Failed to save idea');
    } finally {
      saving = false;
    }
  }

  async function updateStatus(idea: PersonalIdea, nextStatus: IdeaStatus) {
    if (storageMode === 'd1') {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (d1Bookmark) headers['x-d1-bookmark'] = d1Bookmark;
      const res = await fetch(`/api/vault/ideas/${idea.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        const bm = res.headers.get('x-d1-bookmark');
        if (bm) d1Bookmark = bm;
        await loadIdeas();
        showToast(`Status → ${nextStatus}`);
      }
    } else {
      ideas = ideas.map((x) => (x.id === idea.id ? { ...x, status: nextStatus, updatedAt: new Date().toISOString() } : x));
      persistLocal(ideas);
    }
  }

  async function saveCollisionSnapshot(idea: PersonalIdea) {
    const top = selectedCollisions[0];
    const topOverlap = top?.overlap ?? 0;
    if (storageMode === 'd1') {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (d1Bookmark) headers['x-d1-bookmark'] = d1Bookmark;
      const res = await fetch(`/api/vault/ideas/${idea.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          topOverlap,
          closestSlug: top?.variant.slug ?? null,
          publicTwinsCount: selectedCollisions.filter((c) => c.overlap >= 45).length,
          stealthNearbyCount: 0
        })
      });
      if (res.ok) {
        const bm = res.headers.get('x-d1-bookmark');
        if (bm) d1Bookmark = bm;
        await loadIdeas();
        showToast(`Snapshot saved (${topOverlap}% top overlap)`);
      }
    } else {
      ideas = ideas.map((x) =>
        x.id === idea.id ? { ...x, lastMaxOverlap: topOverlap, lastCheckedAt: new Date().toISOString() } : x
      );
      persistLocal(ideas);
      showToast(`Snapshot recorded locally (${topOverlap}%)`);
    }
  }

  async function deleteIdea(idea: PersonalIdea) {
    if (storageMode === 'd1') {
      const res = await fetch(`/api/vault/ideas/${idea.id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadIdeas();
        if (selectedId === idea.id) selectedId = ideas[0]?.id ?? null;
        showToast('Removed from vault');
      }
    } else {
      ideas = ideas.filter((x) => x.id !== idea.id);
      persistLocal(ideas);
      if (selectedId === idea.id) selectedId = ideas[0]?.id ?? null;
      showToast('Removed from vault');
    }
  }

  async function promoteToPublicYaml(idea: PersonalIdea) {
    const { yaml } = buildVariantYaml({
      name: idea.title,
      category: idea.categorySlug,
      repo: `https://github.com/you/${idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      tagline: idea.pitch,
      arch: 'Desktop',
      model: idea.traits.includes('local-first') ? 'Local LLM' : 'Hybrid',
      license: 'MIT',
      stage: 'Proto',
      stack: 'TBD',
      traits: idea.traits
    });
    try {
      await navigator.clipboard.writeText(yaml);
    } catch {
      // ignore
    }
    showToast('Public variant YAML copied — ready to PR to Open Hub');
  }

  onMount(() => {
    loadIdeas();
  });
</script>

<div class="flex flex-col gap-4">
  <!-- Vault Isolation Banner -->
  <div class="rounded-xl bg-[var(--card)] border border-[var(--purple)]/50 p-4 flex items-center justify-between gap-3 flex-wrap">
    <div>
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-[var(--purple)]"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-[var(--purple)]">Personal Ideas Vault</span>
        <span class="px-2 py-0.5 rounded font-mono text-[10px] bg-[var(--secondary)] text-[var(--muted)]">
          {storageMode === 'd1' ? `D1: alsobuilt-vault (${ownerEmail})` : 'Local preview fallback'}
        </span>
      </div>
      <p class="m-0 mt-1 text-xs text-[var(--muted)]">
        Physically separate database from the public Open Hub. Ideas stay private here while running live read-only collision checks against public builds.
      </p>
    </div>
    <span class="font-mono text-xs text-[var(--muted)]">{ideas.length} personal idea{ideas.length === 1 ? '' : 's'}</span>
  </div>

  <!-- Add Personal Idea Form -->
  <section class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 flex flex-col gap-3">
    <div class="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Capture a Personal Idea</div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <input
        bind:value={title}
        placeholder="Working title (e.g., Local Voice MCP)"
        class="h-9 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs sm:col-span-2"
      />
      <select bind:value={categorySlug} class="h-9 px-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs">
        {#each catalog.categories as cat}
          <option value={cat.slug}>{cat.name}</option>
        {/each}
      </select>
    </div>

    <textarea
      bind:value={pitch}
      rows="2"
      placeholder="One-line pitch — traits and public collisions update live as you type..."
      class="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs resize-y"
    ></textarea>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input
        bind:value={wedgeNotes}
        placeholder="My unique wedge / why existing repos miss this..."
        class="h-9 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
      />
      <div class="flex items-center gap-2">
        <select bind:value={status} class="h-9 px-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs flex-1">
          {#each STATUSES as st}<option value={st}>Status: {st}</option>{/each}
        </select>
        <label class="text-xs text-[var(--muted)] flex items-center gap-1.5">
          Conviction
          <select bind:value={conviction} class="h-9 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--fg)]">
            {#each [1, 2, 3, 4, 5] as n}<option value={n}>{n}/5</option>{/each}
          </select>
        </label>
      </div>
    </div>

    <textarea
      bind:value={privateNotes}
      rows="2"
      placeholder="Private scratch notes, links, architecture thoughts (never exposed publicly)..."
      class="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs resize-y"
    ></textarea>

    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-[11px] text-[var(--muted)]">Traits:</span>
      {#each ALL_TRAITS as t}
        {@const on = activeTraits.includes(t)}
        <button
          type="button"
          onclick={() => {
            if (customTraits.includes(t)) customTraits = customTraits.filter((x) => x !== t);
            else if (!detected.includes(t)) customTraits = [...customTraits, t];
          }}
          class="px-2 py-0.5 rounded-full font-mono text-[10px] border cursor-pointer {on
            ? 'bg-[var(--purple)] text-white border-[var(--purple)]'
            : 'bg-[var(--secondary)] text-[var(--muted)] border-[var(--border)]'}"
        >
          {t}
        </button>
      {/each}
    </div>

    <div class="flex items-center justify-between gap-3 flex-wrap pt-1">
      <div class="text-xs text-[var(--muted)]">
        {#if draftMatches.length}
          Live check vs Open Hub: closest is <strong class="text-[var(--fg)] font-mono">{draftMatches[0].variant.name}</strong> ({draftMatches[0].overlap}% overlap)
        {:else}
          Start typing your pitch to run a live read-only collision check.
        {/if}
      </div>
      <button
        type="button"
        disabled={saving}
        onclick={createIdea}
        class="px-4 py-2 rounded-lg bg-[var(--purple)] text-white text-xs font-semibold cursor-pointer hover:opacity-90"
      >
        {saving ? 'Saving...' : '+ Save Private Idea'}
      </button>
    </div>
  </section>

  <!-- Vault List + Live Collision Inspector -->
  <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
    <div class="md:col-span-5 flex flex-col gap-2">
      {#if loading}
        <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 text-xs text-[var(--muted)]">
          Loading personal vault...
        </div>
      {:else if ideas.length === 0}
        <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-5 text-xs text-[var(--muted)]">
          Your personal vault is empty. Add your first idea above to track it privately against the Open Hub.
        </div>
      {:else}
        {#each ideas as idea}
          <button
            type="button"
            onclick={() => (selectedId = idea.id)}
            class="text-left rounded-xl bg-[var(--card)] border p-3.5 cursor-pointer transition {selectedIdea?.id === idea.id
              ? 'border-[var(--purple)] bg-[var(--purple)]/8'
              : 'border-[var(--border)] hover:border-[var(--purple)]/50'}"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-sm">{idea.title}</span>
              <span class="px-2 py-0.5 rounded font-mono text-[10px] uppercase bg-[var(--secondary)] text-[var(--muted)]">
                {idea.status}
              </span>
            </div>
            <p class="m-0 mt-1 text-xs text-[var(--muted)] line-clamp-2">{idea.pitch}</p>
            <div class="flex items-center justify-between mt-2 font-mono text-[10px] text-[var(--muted)]">
              <span>Conviction: {'★'.repeat(idea.conviction)}{'☆'.repeat(5 - idea.conviction)}</span>
              <span>{idea.lastMaxOverlap !== null ? `${idea.lastMaxOverlap}% top overlap` : 'Not snapped'}</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>

    <div class="md:col-span-7">
      {#if selectedIdea}
        <div class="rounded-xl bg-[var(--card)] border border-[var(--border)] p-4 flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 class="m-0 text-base font-bold">{selectedIdea.title}</h2>
              <div class="text-xs text-[var(--muted)] font-mono mt-0.5">
                {selectedIdea.categorySlug} · Conviction {selectedIdea.conviction}/5
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <select
                value={selectedIdea.status}
                onchange={(e) => updateStatus(selectedIdea, (e.target as HTMLSelectElement).value as IdeaStatus)}
                class="h-8 px-2 rounded bg-[var(--secondary)] border border-[var(--border)] text-xs"
              >
                {#each STATUSES as st}<option value={st}>{st}</option>{/each}
              </select>
              <button
                type="button"
                onclick={() => saveCollisionSnapshot(selectedIdea)}
                class="px-2.5 py-1.5 rounded bg-[var(--secondary)] border border-[var(--border)] text-xs cursor-pointer hover:border-[var(--primary)]"
              >
                Save Snapshot
              </button>
              <button
                type="button"
                onclick={() => promoteToPublicYaml(selectedIdea)}
                class="px-2.5 py-1.5 rounded bg-[var(--primary)] text-white text-xs cursor-pointer"
              >
                Promote to PR
              </button>
              <button
                type="button"
                onclick={() => deleteIdea(selectedIdea)}
                class="px-2.5 py-1.5 rounded bg-[var(--rose)]/15 text-[var(--rose)] border border-[var(--rose)]/40 text-xs cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>

          <p class="m-0 text-xs leading-relaxed">{selectedIdea.pitch}</p>

          {#if selectedIdea.wedgeNotes}
            <div class="p-2.5 rounded-lg bg-[var(--emerald)]/10 border border-[var(--emerald)]/30 text-xs">
              <strong class="text-[var(--emerald)]">My Wedge:</strong> {selectedIdea.wedgeNotes}
            </div>
          {/if}

          {#if selectedIdea.privateNotes}
            <div class="p-2.5 rounded-lg bg-[var(--secondary)] border border-[var(--border)] text-xs whitespace-pre-wrap">
              <div class="text-[10px] uppercase font-semibold text-[var(--muted)] mb-1">Private Notes</div>
              {selectedIdea.privateNotes}
            </div>
          {/if}

          <div>
            <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
              Live Read-Only Collisions Against Public Open Hub
            </div>
            <div class="flex flex-col gap-2">
              {#each selectedCollisions as { variant: v, overlap }}
                {@const wedge = selectedIdea.traits.filter((t) => !v.traits.includes(t))}
                <div class="rounded-lg bg-[var(--secondary)] border border-[var(--border)] p-2.5 flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="font-mono text-xs font-semibold">{v.name} <span class="text-[var(--muted)] font-normal">({v.arch})</span></div>
                    <div class="text-[11px] text-[var(--muted)] truncate">{v.tagline}</div>
                    {#if wedge.length}
                      <div class="text-[10px] font-mono text-[var(--emerald)] mt-0.5">
                        Your wedge: {wedge.map((w) => `+${w}`).join(' ')}
                      </div>
                    {/if}
                  </div>
                  <span class="px-2.5 py-0.5 rounded-full font-mono text-xs font-bold shrink-0 {overlap >= 65
                    ? 'bg-[var(--amber)]/20 text-[var(--amber)]'
                    : 'bg-[var(--blue)]/20 text-[var(--blue)]'}">
                    {overlap}%
                  </span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if toast}
  <div class="fixed bottom-4 right-4 px-3.5 py-2 rounded-lg bg-[var(--purple)] text-white text-xs font-medium shadow-lg z-50">
    {toast}
  </div>
{/if}
