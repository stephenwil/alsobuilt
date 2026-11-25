import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { loadCategories } from './sync-categories.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const VARIANTS_DIR = path.join(ROOT, 'variants');
const SCHEMA_PATH = path.join(ROOT, 'schema', 'variant.schema.json');
const OUT_INDEX = path.join(ROOT, 'public', 'index.json');
const CHECK_ONLY = process.argv.includes('--check');

const CATEGORIES = loadCategories();

function loadGitAddedDates() {
  const map = new Map();
  try {
    const out = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--name-only', '--format=COMMIT:%cI', '--', 'variants/'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    );
    let currentDate = null;
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('COMMIT:')) {
        currentDate = line.slice('COMMIT:'.length).trim();
      } else if (currentDate && (line.endsWith('.yaml') || line.endsWith('.yml'))) {
        // git log outputs newest commits first; overwriting preserves the earliest add date
        map.set(line.replace(/\\/g, '/'), currentDate);
      }
    }
  } catch {
    // Non-git build environment fallback handled per-file via mtime
  }
  return map;
}

const gitAddedDates = loadGitAddedDates();

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

const STAR_HISTORY_PATH = path.join(ROOT, 'data', 'star-history.json');

function loadStarHistory() {
  if (!fs.existsSync(STAR_HISTORY_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(STAR_HISTORY_PATH, 'utf8'));
    return parsed && typeof parsed.snapshots === 'object' ? parsed.snapshots : {};
  } catch {
    return {};
  }
}

const starHistory = loadStarHistory();

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

  const relNorm = rel.replace(/\\/g, '/');
  const addedAt = gitAddedDates.get(relNorm) || fs.statSync(file).mtime.toISOString();

  const historyPoints = Array.isArray(starHistory[data.slug]) ? starHistory[data.slug] : [];
  const realSpark =
    historyPoints.length >= 2
      ? historyPoints
          .map((pt) => Number(pt?.stars))
          .filter((n) => Number.isFinite(n) && n >= 0)
      : undefined;

  const entry = {
    ...data,
    stars: data.stars ?? 0,
    region: data.region ?? 'Global',
    x: data.x ?? deterministicCoord(data.traits, 'x'),
    y: data.y ?? deterministicCoord(data.traits, 'y'),
    addedAt
  };
  if (realSpark && realSpark.length >= 2) {
    entry.spark = realSpark;
  } else if (!Array.isArray(data.spark)) {
    delete entry.spark;
  }

  variants.push(entry);
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
