'use strict';

/**
 * A choice made from the player's own hand is answered on the hand: the hint and the selection bar there, and the
 * engine's own stop row as "Choose none" or "Done". It never opens the search panel ("Choose a card / from your deck /
 * No matching cards"), which is for a deck, a discard pile or Prize cards.
 *
 * The snapshots are the engine's own (Wave-TCG, player 1's view with its legal rows), captured once:
 * Rocket Feathers (me2pt5-127) with two Team Rocket Supporters, Iono and a Grass Energy in hand; with one; with one
 * held. Tropical Frenzy (sv8-133) choosing a Basic Energy, then a Pokémon. Ultra Ball's discard of exactly 2, then its
 * deck search. Nest Ball's deck search.
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
global.PS = {prefs: {tcghints: true}};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.lookupAttackHit = function () { return null; };
global.getTcgCard = function () { return undefined; };
global.document = {querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }};
global.setTimeout = global.setTimeout || (() => 0);

const choicePath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg-choice.js');
vm.runInThisContext(fs.readFileSync(choicePath, 'utf8'), {filename: choicePath});
const boardPath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg.js');
vm.runInThisContext(fs.readFileSync(boardPath, 'utf8'), {filename: boardPath});
const {
	TcgBoard, ownHandChoice, ownHandHint, cardCountText, heldChoice, applyTcgEvents, scrubTcgSpectatorView,
	fxFor, searchDoneShuffles,
} = global;

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'battle-tcg-hand-choice.fixtures.json'), 'utf8'));
const snapOf = name => JSON.parse(JSON.stringify(FIX[name].snapshot));

function board(snap, props = {}) {
	const b = new TcgBoard();
	b.sent = [];
	b.props = {snapshot: snap, fxSnapshot: null, events: [], onEvent() {}, onAct(a) { b.sent.push(a); }, fxKey: 1, waiting: false, ...props};
	b.state = {...b.state, fx: null, koHide: {}};
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
const classes = n => String((n.props && n.props.class) || '').split(' ');
const textOf = n => (n.children || []).map(c => (c && typeof c === 'object' ? textOf(c) : c == null || c === false ? '' : String(c))).join('');
const panels = tree => all(tree, n => classes(n).includes('tcg-prompt'));
const bars = tree => all(tree, n => classes(n).includes('tcg-held-bar'));
const buttons = (tree, label) => all(tree, n => n.type === 'button' && textOf(n).trim() === label);
const handFaces = tree => {
	const hand = all(tree, n => classes(n).includes('tcg-hand-mine'))[0];
	return all(hand, n => n.props && typeof n.props.cardId === 'string' && 'playable' in n.props);
};
const hintText = tree => {
	const float = all(tree, n => classes(n).includes('tcg-float-hint'))[0];
	if (float) return textOf(float);
	const title = all(tree, n => classes(n).includes('tcg-held-title'))[0];
	return title ? textOf(title) : '';
};
/** No search panel, and none of its text, anywhere on the board. */
function noSearchPanel(tree) {
	assert.equal(panels(tree).length, 0, 'no choice panel is open');
	const text = textOf(tree);
	assert.ok(!/No matching cards/.test(text), 'no "No matching cards"');
	assert.ok(!/from your deck/.test(text), 'no "from your deck"');
}

