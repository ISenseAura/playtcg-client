/**
 * builds play.pokemonshowdown.com/tcg-cards-index.json from the WaveTCG catalog.
 * usage: node scripts/build-tcg-cards-index.js [path-to-wave-tcg]
 * without a path it uses WAVE_TCG_DIR or caches/wave-tcg. a `playtcg-server` checkout works too (WaveTCG is in
 * its Wave-TCG/ folder). `node build full` runs this
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { checkoutForScript } = require('../build-tools/wave-tcg');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.TCG_INDEX_OUT || path.join(ROOT, 'play.pokemonshowdown.com/tcg-cards-index.json');
const WAVE_TCG = checkoutForScript(process.argv[2]);
const DATA = path.join(WAVE_TCG, 'data');

if (!fs.existsSync(DATA)) {
	console.error('Wave-TCG data not found at', DATA);
	process.exit(1);
}

function walkJson(dir, out) {
	if (!fs.existsSync(dir)) return;
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		const st = fs.statSync(p);
		if (st.isDirectory()) walkJson(p, out);
		else if (name.endsWith('.json') && name !== 'sets.json' && name !== 'en.json' && name !== 'samples.json') {
			out.push(p);
		}
	}
}

function setId(card) {
	return (card.set && card.set.id) || '';
}

/**
 * pocket set ids use WaveTCG's `isPocketSetId`, same as the catalog and server. a missing paper `ptcgoCode` is a
 * separate thing, rows keep the catalog set id.
 */
const ENGINE_PRINT = path.join(WAVE_TCG, 'dist', 'print.js');
if (!fs.existsSync(ENGINE_PRINT)) {
	console.error('Wave-TCG is not built: missing', ENGINE_PRINT);
	process.exit(1);
}
// `be` (basic energy) is the engine's own rule, so the board labels attached energy the way the engine plays it
const { isPocketSetId, isEnergy, isBasicEnergy } = require(ENGINE_PRINT);

function isPocket(card) {
	return isPocketSetId(setId(card));
}

function isPokemon(card) {
	return card.supertype === 'Pokémon' || card.supertype === 'Pokemon';
}

function isTrainer(card) {
	return card.supertype === 'Trainer';
}

function isBasicPokemon(card) {
	if (!isPokemon(card)) return false;
	if ((card.subtypes || []).some(s => /restored|v-union|vunion/i.test(s))) return false;
	return (card.subtypes || []).some(s => s === 'Basic' || s === 'Baby');
}

function isAceSpec(card) {
	if ((card.subtypes || []).some(s => /ace\s*spec/i.test(s))) return true;
	return (card.rules || []).some(r => /ace spec/i.test(r) && /can't have more than 1/i.test(r));
}

function isRadiant(card) {
	return (card.subtypes || []).some(s => /radiant/i.test(s));
}

function isPrismStar(card) {
	return (card.subtypes || []).some(s => /prism/i.test(s)) ||
		(card.rules || []).some(r => /prism star/i.test(r) && /lost zone/i.test(r));
}

function regLetter(card) {
	const m = String(card.regulationMark || '').trim().toUpperCase();
	return /^[A-Z]$/.test(m) ? m : '';
}

/**
 * standard reprint matching comes from WaveTCG's `standardReprintKey` (legality/cards.ts), so this index and the
 * server can't disagree. build WaveTCG first
 */
const ENGINE_LEGALITY = path.join(WAVE_TCG, 'dist', 'legality', 'cards.js');
if (!fs.existsSync(ENGINE_LEGALITY)) {
	console.error('Wave-TCG is not built: missing', ENGINE_LEGALITY);
	process.exit(1);
}
const { standardReprintKey: reprintKey } = require(ENGINE_LEGALITY);

const LEGAL_ON_RELEASE = new Set(['me6']);

/** `releaseWaitOver` in formats.ts as a date: new cards are legal on the second friday after release */
function firstLegalDay(releaseDate, setId) {
	const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(releaseDate || '').trim());
	if (!m) return '';
	if (LEGAL_ON_RELEASE.has(setId)) {
		const month = String(m[2]).padStart(2, '0');
		const day = String(m[3]).padStart(2, '0');
		return `${m[1]}-${month}-${day}`;
	}
	const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	const toFriday = (5 - day.getUTCDay() + 7) % 7 || 7;
	day.setUTCDate(day.getUTCDate() + toFriday + 7);
	return day.toISOString().slice(0, 10);
}

