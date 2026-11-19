'use strict';

/**
 * A batch the opponent started (an attack that ends their turn, then your turn and your draw) must not hand you
 * the turn, the drawn card, or the new actions before its own beats have played. Reported: "my turn became available
 * before the opponent's attack animation and turn-end sequence finished; my draw played early, then again".
 *
 * Cause: the room painted the post-batch snapshot (turn, hand, actions) the moment any batch started for a seated
 * player, so those were live while the attack was still on screen; the draw beat then flew the card in a second time.
 * Now every batch, your own included, keeps the pre-batch board and the board folds each beat in as it plays
 * (`boardSnap`; `tcgInputWaitsOnBatch` decides only what input waits on). The rows are in engine order (act, attack, damage, turn,
 * draw, request). The board's render is walked as a tree of plain objects (`preact.h` builds {type, props, children}).
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

/** Timers run by hand, in order, so a whole batch plays without waiting. */
const timers = [];
global.setTimeout = fn => { timers.push(fn); return timers.length; };
global.clearTimeout = () => {};
global.addEventListener = () => {};
global.removeEventListener = () => {};

const choicePath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg-choice.js');
vm.runInThisContext(fs.readFileSync(choicePath, 'utf8'), {filename: choicePath});
const boardPath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg.js');
vm.runInThisContext(fs.readFileSync(boardPath, 'utf8'), {filename: boardPath});
const {TcgBoard, tcgInputWaitsOnBatch, tcgBatchActor} = global;

function mon(iid, cardId, hp = 100) {
	return {iid, cardId, name: cardId, hp, maxHp: 100, energyCards: [], energy: [], tools: []};
}

const END_TURN = {type: 'endTurn'};

/** Alice is you (seat 0). The opponent attacked, so it is their turn before the batch and yours after it. */
function snapshot(after) {
	const side = me => ({
		name: me ? 'Alice' : 'Bob', active: mon(me ? 'm1' : 'f1', 'sv1-1', me && after ? 70 : 100), bench: [],
		hand: me ? (after ? ['sve-1', 'sve-2', 'sve-3'] : ['sve-1', 'sve-2']) : {count: 4},
		discard: [], deck: {count: after ? 19 : 20}, lostZone: {count: 0}, prizes: {count: 6},
	});
	return {
		you: 0, status: 'playing', turn: after ? 0 : 1, turnNumber: after ? 4 : 3,
		actions: after ? [END_TURN] : [], players: [side(true), side(false)],
	};
}

const OPPONENT_ATTACK = [
	{seq: 10, type: 'act', seat: 1, action: {type: 'attack', slot: 0, index: 0}},
	{seq: 11, type: 'attack', iid: 'f1', name: 'Scratch', seat: 1},
	{seq: 12, type: 'damage', iid: 'm1', amount: 30, hp: 70},
	{seq: 13, type: 'turn', seat: 0, number: 4},
	{seq: 14, type: 'draw', seat: 0, n: 1, ids: ['sve-3']},
	{seq: 15, type: 'request', kind: 'turn', waiting: [0]},
];

const all = (node, test, out = []) => {
	if (!node || typeof node !== 'object') return out;
	if (test(node)) out.push(node);
	(node.children || []).forEach(c => all(c, test, out));
	return out;
};
const text = node => (typeof node === 'object' && node ? node.children.map(text).join(' ') : String(node === false || node == null ? '' : node)).trim();

/** A board mid-batch the way the room hands it over: `held` keeps the pre-batch snapshot as `snapshot`. */
function playBatch(events, {held}) {
	const pre = snapshot(false);
	const post = snapshot(true);
	const sent = [];
	const board = new TcgBoard();
	board.props = {
		snapshot: held ? pre : post, fxSnapshot: post, events, playing: true, fxKey: 1, waiting: false, ended: false,
		onEvent() {}, onAct(a) { sent.push(a); }, onFxDone() { return false; },
	};
	board.state = {...board.state, fx: null, koHide: {}};
	board.setState = (patch, done) => {
		Object.assign(board.state, typeof patch === 'function' ? patch(board.state) : patch);
		if (done) done();
	};
	board.aimFlyers = () => {};
	board.stashHands = () => {};
	let finished = false;
	board.finishFx = () => { finished = true; };
	const look = () => {
		const tree = board.render();
		return {
			badge: text(all(tree, n => String(n.props.class || '').includes('tcg-turn'))[0] || ''),
			handCards: all(tree, n => typeof n.type === 'function' && n.props.cardId && n.props.size === 'md' && n.props.fanCount),
			endTurn: all(tree, n => n.type === 'button' && String(n.props.class || '').includes('tcg-endturn')).length,
			fx: board.state.fx && board.state.fx.kind,
		};
	};
	return {board, look, sent, done: () => finished, run(until) {
		timers.length = 0;
		board.runFx(events);
		for (let guard = 0; timers.length && guard < 200; guard++) {
			if (until && until(board)) break;
			timers.shift()();
		}
	}};
}

