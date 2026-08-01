/**
 * Podcast feed for the narrated site — `/podcast.xml`.
 *
 * Subscribe in any podcast app to listen with the screen off, which is the one
 * thing the in-page player cannot do.
 *
 * Episode order is the site's reading order (`src/sidebar.mjs`), not
 * chronology, so this is published as a serial: episode numbers ascend, and
 * `pubDate` ascends with them so apps that sort by date still present chapter
 * one first. Feeds are generated from the same audio the site serves — if
 * `public/audio` has no track for a page, that page is simply not an episode.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readingOrder } from '../sidebar.mjs';

/**
 * Anchor for the synthetic publication dates. Only the ordering matters, but
 * the value has to be stable or every build churns the whole feed and apps
 * re-announce all 35 episodes as new.
 */
const EPOCH = Date.UTC(2026, 7, 1, 9, 0, 0);

const escape = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const hhmmss = (seconds: number) => {
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

export const GET: APIRoute = async ({ site }) => {
	const base = (site ?? new URL('https://zed-rust-oss-for-dummies.vercel.app')).href.replace(
		/\/$/,
		'',
	);
	const audioDir = path.join(process.cwd(), 'public/audio');
	const docs = await getCollection('docs');
	const byId = new Map(docs.map((entry) => [entry.id.replace(/\.(md|mdx)$/, ''), entry]));

	const episodes = readingOrder
		.map((page, index) => {
			const mp3 = path.join(audioDir, `${page.slug}.mp3`);
			const sidecar = path.join(audioDir, `${page.slug}.json`);
			if (!fs.existsSync(mp3) || !fs.existsSync(sidecar)) return null;

			const entry = byId.get(page.slug);
			const { duration } = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as { duration: number };

			return {
				number: index + 1,
				title: page.label,
				section: page.section,
				description: entry?.data.description ?? page.section,
				link: `${base}/${page.slug}/`,
				url: `${base}/audio/${page.slug}.mp3`,
				bytes: fs.statSync(mp3).size,
				duration,
				pubDate: new Date(EPOCH + index * 3600_000).toUTCString(),
			};
		})
		.filter((episode): episode is NonNullable<typeof episode> => episode !== null);

	const total = episodes.reduce((sum, episode) => sum + episode.duration, 0);
	const summary =
		`A TypeScript developer's field guide to defending a 307-file Rust pull request ` +
		`against the Zed codebase: per-window theme overrides. ${episodes.length} chapters, ` +
		`${hhmmss(total)} total. Narrated with Kokoro-82M from the text at ` +
		`zed-rust-oss-for-dummies.vercel.app — the writing is human, the voice is not.`;

	const items = episodes
		.map(
			(episode) => `		<item>
			<title>${escape(`${episode.number}. ${episode.title}`)}</title>
			<link>${escape(episode.link)}</link>
			<guid isPermaLink="false">${escape(episode.link)}</guid>
			<pubDate>${episode.pubDate}</pubDate>
			<description>${escape(episode.description)}</description>
			<itunes:summary>${escape(episode.description)}</itunes:summary>
			<itunes:subtitle>${escape(episode.section)}</itunes:subtitle>
			<itunes:episode>${episode.number}</itunes:episode>
			<itunes:duration>${hhmmss(episode.duration)}</itunes:duration>
			<itunes:explicit>false</itunes:explicit>
			<enclosure url="${escape(episode.url)}" length="${episode.bytes}" type="audio/mpeg"/>
		</item>`,
		)
		.join('\n');

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
	<channel>
		<title>Zed Rust for Dummies</title>
		<link>${escape(base)}/</link>
		<atom:link href="${escape(base)}/podcast.xml" rel="self" type="application/rss+xml"/>
		<language>en-us</language>
		<description>${escape(summary)}</description>
		<itunes:summary>${escape(summary)}</itunes:summary>
		<itunes:author>cesarnml</itunes:author>
		<itunes:type>serial</itunes:type>
		<itunes:explicit>false</itunes:explicit>
		<itunes:image href="${escape(base)}/podcast-cover.jpg"/>
		<itunes:category text="Technology"/>
		<itunes:owner>
			<itunes:name>cesarnml</itunes:name>
		</itunes:owner>
		<image>
			<url>${escape(base)}/podcast-cover.jpg</url>
			<title>Zed Rust for Dummies</title>
			<link>${escape(base)}/</link>
		</image>
${items}
	</channel>
</rss>
`;

	return new Response(xml, {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
	});
};
