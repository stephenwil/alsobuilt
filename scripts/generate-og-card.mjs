import path from 'node:path';
import sharp from 'sharp';
import { loadCategories } from './sync-categories.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_PATH = path.join(ROOT, 'public', 'og-card.png');

const categories = loadCategories();
const siteUrl = (process.env.SITE_URL || 'https://alsobuilt.pages.dev').replace(/\/+$/, '');
const displayHost = siteUrl.replace(/^https?:\/\//, '');
const pillText = `OPEN-SOURCE BUILD RADAR  ·  ${categories.length} CATEGORIES`;

// Subtle 40px background grid
const gridLines = [];
for (let x = 40; x < 1200; x += 40) {
  gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="630" stroke="#1e293b" stroke-opacity="0.35" stroke-width="1"/>`);
}
for (let y = 40; y < 630; y += 40) {
  gridLines.push(`<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="#1e293b" stroke-opacity="0.35" stroke-width="1"/>`);
}

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bgGlow1" cx="18%" cy="18%" r="55%">
      <stop offset="0%" stop-color="#1e294a" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#090d16" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgGlow2" cx="85%" cy="82%" r="48%">
      <stop offset="0%" stop-color="#0d3b38" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#090d16" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accentTitle" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="cardBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#334155" stop-opacity="0.55"/>
    </linearGradient>
  </defs>

  <!-- Base background -->
  <rect width="1200" height="630" fill="#090d16"/>
  ${gridLines.join('\n  ')}
  <rect width="1200" height="630" fill="url(#bgGlow1)"/>
  <rect width="1200" height="630" fill="url(#bgGlow2)"/>

  <!-- Outer subtle frame -->
  <rect x="20" y="20" width="1160" height="590" rx="22" fill="none" stroke="#1e293b" stroke-width="1.5"/>

  <!-- Brand Logo (top-left) -->
  <g transform="translate(56, 54)">
    <rect x="0" y="0" width="22" height="22" rx="6" fill="none" stroke="#6366f1" stroke-width="3.2"/>
    <rect x="10" y="10" width="22" height="22" rx="6" fill="none" stroke="#10b981" stroke-width="3.2"/>
    <text x="44" y="28" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="27" font-weight="700" fill="#f8fafc" letter-spacing="-0.5">also<tspan font-weight="400" fill="#94a3b8">built</tspan></text>
  </g>

  <!-- Evergreen Category Pill -->
  <g transform="translate(56, 114)">
    <rect x="0" y="0" width="332" height="30" rx="15" fill="#111827" stroke="#334155" stroke-width="1.2"/>
    <circle cx="17" cy="15" r="5" fill="#10b981"/>
    <text x="31" y="19.5" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" font-weight="700" fill="#cbd5e1" letter-spacing="0.4">${pillText}</text>
  </g>

  <!-- Main Headline -->
  <text x="56" y="224" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="53" font-weight="700" fill="#f8fafc" letter-spacing="-1.2">See who's already</text>
  <text x="56" y="282" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="53" font-weight="700" fill="#f8fafc" letter-spacing="-1.2">building your</text>
  <text x="56" y="340" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="53" font-weight="700" fill="url(#accentTitle)" letter-spacing="-1.2">next idea.</text>

  <!-- Subtitle -->
  <text x="56" y="388" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="20" fill="#94a3b8">Paste a one-sentence pitch to check open-source</text>
  <text x="56" y="416" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="20" fill="#94a3b8">overlap, spot missing angles, or signal stealth work.</text>

  <!-- Trait Chips -->
  <g transform="translate(56, 448)" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="12.5" font-weight="600">
    <rect x="0" y="0" width="104" height="28" rx="14" fill="#064e3b" fill-opacity="0.35" stroke="#10b981" stroke-width="1.2"/>
    <text x="52" y="18.5" text-anchor="middle" fill="#34d399">local-first</text>

    <rect x="112" y="0" width="84" height="28" rx="14" fill="#1e293b" fill-opacity="0.7" stroke="#475569" stroke-width="1.2"/>
    <text x="154" y="18.5" text-anchor="middle" fill="#cbd5e1">ai &amp; mcp</text>

    <rect x="204" y="0" width="88" height="28" rx="14" fill="#064e3b" fill-opacity="0.35" stroke="#10b981" stroke-width="1.2"/>
    <text x="248" y="18.5" text-anchor="middle" fill="#34d399">hardware</text>

    <rect x="300" y="0" width="82" height="28" rx="14" fill="#064e3b" fill-opacity="0.35" stroke="#10b981" stroke-width="1.2"/>
    <text x="341" y="18.5" text-anchor="middle" fill="#34d399">gamedev</text>

    <rect x="390" y="0" width="96" height="28" rx="14" fill="#064e3b" fill-opacity="0.35" stroke="#10b981" stroke-width="1.2"/>
    <text x="438" y="18.5" text-anchor="middle" fill="#34d399">indie &lt;5k</text>
  </g>

  <!-- Right Panel: Constellation Radar -->
  <g transform="translate(658, 62)">
    <rect x="0" y="0" width="486" height="432" rx="18" fill="#0d1322" fill-opacity="0.92" stroke="url(#cardBorder)" stroke-width="1.6"/>

    <!-- Panel Header -->
    <text x="22" y="30" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" font-weight="700" fill="#cbd5e1" letter-spacing="0.8">CONSTELLATION RADAR</text>
    <rect x="352" y="13" width="114" height="24" rx="12" fill="#1e1b4b" stroke="#6366f1" stroke-width="1.2"/>
    <text x="409" y="29" text-anchor="middle" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11" font-weight="700" fill="#c7d2fe">72% TOP MATCH</text>

    <line x1="20" y1="48" x2="466" y2="48" stroke="#1e293b" stroke-width="1"/>

    <!-- Radar Rings & Crosshair centered at (243, 212) -->
    <circle cx="243" cy="212" r="134" fill="none" stroke="#1e293b" stroke-width="1"/>
    <circle cx="243" cy="212" r="90" fill="none" stroke="#1e293b" stroke-width="1"/>
    <circle cx="243" cy="212" r="46" fill="none" stroke="#1e293b" stroke-width="1"/>
    <line x1="243" y1="70" x2="243" y2="354" stroke="#1e293b" stroke-width="1"/>
    <line x1="28" y1="212" x2="458" y2="212" stroke="#1e293b" stroke-width="1"/>

    <!-- Axis Labels -->
    <text x="252" y="72" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="9.5" fill="#64748b">PLATFORM / SDK</text>
    <text x="252" y="366" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="9.5" fill="#64748b">FOCUSED TOOL</text>
    <text x="28" y="205" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="9.5" fill="#64748b">LOCAL-FIRST</text>
    <text x="458" y="205" text-anchor="end" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="9.5" fill="#64748b">CLOUD / SELF-HOSTED</text>

    <!-- Connector Lines from YOU (184, 222) -->
    <line x1="184" y1="222" x2="82" y2="158" stroke="#6366f1" stroke-width="1.4" stroke-opacity="0.75"/>
    <line x1="184" y1="222" x2="90" y2="279" stroke="#10b981" stroke-width="1.3" stroke-opacity="0.65"/>
    <line x1="184" y1="222" x2="208" y2="303" stroke="#10b981" stroke-width="1.3" stroke-opacity="0.65"/>

    <!-- Nodes -->
    <!-- aider -->
    <circle cx="144" cy="112" r="16" fill="#2563eb" fill-opacity="0.18"/>
    <circle cx="144" cy="112" r="9.5" fill="#3b82f6" stroke="#93c5fd" stroke-width="1.5"/>
    <text x="160" y="116" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#cbd5e1">aider</text>

    <!-- SavvyCAN -->
    <circle cx="82" cy="158" r="17" fill="#2563eb" fill-opacity="0.22"/>
    <circle cx="82" cy="158" r="10.5" fill="#3b82f6" stroke="#93c5fd" stroke-width="1.5"/>
    <text x="98" y="162" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#e2e8f0">SavvyCAN</text>

    <!-- openhands -->
    <circle cx="286" cy="119" r="18" fill="#9333ea" fill-opacity="0.22"/>
    <circle cx="286" cy="119" r="11" fill="#a855f7" stroke="#d8b4fe" stroke-width="1.5"/>
    <text x="303" y="123" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#cbd5e1">openhands</text>

    <!-- bevy -->
    <circle cx="348" cy="166" r="18" fill="#d97706" fill-opacity="0.22"/>
    <circle cx="348" cy="166" r="11" fill="#f59e0b" stroke="#fde68a" stroke-width="1.5"/>
    <text x="366" y="170" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#cbd5e1">bevy</text>

    <!-- fastmcp -->
    <circle cx="305" cy="233" r="15" fill="#2563eb" fill-opacity="0.2"/>
    <circle cx="305" cy="233" r="9" fill="#3b82f6" stroke="#93c5fd" stroke-width="1.5"/>
    <text x="320" y="237" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#cbd5e1">fastmcp</text>

    <!-- tessera-kit -->
    <circle cx="90" cy="279" r="14" fill="#10b981" fill-opacity="0.2"/>
    <circle cx="90" cy="279" r="8" fill="#10b981" stroke="#6ee7b7" stroke-width="1.5"/>
    <text x="104" y="283" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#cbd5e1">tessera-kit</text>

    <!-- mlxtop -->
    <circle cx="208" cy="303" r="14" fill="#10b981" fill-opacity="0.2"/>
    <circle cx="208" cy="303" r="8" fill="#10b981" stroke="#6ee7b7" stroke-width="1.5"/>
    <text x="222" y="307" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#cbd5e1">mlxtop</text>

    <!-- vital -->
    <circle cx="365" cy="291" r="14" fill="#10b981" fill-opacity="0.2"/>
    <circle cx="365" cy="291" r="8" fill="#10b981" stroke="#6ee7b7" stroke-width="1.5"/>
    <text x="379" y="295" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" fill="#cbd5e1">vital</text>

    <!-- YOU node -->
    <circle cx="184" cy="222" r="28" fill="#6366f1" fill-opacity="0.18"/>
    <circle cx="184" cy="222" r="17" fill="#6366f1" fill-opacity="0.32"/>
    <circle cx="184" cy="222" r="9.5" fill="#6366f1" stroke="#ffffff" stroke-width="2.2"/>
    <rect x="157" y="185" width="54" height="20" rx="8" fill="#6366f1"/>
    <text x="184" y="198.5" text-anchor="middle" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="10.5" font-weight="700" fill="#ffffff">YOU</text>

    <!-- Bottom Wedge Pill -->
    <rect x="20" y="384" width="446" height="32" rx="9" fill="#111827" stroke="#334155" stroke-width="1"/>
    <text x="34" y="404" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" font-weight="700" fill="#94a3b8">YOUR WEDGE:</text>
    <text x="132" y="404" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="11.5" font-weight="700" fill="#34d399">+ 3d-webgl    + hardware    + local-first</text>
  </g>

  <!-- Footer Divider & Bar -->
  <line x1="56" y1="538" x2="1144" y2="538" stroke="#1e293b" stroke-width="1.2"/>
  <text x="56" y="572" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="15" fill="#94a3b8">Git-First YAML Catalog   ·   MCP Server   ·   Cloudflare Pages + D1</text>
  <text x="1144" y="572" text-anchor="end" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="17" font-weight="700" fill="#f8fafc">${displayHost}</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT_PATH);
console.log(`Generated ${OUT_PATH} (${pillText} · ${displayHost})`);
