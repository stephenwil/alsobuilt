import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(import.meta.dirname, '..');
const VARIANTS_DIR = path.join(ROOT, 'variants');
const SCHEMA_PATH = path.join(ROOT, 'schema', 'variant.schema.json');
const OUT_INDEX = path.join(ROOT, 'public', 'index.json');
const CHECK_ONLY = process.argv.includes('--check');

const CATEGORIES = [
  {
    slug: 'ai-memory',
    name: 'AI Memory & Knowledge',
    description: 'Personal vaults, semantic note graphs, and persistent agent memory layers'
  },
  {
    slug: 'coding-agents',
    name: 'AI Coding Agents',
    description: 'Terminal, IDE, and autonomous multi-file software engineering agents'
  },
  {
    slug: 'local-voice',
    name: 'Local & Realtime Voice AI',
    description: 'Ambient dictation, low-latency voice pipelines, and speech-to-action tools'
  },
  {
    slug: 'mcp-tooling',
    name: 'MCP Servers & Tooling',
    description: 'Model Context Protocol servers, bridges, registries, and agent toolkits'
  },
  {
    slug: 'local-llm-runners',
    name: 'Local LLMs & Chat UIs',
    description: 'On-device model runners, inference engines, and desktop/mobile local chat apps'
  },
  {
    slug: 'browser-computer-use',
    name: 'Browser & Computer Use',
    description: 'Autonomous web automation, DOM agents, and desktop GUI control frameworks'
  },
  {
    slug: 'agent-workflows',
    name: 'Agent Frameworks',
    description: 'Multi-agent orchestration graphs, workflow builders, and typed agent SDKs'
  },
  {
    slug: 'hardware-embedded',
    name: 'Hardware & Embedded',
    description: 'CAN bus, automotive, ESP32, firmware, robotics, and electronics tools'
  },
  {
    slug: 'gamedev-retro',
    name: 'Game Dev & Retro',
    description: 'Fantasy consoles, cartridge SDKs, retro game engines, pixel art, and level editors'
  },
  {
    slug: 'devtools-infra',
    name: 'DevTools & Self-Hosted',
    description: 'Local-first apps, TUIs, network monitors, audio synths, and developer utilities'
  }
];

function walkYaml(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkYaml(full));
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) results.push(full);
  }
  return results.sort();
}

function deterministicCoord(traits, axis) {
  if (axis === 'x') {
    let score = 0.5;
    if (traits.includes('local-first')) score -= 0.28;
    if (traits.includes('cli')) score -= 0.1;
    if (traits.includes('open-weights')) score -= 0.06;
    if (traits.includes('self-hosted')) score += 0.18;
    if (traits.includes('browser')) score += 0.08;
    return Number(Math.max(0.12, Math.min(0.88, score)).toFixed(2));
  }
  let score = 0.45;
  if (traits.includes('multi-agent')) score += 0.28;
  if (traits.includes('mcp')) score += 0.1;
  if (traits.includes('realtime')) score += 0.08;
  if (traits.includes('voice')) score -= 0.12;
  if (traits.includes('markdown')) score -= 0.12;
  return Number(Math.max(0.14, Math.min(0.88, score)).toFixed(2));
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const files = walkYaml(VARIANTS_DIR);
const seenSlugs = new Set();
const variants = [];
let errors = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  let data;
  try {
    data = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`YAML parse error in ${rel}: ${err.message}`);
    errors++;
    continue;
  }

  if (!validate(data)) {
    console.error(`Schema error in ${rel}:`, ajv.errorsText(validate.errors));
    errors++;
    continue;
  }

  if (seenSlugs.has(data.slug)) {
    console.error(`Duplicate slug "${data.slug}" in ${rel}`);
    errors++;
    continue;
  }
  seenSlugs.add(data.slug);

  variants.push({
    ...data,
    stars: data.stars ?? 0,
    spark: data.spark ?? [4, 7, 10, 12, 15, 19, 22, 26],
    region: data.region ?? 'Global',
    x: data.x ?? deterministicCoord(data.traits, 'x'),
    y: data.y ?? deterministicCoord(data.traits, 'y')
  });
}

if (errors > 0) {
  console.error(`\nFailed validation with ${errors} error(s).`);
  process.exit(1);
}

variants.sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));

if (CHECK_ONLY) {
  console.log(`Validated ${variants.length} variant files with 0 errors.`);
  process.exit(0);
}

const payload = {
  generatedAt: new Date().toISOString(),
  categories: CATEGORIES,
  variants
};

fs.mkdirSync(path.dirname(OUT_INDEX), { recursive: true });
fs.writeFileSync(OUT_INDEX, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`Built public/index.json with ${variants.length} variants across ${CATEGORIES.length} categories.`);