describe('Rocket Feathers: up to 2 Team Rocket Supporters from the hand', () => {
	it('the engine asks for a hand discard, never a search', () => {
		const snap = snapOf('feathersUpTo2');
		assert.equal(snap.pendingSearch, undefined);
		assert.deepEqual([snap.pendingDiscard.need, snap.pendingDiscard.upTo, !!snap.pendingDiscard.fromFoe], [2, true, false]);
		assert.deepEqual(snap.actions.map(a => [a.type, a.hand]), [['discardPick', 0], ['discardPick', 2], ['searchDone', undefined]],
			'Archer and Ariana only: Iono and the Energy are not offered');
		assert.equal(ownHandChoice(snap, snap.actions), 'discard');
	});

	it('shows one selection bar at the hand, and no search panel', () => {
		const tree = board(snapOf('feathersUpTo2')).render();
		noSearchPanel(tree);
		const shown = bars(tree);
		assert.equal(shown.length, 1, 'one bar, not one in a panel and one at the hand');
		assert.ok(classes(shown[0]).includes('at-hand'));
		assert.match(textOf(shown[0]), /0 selected \(up to 2\)/);
		assert.equal(hintText(tree), 'Drag up to 2 cards to Discard');
		const none = buttons(tree, 'Choose none');
		assert.equal(none.length, 1, 'one way to discard none');
		assert.equal(none[0].props.disabled, false);
	});

	it('only the Team Rocket Supporters can be picked', () => {
		const faces = handFaces(board(snapOf('feathersUpTo2')).render());
		assert.deepEqual(faces.map(f => [f.props.cardId, !!f.props.playable]), [
			['me2pt5-201', true], ['sv2-185', false], ['me2pt5-202', true], ['sve-1', false],
		]);
	});

	it('a tap holds the pick; a card that is not offered sends nothing', () => {
		const b = board(snapOf('feathersUpTo2'));
		b.clickHand(1);
		b.clickHand(3);
		assert.deepEqual(b.sent, []);
		b.clickHand(2);
		assert.deepEqual(b.sent, [{type: 'discardPick', hand: 2, stage: true}]);
	});

	it('"Choose none" sends the engine\'s stop row once', () => {
		const b = board(snapOf('feathersUpTo2'));
		buttons(b.render(), 'Choose none')[0].props.onClick();
		assert.deepEqual(b.sent.map(a => a.type), ['searchDone']);
		const waiting = board(snapOf('feathersUpTo2'), {waiting: true});
		const tree = waiting.render();
		assert.equal(buttons(tree, 'Choose none')[0].props.disabled, true, 'not again while the answer is on its way');
	});

	it('with one held: the count, the held card marked, Confirm on, still no panel', () => {
		const b = board(snapOf('feathersHeldOne'));
		const tree = b.render();
		noSearchPanel(tree);
		assert.equal(bars(tree).length, 1);
		assert.match(textOf(bars(tree)[0]), /1 selected \(up to 2\)/);
		assert.match(textOf(bars(tree)[0]), /Team Rocket's Ariana/);
		const faces = handFaces(tree);
		assert.deepEqual(faces.filter(f => f.props.selected).map(f => f.props.cardId), ['me2pt5-202']);
		const confirm = buttons(tree, 'Confirm')[0];
		assert.equal(confirm.props.disabled, false);
		confirm.props.onClick();
		assert.deepEqual(b.sent, [{type: 'confirmPicks'}]);
	});

	it('up to 1: no bar, a tap discards at once, and "Choose none" sits with the board buttons', () => {
		const b = board(snapOf('feathersUpTo1'));
		const tree = b.render();
		noSearchPanel(tree);
		assert.equal(bars(tree).length, 0);
		assert.equal(hintText(tree), 'Drag up to 1 card to Discard');
		const none = buttons(tree, 'Choose none');
		assert.equal(none.length, 1);
		assert.ok(classes(none[0]).includes('tcg-hand-stop'));
		b.clickHand(0);
		assert.deepEqual(b.sent, [], 'Iono is not a Team Rocket Supporter');
		b.clickHand(1);
		assert.deepEqual(b.sent, [{type: 'discardPick', hand: 1}]);
		none[0].props.onClick();
		assert.deepEqual(b.sent.map(a => a.type), ['discardPick', 'searchDone']);
	});
});

describe('Energy from the hand (Tropical Frenzy)', () => {
	it('choosing the Energy: on the hand, with Done, and no raw row button', () => {
		const b = board(snapOf('frenzyCard'));
		const tree = b.render();
		noSearchPanel(tree);
		assert.equal(hintText(tree), 'Choose a Basic Energy from your hand to attach');
		assert.equal(buttons(tree, 'Done').length, 1);
		assert.equal(all(tree, n => n.type === 'button' && /handEnergyPick|Attach /.test(textOf(n))).length, 0,
			'the picks are the hand cards, not buttons');
		assert.deepEqual(handFaces(tree).map(f => [f.props.cardId, !!f.props.playable]), [
			['sve-2', true], ['sv2-185', false], ['sve-3', true],
		]);
		b.clickHand(2);
		assert.deepEqual(b.sent, [{type: 'handEnergyPick', hand: 2}]);
		buttons(tree, 'Done')[0].props.onClick();
		assert.deepEqual(b.sent.map(a => a.type), ['handEnergyPick', 'searchDone']);
	});

	it('choosing the Pokémon: the hint says so, and nothing offers to stop', () => {
		const tree = board(snapOf('frenzyPokemon')).render();
		noSearchPanel(tree);
		assert.equal(hintText(tree), 'Choose a Pokémon to attach that Energy to');
		assert.equal(buttons(tree, 'Done').length + buttons(tree, 'Choose none').length, 0);
	});

	it('an opponent\'s effect can ask for it on their turn', () => {
		const snap = snapOf('frenzyCard');
		snap.turn = 1;
		const b = board(snap);
		b.choose(snap.actions[0]);
		assert.deepEqual(b.sent, [{type: 'handEnergyPick', hand: 0}]);
		assert.equal(b.refused, undefined);
	});
});

describe('the other zones keep their own interface', () => {
	it('Ultra Ball\'s discard of exactly 2: the hand bar, Confirm off, no way to discard none', () => {
		const tree = board(snapOf('ultraDiscard')).render();
		noSearchPanel(tree);
		assert.equal(bars(tree).length, 1);
		assert.match(textOf(bars(tree)[0]), /0 of 2 selected/);
		assert.equal(hintText(tree), 'Drag 2 cards to Discard');
		assert.equal(buttons(tree, 'Choose none').length, 0);
		assert.equal(all(bars(tree)[0], n => n.type === 'button' && classes(n).includes('tcg-held-confirm'))[0].props.disabled, true);
	});

	it('the deck search after it opens the search panel, with Done', () => {
		for (const name of ['ultraSearch', 'nestSearch']) {
			const tree = board(snapOf(name)).render();
			const panel = all(tree, n => classes(n).includes('kind-search'));
			assert.equal(panel.length, 1, name);
			assert.match(textOf(panel[0]), /from your deck/, name);
			assert.equal(buttons(tree, 'Done').length, 1, name);
			assert.equal(buttons(tree, 'Choose none').length, 0, name);
			assert.equal(ownHandChoice(snapOf(name), snapOf(name).actions), null, name);
		}
	});

	it('the opponent\'s revealed hand keeps its panel', () => {
		const snap = snapOf('feathersUpTo2');
		snap.pendingDiscard = {need: 1, fromFoe: true, upTo: true, cardIds: ['sv2-185', 'sve-1']};
		snap.actions = [{type: 'discardPick', hand: 0}, {type: 'searchDone'}];
		const tree = board(snap).render();
		assert.equal(all(tree, n => classes(n).includes('kind-foeHand')).length, 1);
		assert.equal(ownHandChoice(snap, snap.actions), null);
		assert.equal(buttons(tree, 'Choose none').length, 0);
	});
});

describe('the prompt\'s life', () => {
	it('once the choice is answered nothing is left on the board', () => {
		const snap = snapOf('feathersUpTo2');
		delete snap.pendingDiscard;
		snap.actions = [{type: 'endTurn'}];
		const tree = board(snap).render();
		assert.equal(panels(tree).length, 0);
		assert.equal(bars(tree).length, 0);
		assert.equal(buttons(tree, 'Choose none').length, 0);
		assert.notEqual(hintText(tree), 'Drag up to 2 cards to Discard');
	});

	it('while a batch still plays on the held board, the spent rows offer nothing', () => {
		const snap = snapOf('feathersUpTo2');
		const tree = board(snap, {playing: true, fxSnapshot: snapOf('feathersUpTo1')}).render();
		assert.equal(panels(tree).length, 0);
		assert.equal(buttons(tree, 'Choose none').length, 0);
	});

	it('the request events set the Energy choice, and the next request clears it', () => {
		const base = snapOf('feathersUpTo2');
		delete base.pendingDiscard;
		base.actions = [];
		const open = applyTcgEvents(base, [{type: 'request', kind: 'handEnergy', waiting: [0], phase: 'card'}]);
		assert.deepEqual(open.pendingHandEnergy, {phase: 'card'});
		const next = applyTcgEvents(open, [{type: 'request', kind: 'turn', waiting: [0]}]);
		assert.equal(next.pendingHandEnergy, undefined);
		const foe = applyTcgEvents(base, [{type: 'request', kind: 'handEnergy', waiting: [1], phase: 'card'}]);
		assert.equal(foe.pendingHandEnergy, undefined, 'only the chooser sees it');
	});

	it('a discard from the own hand keeps where the cards go', () => {
		const base = snapOf('feathersUpTo2');
		delete base.pendingDiscard;
		const after = applyTcgEvents(base, [{type: 'request', kind: 'discard', waiting: [0], need: 2, to: 'deck'}]);
		assert.deepEqual([after.pendingDiscard.need, after.pendingDiscard.to, !!after.pendingDiscard.fromFoe], [2, 'deck', false]);
	});

	it('a spectator view drops the Energy choice', () => {
		const snap = snapOf('frenzyCard');
		snap.you = null;
		assert.equal(scrubTcgSpectatorView(snap).pendingHandEnergy, undefined);
	});
});

describe('what the hint says', () => {
	const discard = (pendingDiscard, actions) => ownHandHint({pendingDiscard, players: []}, actions, heldChoice(actions));
	it('counts from the fewest to the most', () => {
		assert.equal(cardCountText(0, 3), 'up to 3 cards');
		assert.equal(cardCountText(2, 2), '2 cards');
		assert.equal(cardCountText(1, 3), '1–3 cards');
		assert.equal(cardCountText(1, 1), '1 card');
	});
	it('says where the cards go', () => {
		const pick = [{type: 'discardPick', hand: 0}];
		assert.equal(discard({need: 1}, pick), 'Drag 1 card to Discard');
		assert.equal(discard({need: 2, to: 'deck'}, pick), 'Choose 2 cards from your hand to put into your deck');
		assert.equal(discard({need: 2, to: 'lost'}, pick), 'Choose 2 cards from your hand to put in the Lost Zone');
		assert.equal(discard({need: 1, to: 'prizes'}, pick), 'Choose 1 card from your hand to put with your Prize cards');
	});
	it('"up to" comes from the engine: its flag, its stop row, or the held choice\'s fewest', () => {
		assert.equal(discard({need: 2, upTo: true}, [{type: 'discardPick', hand: 0}]), 'Drag up to 2 cards to Discard');
		assert.equal(discard({need: 1}, [{type: 'discardPick', hand: 0}, {type: 'searchDone'}]), 'Drag up to 1 card to Discard');
		const atLeastOne = [{type: 'discardPick', hand: 0, multi: {picked: 0, min: 1, max: 3}}];
		assert.equal(discard({need: 3, upTo: true}, atLeastOne), 'Drag 1–3 cards to Discard');
	});
});

describe('ending an "up to" choice is not a shuffle', () => {
	const done = {type: 'act', seat: 0, action: {type: 'searchDone'}};
	it('no deck was shuffled: no "Shuffled the deck" beat', () => {
		const events = [done, {type: 'damage', iid: 'm2', amount: 0}, {type: 'request', kind: 'turn', waiting: [1]}];
		assert.equal(searchDoneShuffles(events, 0), false);
		assert.equal(fxFor(done, events, 0, [], 0, null).kind, '');
	});
	it('a deck search that shuffled still shows it', () => {
		const events = [done, {type: 'shuffle', seat: 0, from: 'deck', deck: 40}, {type: 'request', kind: 'turn', waiting: [1]}];
		assert.equal(searchDoneShuffles(events, 0), true);
		assert.equal(fxFor(done, events, 0, [], 0, null).kind, 'searchDone');
	});
	it('a shuffle after the next choice belongs to that choice', () => {
		const events = [done, {type: 'request', kind: 'search', waiting: [0]}, {type: 'shuffle', seat: 0, from: 'deck', deck: 40}];
		assert.equal(searchDoneShuffles(events, 0), false);
	});
});
