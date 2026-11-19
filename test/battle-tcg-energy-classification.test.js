'use strict';

/**
 * Attached Energy is labelled Basic or Special from the card itself (Smogon 3791420, battle-tcgstandard-2541: Basic
 * Grass Energy on Accelgor and on Decidueye ex was labelled Special Energy). The board read the category from a short
 * list of ids (sve-1 to sve-16 and six Base Set prints), so every other Basic Energy printing, mee-1 among them, was
 * called Special. The category now comes from the card index's `be` flag, which the index builder takes from Wave-TCG's
 * `isBasicEnergy`; a card the index does not have is plain "Energy", never guessed.
 *
 * Boards, events, and the engine's Energy categories below are the real engine's, recorded from WaveTCG by
 * scripts/record-tcg-energy-fixtures.js into battle-tcg-energy-classification.fixtures.json (its `source` names the
 * WaveTCG commit and catalog pin). Cards are the real index. The last test re-records from a WaveTCG checkout, when
 * there is one, and fails if the fixtures no longer match the engine.
 */
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it} = require('node:test');
const vm = require('vm');

const {checkoutForTests} = require('../build-tools/wave-tcg');

const CLIENT = path.resolve(__dirname, '..');
// Only the check that the fixtures still match the engine needs WaveTCG; it skips without a checkout.
const WAVE_TCG = checkoutForTests(['dist/testing/board.js', 'dist/catalog.js', 'dist/print.js', 'dist/data/paper/sets.json']);
const needsWaveTcg = {skip: WAVE_TCG.skip};
const FIXTURES = require('./battle-tcg-energy-classification.fixtures.json');
const INDEX_ROWS = require('../play.pokemonshowdown.com/tcg-cards-index.json');
const INDEX = new Map(INDEX_ROWS.map(r => [r.id, r]));

global.window = global;
global.preact = {
	Component: function () {},
	h(type, props, ...children) { return {type, props: props || {}, children: children.flat(Infinity)}; },
	render() {},
};
global.PS = {prefs: {}};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.lookupAttackHit = function () { return null; };
const withIndex = function (id) { return INDEX.get(id); };
global.getTcgCard = withIndex;
global.document = {querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }};
for (const file of ['battle-tcg-choice.js', 'battle-tcg.js']) {
	const p = path.resolve(CLIENT, 'play.pokemonshowdown.com/js', file);
	vm.runInThisContext(fs.readFileSync(p, 'utf8'), {filename: p});
}
const {TcgBoard, applyTcgEvents} = global;
const {
	TcgMon, attachedCardsOf, attachedKindLabel, energyCategory, partitionEnergyPips, detachPlayedCards,
} = vm.runInThisContext(
	'({TcgMon, attachedCardsOf, attachedKindLabel, energyCategory, partitionEnergyPips, detachPlayedCards})');

const ACCELGOR = 'sv9-13';
const DECIDUEYE = 'me3-12';
const GRASS = 'mee-1';
const NEO_UPPER = 'sv5-162';
const OLD_DARKNESS = 'neo1-104';
const ENERGY_SWITCH = 'sv1-173';

/** Without the card index (not loaded yet, or failed). */
function noIndex(fn) {
	global.getTcgCard = function () { return undefined; };
	try { return fn(); } finally { global.getTcgCard = withIndex; }
}

/**
 * The engine's boards, as recorded: Accelgor Active with Basic Grass Energy; Decidueye ex Benched with Basic Grass
 * Energy and Neo Upper Energy (see scripts/record-tcg-energy-fixtures.js). Each use gets a fresh copy.
 */
const recorded = name => JSON.parse(JSON.stringify(FIXTURES.boards[name]));
const kinds = m => attachedCardsOf(m).map(c => `${c.cardId}:${c.kind}`);

function all(node, test, out = []) {
	if (!node || typeof node !== 'object') return out;
	if (test(node)) out.push(node);
	(node.children || []).forEach(c => all(c, test, out));
	return out;
}
const classOf = n => String((n.props && n.props.class) || '');
const hasClass = (n, c) => classOf(n).split(/\s+/).includes(c);
const text = n => (typeof n === 'string' || typeof n === 'number') ? String(n) :
	(n && n.children ? n.children.map(text).join('') : '');

