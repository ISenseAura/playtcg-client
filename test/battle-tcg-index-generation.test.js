'use strict';

/**
 * Card vs set identity for client index generation.
 *
 * Cards keep their catalog ids even when a set has no paper `ptcgoCode`. Pocket sets list by set id
 * (including C1); paper sets omit `code` when the catalog has no official code. Never invent one.
 */
const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {describe, it} = require('node:test');

const {checkoutForTests, INDEX_INPUTS} = require('../build-tools/wave-tcg');

const CLIENT = path.resolve(__dirname, '..');
// Skips without a WaveTCG checkout; throws if one was provided but is incomplete.
const WAVE_TCG = checkoutForTests([...INDEX_INPUTS, 'data/pocket/C1.json', 'data/pocket/sets.json', 'data/paper/sets.json']);
const needsWaveTcg = {skip: WAVE_TCG.skip};
const DATA = path.join(WAVE_TCG.root || '', 'data');
const CATALOG_C1 = path.join(DATA, 'pocket', 'C1.json');
const POCKET_SETS = path.join(DATA, 'pocket', 'sets.json');
const PAPER_SETS = path.join(DATA, 'paper', 'sets.json');

function readCards(file) {
	const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	return Array.isArray(raw) ? raw : raw.data || [];
}

function runBuild(script, outEnv, outPath) {
	const result = spawnSync(process.execPath, [path.join(CLIENT, 'scripts', script), WAVE_TCG.root], {
		cwd: CLIENT,
		encoding: 'utf8',
		env: {...process.env, [outEnv]: outPath},
	});
	assert.equal(result.status, 0, `${script}\n${result.stderr || result.stdout}`);
}

function buildIndexes(outDir) {
	assert.ok(fs.existsSync(DATA), `catalog missing at ${DATA}`);
	assert.ok(fs.existsSync(path.join(WAVE_TCG.root, 'dist', 'print.js')), 'build Wave-TCG first');
	assert.ok(fs.existsSync(path.join(WAVE_TCG.root, 'dist', 'legality', 'cards.js')), 'build Wave-TCG first');
	fs.mkdirSync(outDir, {recursive: true});
	const cardsOut = path.join(outDir, 'tcg-cards-index.json');
	const setsOut = path.join(outDir, 'tcg-sets-index.json');
	runBuild('build-tcg-cards-index.js', 'TCG_INDEX_OUT', cardsOut);
	runBuild('build-tcg-sets-index.js', 'TCG_SETS_INDEX_OUT', setsOut);
	return {
		cards: JSON.parse(fs.readFileSync(cardsOut, 'utf8')),
		sets: JSON.parse(fs.readFileSync(setsOut, 'utf8')),
		cardsOut,
		setsOut,
	};
}

describe('TCG index generation: C1 and missing official codes', () => {
	it('keeps every C1 card in the card index as Pocket with its real id and set', needsWaveTcg, () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-index-'));
		const catalog = readCards(CATALOG_C1);
		assert.equal(catalog.length, 217);
		const {cards, sets} = buildIndexes(dir);

		const c1Rows = cards.filter(c => c.set === 'C1' || c.id.startsWith('C1-'));
		assert.equal(c1Rows.length, 217);
		assert.deepEqual(c1Rows.map(c => c.id).sort(), catalog.map(c => c.id).sort());
		for (const row of c1Rows) {
			const src = catalog.find(c => c.id === row.id);
			assert.ok(src, row.id);
			assert.equal(row.n, src.name, row.id);
			assert.equal(row.set, 'C1', row.id);
			assert.equal(row.k, 'k', `${row.id} must be Pocket, not paper`);
			assert.equal(row.pkt, 1, row.id);
			assert.equal(row.std, 0, row.id);
		}

		const pocketC1 = sets.pocket.find(s => s.id === 'C1');
		assert.ok(pocketC1, 'C1 belongs in the pocket set index');
		assert.equal(pocketC1.name, 'Dual Fusion');
		assert.equal(pocketC1.code, 'C1', 'Pocket list code is the set id, not a fabricated ptcgoCode');
		assert.equal(sets.paper.some(s => s.id === 'C1'), false, 'C1 is not a paper set');

		const ids = cards.map(c => c.id);
		assert.equal(new Set(ids).size, ids.length, 'no duplicate card ids');
		assert.equal(cards.filter(c => !c.n).length, 0, 'no missing names');
	});

	it('does not invent paper official codes, and keeps Pocket codes as set ids', needsWaveTcg, () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-index-'));
		const {sets} = buildIndexes(dir);
		const paperCatalog = JSON.parse(fs.readFileSync(PAPER_SETS, 'utf8'));
		const byId = Object.fromEntries(paperCatalog.map(s => [s.id, s]));
		for (const row of sets.paper) {
			const src = byId[row.id];
			if (!src) continue;
			if (src.ptcgoCode) assert.equal(row.code, src.ptcgoCode, row.id);
			else assert.equal(row.code, undefined, `${row.id} must not invent a code`);
		}
		const pocketCatalog = JSON.parse(fs.readFileSync(POCKET_SETS, 'utf8'));
		assert.equal(sets.pocket.length, pocketCatalog.length);
		for (const row of sets.pocket) {
			assert.equal(row.code, row.id, `${row.id} Pocket list code is the set id`);
		}
		assert.equal(new Set(sets.paper.map(s => s.id)).size, sets.paper.length);
		assert.equal(new Set(sets.pocket.map(s => s.id)).size, sets.pocket.length);
		assert.ok(sets.pocket.some(s => s.id === 'C1' && s.code === 'C1'));
	});

	it('rebuilds deterministically', needsWaveTcg, () => {
		const a = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-index-a-'));
		const b = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-index-b-'));
		const first = buildIndexes(a);
		const second = buildIndexes(b);
		assert.equal(fs.readFileSync(first.cardsOut, 'utf8'), fs.readFileSync(second.cardsOut, 'utf8'));
		assert.equal(fs.readFileSync(first.setsOut, 'utf8'), fs.readFileSync(second.setsOut, 'utf8'));
	});
});
