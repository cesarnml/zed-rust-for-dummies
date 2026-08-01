/**
 * Wraps every sentence of rendered page content in a `<span data-tts="n">`.
 *
 * That span is the unit of everything downstream: the highlight the player
 * moves through the page, and the audio segment `scripts/narrate.mjs`
 * synthesises. Both are derived from the built HTML — this plugin deliberately
 * writes no manifest of its own, because Astro caches rendered markdown and a
 * manifest emitted here would only cover the pages that happened to re-render.
 * The built HTML is always complete; a sidecar written from inside the render
 * is not.
 *
 * The span keeps the original nodes, so `window.theme(cx)` still renders as
 * code on the page. The spoken form ("window dot theme of context") is
 * recomputed from those same nodes at generation time by `speechOf`.
 */
import { visit } from 'unist-util-visit';
import { textOf } from '../lib/tts/speech.mjs';
import { splitSentences } from '../lib/tts/sentences.mjs';

/** Leaf blocks whose text is worth speaking. */
const BLOCKS = new Set([
	'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dd', 'dt', 'td', 'th', 'figcaption', 'summary',
]);

/** Subtrees that are never spoken. */
const SKIP = new Set(['script', 'style', 'svg', 'button']);

const hasBlockDescendant = (node) =>
	node.children?.some(
		(c) => c.type === 'element' && (BLOCKS.has(c.tagName) || hasBlockDescendant(c)),
	) ?? false;

const span = (index, children) => ({
	type: 'element',
	tagName: 'span',
	properties: { dataTts: String(index) },
	children,
});

export default function rehypeTts() {
	return (tree) => {
		let counter = 0;

		visit(tree, 'element', (node, _index, parent) => {
			// A fenced block is announced, not read, but it still gets a span so
			// the highlight lands on it while the announcement plays.
			if (node.tagName === 'pre') {
				if (parent) {
					const at = parent.children.indexOf(node);
					parent.children[at] = span(counter++, [node]);
				}
				return 'skip';
			}

			if (SKIP.has(node.tagName)) return 'skip';
			if (!BLOCKS.has(node.tagName)) return;
			if (hasBlockDescendant(node)) return;

			// Flatten to atoms: text nodes can be split at a sentence boundary,
			// inline elements are kept whole and assigned to whichever sentence
			// they start in.
			const atoms = node.children.map((child) =>
				child.type === 'text'
					? { kind: 'text', node: child, visible: child.value }
					: { kind: 'el', node: child, visible: textOf(child) },
			);

			const visible = atoms.map((a) => a.visible).join('');
			if (!visible.trim()) return;

			const ranges = splitSentences(visible);
			if (ranges.length === 0) return;

			const children = [];
			let cursor = 0;
			let ai = 0;
			let carry = atoms[0]?.visible ?? '';

			for (const range of ranges) {
				const bucket = [];

				while (ai < atoms.length && cursor < range.end) {
					const atom = atoms[ai];
					const atomStart = cursor;
					const atomEnd = atomStart + carry.length;

					if (atom.kind === 'text') {
						const from = Math.max(0, range.start - atomStart);
						const to = Math.min(carry.length, range.end - atomStart);
						const piece = carry.slice(from, to);
						if (piece) bucket.push({ type: 'text', value: piece });
						if (atomEnd > range.end) {
							// Text node straddles the boundary — keep the tail for
							// the next sentence.
							carry = carry.slice(to);
							cursor = range.end;
							break;
						}
					} else {
						bucket.push(atom.node);
					}

					cursor = atomEnd;
					ai++;
					carry = atoms[ai]?.visible ?? '';
				}

				if (bucket.length) children.push(span(counter++, bucket));
			}

			// Wrapping sentences must never change what the page says. Slicing
			// text nodes by offset is exactly the kind of code where an
			// off-by-one silently eats a space between two sentences, so the
			// invariant is asserted rather than assumed.
			const rebuilt = children.map(textOf).join('');
			if (rebuilt !== visible) {
				throw new Error(
					`rehype-tts changed page text.\n  before: ${JSON.stringify(visible.slice(0, 120))}\n` +
						`  after:  ${JSON.stringify(rebuilt.slice(0, 120))}`,
				);
			}

			node.children = children;
		});
	};
}
