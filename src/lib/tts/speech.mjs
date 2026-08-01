/**
 * Turns inline `code` spans into something a speech synthesiser can read.
 *
 * The site has 1,667 inline code spans across 548 distinct strings — roughly one
 * every 23 words of prose. A lookup table does not cover that: the 150 most
 * common spans account for only 70% of occurrences. So this is a rules engine
 * for the Rust/path/identifier grammar, plus a dictionary for the head of the
 * distribution and for anything the rules get wrong.
 *
 * Guiding rule (the author's): verbose where it enhances clarity, terse where
 * verbose sounds goofy. So `&mut Window` becomes "mutable reference to Window"
 * — the long form is what a person would say out loud — but a commit SHA is
 * cut to four spelled characters, because no amount of verbosity makes
 * "04b9f24065" clarifying by ear.
 */

/** Exact-match overrides. Checked before any rule fires. */
const DICTIONARY = new Map(Object.entries({
	// --- the head of the distribution -------------------------------------
	cx: 'context',
	gpui: 'G P U I',
	fn: 'function',
	ui: 'U I',
	Hsla: 'H S L A',
	sqlez: 'sequel E Z',
	'sql!': 'sequel macro',
	zed: 'Zed',

	// `impl` is a term of art. Expanding it to "something implementing" reads
	// naturally in bound position but is wrong for the bare noun phrase, so
	// both forms are spelled out here rather than left to a rule.
	'impl Trait': 'impl Trait',
	'&impl Trait': 'reference to impl Trait',
	'dyn Trait': 'dyn Trait',
	'impl ActiveTheme for App': 'the ActiveTheme implementation for App',
	'impl ActiveTheme for Arc<Theme>': 'the ActiveTheme implementation for Arc of Theme',
	'&impl ActiveTheme': 'reference to something implementing ActiveTheme',

	// Lifetimes. "static lifetime" is redundant in the phrase "the 'static
	// bound", which is how the prose actually uses it.
	"'static": 'static',
	"&'static str": 'a static string slice',

	// Bare punctuation used as prose nouns.
	'?': 'the question mark operator',
	'&': 'ampersand',
	_: 'underscore',
	'_:': 'underscore',
	'::<T>': 'turbofish of T',
	'"\\n"': 'a newline',
	'->': 'returning',

	// Primitives, where the long form is genuinely more informative by ear.
	u64: 'unsigned 64-bit integer',
	usize: 'pointer-sized unsigned integer',
	bool: 'boolean',

	// Frequently-spoken shapes the rules would render clumsily.
	'&**window.theme(cx)': 'a double dereference of window dot theme of context',
	'let ... else': 'let else',
	'let _ =': 'let underscore equals',
	'T | undefined': 'T or undefined',
	'Release Notes:': 'Release Notes',
	'.rules': 'dot rules',
	'#[deprecated]': 'the deprecated attribute',
	'#[derive(Default)]': 'the derive Default attribute',
	'#[serde(deny_unknown_fields)]': 'the serde deny unknown fields attribute',
	'307 files changed, 4701 insertions(+), 3078 deletions(-)':
		'307 files changed, 4,701 insertions, 3,078 deletions',
}));

/** Identifier-level substitutions, applied after structure is unpacked. */
const IDENTS = new Map(Object.entries({
	cx: 'context',
	Id: 'I D',
	Ids: 'I Ds',
	ui: 'U I',
	gpui: 'G P U I',
	Hsla: 'H S L A',
	sqlez: 'sequel E Z',
	fn: 'function',
	dyn: 'dyn',
	impl: 'impl',
	str: 'string slice',
	u64: 'unsigned 64-bit integer',
	usize: 'pointer-sized unsigned integer',
	bool: 'boolean',
}));

/** File extensions, spelled the way people say them. */
const EXTENSIONS = new Map(Object.entries({
	rs: 'R S',
	md: 'M D',
	ts: 'T S',
	js: 'J S',
	mjs: 'M J S',
	json: 'JSON',
	toml: 'TOML',
	css: 'C S S',
	html: 'H T M L',
	astro: 'astro',
	yml: 'Y M L',
	yaml: 'YAML',
}));

const isSha = (s) => /^[0-9a-f]{7,40}$/.test(s) && /\d/.test(s) && /[a-f]/.test(s);
const isAllCaps = (s) => /^[A-Z0-9_]{2,}$/.test(s);

