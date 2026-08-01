#!/usr/bin/env node
/**
 * Renders the podcast cover to `public/podcast-cover.jpg`.
 *
 * Apple Podcasts wants JPEG or PNG, square, between 1400 and 3000 px. The art
 * is generated rather than drawn so it stays in step with the site palette —
 * ink `#101119` and ember `#EA862E`, the same pair `src/styles/theme.css`
 * uses in dark mode.
 *
 *   node scripts/make-cover.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SIZE = 1400;
const INK = '#101119';
const EMBER = '#EA862E';
const PARCHMENT = '#F7F4EE';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#141626"/>
			<stop offset="100%" stop-color="${INK}"/>
		</linearGradient>
	</defs>

	<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>

	<!-- Two window frames, offset and differently themed: the feature itself. -->
	<rect x="150" y="300" width="620" height="440" rx="26" fill="${INK}" stroke="#2A2E45" stroke-width="4"/>
	<rect x="150" y="300" width="620" height="58" rx="26" fill="#1B1F33"/>
	<rect x="150" y="332" width="620" height="26" fill="#1B1F33"/>
	<circle cx="196" cy="329" r="9" fill="#3A4060"/>
	<circle cx="226" cy="329" r="9" fill="#3A4060"/>
	<circle cx="256" cy="329" r="9" fill="#3A4060"/>

	<rect x="630" y="470" width="620" height="440" rx="26" fill="${PARCHMENT}" stroke="${EMBER}" stroke-width="5"/>
	<rect x="630" y="470" width="620" height="58" rx="26" fill="#EDE7DA"/>
	<rect x="630" y="502" width="620" height="26" fill="#EDE7DA"/>
	<circle cx="676" cy="499" r="9" fill="${EMBER}"/>
	<circle cx="706" cy="499" r="9" fill="#C9C1AF"/>
	<circle cx="736" cy="499" r="9" fill="#C9C1AF"/>

	<!-- Suggestion of code in each window. -->
	<rect x="196" y="410" width="300" height="14" rx="7" fill="#2F3552"/>
	<rect x="196" y="452" width="420" height="14" rx="7" fill="#2F3552"/>
	<rect x="196" y="494" width="240" height="14" rx="7" fill="${EMBER}" opacity="0.55"/>
	<rect x="196" y="536" width="380" height="14" rx="7" fill="#2F3552"/>
	<rect x="196" y="578" width="180" height="14" rx="7" fill="#2F3552"/>

	<rect x="676" y="580" width="300" height="14" rx="7" fill="#CFC7B4"/>
	<rect x="676" y="622" width="420" height="14" rx="7" fill="#CFC7B4"/>
	<rect x="676" y="664" width="240" height="14" rx="7" fill="${EMBER}"/>
	<rect x="676" y="706" width="380" height="14" rx="7" fill="#CFC7B4"/>
	<rect x="676" y="748" width="180" height="14" rx="7" fill="#CFC7B4"/>

	<text x="${SIZE / 2}" y="160" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
		font-size="104" font-weight="600" fill="${PARCHMENT}">Zed Rust</text>
	<text x="${SIZE / 2}" y="252" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
		font-size="104" font-weight="600" font-style="italic" fill="${EMBER}">for Dummies</text>

	<text x="${SIZE / 2}" y="1070" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
		font-size="40" fill="#8A90AC" letter-spacing="6">NARRATED FIELD GUIDE</text>
	<text x="${SIZE / 2}" y="1150" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
		font-size="34" fill="#666C88">per-window theme overrides · 307 files</text>

	<rect x="${SIZE / 2 - 90}" y="1230" width="180" height="6" rx="3" fill="${EMBER}"/>
</svg>`;

const out = fileURLToPath(new URL('../public/podcast-cover.jpg', import.meta.url));
await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(out);
console.log(`wrote ${path.relative(process.cwd(), out)} (${SIZE}×${SIZE})`);
