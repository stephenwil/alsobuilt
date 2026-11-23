import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const VARIANTS_DIR = path.join(ROOT, 'variants');
const TOKEN = process.env.GITHUB_TOKEN || '';

function walkYaml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkYaml(full));
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) out.push(full);
  }
  return out;
}

function parseGithubRepo(url) {
  const m = String(url).match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  return m ? `${m[1]}/${m[2].replace(/\.git$/, '')}` : null;
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'alsobuilt-nightly-sync'
};
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

let updated = 0;
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
  if (typeof info.stargazers_count === 'number' && info.stargazers_count !== doc.stars) {
    doc.stars = info.stargazers_count;
    fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 120, noRefs: true }), 'utf8');
    updated++;
    console.log(`Updated ${repoSlug}: ★ ${doc.stars}`);
  }
}

console.log(`Done. Updated ${updated} variant file(s).`);
