import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const VARIANTS_DIR = path.join(ROOT, 'variants');
const HISTORY_PATH = path.join(ROOT, 'data', 'star-history.json');
const MAX_SNAPSHOTS = 16;
const TOKEN = process.env.GITHUB_TOKEN || '';

function walkYaml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkYaml(full));
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) out.push(full);
  }
  return out.sort();
}

function parseGithubRepo(url) {
  const m = String(url).match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  return m ? `${m[1]}/${m[2].replace(/\.git$/, '')}` : null;
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { updatedAt: null, snapshots: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return {
      updatedAt: parsed.updatedAt ?? null,
      snapshots: parsed.snapshots && typeof parsed.snapshots === 'object' ? parsed.snapshots : {}
    };
  } catch {
    return { updatedAt: null, snapshots: {} };
  }
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'alsobuilt-nightly-sync'
};
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

const today = new Date().toISOString().slice(0, 10);
const history = loadHistory();

let updatedVariants = 0;
let recordedSnapshots = 0;

for (const file of walkYaml(VARIANTS_DIR)) {
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  const repoSlug = parseGithubRepo(doc.repo);
  if (!repoSlug) continue;

  const res = await fetch(`https://api.github.com/repos/${repoSlug}`, { headers });
  if (!res.ok) {
    console.warn(`Skipped ${repoSlug}: HTTP ${res.status}`);
    continue;
  }
  const info = await res.json();
  if (typeof info.stargazers_count === 'number') {
    const stars = info.stargazers_count;

    if (stars !== doc.stars) {
      doc.stars = stars;
      fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 120, noRefs: true }), 'utf8');
      updatedVariants++;
      console.log(`Updated ${repoSlug}: ★ ${doc.stars}`);
    }

    const list = Array.isArray(history.snapshots[doc.slug]) ? history.snapshots[doc.slug] : [];
    const last = list[list.length - 1];
    if (last && last.date === today) {
      last.stars = stars;
    } else {
      list.push({ date: today, stars });
    }
    history.snapshots[doc.slug] = list.slice(-MAX_SNAPSHOTS);
    recordedSnapshots++;
  }
}

history.updatedAt = today;
const sortedSnapshots = Object.fromEntries(
  Object.keys(history.snapshots)
    .sort()
    .map((k) => [k, history.snapshots[k]])
);

fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
fs.writeFileSync(
  HISTORY_PATH,
  JSON.stringify({ updatedAt: history.updatedAt, snapshots: sortedSnapshots }, null, 2) + '\n',
  'utf8'
);

console.log(
  `Done. Updated ${updatedVariants} variant file(s) and recorded ${recordedSnapshots} real star snapshot(s) in data/star-history.json.`
);
