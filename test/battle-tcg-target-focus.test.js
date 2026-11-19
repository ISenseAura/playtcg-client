'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it} = require('node:test');
const vm = require('vm');

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
global.getTcgCard = function () { return undefined; };
global.document = {querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }};

for (const file of ['battle-tcg-choice.js', 'battle-tcg.js']) {
	const p = path.resolve(__dirname, '../play.pokemonshowdown.com/js', file);
	vm.runInThisContext(fs.readFileSync(p, 'utf8'), {filename: p});
}
const {TcgBoard} = global;

const AT = {clientX: 5, clientY: 5};
function mon(iid, name) {
	return {iid, cardId: 'x', name, hp: 100, maxHp: 100, energyCards: [], energy: [], tools: []};
}
function snapshot(actions, extra = {}, me = {}) {
	const pile = {discard: [], deck: {count: 20}, lostZone: {count: 0}, prizes: {count: 6}};
	return {
		you: 0, status: 'playing', turn: 0, turnNumber: 3, actions, ...extra,
		players: [
			{name: 'Alice', active: mon('m1', 'Diglett'), bench: [mon('m2', 'Zubat'), mon('m3', 'Bulbasaur')], hand: ['card'], ...pile, ...me},
			{name: 'Bob', active: mon('m8', 'Bulbasaur'), bench: [mon('m9', 'Pineco'), mon('m10', 'Camerupt')], hand: {count: 4}, ...pile},
		],
	};
}
function board(snap, state = {}, props = {}) {
	const b = new TcgBoard();
	b.sent = [];
	b.props = {
		snapshot: snap, fxSnapshot: null, events: [], onEvent() {}, onAct(a) { b.sent.push(a); },
		fxKey: 1, waiting: false, ended: false, ...props,
	};
	b.state = {...b.state, fx: null, koHide: {}, ...state};
	b.setState = patch => Object.assign(b.state, typeof patch === 'function' ? patch(b.state) : patch);
	b.showRefuse = text => { b.refused = text; };
	return b;
}

function all(node, test, out = []) {
	if (!node || typeof node !== 'object') return out;
	if (test(node)) out.push(node);
	(node.children || []).forEach(c => all(c, test, out));
	return out;
}
const classOf = n => String((n.props && n.props.class) || '');
const tableClass = tree => classOf(all(tree, n => classOf(n).startsWith('tcg-table'))[0]).split(' ');
function monProps(tree) {
	const out = {};
	for (const n of all(tree, n => n.props && n.props.mon && n.props.slot !== undefined)) out[n.props.mon.iid] = n.props;
	return out;
}
const marked = tree => Object.entries(monProps(tree)).filter(([, p]) => p.legal).map(([iid]) => iid).sort();

const pickRows = (...slots) => slots.map(slot => ({type: 'pickSlot', slot}));
const pending = (side, extra = {}) => ({pendingSlotPick: {left: 1, hint: '', side, ...extra}});

function assertMarksMatchClicks(make, label) {
	const tree = make().render();
	for (const [iid, p] of Object.entries(monProps(tree))) {
		const c = make();
		c.clickSlot(p.slot, !!p.foe, AT);
		assert.equal(!!p.legal, c.sent.length === 1, `${label}: ${iid} (${p.foe ? 'foe ' : ''}${p.slot}) is marked ${!!p.legal}, click sent ${c.sent.length}`);
		assert.equal(!!p.dropOk, !!p.legal, `${label}: ${iid} soft ring follows the mark`);
	}
	return tree;
}

