/**
 * Tests for the narration text layer. Run with `npm test`.
 *
 * These cover the two places that actually broke while this was being built:
 * the ordering between the lifetime rule and the `::` possessive rule (which
 * turned `WindowTheme::theme` into "Window Themelifetime s theme"), and the
 * tiling guarantee in `splitSentences` (whose absence silently deleted the
 * space between every pair of sentences on the site).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { speakCode, announceCodeBlock } from './speech.mjs';
import { splitSentences, tidyForSpeech } from './sentences.mjs';

test('speakCode: the common shapes', () => {
	assert.equal(speakCode('cx'), 'context');
	assert.equal(speakCode('cx.theme()'), 'context dot theme');
	assert.equal(speakCode('window.theme(cx)'), 'window dot theme of context');
	assert.equal(speakCode('Arc<Theme>'), 'Arc of Theme');
	assert.equal(speakCode('&Theme'), 'reference to Theme');
	assert.equal(speakCode('&mut Window'), 'mutable reference to Window');
	assert.equal(speakCode('WindowId'), 'Window I D');
	assert.equal(speakCode('theme_overrides'), 'theme overrides');
	assert.equal(speakCode("'static"), 'static');
});

test('speakCode: a lifetime is not a possessive', () => {
	// `::` becomes `'s`, so it has to resolve after the lifetime rule or the
	// apostrophe gets re-read as a lifetime named `s`.
	assert.equal(speakCode('WindowTheme::theme'), "Window Theme's theme");
	assert.equal(speakCode('ElevationIndex::bg'), "Elevation Index's bg");
	assert.match(speakCode("fn theme<'a>(&self, cx: &'a App)"), /lifetime a/);
	assert.doesNotMatch(speakCode('ThemeSettings::get_global(cx)'), /lifetime/);
});

test('speakCode: nested generics and multiple arguments', () => {
	assert.equal(speakCode('HashMap<WindowId, Arc<Theme>>'), 'Hash Map of Window I D and Arc of Theme');
	assert.equal(speakCode('Option<Arc<dyn Any>>'), 'Option of Arc of dyn Any');
});

test('speakCode: paths, files and line numbers', () => {
	assert.equal(speakCode('crates/theme/src/theme.rs'), 'crates, theme, src, theme dot R S');
	assert.equal(speakCode('settings.json'), 'settings dot JSON');
	assert.equal(speakCode('theme_selector.rs'), 'theme selector dot R S');
	assert.equal(speakCode('zed/src/zed.rs:413'), 'zed, src, zed dot R S, line 413');
	assert.equal(
		speakCode('crates/ui/src/styles/{color,elevation}.rs'),
		'crates, U I, src, styles, color dot R S, elevation dot R S',
	);
});

test('speakCode: a commit SHA is cut, not spelled out in full', () => {
	assert.equal(speakCode('04b9f24065'), 'commit 0 4 b 9');
	// A hex-looking word that is actually prose must not be mistaken for one.
	assert.equal(speakCode('deadbeef'), 'deadbeef');
});

test('speakCode: closures, macros and turbofish', () => {
	assert.equal(speakCode('sql!'), 'sequel macro');
	assert.equal(speakCode('impl_tuple_row_traits!'), 'impl tuple row traits macro');
	assert.match(speakCode('cx.global::<GlobalTheme>()'), /turbofish of Global Theme/);
	// `|a, b|` is a parameter list, not a disjunction.
	assert.doesNotMatch(speakCode('cx.listener(|this, action, cx| ...)'), / or /);
});

test('speakCode: leaves no residual punctuation for any corpus shape', () => {
	const samples = [
		'&**window.theme(cx)', '#[derive(Default)]', '#![deny(missing_docs)]',
		'::default()', 'T | undefined', '(x) => x + captured', '_window:',
		'theme_override: Option<SharedString>', 'ElevationIndex::{bg, shadow}',
		'fn(&App) -> Hsla', 'Arc<dyn Fn(...)>', '"theme"',
	];
	for (const sample of samples) {
		const spoken = speakCode(sample);
		assert.doesNotMatch(spoken, /[<>&{}|\\]|::|\(\)/, `residual punctuation in ${sample}`);
	}
});

test('announceCodeBlock: counts Expressive Code lines and names the language', () => {
	const line = () => ({ type: 'element', tagName: 'div', properties: { className: ['ec-line'] }, children: [] });
	const pre = {
		type: 'element',
		tagName: 'pre',
		properties: { dataLanguage: 'rust' },
		children: [line(), line(), line()],
	};
	assert.equal(announceCodeBlock(pre), '[Rust code block, 3 lines.]');
});

test('splitSentences: ranges tile the input exactly', () => {
	// This is the load-bearing property: the caller slices DOM text nodes with
	// these ranges, so any gap deletes a character from the rendered page.
	const inputs = [
		'One sentence.',
		'First. Second! Third?',
		'Ends without a terminator',
		'A line.\nAnother line after a newline.',
		'Quote: "like this." Then more.',
		'  leading space, then a stop. And another.',
	];
	for (const text of inputs) {
		const ranges = splitSentences(text);
		assert.equal(ranges[0].start, 0, `does not start at 0: ${text}`);
		assert.equal(ranges.at(-1).end, text.length, `does not end at length: ${text}`);
		for (let i = 1; i < ranges.length; i++) {
			assert.equal(ranges[i].start, ranges[i - 1].end, `gap before range ${i} in: ${text}`);
		}
		assert.equal(ranges.map((r) => text.slice(r.start, r.end)).join(''), text);
	}
});

test('splitSentences: does not break on abbreviations or decimals', () => {
	assert.equal(splitSentences('Use e.g. this one. Then stop.').length, 2);
	assert.equal(splitSentences('Version 1.0 shipped. Then 2.0.').length, 2);
	assert.equal(splitSentences('Ask J. Doe about it. Later.').length, 2);
});

test('splitSentences: a highlight starts on a visible character', () => {
	const text = 'First sentence.   Second sentence.';
	const [, second] = splitSentences(text);
	assert.equal(text[second.start], 'S');
});

test('tidyForSpeech: closes the gap left by expanded inline code', () => {
	assert.equal(tidyForSpeech('not warn about it , remove it'), 'not warn about it, remove it');
	assert.equal(tidyForSpeech('a ( configured theme ) here'), 'a (configured theme) here');
	assert.equal(tidyForSpeech('spaced   out\ntext'), 'spaced out text');
});
