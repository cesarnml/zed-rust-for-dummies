#!/usr/bin/env node
/**
 * Kokoro synthesis backend using kokoro-js — the default.
 *
 * Weights (Apache-2.0, ~86 MB at q8) are fetched from huggingface.co on first
 * run and cached by transformers.js. If that host is unreachable, use the
 * offline backend instead: `npm run narrate -- --backend onnx`.
 *
 * Reads a job file written by narrate.mjs and writes, per page, a single WAV
 * plus a `.timing.json` giving the start and end second of every sentence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KokoroTTS } from 'kokoro-js';

/** Pause after a sentence; a code-block announcement gets a longer one. */
const GAP = 0.12;
const GAP_ASIDE = 0.3;

const MODEL = process.env.KOKORO_MODEL ?? 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** Minimal 16-bit mono PCM WAV writer. */
function writeWav(file, samples, rate) {
	const buffer = Buffer.alloc(44 + samples.length * 2);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + samples.length * 2, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16); // PCM header size
	buffer.writeUInt16LE(1, 20); // format: PCM
	buffer.writeUInt16LE(1, 22); // channels
	buffer.writeUInt32LE(rate, 24);
	buffer.writeUInt32LE(rate * 2, 28); // byte rate
	buffer.writeUInt16LE(2, 32); // block align
	buffer.writeUInt16LE(16, 34); // bits per sample
	buffer.write('data', 36);
	buffer.writeUInt32LE(samples.length * 2, 40);
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, buffer);
}

async function main() {
	const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
	const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' });

	let done = 0;
	let totalSeconds = 0;

	for (const page of job.pages) {
		const chunks = [];
		const timing = [];
		let cursor = 0;
		let rate = 24000;

		for (const sentence of page.sentences) {
			const text = sentence.speech.trim();
			if (!text) continue;
			let audio;
			try {
				audio = await tts.generate(text, { voice: job.voice });
			} catch (err) {
				// One bad sentence must not lose the page.
				console.error(`  ! ${page.key} [${sentence.i}]: ${err.message}`);
				continue;
			}

			rate = audio.sampling_rate;
			const samples = audio.audio;
			const duration = samples.length / rate;
			timing.push({
				i: sentence.i,
				start: Number(cursor.toFixed(3)),
				end: Number((cursor + duration).toFixed(3)),
			});

			const gap = text.startsWith('[') ? GAP_ASIDE : GAP;
			chunks.push(samples, new Float32Array(Math.round(rate * gap)));
			cursor += duration + gap;
		}

		if (chunks.length === 0) continue;

		const total = chunks.reduce((n, c) => n + c.length, 0);
		const merged = new Float32Array(total);
		let at = 0;
		for (const chunk of chunks) {
			merged.set(chunk, at);
			at += chunk.length;
		}

		const dest = path.join(job.outDir, `${page.key}.wav`);
		writeWav(dest, merged, rate);
		fs.writeFileSync(
			path.join(job.outDir, `${page.key}.timing.json`),
			JSON.stringify({ duration: Number((total / rate).toFixed(3)), sentences: timing }),
		);

		totalSeconds += total / rate;
		done++;
		console.log(`  [${done}/${job.pages.length}] ${page.key} — ${(total / rate / 60).toFixed(1)} min`);
	}

	console.log(`Synthesised ${(totalSeconds / 3600).toFixed(2)} h of audio.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