function pocketArt(card) {
	const set = setId(card);
	let num = String(card.number || '').trim() || card.id.slice(card.id.lastIndexOf('-') + 1);
	if (/^\d+$/.test(num)) num = (num.replace(/^0+/, '') || '0').padStart(3, '0');
	if (!set || !num) return '';
	return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${set}/${set}_${num}_EN_SM.webp`;
}

const files = [];
walkJson(path.join(DATA, 'paper'), files);
walkJson(path.join(DATA, 'pocket'), files);
walkJson(path.join(DATA, 'cards'), files);
const rootFiles = ['basic-energy.json', 'base1.json'];
for (const f of rootFiles) {
	const p = path.join(DATA, f);
	if (fs.existsSync(p)) files.push(p);
}

const byId = new Map();
for (const file of files) {
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
		const list = Array.isArray(raw) ? raw : raw.data || [];
		for (const card of list) {
			if (!card?.id || !card.name) continue;
			byId.set(card.id, card);
		}
	} catch (e) {
		console.warn('skip', file, e.message);
	}
}

const REG_MIN = 'H';
const releaseDates = new Map();
for (const file of [path.join(DATA, 'paper', 'sets.json'), path.join(DATA, 'sets.json')]) {
	if (!fs.existsSync(file)) continue;
	for (const set of JSON.parse(fs.readFileSync(file, 'utf8'))) releaseDates.set(set.id, set.releaseDate);
}
function paperSetId(card) {
	return setId(card) || card.id.slice(0, card.id.lastIndexOf('-'));
}

// first day a card with this printed text can be played: its earliest printing with a current mark
const legalFromByKey = new Map();
for (const c of byId.values()) {
	if (isPocket(c) || isBasicEnergy(c) || c.legalities?.standard === 'Banned') continue;
	const letter = regLetter(c);
	if (!letter || letter < REG_MIN) continue;
	const key = reprintKey(c);
	const day = firstLegalDay(releaseDates.get(paperSetId(c)), paperSetId(c));
	const known = legalFromByKey.get(key);
	if (known === undefined || day < known) legalFromByKey.set(key, day);
}

function standardLegal(card) {
	if (isPocket(card)) return false;
	if (isBasicEnergy(card)) return true;
	if (card.legalities?.standard === 'Banned') return false;
	return legalFromByKey.has(reprintKey(card));
}

/** only set while the wait is still ahead, so most rows have nothing */
const TODAY = new Date().toISOString().slice(0, 10);
function legalFrom(card) {
	if (isPocket(card) || isBasicEnergy(card)) return '';
	const day = legalFromByKey.get(reprintKey(card)) || '';
	return day > TODAY ? day : '';
}

function pocketLegal(card) {
	if (!isPocket(card)) return false;
	if (isEnergy(card)) return false; // Energy Zone
	return true;
}

function costTypes(card) {
	const out = new Set();
	for (const atk of card.attacks || []) {
		for (const cost of atk.cost || []) {
			const t = String(cost).toLowerCase();
			if (t !== 'colorless' && t !== 'free') out.add(t);
		}
	}
	return [...out];
}

// some reprints in the catalog have no evolvesFrom. evolution goes by name, so take it from another print with
// the same name in the same game (paper or pocket)
const evolvesFromByName = new Map();
for (const c of byId.values()) {
	const key = `${isPocket(c) ? 'k' : 'p'}|${c.name}`;
	if (isPokemon(c) && c.evolvesFrom && !evolvesFromByName.has(key)) evolvesFromByName.set(key, c.evolvesFrom);
}
function evolvesFrom(card) {
	if (card.evolvesFrom) return card.evolvesFrom;
	if (isBasicPokemon(card)) return '';
	return evolvesFromByName.get(`${isPocket(card) ? 'k' : 'p'}|${card.name}`) || '';
}

const index = [];
for (const card of byId.values()) {
	const pocket = isPocket(card);
	const img = pocket ?
		pocketArt(card) :
		(card.images?.small || card.images?.large || '');
	const superType = isPokemon(card) ? 'P' : isTrainer(card) ? 'T' : isEnergy(card) ? 'E' : '?';
	// the deck filler uses these: what a card evolves from and the energy its attacks need. left out when empty to
	// keep the index small
	const extra = {};
	const ef = isPokemon(card) ? evolvesFrom(card) : '';
	if (ef) extra.ef = ef;
	const ec = isPokemon(card) ? costTypes(card) : [];
	if (ec.length) extra.ec = ec;
	const lf = standardLegal(card) ? legalFrom(card) : '';
	if (lf) extra.lf = lf;
	index.push({
		id: card.id,
		n: card.name,
		s: superType,
		u: (card.subtypes || []).slice(0, 6),
		t: (card.types || []).map(x => String(x).toLowerCase()),
		set: setId(card),
		r: regLetter(card),
		k: pocket ? 'k' : 'p', // pocket / paper
		i: img,
		std: standardLegal(card) ? 1 : 0,
		pkt: pocketLegal(card) ? 1 : 0,
		b: isBasicPokemon(card) ? 1 : 0,
		be: isBasicEnergy(card) ? 1 : 0,
		ace: isAceSpec(card) ? 1 : 0,
		rad: isRadiant(card) ? 1 : 0,
		prism: isPrismStar(card) ? 1 : 0,
		...extra,
	});
}

index.sort((a, b) => a.n.localeCompare(b.n) || a.id.localeCompare(b.id));

fs.writeFileSync(OUT, JSON.stringify(index));
console.log(`Wrote ${index.length} cards → ${OUT}`);
console.log(`  standard-legal: ${index.filter(c => c.std).length}`);
console.log(`  pocket-legal: ${index.filter(c => c.pkt).length}`);
