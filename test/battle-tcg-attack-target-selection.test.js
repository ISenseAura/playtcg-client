'use strict';

/**
 * An attack is used only when the player chooses it (battle-tcgcustomgame-2567: Decidueye ex Active, Relicanth on the
 * Bench, so Memory Dive offers Dartrix's Feather Shot, "90 damage to 1 of your opponent's Pokémon"). Every legal row of
 * Feather Shot names an opponent's Pokémon (`foeSlot`), and the board used to read those rows on their own: the
 * opponent's Pokémon glowed with nothing chosen, and a click on one sent Feather Shot.
 *
 * The rows below are the engine's, for that board. The rule tested: an opponent's Pokémon glows, and a click on it sends
 * something, only for what the player chose (a hand card, an engine prompt, or an attack or Ability picked from the
 * menu, whose own list names its targets), and a choice left open is closed when its rows are no longer offered.
 */
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
const {rowsStillOffered} = vm.runInThisContext('({rowsStillOffered})');

const C3 = ['colorless', 'colorless', 'colorless'];
// `legalActions` for that board (Wave-TCG, Decidueye ex me3-12 evolved from Rowlet and Dartrix, Relicanth sv5-84 Benched).
const CRUSHING = {type: 'attack', index: 0, name: 'Crushing Arrow', cost: ['grass', 'colorless', 'colorless', 'colorless'], damage: '240'};
const FIND = {type: 'attack', index: 1, name: 'Find a Friend', cost: ['grass'], damage: ''};
const TACKLE = {type: 'attack', index: 2, name: 'Tackle', cost: C3, damage: '30'};
const LEAFAGE = {type: 'attack', index: 3, name: 'Leafage', cost: ['grass'], damage: '20'};
const feather = foeSlot => ({type: 'attack', index: 4, foeSlot, name: 'Feather Shot', cost: C3, damage: ''});
const FEATHER = [feather('active'), feather(0), feather(1)];
const ROWS = [CRUSHING, FIND, TACKLE, LEAFAGE, ...FEATHER, {type: 'endTurn'}];

function mon(iid, cardId, name, extra = {}) {
	return {iid, cardId, name, hp: 200, maxHp: 200, energyCards: [], energy: [], tools: [], ...extra};
}
const pile = () => ({discard: [], deck: {count: 20}, lostZone: {count: 0}, prizes: {count: 6}});
function snapshot(actions = ROWS, extra = {}) {
	return {
		you: 0, status: 'playing', turn: 0, turnNumber: 5, actions,
		players: [
			{
				name: 'Alice', hand: {count: 3}, ...pile(),
				active: mon('dec', 'me3-12', 'Decidueye ex', {
					energy: ['grass', 'grass', 'grass', 'grass'],
					attacks: [
						{name: 'Crushing Arrow', cost: ['Grass', 'Colorless', 'Colorless', 'Colorless'], damage: '240'},
						{name: 'Find a Friend', cost: ['Grass'], damage: '', sourceCardId: 'me3-10'},
						{name: 'Tackle', cost: ['Colorless', 'Colorless', 'Colorless'], damage: '30', sourceCardId: 'me3-10'},
						{name: 'Leafage', cost: ['Grass'], damage: '20', sourceCardId: 'me3-11'},
						{name: 'Feather Shot', cost: ['Colorless', 'Colorless', 'Colorless'], damage: '', sourceCardId: 'me3-11'},
					],
				}),
				bench: [mon('rel', 'sv5-84', 'Relicanth')],
			},
			{
				name: 'Bob', hand: {count: 4}, ...pile(),
				active: mon('pin', 'sv1-1', 'Pineco'),
				bench: [mon('bul', 'me1-1', 'Bulbasaur'), mon('sab', 'sv3-62', 'Sableye')],
			},
		],
		...extra,
	};
}
function board(snap = snapshot(), props = {}) {
	const b = new TcgBoard();
	b.refused = null;
	b.sent = [];
	b.props = {snapshot: snap, fxSnapshot: null, events: [], onEvent() {}, onAct(a) { b.sent.push(a); }, fxKey: 1, waiting: false, ended: false, ...props};
	b.state = {...b.state, fx: null, koHide: {}};
	b.setState = patch => Object.assign(b.state, typeof patch === 'function' ? patch(b.state) : patch);
	b.showRefuse = text => { b.refused = text; };
	return b;
}
const AT = {clientX: 5, clientY: 5};
const FOE_SLOTS = [['active', 'sv1-1'], [0, 'me1-1'], [1, 'sv3-62']];

