import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  CATEGORIES_PATH,
  OTHER_CATEGORY_OPTION,
  loadCategories,
  syncCategories
} from './sync-categories.mjs';

const CATEGORIES = loadCategories();
const ALLOWED_CATEGORIES = new Set(CATEGORIES.map((c) => c.slug));

const ALLOWED_ARCH = new Set(['Desktop', 'CLI', 'Web', 'Browser', 'SDK', 'Mobile']);
const ALLOWED_MODEL = new Set(['Standalone', 'Local LLM', 'Hybrid', 'Cloud API']);
const ALLOWED_STAGE = new Set(['Prod', 'Beta', 'Proto', 'Lesson']);
const ALLOWED_TRAITS = new Set([
  'local-first',
  'mcp',
  'voice',
  'markdown',
  'multi-agent',
  'browser',
  'cli',
  'rust',
  'python',
  'typescript',
  'open-weights',
  'self-hosted',
  'mobile',
  'rag',
  'realtime',
  'hardware',
  'gamedev',
  '3d-webgl',
  'audio-synth'
]);

const TRAIT_KEYWORDS = {
  'local-first': /\b(local|offline|on-device|private|ollama|llama\.cpp|gguf|ggml|sqlite)\b/i,
  mcp: /\b(mcp|model context protocol)\b/i,
  voice: /\b(voice|audio|speech|whisper|tts|stt|dictation|transcrib)\b/i,
  markdown: /\b(markdown|obsidian|notes|wiki|knowledge)\b/i,
  'multi-agent': /\b(multi-agent|swarm|orchestrat|workflow|crew|handoff)\b/i,
  browser: /\b(browser|playwright|chromium|chrome|cdp|extension|web agent)\b/i,
  cli: /\b(cli|terminal|tui|shell|command-line|tmux)\b/i,
  rust: /\b(rust|cargo|candle|ratatui)\b/i,
  python: /\b(python|fastapi|pytorch|pydantic)\b/i,
  typescript: /\b(typescript|javascript|node|react|svelte|next\.js)\b/i,
  'open-weights': /\b(open-weights|gguf|ollama|llama|qwen|mistral|vllm|mlx)\b/i,
  'self-hosted': /\b(self-hosted|selfhost|docker|gateway|server)\b/i,
  mobile: /\b(mobile|ios|android|iphone|swiftui|react native)\b/i,
  rag: /\b(rag|vector|embedding|retriev|knowledge graph|graphrag|semantic search)\b/i,
  realtime: /\b(realtime|real-time|webrtc|streaming|live|low-latency)\b/i,
  hardware: /\b(hardware|can\s?bus|obd|automotive|esp32|embedded|firmware|serial|robotics|iot|pcb)\b/i,
  gamedev: /\b(game|gamedev|fantasy console|cartridge|retro|pixel|sprite|tilemap|godot|bevy)\b/i,
  '3d-webgl': /\b(3d|webgl|webgpu|three\.?js|shader|blender|cad|stl|3mf)\b/i,
  'audio-synth': /\b(synth|synthesizer|midi|dsp|webaudio|audioworklet|wavetable|daw)\b/i
};

function parseIssueForm(body) {
  const sections = {};
  const lines = String(body || '').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) {
      current = m[1].trim().toLowerCase();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(sections)) {
    const val = v.join('\n').trim();
    out[k] = val === '_No response_' ? '' : val;
  }
  return out;
}

