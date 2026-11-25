import type { Variant } from './types';

export const TRAIT_KEYWORDS: Record<string, string[]> = {
  'local-first': ['local', 'offline', 'zero cloud', 'privacy', 'sqlite', 'on-device', 'desktop'],
  mcp: ['mcp', 'model context', 'tool server', 'claude', 'cursor'],
  voice: ['voice', 'audio', 'whisper', 'speech', 'ambient', 'mic', 'dictation'],
  markdown: ['markdown', 'obsidian', 'notes', 'vault', 'wiki', 'md'],
  'multi-agent': ['agent', 'swarm', 'multi-agent', 'autonomous', 'agents'],
  browser: ['browser', 'extension', 'chrome', 'tab', 'arxiv', 'webgpu', 'bookmark'],
  cli: ['cli', 'terminal', 'daemon', 'shell', 'git'],
  rust: ['rust', 'tauri', 'binary', 'tantivy'],
  python: ['python', 'fastapi', 'django', 'pydantic'],
  typescript: ['typescript', 'ts', 'node', 'svelte', 'react', 'vs code'],
  'open-weights': ['open-weight', 'open weight', 'ollama', 'llama', 'local llm', 'onnx', 'ggml'],
  'self-hosted': ['self-host', 'docker', 'tailscale', 'team', 'org', 'postgres', 'neo4j'],
  mobile: ['mobile', 'ios', 'android', 'phone', 'watch'],
  rag: ['rag', 'vector', 'embedding', 'retrieval', 'memory', 'knowledge graph', 'search'],
  realtime: ['realtime', 'real-time', 'webrtc', 'streaming', 'low-latency', 'live'],
  hardware: ['hardware', 'can bus', 'canbus', 'obd', 'automotive', 'esp32', 'embedded', 'firmware', 'serial', 'robotics', 'iot', 'pcb'],
  gamedev: ['game', 'gamedev', 'fantasy console', 'cartridge', 'retro', 'pixel', 'sprite', 'tilemap', 'engine', 'godot', 'bevy', 'pico'],
  '3d-webgl': ['3d', 'webgl', 'webgpu', 'three.js', 'threejs', 'shader', 'blender', 'cad', 'stl', '3mf', 'mesh'],
  'audio-synth': ['synth', 'synthesizer', 'midi', 'dsp', 'webaudio', 'audioworklet', 'wavetable', 'daw', 'tracker']
};

export const ALL_TRAITS = Object.keys(TRAIT_KEYWORDS);

export function detectTraits(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [trait, kws] of Object.entries(TRAIT_KEYWORDS)) {
    if (kws.some((kw) => lower.includes(kw))) found.push(trait);
  }
  return found;
}

const STOP_WORDS = new Set([
  'that', 'with', 'into', 'over', 'from', 'your', 'this', 'have', 'zero',
  'and', 'the', 'for', 'using', 'built', 'build', 'tool', 'app', 'project'
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  );
}

export function computeOverlap(variant: Variant, pitchText: string, activeTraits: Set<string>): number {
  if (!pitchText.trim() && activeTraits.size === 0) return 0;

  let traitScore = 0;
  if (activeTraits.size > 0) {
    let hits = 0;
    for (const t of activeTraits) if (variant.traits.includes(t)) hits++;
    const recall = hits / activeTraits.size;
    const union = new Set([...activeTraits, ...variant.traits]).size;
    const jaccard = union > 0 ? hits / union : 0;
    traitScore = 0.65 * recall + 0.35 * jaccard;
  }

  const qToks = tokenize(pitchText);
  const vToks = tokenize(`${variant.name} ${variant.tagline} ${variant.stack} ${variant.traits.join(' ')}`);
  let textScore = 0;
  if (qToks.size > 0) {
    let thits = 0;
    for (const tok of qToks) if (vToks.has(tok)) thits++;
    textScore = Math.min(1, thits / Math.min(qToks.size, 6));
  }

  const combined = activeTraits.size > 0 ? 0.72 * traitScore + 0.28 * textScore : textScore;
  return Math.min(98, Math.round(combined * 100));
}