describe('a pick of Pokémon with pickSlot rows', () => {
	it('with an instruction: marks the offered side and steps the rest back', () => {
		const make = () => board(snapshot(pickRows(0, 1), pending('mine', {ask: 'Choose a Pokémon.'})));
		const tree = assertMarksMatchClicks(make, 'ask');
		assert.deepEqual(marked(tree), ['m2', 'm3'], 'my Bench only: not my Active, not theirs');
		assert.ok(tableClass(tree).includes('is-targeting'));
		assert.ok(tableClass(tree).includes('is-choosing'), 'the older board-choice mark is unchanged');
	});

	it('without an instruction: the same marks, and the focus alone (the hand and piles are not stepped back)', () => {
		const make = () => board(snapshot(pickRows('active', 0, 1), pending('mine')));
		const tree = assertMarksMatchClicks(make, 'no ask');
		assert.deepEqual(marked(tree), ['m1', 'm2', 'm3']);
		assert.ok(tableClass(tree).includes('is-targeting'));
		assert.ok(!tableClass(tree).includes('is-choosing'));
	});

	it('an opponent Bench pick marks theirs and none of mine', () => {
		const make = () => board(snapshot(pickRows(0, 1), pending('foe')));
		const tree = assertMarksMatchClicks(make, 'foe bench');
		assert.deepEqual(marked(tree), ['m10', 'm9'], 'their Bench; their Active and all of mine step back');
		assert.ok(tableClass(tree).includes('is-targeting'));
	});

	it('an Active-only pick marks that one Pokémon', () => {
		const make = () => board(snapshot(pickRows('active'), pending('foe')));
		const tree = assertMarksMatchClicks(make, 'foe active');
		assert.deepEqual(marked(tree), ['m8']);
		const own = assertMarksMatchClicks(() => board(snapshot(pickRows('active'), pending('mine'))), 'own active');
		assert.deepEqual(marked(own), ['m1']);
	});

	it('a Pokémon the rows do not name is not marked and a click on it sends nothing', () => {
		const b = board(snapshot(pickRows(1), pending('mine')));
		assert.deepEqual(marked(b.render()), ['m3']);
		b.clickSlot(0, false, AT);
		assert.deepEqual(b.sent, []);
		b.clickSlot(1, false, AT);
		assert.deepEqual(b.sent, [{type: 'pickSlot', slot: 1}]);
	});
});

describe('Energy from the hand, then the Pokémon', () => {
	const phase = {pendingHandEnergy: {phase: 'pokemon'}};

	it('marks only my own Pokémon: the same Bench number on their side is not the target', () => {
		const make = () => board(snapshot(pickRows('active', 0, 1), phase));
		const tree = assertMarksMatchClicks(make, 'hand Energy');
		assert.deepEqual(marked(tree), ['m1', 'm2', 'm3']);
		assert.ok(tableClass(tree).includes('is-targeting'));
	});

	it('does not focus the board while the Energy card itself is still being chosen', () => {
		const b = board(snapshot([{type: 'handEnergyPick', hand: 0}], {pendingHandEnergy: {phase: 'card'}}));
		const tree = b.render();
		assert.ok(!tableClass(tree).includes('is-targeting'), 'the hand is where the choice is');
		assert.equal(b.targetFocus(), false);
	});
});

describe('Promotion', () => {
	it('marks the Benched Pokémon that can be promoted, not the same Bench number across the board', () => {
		const make = () => board(snapshot([{type: 'promote', bench: 0}, {type: 'promote', bench: 1}], {pendingPromote: 0}, {active: null}));
		const tree = assertMarksMatchClicks(make, 'promote');
		assert.deepEqual(marked(tree), ['m2', 'm3']);
		assert.ok(tableClass(tree).includes('is-targeting'));
	});

	it('leaves out a Bench Pokémon that has no Promote row', () => {
		const make = () => board(snapshot([{type: 'promote', bench: 1}], {pendingPromote: 0}, {active: null}));
		const tree = assertMarksMatchClicks(make, 'promote one');
		assert.deepEqual(marked(tree), ['m3']);
	});
});

describe('Retreat destination', () => {
	const rows = [{type: 'retreat', bench: 0}, {type: 'retreat', bench: 1}];

	it('marks my Bench and nothing on their board once Retreat is chosen', () => {
		const make = () => board(snapshot(rows), {retreatPick: true});
		const tree = assertMarksMatchClicks(make, 'retreat');
		assert.deepEqual(marked(tree), ['m2', 'm3']);
		assert.ok(tableClass(tree).includes('is-targeting'));
	});

	it('is not a focus before Retreat is chosen: the rows alone are only an action', () => {
		const tree = board(snapshot(rows)).render();
		assert.ok(!tableClass(tree).includes('is-targeting'));
	});

	it('is over when the retreat is cancelled', () => {
		const b = board(snapshot(rows), {retreatPick: true});
		assert.ok(tableClass(b.render()).includes('is-targeting'));
		b.state.retreatPick = false;
		assert.ok(!tableClass(b.render()).includes('is-targeting'));
	});

	it('a tap on their Bench is refused, not a retreat to my Bench of the same number', () => {
		const b = board(snapshot(rows), {retreatPick: true});
		b.clickSlot(0, true, AT);
		assert.deepEqual(b.sent, []);
		assert.match(b.refused, /Benched Pokémon/);
	});
});

