/**
 * builds play.pokemonshowdown.com/tcg-sets-index.json from the WaveTCG set data.
 * usage: node scripts/build-tcg-sets-index.js [path-to-wave-tcg]
 * without a path it uses WAVE_TCG_DIR or caches/wave-tcg. `node build full` runs this.
 * the card index has no set codes or collector numbers, so the deck importer and exporter get them from here
 * (the catalog's own `ptcgoCode`). never add a code: a set without `ptcgoCode` has no official code, so its
 * cards export by card id. re-run this whenever the card index is rebuilt.
 * paper sets come from the paper/ dump, then WaveTCG's data/sets.json and data/cards/ for sets the dump doesn't
 * have yet. the dump wins for cards, like in WaveTCG's catalog
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {checkoutForScript} = require('../build-tools/wave-tcg');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.TCG_SETS_INDEX_OUT || path.join(ROOT, 'play.pokemonshowdown.com/tcg-sets-index.json');
const WAVE_TCG = checkoutForScript(process.argv[2]);
const DATA = path.join(WAVE_TCG, 'data');

if (!fs.existsSync(DATA)) {
	console.error('Wave-TCG data not found at', DATA);
	process.exit(1);
}

function readJson(...parts) {
	const raw = JSON.parse(fs.readFileSync(path.join(DATA, ...parts), 'utf8'));
	return Array.isArray(raw) ? raw : raw.data || [];
}

function readOptional(...parts) {
	return fs.existsSync(path.join(DATA, ...parts)) ? readJson(...parts) : [];
}

function cardsInSet(id) {
	const dumped = readOptional('paper', 'cards', 'en', `${id}.json`);
	const extra = readOptional('cards', `${id}.json`);
	return dumped.concat(extra.filter(card => !dumped.some(found => found.id === card.id)));
}

const dumpSets = readJson('paper', 'sets.json');
const paperSets = dumpSets.concat(
	readOptional('sets.json').filter(set => !dumpSets.some(dumped => dumped.id === set.id))
);
const pocketSets = readJson('pocket', 'sets.json');

// a card id is `set-number`, except cards like cel25c-2_A. those list their number here
const numbers = {};
for (const set of paperSets) {
	for (const card of cardsInSet(set.id)) {
		if (card.id !== `${set.id}-${card.number}`) numbers[card.id] = String(card.number);
	}
}

const index = {
	paper: paperSets.map(set => {
		const row = {id: set.id, name: set.name};
		if (set.ptcgoCode) row.code = set.ptcgoCode;
		return row;
	}),
	// pocket lists name a set by its id
	pocket: pocketSets.map(set => ({id: set.id, name: set.name, code: set.id})),
	numbers,
};

fs.writeFileSync(OUT, JSON.stringify(index));
console.log(`Wrote ${index.paper.length} paper and ${index.pocket.length} pocket sets → ${OUT}`);
console.log(`  paper sets with no official code: ${index.paper.filter(set => !set.code).length}`);
console.log(`  cards with a number outside their id: ${Object.keys(numbers).length}`);