export interface RankedVariant {
  variant: Variant;
  overlap: number;
}

export type SortMode = 'discovery' | 'recent' | 'indie' | 'stars';

const INITIAL_SEED_CUTOFF_MS = Date.parse('2026-11-25T00:00:00Z');
const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function addedMs(v: Variant): number {
  const ts = Date.parse(v.addedAt || '');
  return Number.isFinite(ts) ? ts : 0;
}

export function isNewSubmission(v: Variant, referenceIso?: string): boolean {
  const ts = addedMs(v);
  if (ts <= INITIAL_SEED_CUTOFF_MS) return false;
  const ref = referenceIso ? Date.parse(referenceIso) : Date.now();
  if (!Number.isFinite(ref)) return true;
  return ref - ts <= NEW_WINDOW_MS;
}

export function getScaleTier(stars: number): { id: 'indie' | 'mid' | 'major'; label: string } {
  if (stars < 5000) return { id: 'indie', label: 'Indie' };
  if (stars < 20000) return { id: 'mid', label: 'Growing' };
  return { id: 'major', label: 'Major' };
}

function roundRobinByCategory(items: Variant[]): Variant[] {
  const buckets = new Map<string, Variant[]>();
  for (const item of items) {
    const arr = buckets.get(item.category);
    if (arr) arr.push(item);
    else buckets.set(item.category, [item]);
  }
  const queues = [...buckets.values()];
  const out: Variant[] = [];
  let idx = 0;
  while (queues.length > 0) {
    const q = queues[idx % queues.length];
    const next = q.shift();
    if (next) out.push(next);
    if (q.length === 0) {
      queues.splice(idx % queues.length, 1);
    } else {
      idx++;
    }
  }
  return out;
}

function sortDiscovery(variants: Variant[], referenceIso?: string): Variant[] {
  const fresh: Variant[] = [];
  const indie: Variant[] = [];
  const anchors: Variant[] = [];

  for (const v of variants) {
    if (isNewSubmission(v, referenceIso)) fresh.push(v);
    else if (v.stars < 5000) indie.push(v);
    else anchors.push(v);
  }

  fresh.sort((a, b) => addedMs(b) - addedMs(a) || a.stars - b.stars);
  indie.sort((a, b) => addedMs(b) - addedMs(a) || b.stars - a.stars || a.name.localeCompare(b.name));
  anchors.sort((a, b) => addedMs(b) - addedMs(a) || b.stars - a.stars || a.name.localeCompare(b.name));

  const indieBalanced = roundRobinByCategory(indie);
  const anchorBalanced = roundRobinByCategory(anchors);

  // Interleave 2 indie builds for every 1 established anchor so smaller projects stay visible
  const mixed: Variant[] = [...fresh];
  let ii = 0;
  let ai = 0;
  while (ii < indieBalanced.length || ai < anchorBalanced.length) {
    for (let k = 0; k < 2 && ii < indieBalanced.length; k++) {
      mixed.push(indieBalanced[ii++]);
    }
    if (ai < anchorBalanced.length) {
      mixed.push(anchorBalanced[ai++]);
    }
  }
  return mixed;
}