describe('nothing chosen: the opponent\'s Pokémon are not targets', () => {
	it('none glows, although every one could be hit by Feather Shot', () => {
		const b = board();
		for (const [slot] of FOE_SLOTS) {
			assert.equal(b.slotActionable(slot, true), false, `their ${slot} is not lit`);
			assert.equal(b.slotLegal(slot, true), false, `their ${slot} is not a legal target`);
		}
	});

	it('a click on one sends nothing, and shows that Pokémon\'s card', () => {
		for (const [slot, cardId] of FOE_SLOTS) {
			const b = board();
			b.clickSlot(slot, true, AT);
			assert.deepEqual(b.sent, [], `their ${slot}: Feather Shot was not used`);
			assert.equal(b.state.inspect && b.state.inspect.cardId, cardId, `their ${slot}: its card is shown`);
		}
	});

	it('opening and closing the attack menu chooses nothing', () => {
		const b = board();
		b.clickSlot('active', false, AT);
		assert.equal(b.state.menuSlot, 'active', 'the menu is open');
		assert.equal(b.state.moveTargetPick, null, 'no attack is chosen');
		for (const [slot] of FOE_SLOTS) assert.equal(b.slotActionable(slot, true), false, `their ${slot} is still not lit`);
		b.clickSlot('active', false, AT);
		assert.equal(b.state.menuSlot, null, 'closed');
		b.clickSlot(0, true, AT);
		assert.deepEqual(b.sent, [], 'and a click on their Pokémon after it still sends nothing');
	});

	it('the same holds for a lone attack and for an Ability that target the opponent', () => {
		const lone = board(snapshot([feather(0), {type: 'endTurn'}]));
		lone.clickSlot(0, true, AT);
		assert.deepEqual(lone.sent, [], 'one legal target is still not a choice');
		assert.equal(lone.slotActionable(0, true), false);
		const blast = {type: 'ability', slot: 'active', index: 0, foeSlot: 1, name: 'Some Ability'};
		const ability = board(snapshot([blast, {type: 'endTurn'}]));
		ability.clickSlot(1, true, AT);
		assert.deepEqual(ability.sent, [], 'an Ability is not used by tapping its target');
		assert.equal(ability.slotActionable(1, true), false);
	});

	it('on the opponent\'s turn nothing of theirs is a target either', () => {
		const b = board(snapshot([], {turn: 1}), {waiting: true});
		for (const [slot] of FOE_SLOTS) {
			assert.equal(b.slotActionable(slot, true), false);
			b.clickSlot(slot, true, AT);
		}
		assert.deepEqual(b.sent, []);
	});
});

describe('choosing the attack', () => {
	it('Feather Shot from the menu lists exactly its three targets, on the opponent\'s side, and sends nothing yet', () => {
		const b = board();
		b.clickSlot('active', false, AT);
		b.pickMenuAction(feather('active'));
		const pick = b.state.moveTargetPick;
		assert.ok(pick, 'its target list is open');
		assert.equal(pick.kind, 'attack');
		assert.deepEqual(pick.actions, FEATHER, 'Feather Shot and nothing else');
		assert.deepEqual(b.sent, [], 'not used until a target is chosen');
	});

	it('choosing a target uses Feather Shot once, on that Pokémon, and closes the list', () => {
		const b = board();
		b.pickMenuAction(feather('active'));
		b.pickMoveTarget(feather(1));
		assert.deepEqual(b.sent, [feather(1)], 'one attack, on their Bench 1');
		assert.equal(b.state.moveTargetPick, null);
		assert.equal(b.slotActionable(1, true), false, 'nothing is left lit');
	});

	it('an attack with no target is used from the menu as before, and lights nothing', () => {
		const b = board();
		b.pickMenuAction(CRUSHING);
		assert.deepEqual(b.sent, [CRUSHING]);
		assert.equal(b.state.moveTargetPick, null);
	});

	it('Memory Dive attacks keep their own identity: Leafage and Tackle are sent as themselves', () => {
		const b = board();
		b.pickMenuAction(LEAFAGE);
		b.pickMenuAction(TACKLE);
		assert.deepEqual(b.sent, [LEAFAGE, TACKLE]);
	});
});

