'use strict';

/**
 * where the full build, the index scripts and the tests find WaveTCG.
 * `node build full` keeps a checkout in caches/wave-tcg, like build-indexes does with caches/pokemon-showdown.
 * REPOSITORY_URL is empty until WaveTCG's public repo url is set, and till then the WaveTCG step and tests get
 * skipped.
 * WAVE_TCG_DIR points at a checkout that's already built. it's used instead of caches/wave-tcg and the build
 * never installs or builds anything in it
 */

const fs = require('node:fs');
const path = require('node:path');

/** the public WaveTCG git url (Coming soon). empty until it's set; the WaveTCG step and tests skip till then */
const REPOSITORY_URL = '';
/** always track main; do not pin a commit. build-wave-tcg pulls when the checkout exists, clones when it doesn't */
const BRANCH = 'main';

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'caches', 'wave-tcg');
const ENV_DIR = 'WAVE_TCG_DIR';

const INDEX_INPUTS = ['data', 'dist/print.js', 'dist/legality/cards.js'];

function findCheckout() {
	const fromEnv = process.env[ENV_DIR];
	if (fromEnv) return { root: path.resolve(fromEnv), source: ENV_DIR };
	if (fs.existsSync(CACHE_DIR)) return { root: CACHE_DIR, source: 'caches/wave-tcg' };
	return null;
}

function missingFiles(root, files) {
	return files.filter(file => !fs.existsSync(path.join(root, file)));
}

/** `arg` can be a WaveTCG checkout or a `playtcg-server` checkout, which keeps WaveTCG in Wave-TCG/ */
function checkoutForScript(arg) {
	if (arg) {
		const root = path.resolve(arg);
		const nested = path.join(root, 'Wave-TCG');
		return fs.existsSync(path.join(nested, 'package.json')) ? nested : root;
	}
	const found = findCheckout();
	if (!found) {
		console.error(
			`No WaveTCG checkout: pass its path, set ${ENV_DIR}, or run \`node build full\` ` +
			`once WaveTCG is public (it checks out into caches/wave-tcg).`
		);
		process.exit(1);
	}
	return found.root;
}

/**
 * skips when there's no checkout. throws if there is one but it's missing files, so a broken checkout fails
 * instead of skipping
 */
function checkoutForTests(files) {
	const found = findCheckout();
	if (!found) {
		return {
			root: null,
			skip: `needs WaveTCG: set ${ENV_DIR} to a built checkout, or run \`node build full\` once ` +
				`WaveTCG is public (caches/wave-tcg)`,
		};
	}
	const missing = missingFiles(found.root, files);
	if (missing.length) {
		throw new Error(
			`WaveTCG at ${found.root} (from ${found.source}) is missing ${missing.join(', ')}. ` +
			`Build it (npm ci, npm run fetch-catalog, npm run build)` +
			(found.source === ENV_DIR ? `, or unset ${ENV_DIR}.` : '.')
		);
	}
	return { root: found.root, skip: false };
}

/**
 * github gives 404 for private repos (and renamed or mistyped ones), so 404 means 'unavailable'. network or api
 * errors throw, they're never treated as private
 */
async function publicVisibility(url) {
	const github = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
	if (!github) return 'unknown';
	const api = `https://api.github.com/repos/${github[1]}/${github[2]}`;
	let response;
	try {
		response = await fetch(api, {
			headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'build-wave-tcg' },
		});
	} catch (error) {
		throw new Error(`Could not reach ${api} to check ${url}: ${error.cause?.message || error.message}`);
	}
	if (response.status === 404) return 'unavailable';
	if (!response.ok) {
		const limited = response.headers.get('x-ratelimit-remaining') === '0' ? ' (rate limit reached)' : '';
		throw new Error(`${api} answered ${response.status} ${response.statusText}${limited} for ${url}`);
	}
	const repo = await response.json();
	return repo.private ? 'unavailable' : 'public';
}

module.exports = {
	REPOSITORY_URL, BRANCH, CACHE_DIR, ENV_DIR, INDEX_INPUTS,
	findCheckout, missingFiles, checkoutForScript, checkoutForTests, publicVisibility,
};