export function rankVariants(
  variants: Variant[],
  pitchText: string,
  activeTraits: Set<string>,
  sortMode: SortMode = 'discovery',
  referenceIso?: string
): RankedVariant[] {
  const hasIdea = pitchText.trim().length > 0 || activeTraits.size > 0;

  if (hasIdea) {
    return variants
      .map((variant) => ({ variant, overlap: computeOverlap(variant, pitchText, activeTraits) }))
      .sort((a, b) => {
        if (b.overlap !== a.overlap) return b.overlap - a.overlap;
        if (sortMode === 'stars') return b.variant.stars - a.variant.stars;
        if (sortMode === 'recent') return addedMs(b.variant) - addedMs(a.variant) || a.variant.stars - b.variant.stars;
        if (sortMode === 'indie') {
          return (
            (a.variant.stars < 5000 ? 0 : 1) - (b.variant.stars < 5000 ? 0 : 1) ||
            addedMs(b.variant) - addedMs(a.variant) ||
            b.variant.stars - a.variant.stars
          );
        }
        return (
          addedMs(b.variant) - addedMs(a.variant) ||
          (a.variant.stars < 5000 ? 0 : 1) - (b.variant.stars < 5000 ? 0 : 1) ||
          b.variant.stars - a.variant.stars
        );
      });
  }

  let ordered: Variant[];
  if (sortMode === 'stars') {
    ordered = [...variants].sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
  } else if (sortMode === 'recent') {
    ordered = [...variants].sort(
      (a, b) =>
        addedMs(b) - addedMs(a) ||
        (a.stars < 5000 ? 0 : 1) - (b.stars < 5000 ? 0 : 1) ||
        b.stars - a.stars ||
        a.name.localeCompare(b.name)
    );
  } else if (sortMode === 'indie') {
    ordered = [...variants].sort(
      (a, b) =>
        (a.stars < 5000 ? 0 : 1) - (b.stars < 5000 ? 0 : 1) ||
        addedMs(b) - addedMs(a) ||
        b.stars - a.stars ||
        a.name.localeCompare(b.name)
    );
  } else {
    ordered = sortDiscovery(variants, referenceIso);
  }

  return ordered.map((variant) => ({ variant, overlap: 0 }));
}

export function computeUserCoords(ranked: RankedVariant[], activeTraits: Set<string>): { x: number; y: number } {
  const top = ranked.slice(0, 3).filter((r) => r.overlap > 10);
  if (!top.length) return { x: 0.74, y: 0.24 };

  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const { variant, overlap } of top) {
    const w = Math.max(overlap, 10);
    sx += variant.x * w;
    sy += variant.y * w;
    sw += w;
  }
  let x = sx / sw;
  let y = sy / sw;
  if (activeTraits.has('mobile')) {
    x = Math.min(0.86, x + 0.22);
    y = Math.max(0.14, y - 0.08);
  }
  if (activeTraits.has('multi-agent')) y = Math.min(0.88, y + 0.1);
  if (activeTraits.has('local-first')) x = Math.max(0.12, x - 0.08);
  return {
    x: Number(Math.max(0.1, Math.min(0.9, x)).toFixed(3)),
    y: Number(Math.max(0.12, Math.min(0.88, y)).toFixed(3))
  };
}

export function buildCollisionReceipt(ranked: RankedVariant[], activeTraits: Set<string>): string {
  const top = ranked[0];
  if (!top) return 'Tested my AI idea on AlsoBuilt — open whitespace! https://alsobuilt.dev';
  const wedge = [...activeTraits].filter((t) => !top.variant.traits.includes(t));
  const wedgePart = wedge.length ? ` · My wedge: ${wedge.map((w) => `+${w}`).join(', ')}` : '';
  return `Tested my AI idea on AlsoBuilt: ${top.overlap}% overlap with ${top.variant.name}${wedgePart} · https://alsobuilt.dev`;
}

export function buildVariantYaml(input: {
  name: string;
  category: string;
  repo: string;
  tagline: string;
  arch: string;
  model: string;
  license: string;
  stage: string;
  stack: string;
  traits: string[];
}): { slug: string; yaml: string; prUrl: string } {
  const slug =
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'my-variant';
  const traitLines = (input.traits.length ? input.traits : ['local-first']).map((t) => `  - ${t}`).join('\n');
  const yaml = `slug: ${slug}
category: ${input.category}
name: ${input.name}
repo: ${input.repo}
tagline: "${input.tagline.replace(/"/g, '\\"')}"
arch: ${input.arch}
model: ${input.model}
license: ${input.license}
stage: ${input.stage}
stack: ${input.stack}
traits:
${traitLines}
`;
  const prUrl = `https://github.com/stephenwil/alsobuilt/new/main/variants/${input.category}?filename=${slug}.yaml&value=${encodeURIComponent(yaml)}`;
  return { slug, yaml, prUrl };
}