/** What TcgMon draws: the peeks under the card by kind, the stack's tooltip, and the Special class. */
function surface(m) {
	const c = new TcgMon();
	c.props = {mon: m, slot: 'active', activeSpot: true, onAttachBrowse() {}};
	const tree = c.render();
	const stack = all(tree, n => hasClass(n, 'tcg-attach-stack'))[0];
	return {
		peeks: all(tree, n => hasClass(n, 'tcg-attach-peek'))
			.map(n => `${n.props['data-card']}:${classOf(n).replace('tcg-attach-peek kind-', '')}`),
		title: stack && stack.props.title,
		aria: stack && stack.props['aria-label'],
		special: hasClass(tree, 'has-special'),
	};
}

/** The attached cards in the Attached Cards modal (not the previous Evolution stages), opened as the board opens it. */
function modal(snapshot, mon) {
	const b = new TcgBoard();
	b.props = {snapshot, fxSnapshot: null, events: [], onEvent() {}, onAct() {}, fxKey: 1, waiting: false, ended: false};
	b.state = {...b.state, fx: null, koHide: {}};
	b.setState = patch => Object.assign(b.state, typeof patch === 'function' ? patch(b.state) : patch);
	b.openAttachBrowse(mon);
	const root = all(b.render(), n => hasClass(n, 'kind-attach-browse'))[0];
	return all(root, n => hasClass(n, 'tcg-prompt-card') && !hasClass(n, 'kind-stage')).map(n => {
		const tag = all(n, t => hasClass(t, 'tcg-attach-tag'))[0];
		return {cardId: all(n, f => f.props && f.props.cardId)[0].props.cardId, tag: text(tag), kind: classOf(tag)};
	});
}

describe('the reported board: Basic Grass Energy on Accelgor and Decidueye ex', () => {
	const s = recorded('reported').p1;
	const accelgor = s.players[0].active;
	const decidueye = s.players[0].bench[0];

	it('the engine sends mee-1, and the board calls it Basic Energy on both', () => {
		assert.deepEqual([accelgor.cardId, accelgor.energyCards], [ACCELGOR, [GRASS]]);
		assert.deepEqual([decidueye.cardId, decidueye.energyCards], [DECIDUEYE, [GRASS, NEO_UPPER]]);
		assert.deepEqual(kinds(accelgor), [`${GRASS}:energy`]);
		assert.deepEqual(kinds(decidueye), [`${GRASS}:energy`, `${NEO_UPPER}:special`]);
	});

	it('on the board: no Special mark on Accelgor; one Special Energy on Decidueye ex, which is Neo Upper', () => {
		const a = surface(accelgor);
		assert.deepEqual(a.peeks, [`${GRASS}:energy`]);
		assert.equal(a.special, false);
		assert.ok(!/Special/i.test(a.title) && !/special/i.test(a.aria), a.title);
		const d = surface(decidueye);
		assert.deepEqual(d.peeks.sort(), [`${GRASS}:energy`, `${NEO_UPPER}:special`].sort());
		assert.equal(d.special, true);
		assert.match(d.title, /^2 attached, 2 previous stages, 1 Special Energy\./);
		assert.match(d.aria, /, 1 special energy$/);
	});

	it('in the Attached Cards modal: Basic Energy and Special Energy, as on the board', () => {
		assert.deepEqual(modal(s, accelgor), [{cardId: GRASS, tag: 'Basic Energy', kind: 'tcg-attach-tag kind-energy'}]);
		const rows = modal(s, decidueye);
		assert.deepEqual(rows.map(r => r.tag), ['Basic Energy', 'Special Energy']);
		assert.deepEqual(rows.map(r => `${r.cardId}:${r.kind.replace('tcg-attach-tag kind-', '')}`), kinds(decidueye),
			'the modal and the board agree');
	});

	it('the opponent and a spectator see the same labels', () => {
		const b = recorded('reported');
		for (const [who, view] of [['p2', b.p2], [undefined, b.spectator]]) {
			const v = view.players[0];
			assert.deepEqual(kinds(v.active), [`${GRASS}:energy`], String(who));
			assert.deepEqual(kinds(v.bench[0]), [`${GRASS}:energy`, `${NEO_UPPER}:special`], String(who));
		}
	});
});