function mapLicense(spdx) {
  const s = (spdx || '').toUpperCase();
  if (s.startsWith('MIT')) return 'MIT';
  if (s.startsWith('APACHE')) return 'Apache-2';
  if (s.startsWith('AGPL')) return 'AGPL';
  if (s.startsWith('GPL')) return 'GPL-3';
  if (s.startsWith('BSD')) return 'BSD-3';
  if (s.startsWith('ISC')) return 'ISC';
  return 'Source';
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function clamp(v, lo, hi) {
  return Number(Math.max(lo, Math.min(hi, v)).toFixed(2));
}

function hashFloat(seed, offset) {
  let h = 2166136261 ^ offset;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

async function main() {
  const issueBody = process.env.ISSUE_BODY || '';
  if (!issueBody.trim()) {
    throw new Error('ISSUE_BODY env var is empty.');
  }

  const fields = parseIssueForm(issueBody);
  const rawRepo = fields['github repository url'] || '';
  const match = rawRepo.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!match) {
    throw new Error(`Could not find a valid GitHub repository URL in "${rawRepo}". Expected https://github.com/owner/repo.`);
  }
  const owner = match[1];
  const repoName = match[2].replace(/\.git$/i, '');

  let category = (fields['category'] || '').trim();
  const arch = (fields['architecture / form factor'] || '').trim();
  const model = (fields['model runtime'] || '').trim();
  const stage = (fields['project stage'] || '').trim();

  let newCategoryEntry = null;
  if (category === OTHER_CATEGORY_OPTION || category.toLowerCase().startsWith('other')) {
    const rawSuggested = (fields['suggested new category (only if category = other)'] || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawSuggested) {
      throw new Error(
        'You selected "other" for Category — please enter a name in "Suggested New Category" (or pick an existing category).'
      );
    }
    const derivedSlug = slugify(rawSuggested);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(derivedSlug) || derivedSlug.length < 2) {
      throw new Error(`Suggested category "${rawSuggested}" could not be turned into a valid kebab-case slug.`);
    }
    if (ALLOWED_CATEGORIES.has(derivedSlug)) {
      category = derivedSlug;
    } else {
      const displayName = rawSuggested.includes('-') && !rawSuggested.includes(' ')
        ? rawSuggested
            .split('-')
            .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
            .join(' ')
            .slice(0, 64)
        : rawSuggested.slice(0, 64);
      category = derivedSlug;
      newCategoryEntry = {
        slug: derivedSlug,
        name: displayName,
        description: `Open-source ${displayName.toLowerCase()} projects, tools, and libraries`
      };
    }
  } else if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error(`Invalid category "${category}".`);
  }

  if (!ALLOWED_ARCH.has(arch)) throw new Error(`Invalid architecture "${arch}".`);
  if (!ALLOWED_MODEL.has(model)) throw new Error(`Invalid model runtime "${model}".`);
  if (!ALLOWED_STAGE.has(stage)) throw new Error(`Invalid stage "${stage}".`);

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'alsobuilt-issue-to-pr'
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} for ${owner}/${repoName}. Make sure the repository is public.`);
  }
  const repo = await res.json();
  if (repo.private) {
    throw new Error(`Repository ${repo.full_name} is private and cannot be added to the public catalog.`);
  }

  const slug = slugify(repo.name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Derived slug "${slug}" is invalid.`);
  }

  // Prevent duplicates across categories
  const variantsRoot = path.resolve(process.cwd(), 'variants');
  for (const dir of fs.readdirSync(variantsRoot)) {
    const dirPath = path.join(variantsRoot, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.yaml')) continue;
      const existing = yaml.load(fs.readFileSync(path.join(dirPath, file), 'utf8'));
      if (
        existing?.slug === slug ||
        String(existing?.repo || '').toLowerCase().replace(/\/+$/, '') === repo.html_url.toLowerCase()
      ) {
        throw new Error(`Project is already listed in variants/${dir}/${file}.`);
      }
    }
  }

  let tagline = (fields['one-line tagline (optional)'] || repo.description || '').replace(/\s+/g, ' ').trim();
  if (tagline.length < 12) {
    tagline = `${repo.name} — open-source ${category.replace(/-/g, ' ')} project (${repo.language || 'AI'})`;
  }
  if (tagline.length > 180) {
    tagline = `${tagline.slice(0, 177).trimEnd()}...`;
  }

  const stack = (fields['primary stack (optional)'] || repo.language || 'Open Source').trim().slice(0, 80);
  const license = mapLicense(repo.license?.spdx_id);

  // Infer traits from manual input + repo description/topics/arch/language
  const traitSet = new Set();
  const manualRaw = fields['extra traits (optional, comma-separated)'] || '';
  for (const part of manualRaw.split(/[,\s]+/)) {
    const t = part.trim().toLowerCase();
    if (ALLOWED_TRAITS.has(t)) traitSet.add(t);
  }
  const hay = `${repo.name} ${tagline} ${stack} ${(repo.topics || []).join(' ')} ${repo.language || ''}`;
  for (const [trait, rx] of Object.entries(TRAIT_KEYWORDS)) {
    if (rx.test(hay)) traitSet.add(trait);
  }
  if (arch === 'CLI') traitSet.add('cli');
  if (arch === 'Browser') traitSet.add('browser');
  if (arch === 'Mobile') traitSet.add('mobile');
  if (model === 'Local LLM') traitSet.add('local-first');
  if (category === 'mcp-tooling') traitSet.add('mcp');
  if (category === 'local-voice') traitSet.add('voice');
  if (traitSet.size === 0) traitSet.add('self-hosted');
  const traits = [...traitSet].slice(0, 8);

  // Deterministic radar coordinates based on model/traits + hash jitter
  const baseX = model === 'Local LLM' ? 0.24 : model === 'Cloud API' ? 0.76 : 0.48;
  const baseY = traits.includes('multi-agent') ? 0.68 : 0.36;
  const x = clamp(baseX + (hashFloat(slug, 11) - 0.5) * 0.2, 0.1, 0.9);
  const y = clamp(baseY + (hashFloat(slug, 29) - 0.5) * 0.24, 0.1, 0.9);

  const entry = {
    slug,
    category,
    name: repo.name.slice(0, 64),
    repo: repo.html_url,
    tagline,
    arch,
    model,
    license,
    stage,
    ...(stage === 'Lesson' && fields['lesson note (only if stage = lesson)']
      ? { lesson: fields['lesson note (only if stage = lesson)'].replace(/\s+/g, ' ').trim().slice(0, 280) }
      : {}),
    stack,
    region: 'Global',
    stars: Number(repo.stargazers_count || 0),
    traits,
    x,
    y
  };

  if (newCategoryEntry) {
    const existingYaml = fs.readFileSync(CATEGORIES_PATH, 'utf8').trimEnd();
    const appendedBlock = yaml.dump([newCategoryEntry], { lineWidth: 120, noRefs: true }).trimEnd();
    fs.writeFileSync(CATEGORIES_PATH, `${existingYaml}\n\n${appendedBlock}\n`, 'utf8');
    syncCategories();
    console.log(`Proposed new category "${newCategoryEntry.slug}" (${newCategoryEntry.name}) in categories.yaml`);
  }

  const outDir = path.join(variantsRoot, category);
  fs.mkdirSync(outDir, { recursive: true });
  const relPath = `variants/${category}/${slug}.yaml`;
  fs.writeFileSync(path.join(process.cwd(), relPath), yaml.dump(entry, { lineWidth: 120, noRefs: true }));

  console.log(`Generated ${relPath} (${entry.name}, ★ ${entry.stars})`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `slug=${slug}`,
        `file_path=${relPath}`,
        `project_name=${entry.name}`,
        `stars=${entry.stars}`,
        `category=${category}`,
        `repo_url=${entry.repo}`,
        `new_category_created=${newCategoryEntry ? 'true' : 'false'}`,
        `new_category_name=${newCategoryEntry ? newCategoryEntry.name : ''}`
      ].join('\n') + '\n'
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