/** `Arc<Theme>` → `Arc of Theme`; `HashMap<K, V>` → `HashMap of K and V`. */
function expandGenerics(s) {
	const open = s.indexOf('<');
	if (open === -1) return s;

	// Find the matching close bracket so nested generics survive.
	let depth = 0;
	let close = -1;
	for (let i = open; i < s.length; i++) {
		if (s[i] === '<') depth++;
		else if (s[i] === '>') {
			depth--;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}
	if (close === -1) return s;

	const head = s.slice(0, open);
	const inner = s.slice(open + 1, close);
	const tail = s.slice(close + 1);

	// Split on top-level commas only.
	const args = [];
	let buf = '';
	let d = 0;
	for (const ch of inner) {
		if (ch === '<' || ch === '(') d++;
		else if (ch === '>' || ch === ')') d--;
		if (ch === ',' && d === 0) {
			args.push(buf);
			buf = '';
		} else buf += ch;
	}
	args.push(buf);

	const spoken = args.map((a) => expandGenerics(a.trim())).filter(Boolean);
	const joined =
		spoken.length <= 1 ? spoken[0] ?? '' : `${spoken.slice(0, -1).join(', ')} and ${spoken.at(-1)}`;
	return `${expandGenerics(head)} of ${joined}${expandGenerics(tail)}`;
}

/** `&mut Window` → `mutable reference to Window`. */
function expandReferences(s) {
	return s
		.replace(/&\s*'(\w+)\s+mut\s+/g, 'mutable reference with lifetime $1 to ')
		.replace(/&\s*'(\w+)\s+/g, 'reference with lifetime $1 to ')
		.replace(/&\s*mut\s+/g, 'mutable reference to ')
		.replace(/&(?=[A-Za-z_])/g, 'reference to ');
}

/** `crates/theme/src/theme.rs` → `crates, theme, src, theme dot R S`. */
function expandPath(s) {
	const [path, line] = s.split(':');
	const spoken = path
		.split('/')
		.filter(Boolean)
		.map((seg) => {
			// `{editor,document_symbols}.rs` — a brace group names sibling files.
			const braced = seg.match(/^\{(.*)\}(\..*)?$/);
			if (braced) {
				const ext = braced[2] ?? '';
				return braced[1]
					.split(',')
					.map((n) => expandPath(n.trim() + ext))
					.join(', ');
			}
			const m = seg.match(/^(.*)\.([A-Za-z0-9]+)$/);
			if (m && EXTENSIONS.has(m[2])) {
				return `${expandIdentifier(m[1])} dot ${EXTENSIONS.get(m[2])}`;
			}
			return expandIdentifier(seg);
		})
		.join(', ');
	const prefix = s.startsWith('.') ? 'dot ' : '';
	return line && /^\d+$/.test(line) ? `${prefix}${spoken}, line ${line}` : `${prefix}${spoken}`;
}

/** Split identifiers into words the synthesiser can pronounce separately. */
function expandIdentifier(word) {
	if (IDENTS.has(word)) return IDENTS.get(word);
	if (isAllCaps(word)) return word;

	// snake_case → words, preserving a leading underscore (it means "unused"
	// in Rust, which is worth hearing).
	if (word.includes('_')) {
		const lead = word.startsWith('_') ? 'underscore ' : '';
		return (
			lead +
			word
				.split('_')
				.filter(Boolean)
				.map(expandIdentifier)
				.join(' ')
		);
	}

	// CamelCase → words. `WindowId` → `Window I D`.
	if (/^[A-Za-z]+$/.test(word) && /[a-z][A-Z]/.test(word)) {
		return word
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.split(' ')
			.map((w) => IDENTS.get(w) ?? w)
			.join(' ');
	}
	return word;
}

/**
 * Convert one inline code span to speech text.
 *
 * @param {string} raw - the literal contents of a `code` span
 * @returns {string} text suitable for a speech synthesiser
 */
export function speakCode(raw) {
	const key = String(raw).trim();
	if (!key) return '';
	if (DICTIONARY.has(key)) return DICTIONARY.get(key);

	// Commit SHAs: four spelled characters is identifiable; ten is noise.
	if (isSha(key)) return `commit ${key.slice(0, 4).split('').join(' ')}`;

	// Quoted string literals read better without the quotes.
	const quoted = key.match(/^"(.*)"$/);
	if (quoted) return speakCode(quoted[1]) || quoted[1];

	// Attributes, outer `#[...]` and inner `#![...]` alike.
	const attr = key.match(/^#!?\[(.+)\]$/);
	if (attr) return `the ${expandIdentifier(attr[1].replace(/[()]/g, ' ')).trim()} attribute`;

	// Paths — anything with a slash, or a bare filename with a known extension.
	if (key.includes('/') && !key.includes(' ')) return expandPath(key);
	const filename = key.match(/^([\w.-]+)\.([A-Za-z0-9]+)$/);
	if (filename && EXTENSIONS.has(filename[2])) return expandPath(key);

	let s = key;

	// Trailing punctuation that only matters on the page.
	s = s.replace(/[;:]\s*$/, '');

	// Quotes: say the words, drop the delimiters.
	s = s.replace(/"([^"]*)"/g, '$1');

	// Elided argument lists carry no information by ear.
	s = s.replace(/\(\s*\.\.\.\s*\)/g, '');
	s = s.replace(/\s*\.\.\.\s*/g, ' ');

	// Brace expansion: `Elevation::{bg, shadow}` → `Elevation's bg, shadow`.
	s = s.replace(/\{([^}]*)\}/g, (_m, inner) => inner);

	// Macro invocation.
	s = s.replace(/(\w+)!/g, '$1 macro');

	// Turbofish, before the `::` possessive rule can claim the colons. The
	// angle brackets are left in place for `expandGenerics` to voice as "of",
	// so this must not supply an "of" of its own.
	s = s.replace(/::</g, ' turbofish<');

	s = expandGenerics(s);
	s = expandReferences(s);

	// Lifetimes must resolve BEFORE `::` becomes a possessive, or the `'s`
	// this rule introduces gets re-read as a lifetime named `s`.
	s = s.replace(/'(\w+)\b/g, (_m, n) => (n === 'static' ? 'static' : `lifetime ${n}`));

	// Paths: `WindowTheme::theme` → `WindowTheme's theme`. A leading `::`
	// (as in `::default()`) has no owner to be possessive about — drop it.
	s = s.replace(/(\w)::(\w)/g, "$1's $2").replace(/^::/, '');

	// Closure parameter lists: `|this, action, cx|` is not a disjunction.
	s = s.replace(/\|([^|]*)\|/g, (_m, args) => (args.trim() ? ` closure of ${args} ` : ' closure '));

	// Calls: `foo()` → `foo`; `foo(bar)` → `foo of bar`. Looped, because the
	// inner-most-first regex only unwraps one nesting level per pass.
	s = s.replace(/\(\s*\)/g, '');
	for (let i = 0; i < 6 && /\(/.test(s); i++) {
		const next = s.replace(/\(([^()]*)\)/g, ' of $1');
		if (next === s) break;
		s = next;
	}

	// A binding's type annotation reads as an apposition: `name: Type` →
	// "name, Type".
	s = s.replace(/(\w)\s*:\s+/g, '$1, ');

	// Operators. `=>` is matched before `=` so a TypeScript arrow function
	// does not come out as "equals greater than".
	s = s.replace(/\s*->\s*/g, ' returning ');
	s = s.replace(/\s*=>\s*/g, ' arrow ');
	s = s.replace(/\s*\|\s*/g, ' or ');
	s = s.replace(/\s*\?\s*/g, ' question mark ');
	s = s.replace(/\s*=\s*/g, ' equals ');

	// Leading method dot: `.clone` → `dot clone`.
	s = s.replace(/(^|\s)\.(\w)/g, '$1dot $2');
	s = s.replace(/(\w)\.(\w)/g, '$1 dot $2');

	// Finally, expand each remaining identifier.
	s = s
		.split(/(\s+|,)/)
		.map((tok) => {
			// Keep a possessive suffix attached to the expanded owner.
			const m = tok.match(/^([A-Za-z_][\w]*)('s)?$/);
			return m ? expandIdentifier(m[1]) + (m[2] ?? '') : tok;
		})
		.join('');

	return s.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/** Plain text of a hast subtree. */
export const textOf = (node) =>
	node.type === 'text' ? node.value : (node.children?.map(textOf).join('') ?? '');

/**
 * Spoken form of a hast subtree.
 *
 * Identical to `textOf` except inside `code` (expanded to speech) and `pre`
 * (announced rather than read). Shared by the build-time span wrapper and the
 * audio generator so both agree on what a given span says.
 */
export const speechOf = (node) => {
	if (node.type === 'text') return node.value;
	if (node.type !== 'element') return '';
	if (node.tagName === 'script' || node.tagName === 'style' || node.tagName === 'link') return '';
	if (node.tagName === 'pre') return announceCodeBlock(node);
	if (node.tagName === 'code') return ` ${speakCode(textOf(node))} `;
	return node.children?.map(speechOf).join('') ?? '';
};

/** Count of elements matching a class, anywhere beneath `node`. */
const countByClass = (node, className) => {
	let n = 0;
	const walk = (current) => {
		if (current.type === 'element') {
			const classes = current.properties?.className ?? [];
			if ((Array.isArray(classes) ? classes : [classes]).map(String).includes(className)) n++;
		}
		current.children?.forEach(walk);
	};
	walk(node);
	return n;
};

/**
 * Describe a fenced code block instead of reading it.
 *
 * Reading 165 fenced blocks line by line would be unlistenable, but silently
 * dropping them loses the fact that the prose is pointing at something.
 *
 * Expressive Code has already rewritten these by the time the generator sees
 * them: the language moves to `pre[data-language]` and each source line becomes
 * its own `div.ec-line`, with no literal newlines left to count.
 *
 * @param {object} pre - the `pre` element node
 */
export function announceCodeBlock(pre) {
	const lang =
		pre.properties?.dataLanguage ??
		(pre.children ?? [])
			.flatMap((c) => (c.properties?.className ?? []).map(String))
			.find((c) => c.startsWith('language-'))
			?.replace('language-', '');

	const lines = countByClass(pre, 'ec-line') || textOf(pre).trim().split('\n').length;
	const named = {
		rust: 'Rust', bash: 'shell', sh: 'shell', shell: 'shell',
		json: 'JSON', sql: 'SQL', ts: 'TypeScript', js: 'JavaScript',
		toml: 'TOML', diff: 'diff', text: '', plaintext: '',
	};
	const label = lang ? (named[String(lang)] ?? String(lang)) : '';
	return `[${label ? label + ' ' : ''}code block, ${lines} line${lines === 1 ? '' : 's'}.]`;
}