describe('Foe-slot targeting', () => {
	it('is not a focus: those rows are an attack\'s targets, on every turn, and tapping one does not use the attack', () => {
		const rows = [{type: 'attack', index: 0, foeSlot: 0}, {type: 'attack', index: 0, foeSlot: 1}];
		const tree = board(snapshot(rows)).render();
		assert.ok(!tableClass(tree).includes('is-targeting'), 'the board is not stepped back on an ordinary turn');
	});
});

describe('multi-target picks', () => {
	const multi = {picked: 1, min: 2, max: 2};
	const held = () => snapshot([
		{type: 'pickSlot', slot: 0, multi}, {type: 'pickSlot', slot: 1, multi},
		{type: 'unstagePick', of: {type: 'pickSlot', slot: 0}, multi},
	], pending('mine', {left: 2}));

	it('keeps every offered Pokémon marked and shows the ones already held as selected', () => {
		const tree = board(held()).render();
		const m = monProps(tree);
		assert.deepEqual(marked(tree), ['m2', 'm3']);
		assert.deepEqual([!!m.m2.selected, !!m.m3.selected], [true, false]);
		assert.ok(tableClass(tree).includes('is-targeting'));
	});

	it('still sends a staged pick for a tap, as before', () => {
		const b = board(held());
		b.clickSlot(1, false, AT);
		assert.deepEqual(b.sent, [{type: 'pickSlot', slot: 1, stage: true}]);
	});

	it('ends with the focus once the picks are all held and only Confirm is left', () => {
		const done = snapshot([{type: 'confirmPicks', multi: {picked: 2, min: 2, max: 2}}], pending('mine', {left: 2}));
		const tree = board(done).render();
		assert.ok(!tableClass(tree).includes('is-targeting'));
	});
});

describe('when the focus is off', () => {
	const make = (state = {}, props = {}, extra = {}) =>
		board(snapshot(pickRows(0, 1), {...pending('mine'), ...extra}), state, props);

	it('is on for the plain case, so each case below is a real change', () => {
		assert.ok(tableClass(make().render()).includes('is-targeting'));
	});

	it('while an answer is in flight', () => {
		assert.ok(!tableClass(make({}, {waiting: true}).render()).includes('is-targeting'));
	});

	it('during an animation beat', () => {
		assert.ok(!tableClass(make({fx: {kind: 'attack'}}).render()).includes('is-targeting'));
	});

	it('for a spectator', () => {
		const spec = board(snapshot(pickRows(0, 1), {...pending('mine'), you: null}));
		assert.ok(!tableClass(spec.render()).includes('is-targeting'));
	});

	it('when the game has ended', () => {
		assert.ok(!tableClass(make({}, {ended: true}).render()).includes('is-targeting'));
	});

	it('when the rows are gone: the choice was answered or cancelled', () => {
		const b = make();
		assert.ok(tableClass(b.render()).includes('is-targeting'));
		b.props = {...b.props, snapshot: snapshot([])};
		assert.ok(!tableClass(b.render()).includes('is-targeting'));
	});

	it('after the pick is sent, once the next snapshot has no pending choice', () => {
		const b = make();
		b.clickSlot(0, false, AT);
		assert.deepEqual(b.sent, [{type: 'pickSlot', slot: 0}]);
		b.props = {...b.props, snapshot: snapshot([{type: 'endTurn'}])};
		assert.ok(!tableClass(b.render()).includes('is-targeting'));
	});

	it('under a mode or a prompt that owns the tap or the board', () => {
		for (const state of [
			{selectedHand: 0}, {energyPick: true}, {drag: {active: true}}, {moveTargetPick: {}}, {attackMay: {}},
			{trainerUse: {}}, {stadiumUse: {}}, {endTurnConfirm: true}, {playChoice: {}}, {discardBrowse: {}},
		]) {
			assert.equal(make(state).targetFocus(), false, JSON.stringify(state));
		}
		for (const extra of [
			{pendingSearch: {kind: 'any'}}, {pendingConfirm: {title: 'x', text: 'y'}}, {pendingPrize: {seat: 0, n: 1}},
			{pendingRetreatPay: {need: 1, cardIds: []}}, {pendingFirst: 0},
		]) {
			assert.equal(make({}, {}, extra).targetFocus(), false, JSON.stringify(extra));
		}
	});

	it('for an ordinary turn: Pokémon that have actions are not a choice', () => {
		const tree = board(snapshot([{type: 'attack', index: 0}, {type: 'endTurn'}])).render();
		assert.ok(!tableClass(tree).includes('is-targeting'));
	});
});