describe('who started a batch decides what input waits on (every batch plays on the held board)', () => {
	it('the seat of the first act row is the actor; no act row means nobody', () => {
		assert.equal(tcgBatchActor(OPPONENT_ATTACK), 1);
		assert.equal(tcgBatchActor([{seq: 1, type: 'turn', seat: 0}]), null);
		assert.equal(tcgBatchActor(undefined), null);
	});

	it('input waits on the batch for an opponent batch or one that hands you the turn; your own uses the wait flag', () => {
		assert.equal(tcgInputWaitsOnBatch(OPPONENT_ATTACK, 0), true, 'opponent attack');
		const mine = [{seq: 20, type: 'act', seat: 0, action: {type: 'playTrainer', hand: 0}}, {seq: 21, type: 'trainer', seat: 0, cardId: 'sv1-189'}];
		assert.equal(tcgInputWaitsOnBatch(mine, 0), false, 'my own play: the server says whether I wait');
		const setupDone = [{seq: 30, type: 'act', seat: 0, action: {type: 'setupDone'}}, {seq: 31, type: 'turn', seat: 0, number: 1}, {seq: 32, type: 'draw', seat: 0, n: 1, ids: ['sve-1']}];
		assert.equal(tcgInputWaitsOnBatch(setupDone, 0), true, 'my setupDone that starts my own turn waits on the turn and draw');
		const endMine = [{seq: 40, type: 'act', seat: 0, action: {type: 'endTurn'}}, {seq: 41, type: 'turn', seat: 1, number: 5}];
		assert.equal(tcgInputWaitsOnBatch(endMine, 0), false, 'ending my turn leaves me with nothing to click either way');
		assert.equal(tcgInputWaitsOnBatch(mine, null), true, 'a spectator always follows the beats');
		assert.equal(tcgInputWaitsOnBatch([], 0), true, 'a batch nobody started (deal, coin, game end)');
	});
});

describe('an opponent attack that ends their turn', () => {
	it('control: painting the post-batch board first (the old behaviour) shows your turn, draw and End Turn under the attack', () => {
		const run = playBatch(OPPONENT_ATTACK, {held: false});
		run.run(b => b.state.fx && b.state.fx.kind === 'attack');
		const shown = run.look();
		assert.equal(shown.fx, 'attack');
		assert.equal(shown.endTurn, 1, 'End Turn is live while the attack plays');
		assert.equal(shown.handCards.length, 3, 'the drawn card is already in the hand');
	});

	it('held: during the attack you are not on turn, the card is not drawn, and there is nothing to click', () => {
		const run = playBatch(OPPONENT_ATTACK, {held: true});
		run.run(b => b.state.fx && b.state.fx.kind === 'attack');
		const shown = run.look();
		assert.equal(shown.fx, 'attack');
		assert.equal(shown.endTurn, 0, 'no End Turn yet');
		assert.equal(shown.handCards.length, 2, 'the draw has not happened');
		assert.ok(!/Your turn/i.test(shown.badge), `badge was "${shown.badge}"`);
	});

	it('held: the turn passes on its own beat, then the card is drawn once, then the actions arrive', () => {
		const run = playBatch(OPPONENT_ATTACK, {held: true});
		const seen = [];
		timers.length = 0;
		const board = run.board;
		const record = () => {
			const s = run.look();
			seen.push({fx: s.fx, hand: s.handCards.length, endTurn: s.endTurn, mine: /Your turn/i.test(s.badge)});
		};
		board.runFx(OPPONENT_ATTACK);
		record();
		for (let guard = 0; timers.length && guard < 200; guard++) {
			timers.shift()();
			record();
		}
		const at = kind => seen.findIndex(s => s.fx === kind);
		const turnAt = seen.findIndex(s => s.mine);
		const drawAt = seen.findIndex(s => s.hand === 3);
		assert.ok(at('attack') >= 0 && turnAt > at('attack'), 'your turn begins after the attack beat');
		assert.ok(drawAt >= turnAt, 'the card joins the hand with or after the turn beat, never before');
		assert.equal(seen.filter((s, i) => i > 0 && s.hand === 3 && seen[i - 1].hand !== 3).length, 1, 'the hand grows once');
		assert.ok(seen.slice(0, turnAt).every(s => s.endTurn === 0), 'End Turn never shows before the turn beat');
		assert.ok(run.done(), 'the batch finished');
		assert.equal(seen[seen.length - 1].endTurn, 1, 'End Turn is there when the batch is over');
	});

	it('held: a click during the attack is refused (not your turn yet) and sends nothing', () => {
		const run = playBatch(OPPONENT_ATTACK, {held: true});
		run.run(b => b.state.fx && b.state.fx.kind === 'attack');
		run.board.showRefuse = () => {};
		run.board.choose(END_TURN);
		assert.deepEqual(run.sent, [], 'nothing was sent');
	});
});