describe('every Basic and Special Energy printing', () => {
	it('each Basic Energy type, in Mega Evolution, Scarlet & Violet, and older prints, is Basic Energy', () => {
		const ids = ['mee-1', 'mee-2', 'mee-3', 'mee-4', 'mee-5', 'mee-6', 'mee-7', 'mee-8', 'mee-9', 'sve-1', 'sve-9',
			'sve-17', 'sve-24', 'sv2-278', 'sv3-230', 'base1-99', 'base4-127', 'xy1-140', 'g1-83', 'sm1-172', 'swsh12pt5-152'];
		for (const id of ids) {
			assert.equal(energyCategory(id), 'basic', id);
			assert.equal(attachedKindLabel(attachedCardsOf({energyCards: [id], energy: ['grass'], tools: []})[0].kind),
				'Basic Energy', id);
		}
	});

	it('Special Energy stays Special: old Darkness and Metal Energy, Colorless ones, ACE SPEC', () => {
		const ids = [OLD_DARKNESS, 'neo1-19', 'ex1-93', 'hgss3-80', 'base1-96', 'sm7-151', 'swsh9-151', 'sv5-161',
			NEO_UPPER, 'sv6-167', 'sv8-191'];
		for (const id of ids) {
			assert.equal(energyCategory(id), 'special', id);
			assert.equal(attachedKindLabel(attachedCardsOf({energyCards: [id], energy: ['colorless'], tools: []})[0].kind),
				'Special Energy', id);
		}
	});

	it('every Energy card in the engine is in the card index, with the engine\'s Basic or Special', () => {
		// [id, name, the engine's isBasicEnergy as 'basic' or 'special'] for every catalog card isEnergy accepts.
		const energies = FIXTURES.energies;
		assert.ok(energies.length > 400, `${energies.length} Energy cards`);
		const wrong = energies.filter(([id, , want]) => energyCategory(id) !== want)
			.map(([id, name]) => `${id} ${name}: ${energyCategory(id)}`);
		assert.deepEqual(wrong, [], 'missing from the index, or another category');
	});

	it('every Energy row in the card index is labelled by its `be` flag', () => {
		const rows = INDEX_ROWS.filter(r => r.s === 'E');
		const wrong = rows.filter(r => energyCategory(r.id) !== (r.be ? 'basic' : 'special')).map(r => r.id);
		assert.deepEqual(wrong, []);
	});
});

describe('a card the board cannot classify is plain Energy, never Basic or Special', () => {
	it('before the card index arrives, mee-1 is "Energy", not Special Energy', () => {
		noIndex(() => {
			assert.equal(energyCategory(GRASS), 'unknown');
			const [c] = attachedCardsOf({energyCards: [GRASS], energy: ['grass'], tools: []});
			assert.deepEqual([c.kind, attachedKindLabel(c.kind)], ['unclassified', 'Energy']);
			assert.equal(surface({iid: 'm1', cardId: ACCELGOR, name: 'Accelgor', hp: 1, maxHp: 1,
				energyCards: [GRASS], energy: ['grass'], tools: []}).special, false);
		});
	});

	it('a set newer than the card index is "Energy"', () => {
		assert.equal(energyCategory('zz99-1'), 'unknown');
		assert.equal(attachedCardsOf({energyCards: ['zz99-1'], energy: ['grass'], tools: []})[0].kind, 'unclassified');
	});

	it('a Pokémon attached as Energy (Buzzap) is not an Energy card, so it is "Energy"', () => {
		assert.equal(energyCategory('sv1-1'), 'other');
		assert.equal(attachedCardsOf({energyCards: ['sv1-1'], energy: ['grass', 'grass'], tools: []})[0].kind, 'unclassified');
	});

	it('a snapshot with Energy types and no card ids does not guess Basic', () => {
		assert.deepEqual(attachedCardsOf({energy: ['grass', 'colorless'], tools: []}).map(c => c.kind),
			['unclassified', 'unclassified']);
	});

	it('the card index arriving after the board is drawn draws it again', () => {
		let resolve;
		global.loadTcgCardIndex = () => new Promise(r => { resolve = r; });
		global.tcgCardIndexStatus = () => 'loading';
		try {
			const b = new TcgBoard();
			let drawn = 0;
			b.forceUpdate = () => { drawn++; };
			b.props = {snapshot: recorded('reported').p1, events: [], onEvent() {}, onAct() {}, fxKey: 1, playing: false};
			b.bindHandStrip = () => {};
			global.addEventListener = global.addEventListener || (() => {});
			b.componentDidMount();
			resolve([]);
			return Promise.resolve().then(() => Promise.resolve()).then(() => {
				assert.equal(drawn, 1, 'drawn again once the index is in');
			});
		} finally {
			delete global.loadTcgCardIndex;
			delete global.tcgCardIndexStatus;
		}
	});
});

