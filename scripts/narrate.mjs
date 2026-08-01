#!/usr/bin/env node
/**
 * Generates the narration track for every page.
 *
 * Input is the built site, not the markdown source: `astro build` wraps each
 * sentence in a `<span data-tts="n">`, and this script reads those spans back
 * out of `dist/`. That means the audio can never drift from what is on the
 * page, and the timing sidecar it writes is indexed by the same `n` the player
 * highlights.
 *
 *   npm run build && npm run narrate
 *
 * Pages are content-hashed, so a second run only re-synthesises what changed.
 *
 * Usage:
 *   node scripts/narrate.mjs [--voice af_heart] [--backend kokoro-js|onnx]
 *                            [--only <substring>] [--force] [--jobs N]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fromHtml } from 'hast-util-from-html';
import { visit } from 'unist-util-visit';
import ffmpeg from 'ffmpeg-static';
import { speechOf } from '../src/lib/tts/speech.mjs';
import { tidyForSpeech } from '../src/lib/tts/sentences.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist');
const WORK = path.join(root, '.tts');
const OUT = path.join(root, 'public/audio');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const VOICE = flag('voice', 'af_heart');
const BACKEND = flag('backend', 'kokoro-js');
const ONLY = flag('only', null);
const JOBS = Number(flag('jobs', '4'));
const FORCE = has('force');

/** Every built page, as `{ key, sentences }`. */
function collectPages() {
	const pages = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name === 'index.html') pages.push(full);
		}
	};
	walk(DIST);

	return pages
		.map((file) => {
			const rel = path.relative(DIST, path.dirname(file));
			const key = rel === '' ? 'index' : rel.split(path.sep).join('/');
			const tree = fromHtml(fs.readFileSync(file, 'utf8'));

			const byIndex = new Map();
			visit(tree, 'element', (node) => {
				const raw = node.properties?.dataTts;
				if (raw === undefined || raw === null) return;
				const i = Number(raw);
				if (Number.isNaN(i) || byIndex.has(i)) return;
				const speech = tidyForSpeech(speechOf(node));
				if (speech) byIndex.set(i, speech);
			});

			const sentences = [...byIndex.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([i, speech]) => ({ i, speech }));
			return { key, sentences };
		})
		.filter((p) => p.sentences.length > 0)
		.filter((p) => !ONLY || p.key.includes(ONLY));
}

const hashOf = (page) =>
	crypto
		.createHash('sha256')
		.update(JSON.stringify({ v: 1, voice: VOICE, s: page.sentences }))
		.digest('hex')
		.slice(0, 16);

const run = (cmd, args) =>
	new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}`)),
		);
	});

async function main() {
	if (!fs.existsSync(DIST)) {
		console.error('No dist/ — run `npm run build` first.');
		process.exit(1);
	}

	const pages = collectPages();
	const stale = pages.filter((page) => {
		if (FORCE) return true;
		const sidecar = path.join(OUT, `${page.key}.json`);
		const audio = path.join(OUT, `${page.key}.mp3`);
		if (!fs.existsSync(sidecar) || !fs.existsSync(audio)) return true;
		try {
			return JSON.parse(fs.readFileSync(sidecar, 'utf8')).hash !== hashOf(page);
		} catch {
			return true;
		}
	});

	const totalChars = pages.reduce(
		(n, p) => n + p.sentences.reduce((m, s) => m + s.speech.length, 0),
		0,
	);
	console.log(
		`${pages.length} pages, ${pages.reduce((n, p) => n + p.sentences.length, 0)} sentences, ` +
			`${totalChars.toLocaleString()} chars`,
	);
	if (stale.length === 0) {
		console.log('Everything is up to date.');
		return;
	}
	console.log(`${stale.length} page(s) to synthesise with ${VOICE} via ${BACKEND}\n`);

	fs.mkdirSync(WORK, { recursive: true });
	fs.mkdirSync(OUT, { recursive: true });
	const jobPath = path.join(WORK, 'job.json');
	fs.writeFileSync(
		jobPath,
		JSON.stringify({ voice: VOICE, outDir: path.join(WORK, 'wav'), pages: stale }, null, '\t'),
	);

	if (BACKEND === 'onnx') {
		await run(path.join(root, '.venv-tts/bin/python'), [
			path.join(root, 'scripts/kokoro_synth.py'),
			jobPath,
			String(JOBS),
		]);
	} else {
		await run(process.execPath, [path.join(root, 'scripts/kokoro_synth.mjs'), jobPath]);
	}

	// Encode each page's WAV to MP3 and write the timing sidecar beside it.
	for (const page of stale) {
		const wav = path.join(WORK, 'wav', `${page.key}.wav`);
		const timing = path.join(WORK, 'wav', `${page.key}.timing.json`);
		if (!fs.existsSync(wav) || !fs.existsSync(timing)) {
			console.warn(`  ! ${page.key} — backend produced no audio, skipping`);
			continue;
		}
		const mp3 = path.join(OUT, `${page.key}.mp3`);
		fs.mkdirSync(path.dirname(mp3), { recursive: true });

		// 48 kbps mono is transparent enough for speech and keeps a four-hour
		// site under ~90 MB.
		await run(ffmpeg, [
			'-y', '-loglevel', 'error',
			'-i', wav,
			'-ac', '1', '-ar', '24000', '-b:a', '48k',
			mp3,
		]);

		const { duration, sentences } = JSON.parse(fs.readFileSync(timing, 'utf8'));
		fs.writeFileSync(
			path.join(OUT, `${page.key}.json`),
			JSON.stringify({
				key: page.key,
				voice: VOICE,
				hash: hashOf(page),
				duration,
				sentences,
			}),
		);
		const kb = (fs.statSync(mp3).size / 1024).toFixed(0);
		console.log(`  ✓ ${page.key.padEnd(34)} ${duration.toFixed(0)}s  ${kb} KB`);
	}

	console.log('\nDone. Re-run `npm run build` to publish the audio.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
