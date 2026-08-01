/**
 * The site's reading order, in one place.
 *
 * Starlight consumes this as its sidebar, and `src/pages/podcast.xml.ts`
 * consumes it as the episode order of the narration feed. They have to agree —
 * an audio feed that plays the chapters in a different order to the site would
 * be actively misleading — so neither owns it.
 */

/** @type {import('@astrojs/starlight/types').StarlightUserConfig['sidebar']} */
export const sidebar = [
	{
		label: 'Start here',
		items: [
			{ label: 'Read this first', slug: 'start/read-this-first' },
			{ label: 'What the feature does', slug: 'start/what-it-does' },
			{ label: 'Where the PR actually stands', slug: 'start/standing' },
			{ label: 'Who asked for this', slug: 'start/demand' },
		],
	},
	{
		label: 'Rust from zero — 12 hours',
		items: [
			{ label: 'How this crash course works', slug: 'crash/how-to-use' },
			{ label: '1. Toolchain and hello world', slug: 'crash/01-setup' },
			{ label: '2. Values, functions, match', slug: 'crash/02-values' },
			{ label: '3. Ownership', slug: 'crash/03-ownership' },
			{ label: '4. Borrowing and &mut', slug: 'crash/04-borrowing' },
			{ label: '5. Structs, enums, Option', slug: 'crash/05-structs-enums' },
			{ label: '6. Result and ?', slug: 'crash/06-errors' },
			{ label: '7. Collections and iterators', slug: 'crash/07-collections' },
			{ label: '8. Traits and generics', slug: 'crash/08-traits' },
			{ label: '9. Lifetimes', slug: 'crash/09-lifetimes' },
			{ label: '10. Box, Rc, Arc', slug: 'crash/10-smart-pointers' },
			{ label: '11. Modules, crates, tests', slug: 'crash/11-modules-tests' },
			{ label: '12. Capstone: the PR in miniature', slug: 'crash/12-capstone' },
		],
	},
	{
		label: 'Rust, for a TypeScript brain',
		items: [
			{ label: 'How to use this section', slug: 'rust/how-to-use' },
			{ label: '1. Ownership and borrowing', slug: 'rust/ownership' },
			{ label: '2. Traits', slug: 'rust/traits' },
			{ label: '3. Lifetimes', slug: 'rust/lifetimes' },
			{ label: '4. Arc, Option, Result', slug: 'rust/pointers' },
			{ label: '5. Closures and fn pointers', slug: 'rust/closures' },
			{ label: '6. Generics, macros, modules', slug: 'rust/generics' },
		],
	},
	{
		label: 'GPUI, in plain English',
		items: [
			{ label: 'The mental model', slug: 'gpui/model' },
			{ label: 'Reading a render signature', slug: 'gpui/signatures' },
		],
	},
	{
		label: 'The architecture',
		items: [
			{ label: 'Overview: three pieces', slug: 'architecture/overview' },
			{ label: '01. Window theme resolution', slug: 'architecture/01-resolution' },
			{ label: '02. Splitting ActiveTheme', slug: 'architecture/02-active-theme-split' },
			{ label: '03. Scoping the theme selector', slug: 'architecture/03-selector' },
			{ label: '04. Persistence by workspace id', slug: 'architecture/04-persistence' },
			{ label: '05. Lifecycle and background', slug: 'architecture/05-lifecycle' },
			{ label: '06. Deferred resolution', slug: 'architecture/06-deferred' },
			{ label: '07. Layering theme_overrides', slug: 'architecture/07-layering' },
		],
	},
	{
		label: 'The 2,900-line migration',
		items: [
			{ label: 'Why it is that big', slug: 'migration/why-big' },
			{ label: 'The seven rewrite shapes', slug: 'migration/shapes' },
		],
	},
	{
		label: 'Known gaps',
		items: [
			{ label: 'The honest list', slug: 'gaps/the-honest-list' },
			{ label: 'Syntax highlighting', slug: 'gaps/syntax-highlighting' },
			{ label: 'Mermaid and windowless renderers', slug: 'gaps/mermaid' },
			{ label: 'Light/dark following', slug: 'gaps/appearance' },
			{ label: 'The remaining seven', slug: 'gaps/remaining' },
		],
	},
	{
		label: 'Defending it',
		items: [
			{ label: 'Objections and answers', slug: 'defending/objections' },
			{ label: 'The process gate', slug: 'defending/process' },
			{ label: 'Etiquette and the AI policy', slug: 'defending/etiquette' },
			{ label: 'A walkthrough script', slug: 'defending/walkthrough' },
		],
	},
	{
		label: 'Reference',
		items: [
			{ label: 'Glossary', slug: 'reference/glossary' },
			{ label: 'File map', slug: 'reference/file-map' },
			{ label: 'Verification commands', slug: 'reference/verification' },
		],
	},
];

/**
 * The same order, flattened — `[{ label, slug, section }]` in the sequence a
 * reader (or listener) moves through the site.
 */
export const readingOrder = sidebar.flatMap((group) =>
	group.items.map((item) => ({ ...item, section: group.label })),
);
