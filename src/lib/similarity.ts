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
  realtime: ['realtime', 'real-time', 'webrtc', 'streaming', 'low-latency', 'live']
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

export function rankVariants(variants: Variant[], pitchText: string, activeTraits: Set<string>): RankedVariant[] {
  return variants
    .map((variant) => ({ variant, overlap: computeOverlap(variant, pitchText, activeTraits) }))
    .sort((a, b) => b.overlap - a.overlap || b.variant.stars - a.variant.stars);
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