describe('Energy keeps its label as it moves, is discarded, and on a resync', () => {
	it('the Energy pips of Basic Grass Energy and Neo Upper Energy split by card', () => {
		// Neo Upper Energy on a Stage 2 provides 2 Energy, so 2 cards carry 3 pips.
		const s = recorded('reported').p1.players[0].bench[0];
		assert.deepEqual(s.energy.length, 3);
		assert.deepEqual(partitionEnergyPips(s.energyCards, s.energy), [['grass'], ['colorless', 'colorless']]);
	});

	it('removing Neo Upper Energy leaves a Grass pip for mee-1, not a Colorless one', () => {
		const m = recorded('reported').p1.players[0].bench[0];
		detachPlayedCards(m, [NEO_UPPER]);
		assert.deepEqual([m.energyCards, m.energy], [[GRASS], ['grass']]);
		assert.deepEqual(kinds(m), [`${GRASS}:energy`]);
	});

	it('Energy Switch: the moved mee-1 is Basic Energy on Decidueye ex, from the events and from a resync', () => {
		// Energy Switch (ENERGY_SWITCH) played, then mee-1 picked off Accelgor: the snapshot between, the events, and after.
		const {before, events, after} = recorded('energySwitch');
		assert.ok(events.some(e => e.type === 'energy' && e.source && e.source.cardId === ENERGY_SWITCH), 'moved by Energy Switch');
		const folded = applyTcgEvents(before, events);
		const resync = after;
		const want = [`${GRASS}:energy`, `${NEO_UPPER}:special`, `${GRASS}:energy`];
		assert.deepEqual(kinds(folded.players[0].bench[0]), want, 'folded from the events');
		assert.deepEqual(kinds(resync.players[0].bench[0]), want, 'a fresh snapshot (refresh, reconnect)');
		assert.deepEqual(kinds(folded.players[0].active), [], 'gone from Accelgor');
		assert.deepEqual(modal(resync, resync.players[0].bench[0]).map(r => r.tag),
			['Basic Energy', 'Special Energy', 'Basic Energy']);
	});

	it('a retreat discards mee-1 to the discard pile, and the Energy left is labelled as before', () => {
		const {before, events, afterForOpponent} = recorded('retreat');
		const folded = applyTcgEvents(before, events);
		assert.deepEqual(folded.players[0].discard, [GRASS]);
		assert.deepEqual(kinds(folded.players[0].active), [`${GRASS}:energy`, `${NEO_UPPER}:special`]);
		assert.deepEqual(kinds(afterForOpponent.players[0].active), [`${GRASS}:energy`, `${NEO_UPPER}:special`],
			'and so for the opponent');
	});

	it('attaching an old Special Darkness Energy from the hand is Special Energy', () => {
		const {before, events} = recorded('attachOldDarkness');
		const folded = applyTcgEvents(before, events);
		assert.deepEqual(kinds(folded.players[0].active), [`${GRASS}:energy`, `${OLD_DARKNESS}:special`]);
	});
});

describe('WaveTCG integration: the recorded engine outputs', () => {
	it('still match what the current WaveTCG sends (re-run scripts/record-tcg-energy-fixtures.js if not)', needsWaveTcg, () => {
		// Loaded here, not at the top, so the file needs no WaveTCG unless this test runs.
		const {record} = require('../scripts/record-tcg-energy-fixtures');
		const live = record(WAVE_TCG.root);
		assert.deepEqual(live.boards, FIXTURES.boards, 'boards and events');
		assert.deepEqual(live.energies, FIXTURES.energies, 'Energy cards and their Basic or Special category');
	});
});
