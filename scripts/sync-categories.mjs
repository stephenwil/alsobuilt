import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const CATEGORIES_PATH = path.join(ROOT, 'categories.yaml');
export const SCHEMA_PATH = path.join(ROOT, 'schema', 'variant.schema.json');
export const ISSUE_FORM_PATH = path.join(ROOT, '.github', 'ISSUE_TEMPLATE', 'submit-project.yml');
export const OTHER_CATEGORY_OPTION = 'other (suggest a new category below)';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function loadCategories(categoriesPath = CATEGORIES_PATH) {
  if (!fs.existsSync(categoriesPath)) {
    throw new Error(`Missing categories file: ${categoriesPath}`);
  }
  const raw = yaml.load(fs.readFileSync(categoriesPath, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('categories.yaml must contain a non-empty YAML list of categories.');
  }

  const seen = new Set();
  const categories = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object') {
      throw new Error(`categories.yaml entry #${i + 1} must be an object.`);
    }
    const slug = String(item.slug || '').trim();
    const name = String(item.name || '').trim();
    const description = String(item.description || '').trim();

    if (!SLUG_RE.test(slug)) {
      throw new Error(`categories.yaml entry #${i + 1} has invalid slug "${slug}" (expected kebab-case).`);
    }
    if (seen.has(slug)) {
      throw new Error(`categories.yaml contains duplicate slug "${slug}".`);
    }
    if (name.length < 2 || name.length > 64) {
      throw new Error(`categories.yaml entry "${slug}" must have a name (2–64 chars).`);
    }
    if (description.length < 8 || description.length > 220) {
      throw new Error(`categories.yaml entry "${slug}" must have a description (8–220 chars).`);
    }
    seen.add(slug);
    categories.push({ slug, name, description });
  }
  return categories;
}

function renderSchema(categories) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  schema.properties.category.enum = categories.map((c) => c.slug);
  return JSON.stringify(schema, null, 2) + '\n';
}

function renderIssueForm(categories) {
  const src = fs.readFileSync(ISSUE_FORM_PATH, 'utf8');
  const optionsLines = [...categories.map((c) => c.slug), OTHER_CATEGORY_OPTION]
    .map((opt) => `        - ${opt}`)
    .join('\n');

  const rx = /(id:\s*category\r?\n\s*attributes:\r?\n\s*label:[^\r\n]+\r?\n\s*options:\r?\n)([\s\S]*?)(\r?\n\s*validations:)/;
  if (!rx.test(src)) {
    throw new Error(`Could not locate category dropdown options block in ${path.relative(ROOT, ISSUE_FORM_PATH)}.`);
  }
  return src.replace(rx, `$1${optionsLines}$3`);
}

function sqlEscape(str) {
  return String(str).replace(/'/g, "''");
}

export function renderCategoriesSql(categories) {
  const rows = categories
    .map((c) => `  ('${sqlEscape(c.slug)}', '${sqlEscape(c.name)}', '${sqlEscape(c.description)}')`)
    .join(',\n');
  return [
    '-- Auto-generated from categories.yaml by scripts/sync-categories.mjs',
    'INSERT INTO categories (slug, name, description) VALUES',
    rows,
    'ON CONFLICT(slug) DO UPDATE SET',
    '  name = excluded.name,',
    '  description = excluded.description;',
    ''
  ].join('\n');
}

export function syncCategories({ checkOnly = false } = {}) {
  const categories = loadCategories();
  const nextSchema = renderSchema(categories);
  const nextIssueForm = renderIssueForm(categories);

  const curSchema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const curIssueForm = fs.readFileSync(ISSUE_FORM_PATH, 'utf8');

  const drifted = [];
  if (curSchema !== nextSchema) drifted.push(path.relative(ROOT, SCHEMA_PATH));
  if (curIssueForm !== nextIssueForm) drifted.push(path.relative(ROOT, ISSUE_FORM_PATH));

  if (checkOnly) {
    if (drifted.length > 0) {
      throw new Error(
        `Category metadata is out of sync with categories.yaml in: ${drifted.join(', ')}.\nRun \`npm run sync:categories\` to update them.`
      );
    }
    return { categories, changed: [] };
  }

  if (curSchema !== nextSchema) fs.writeFileSync(SCHEMA_PATH, nextSchema, 'utf8');
  if (curIssueForm !== nextIssueForm) fs.writeFileSync(ISSUE_FORM_PATH, nextIssueForm, 'utf8');
  return { categories, changed: drifted };
}

function runCli() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const sqlIdx = args.indexOf('--sql');

  if (sqlIdx !== -1) {
    const outPath = args[sqlIdx + 1];
    if (!outPath) {
      throw new Error('Missing output path after --sql');
    }
    const categories = loadCategories();
    const sql = renderCategoriesSql(categories);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, sql, 'utf8');
    console.log(`Generated D1 category upsert SQL (${categories.length} categories) -> ${outPath}`);
    return;
  }

  const { categories, changed } = syncCategories({ checkOnly });
  if (checkOnly) {
    console.log(`Category sync OK (${categories.length} categories across schema & issue form).`);
  } else if (changed.length > 0) {
    console.log(`Synced ${categories.length} categories -> updated ${changed.join(', ')}.`);
  } else {
    console.log(`Already in sync (${categories.length} categories).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
