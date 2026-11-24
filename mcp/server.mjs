#!/usr/bin/env node
/**
 * alsobuilt-mcp — Zero-dependency MCP stdio server for AlsoBuilt.
 * Lets Claude Code, Cursor, Codex, and other MCP clients check AI idea overlap
 * against the live AlsoBuilt open-source catalog before scaffolding a new repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = (process.env.ALSOBUILT_URL || 'https://alsobuilt.pages.dev').replace(/\/+$/, '');
const CACHE_TTL_MS = 5 * 60 * 1000;

let catalogCache = { data: null, fetchedAt: 0 };

const TRAIT_PATTERNS = {
  'local-first': /\b(local|offline|on-device|private|sqlite|zero cloud|ollama|llama\.cpp|gguf)\b/i,
  mcp: /\b(mcp|model context protocol)\b/i,
  voice: /\b(voice|audio|speech|whisper|tts|stt|dictation|ambient|mic)\b/i,
  markdown: /\b(markdown|obsidian|notes|wiki|knowledge base|second brain)\b/i,
  'multi-agent': /\b(multi-agent|swarm|orchestrat|workflow|crew|handoff)\b/i,
  browser: /\b(browser|playwright|chromium|chrome|extension|web agent|cdp)\b/i,
  cli: /\b(cli|terminal|tui|shell|command-line|tmux)\b/i,
  rust: /\b(rust|cargo|ratatui|candle)\b/i,
  python: /\b(python|fastapi|pytorch|pydantic)\b/i,
  typescript: /\b(typescript|javascript|node|react|svelte)\b/i,
  'open-weights': /\b(open-weights|open weights|gguf|ollama|llama|qwen|mistral|vllm|mlx)\b/i,
  'self-hosted': /\b(self-hosted|selfhost|docker|gateway|server)\b/i,
  mobile: /\b(mobile|ios|android|iphone|apple watch|react native)\b/i,
  rag: /\b(rag|vector|embedding|retriev|knowledge graph|graphrag|semantic search)\b/i,
  realtime: /\b(realtime|real-time|webrtc|streaming|live|low-latency)\b/i
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'that', 'this',
  'your', 'my', 'our', 'via', 'using', 'into', 'from', 'by', 'is', 'are', 'be', 'ai', 'app', 'tool'
]);

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
  );
}

function detectTraits(text) {
  const found = [];
  for (const [trait, rx] of Object.entries(TRAIT_PATTERNS)) {
    if (rx.test(text || '')) found.push(trait);
  }
  return found;
}

function computeOverlap(variant, pitchText, activeTraits) {
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

async function getCatalog() {
  const now = Date.now();
  if (catalogCache.data && now - catalogCache.fetchedAt < CACHE_TTL_MS) {
    return catalogCache.data;
  }
  try {
    const res = await fetch(`${BASE_URL}/index.json`, {
      headers: { 'User-Agent': 'alsobuilt-mcp/0.1.0' }
    });
    if (res.ok) {
      const data = await res.json();
      catalogCache = { data, fetchedAt: now };
      return data;
    }
  } catch {
    // Fallback to local index.json if offline
  }

  const localPath = path.resolve(__dirname, '..', 'public', 'index.json');
  if (fs.existsSync(localPath)) {
    const data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    catalogCache = { data, fetchedAt: now };
    return data;
  }
  throw new Error(`Unable to fetch catalog from ${BASE_URL}/index.json and no local fallback found.`);
}

async function getPulse() {
  try {
    const res = await fetch(`${BASE_URL}/api/pulse`, {
      headers: { 'User-Agent': 'alsobuilt-mcp/0.1.0' }
    });
    if (res.ok) return await res.json();
  } catch {
    // Optional live stats
  }
  return { total: 0, byCategory: {}, byVariant: {} };
}

function sizeTier(stars) {
  if (stars < 5000) return 'indie';
  if (stars < 20000) return 'mid';
  return 'major';
}

const TOOLS = [
  {
    name: 'check_idea_overlap',
    description:
      'Check if open-source AI projects already exist for a pitch/idea. Returns overlap percentages, top matches (major & indie), missing wedge traits your idea adds, and a shareable AlsoBuilt radar URL.',
    inputSchema: {
      type: 'object',
      properties: {
        pitch: {
          type: 'string',
          description: 'One-sentence description of the AI tool or agent you plan to build.'
        },
        category: {
          type: 'string',
          description:
            'Optional category slug filter: ai-memory, coding-agents, local-voice, mcp-tooling, local-llm-runners, browser-computer-use, agent-workflows.'
        },
        traits: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional explicit traits to include (e.g. local-first, mcp, voice, rust, mobile, cli, rag).'
        },
        maxStars: {
          type: 'integer',
          description: 'Optional max GitHub stars filter (e.g. 5000 to focus on smaller indie repos).'
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of matching repos to return (default 8, max 20).'
        }
      },
      required: ['pitch']
    }
  },
  {
    name: 'list_categories',
    description:
      'List all AlsoBuilt AI categories with total repo counts, indie (<5k stars) counts, and live anonymous stealth builder counts.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'search_projects',
    description:
      'Search or inspect open-source AI projects in AlsoBuilt by keyword, category, size tier (indie/mid/major), stage (Prod/Beta/Proto/Lesson), or exact slug.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match against name, tagline, stack, or traits.' },
        category: { type: 'string', description: 'Optional category slug.' },
        size: {
          type: 'string',
          enum: ['indie', 'mid', 'major'],
          description: 'indie (<5k stars), mid (5k-20k stars), major (20k+ stars).'
        },
        stage: {
          type: 'string',
          enum: ['Prod', 'Beta', 'Proto', 'Lesson'],
          description: 'Optional project maturity stage.'
        },
        slug: { type: 'string', description: 'Optional exact project slug to inspect.' },
        limit: { type: 'integer', description: 'Max projects to return (default 12, max 30).' }
      }
    }
  }
];

async function handleToolCall(name, args = {}) {
  if (name === 'check_idea_overlap') {
    const pitch = String(args.pitch || '').trim();
    if (!pitch) throw new Error('pitch is required');

    const catalog = await getCatalog();
    const detected = detectTraits(pitch);
    const activeTraits = new Set([...detected, ...(Array.isArray(args.traits) ? args.traits : [])]);

    let pool = catalog.variants;
    if (args.category && args.category !== 'all') {
      pool = pool.filter((v) => v.category === args.category);
    }
    if (typeof args.maxStars === 'number' && args.maxStars >= 0) {
      pool = pool.filter((v) => v.stars <= args.maxStars);
    }

    const ranked = pool
      .map((v) => ({ variant: v, overlap: computeOverlap(v, pitch, activeTraits) }))
      .sort((a, b) => b.overlap - a.overlap || b.variant.stars - a.variant.stars);

    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
    const top = ranked[0] || null;
    const wedgeTraits = top
      ? [...activeTraits].filter((t) => !top.variant.traits.includes(t))
      : [...activeTraits];

    const params = new URLSearchParams({ idea: pitch });
    if (args.category && args.category !== 'all') params.set('cat', args.category);

    const payload = {
      pitch,
      detectedTraits: [...activeTraits],
      catalogSize: catalog.variants.length,
      similarCount: ranked.filter((r) => r.overlap >= 40).length,
      indieMatchCount: ranked.filter((r) => r.overlap >= 40 && r.variant.stars < 5000).length,
      topOverlap: top?.overlap ?? 0,
      closestProject: top ? top.variant.name : null,
      yourWedgeOverClosest: wedgeTraits,
      shareUrl: `${BASE_URL}/?${params.toString()}`,
      matches: ranked.slice(0, limit).map(({ variant: v, overlap }) => ({
        slug: v.slug,
        name: v.name,
        category: v.category,
        overlapPercent: overlap,
        stars: v.stars,
        size: sizeTier(v.stars),
        stage: v.stage,
        arch: v.arch,
        license: v.license,
        stack: v.stack,
        repo: v.repo,
        tagline: v.tagline,
        traits: v.traits,
        ...(v.lesson ? { lesson: v.lesson } : {})
      }))
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
    };
  }

  if (name === 'list_categories') {
    const [catalog, pulse] = await Promise.all([getCatalog(), getPulse()]);
    const categories = catalog.categories.map((cat) => {
      const items = catalog.variants.filter((v) => v.category === cat.slug);
      return {
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        totalRepos: items.length,
        indieRepos: items.filter((v) => v.stars < 5000).length,
        lessonRepos: items.filter((v) => v.stage === 'Lesson').length,
        stealthBuilders: pulse.byCategory?.[cat.slug] ?? 0
      };
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              url: BASE_URL,
              totalRepos: catalog.variants.length,
              totalStealthBuilders: pulse.total ?? 0,
              categories
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (name === 'search_projects') {
    const catalog = await getCatalog();
    let pool = catalog.variants;

    if (args.slug) {
      pool = pool.filter((v) => v.slug === String(args.slug).trim());
    }
    if (args.category && args.category !== 'all') {
      pool = pool.filter((v) => v.category === args.category);
    }
    if (args.size) {
      pool = pool.filter((v) => sizeTier(v.stars) === args.size);
    }
    if (args.stage) {
      pool = pool.filter((v) => v.stage === args.stage);
    }
    if (args.query) {
      const q = String(args.query).trim().toLowerCase();
      pool = pool.filter((v) =>
        `${v.name} ${v.slug} ${v.tagline} ${v.stack} ${v.arch} ${v.license} ${v.traits.join(' ')}`
          .toLowerCase()
          .includes(q)
      );
    }

    const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 30);
    const results = [...pool]
      .sort((a, b) => b.stars - a.stars)
      .slice(0, limit)
      .map((v) => ({
        slug: v.slug,
        name: v.name,
        category: v.category,
        stars: v.stars,
        size: sizeTier(v.stars),
        stage: v.stage,
        arch: v.arch,
        model: v.model,
        license: v.license,
        stack: v.stack,
        repo: v.repo,
        tagline: v.tagline,
        traits: v.traits,
        ...(v.lesson ? { lesson: v.lesson } : {})
      }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ matched: pool.length, returned: results.length, projects: results }, null, 2)
        }
      ]
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;

  // Notifications have no id and expect no response
  if (id === undefined || id === null) return;

  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'alsobuilt-mcp', version: '0.1.0' }
        }
      });
    }

    if (method === 'ping') {
      return send({ jsonrpc: '2.0', id, result: {} });
    }

    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const result = await handleToolCall(params?.name, params?.arguments);
      return send({ jsonrpc: '2.0', id, result });
    }

    return send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
  } catch (err) {
    return send({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err instanceof Error ? err.message : String(err) }
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    void handleMessage(parsed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
});
