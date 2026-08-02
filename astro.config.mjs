// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import rehypeTts from './src/plugins/rehype-tts.mjs';
import { sidebar } from './src/sidebar.mjs';


// https://astro.build/config
export default defineConfig({
	site: 'https://zed-rust-oss-for-dummies.vercel.app',
	// The capstone moved from hour 12 to hour 13 when stored callbacks were
	// added ahead of it. The old URL was published and narrated, so it redirects
	// rather than 404s.
	redirects: {
		'/crash/12-capstone': '/crash/13-capstone/',
	},
	markdown: {
		// Wraps each sentence in a `<span data-tts="n">`. `scripts/narrate.mjs`
		// reads those spans back out of `dist/`, so `astro build` has to run
		// before audio can be generated.
		rehypePlugins: [rehypeTts],
	},
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
			favicon: '/favicon.svg',
			lastUpdated: true,
			head: [
				{
					tag: 'link',
					attrs: {
						rel: 'alternate',
						type: 'application/rss+xml',
						title: 'Zed Rust for Dummies — narrated',
						href: '/podcast.xml',
					},
				},
			],
			components: {
				// Mounts the narration player under the page title.
				PageTitle: './src/components/PageTitle.astro',
			},
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
			expressiveCode: {
				// Vitesse is warm and low-contrast — it stops code blocks from
				// being the harshest thing on the page in either theme.
				themes: ['vitesse-dark', 'vitesse-light'],
				// Only non-colour values here. Expressive Code *parses* colour
				// options (it derives contrast from them), so a `var(--token)`
				// string fails to parse and silently resolves to transparent.
				// The palette is wired to its `--ec-*` custom properties in
				// src/styles/custom.css instead.
				styleOverrides: {
					codeFontFamily: 'var(--sl-font-mono)',
					codeFontSize: '0.85rem',
					codeLineHeight: '1.65',
					codePaddingBlock: '0.85rem',
				},
			},
			customCss: [
				'@fontsource-variable/inter/wght.css',
				'@fontsource-variable/newsreader/wght.css',
				'@fontsource-variable/newsreader/wght-italic.css',
				'@fontsource-variable/jetbrains-mono/wght.css',
				'./src/styles/theme.css',
				'./src/styles/custom.css',
			],
			sidebar,
		}),
	],
});