describe('a beat that throws', () => {
	it('ends the batch instead of leaving the room waiting on onFxDone forever', () => {
		const run = playBatch(OPPONENT_ATTACK, {held: true});
		const log = console.error;
		console.error = () => {};
		try {
			let calls = 0;
			const real = run.board.foldEvents.bind(run.board);
			run.board.foldEvents = (...args) => {
				if (++calls === 3) throw new Error('missing target');
				return real(...args);
			};
			run.run();
		} finally {
			console.error = log;
		}
		assert.ok(run.done(), 'finishFx ran, so the room commits the batch and plays the next one');
	});
});

describe('mounting the board', () => {
	function mount(playing, resumeAt) {
		const board = new TcgBoard();
		board.props = {snapshot: snapshot(true), fxSnapshot: null, events: OPPONENT_ATTACK, playing, resumeAt, fxKey: 7, waiting: false, onEvent() {}, onAct() {}};
		board.state = {...board.state, fx: null, koHide: {}};
		board.setState = patch => Object.assign(board.state, patch);
		const calls = [];
		board.runFx = (events, fresh, from) => { calls.push({events, fresh, from}); };
		board.stashHands = () => {};
		board.componentDidMount();
		return calls;
	}

	it('does not play the last batch again when nothing is playing (a remount after a resize or a tab switch)', () => {
		assert.equal(mount(false).length, 0);
	});

	it('plays the batch that is playing when the board first appears, from its first event', () => {
		const calls = mount(true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].from, 0);
	});

	it('a board that mounts part-way through a batch carries on after the beats that already started', () => {
		const calls = mount(true, 3);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].from, 3, 'the attack, damage and act rows are not played again');
	});

	it('resuming shows only the beats left, with the earlier results already on the board', () => {
		const run = playBatch(OPPONENT_ATTACK, {held: true});
		const shown = [];
		const real = run.board.setState;
		run.board.setState = (patch, done) => { if (patch.fx) shown.push(patch.fx.kind); return real(patch, done); };
		timers.length = 0;
		run.board.runFx(OPPONENT_ATTACK, true, 3); // act, attack, damage have played; the turn row is next
		const first = run.look();
		assert.ok(/Your turn/i.test(first.badge) || shown.length > 0, 'the turn beat is the first one shown');
		assert.equal(first.handCards.length, 2, 'the card is not drawn yet');
		assert.equal(first.endTurn, 0, 'still nothing to click');
		for (let guard = 0; timers.length && guard < 200; guard++) timers.shift()();
		assert.ok(!shown.includes('attack'), `the attack was not played again (beats were ${shown.join(', ')})`);
		assert.equal(shown.filter(k => k === 'draw').length, 1, 'the draw plays once');
		assert.ok(run.done());
		assert.equal(run.look().handCards.length, 3);
	});
});
