// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://zed-rust-oss-for-dummies.vercel.app',
	integrations: [
		starlight({
			title: 'Zed Rust for Dummies',
			description:
				"A TypeScript developer's field guide to defending a 307-file Rust PR against the Zed codebase: per-window theme overrides.",
			social: [
				{
					icon: 'github',
					label: 'zed-industries/zed',
					href: 'https://github.com/zed-industries/zed',
				},
			],
			lastUpdated: true,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
			customCss: ['./src/styles/custom.css'],
			sidebar: [
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
			],
		}),
	],
});