describe('a choice left open', () => {
	function opened() {
		const b = board();
		b.pickMenuAction(feather('active'));
		assert.ok(b.state.moveTargetPick);
		return b;
	}
	function next(b, snap, props = {}) {
		const prev = b.props;
		b.props = {...prev, snapshot: snap, ...props};
		b.dropStaleChoices(prev);
	}

	it('is closed when its rows are no longer offered: the turn passed', () => {
		const b = opened();
		next(b, snapshot([], {turn: 1}), {waiting: true});
		assert.equal(b.state.moveTargetPick, null);
	});

	it('is closed when the request changed under it: Relicanth left, so Feather Shot is gone', () => {
		const b = opened();
		next(b, snapshot([CRUSHING, {type: 'endTurn'}]));
		assert.equal(b.state.moveTargetPick, null);
	});

	it('stays open when the same rows are offered again (a resync or an unrelated batch)', () => {
		const b = opened();
		next(b, snapshot(JSON.parse(JSON.stringify(ROWS))));
		assert.ok(b.state.moveTargetPick, 'still open');
	});

	it('is closed when the seat changes', () => {
		const b = opened();
		next(b, snapshot(ROWS, {you: 1}));
		assert.equal(b.state.moveTargetPick, null);
	});

	it('an attack\'s yes/no and a Trainer to confirm close the same way', () => {
		const b = board();
		b.setState({attackMay: {yes: TACKLE, no: LEAFAGE, title: 'x', text: 'y'}, trainerUse: {action: {type: 'playTrainer', hand: 0}, name: 'z'}});
		next(b, snapshot([CRUSHING]));
		assert.equal(b.state.attackMay, null);
		assert.equal(b.state.trainerUse, null);
	});

	it('the check runs on every update of the board', () => {
		assert.match(TcgBoard.prototype.componentDidUpdate.toString(), /dropStaleChoices/);
	});

	it('rowsStillOffered compares the rows as sent', () => {
		assert.equal(rowsStillOffered(FEATHER, ROWS), true);
		assert.equal(rowsStillOffered(FEATHER, [CRUSHING]), false);
		assert.equal(rowsStillOffered([feather(2)], ROWS), false, 'a target that is not offered');
		assert.equal(rowsStillOffered([null, undefined], []), true);
	});
});

describe('choices that do name the opponent\'s Pokémon still work', () => {
	it('an engine prompt to choose one of their Pokémon lights those and sends the one tapped', () => {
		const picks = [{type: 'pickSlot', slot: 'active'}, {type: 'pickSlot', slot: 1}];
		const b = board(snapshot(picks, {pendingSlotPick: {side: 'foe', left: 1}}));
		assert.equal(b.slotActionable(1, true), true);
		assert.equal(b.slotActionable(0, true), false, 'only the offered ones');
		b.clickSlot(1, true, AT);
		assert.deepEqual(b.sent, [{type: 'pickSlot', slot: 1}]);
	});

	it('a selected hand card that targets their Pokémon lights it and is played on the tap', () => {
		const boss = [{type: 'playTrainer', hand: 1, foeSlot: 0}, {type: 'playTrainer', hand: 1, foeSlot: 1}];
		const b = board(snapshot([...boss, ...ROWS]));
		b.state.selectedHand = 1;
		assert.equal(b.slotLegal(0, true), true);
		b.clickSlot(0, true, AT);
		assert.deepEqual(b.sent, [boss[0]], 'the card the player chose, not Feather Shot');
	});

	it('a spectator still only looks', () => {
		const b = board(snapshot(ROWS, {you: null}));
		b.clickSlot(0, true, AT);
		assert.deepEqual(b.sent, []);
		assert.equal(b.state.inspect.cardId, 'me1-1');
	});
});
