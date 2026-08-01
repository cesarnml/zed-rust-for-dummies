#!/usr/bin/env node
/**
 * Compiles every Rust snippet in the crash course.
 *
 * A teaching page whose examples do not build is worse than no page, and these
 * are the first Rust a reader will type. So every ```rust fence is compiled with
 * the real toolchain.
 *
 * Two markers, written as HTML comments immediately above a fence, control what
 * is expected. They are invisible to readers and to the narration.
 *
 *   <!-- rust:expect-fail -->   the snippet MUST NOT compile (it demonstrates
 *                               an error, and a silent fix would make the prose
 *                               a lie)
 *   <!-- rust:skip -->          a fragment that cannot stand alone
 *
 * Snippets are compiled as a library crate, so top-level items need no `main`.
 * A snippet that is only statements is retried wrapped in one.
 *
 *   node scripts/check-rust-examples.mjs [--dir src/content/docs/crash]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dirArg = process.argv.indexOf('--dir');
const DIR = path.join(root, dirArg === -1 ? 'src/content/docs/crash' : process.argv[dirArg + 1]);

/** @returns {Array<{file: string, line: number, code: string, mode: string}>} */
function collect(file) {
	const lines = fs.readFileSync(file, 'utf8').split('\n');
	const blocks = [];
	let mode = 'check';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		const marker = line.match(/^<!--\s*rust:(expect-fail|skip)\s*-->$/);
		if (marker) {
			mode = marker[1];
			continue;
		}

		if (!/^```rust\b/.test(line)) {
			// A non-fence, non-blank line cancels a pending marker so it cannot
			// leak onto an unrelated block further down.
			if (line !== '' && !line.startsWith('<!--')) mode = 'check';
			continue;
		}

		const start = i;
		const indent = lines[i].length - lines[i].trimStart().length;
		const body = [];
		i++;
		while (i < lines.length && lines[i].trim() !== '```') {
			body.push(lines[i].slice(indent));
			i++;
		}
		blocks.push({
			file: path.relative(root, file),
			line: start + 1,
			code: body.join('\n'),
			mode,
		});
		mode = 'check';
	}
	return blocks;
}

/** Try to compile `code`; returns null on success or the stderr on failure. */
function compile(code, tmp) {
	const attempts = [code, `fn main() {\n${code}\n}`];
	let lastError = '';

	for (const source of attempts) {
		const file = path.join(tmp, 'snippet.rs');
		fs.writeFileSync(file, source);
		try {
			execFileSync(
				'rustc',
				[
					'--edition', '2021',
					'--crate-type', 'lib',
					'--emit', 'metadata',
					'-A', 'dead_code',
					'-A', 'unused_variables',
					'-A', 'unused_mut',
					'-o', path.join(tmp, 'out.rmeta'),
					file,
				],
				{ stdio: ['ignore', 'pipe', 'pipe'] },
			);
			return null;
		} catch (error) {
			lastError = String(error.stderr ?? error.message);
			// Only the bare-statements case is worth a second attempt.
			if (!/expected item|consider adding a `main`/.test(lastError)) break;
		}
	}
	return lastError;
}

const files = fs
	.readdirSync(DIR)
	.filter((name) => name.endsWith('.md') || name.endsWith('.mdx'))
	.map((name) => path.join(DIR, name))
	.sort();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rustcheck-'));
let checked = 0;
let skipped = 0;
let expectedFail = 0;
const failures = [];

for (const file of files) {
	for (const block of collect(file)) {
		if (block.mode === 'skip') {
			skipped++;
			continue;
		}
		const error = compile(block.code, tmp);
		const where = `${block.file}:${block.line}`;

		if (block.mode === 'expect-fail') {
			expectedFail++;
			if (!error) {
				failures.push(`${where} — marked expect-fail but it COMPILES`);
			}
			continue;
		}

		checked++;
		if (error) {
			const first = error
				.split('\n')
				.filter((l) => /^error/.test(l))
				.slice(0, 2)
				.join(' / ');
			failures.push(`${where} — ${first || error.split('\n')[0]}`);
		}
	}
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(
	`${checked} snippets compiled, ${expectedFail} expected to fail, ${skipped} skipped`,
);
if (failures.length) {
	console.error(`\n${failures.length} problem(s):`);
	for (const failure of failures) console.error(`  ✗ ${failure}`);
	process.exit(1);
}
console.log('All Rust examples behave as documented.');
