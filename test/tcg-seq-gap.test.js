'use strict';


const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it} = require('node:test');
const vm = require('vm');

global.window = global;
global.preact = {
	Component: class {},
	h() { return null; },
	render() {},
};
global.PS = {prefs: {}};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.lookupAttackHit = function () { return null; };

const choicePath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg-choice.js');
vm.runInThisContext(fs.readFileSync(choicePath, 'utf8'), {filename: choicePath});
const boardPath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg.js');
vm.runInThisContext(fs.readFileSync(boardPath, 'utf8'), {filename: boardPath});

const {
	tcgSeqGap, tcgSeqStep, tcgSeqGate, tcgFreshEvents, applyTcgEvents, createTcgResyncRetry,
	TCG_RESYNC_RETRY_MS, TCG_RESYNC_MAX_TRIES,
} = global;

const rows = (...seqs) => seqs.map(seq => ({type: 'draw', seq, seat: 0, n: 1}));
const fresh = () => ({seen: 0, pendingAt: null});

function room() {
	const r = {seen: 0, pendingAt: null, requests: 0, applied: [], now: 1000};
	r.receive = data => {
		const step = tcgSeqStep({seen: r.seen, pendingAt: r.pendingAt}, data, r.now);
		r.pendingAt = step.pendingAt;
		if (step.drop) {
			if (step.request) r.requests++;
			return;
		}
		for (const ev of data.events || []) {
			if (typeof ev.seq === 'number' && ev.seq <= r.seen) continue;
			r.applied.push(ev.seq);
		}
		r.seen = Math.max(r.seen, step.seen);
	};
	return r;
}

describe('sequence gap detection', () => {
	it('contiguous batches apply in order', () => {
		const r = room();
		r.receive({events: rows(1, 2, 3), seq: 3});
		r.receive({events: rows(4, 5), seq: 5});
		assert.deepEqual(r.applied, [1, 2, 3, 4, 5]);
		assert.equal(r.seen, 5);
		assert.equal(r.requests, 0);
		assert.equal(tcgSeqGap(5, rows(6, 7, 8)), false);
	});

	it('repeated and stale rows are not a gap and are not applied again', () => {
		const r = room();
		r.receive({events: rows(1, 2, 3), seq: 3});
		r.receive({events: rows(1, 2, 3), seq: 3});
		r.receive({events: rows(2, 3, 4), seq: 4});
		assert.deepEqual(r.applied, [1, 2, 3, 4]);
		assert.equal(r.requests, 0);
		assert.equal(tcgSeqGap(10, rows(3, 4)), false);
	});

	it('a missing sequence is a gap, at the start of a batch or inside it', () => {
		assert.equal(tcgSeqGap(3, rows(5, 6)), true);
		assert.equal(tcgSeqGap(3, rows(4, 6)), true);
		assert.equal(tcgSeqGap(3, rows(2, 3, 5)), true);
	});

	it('rows without a seq, and a board with nothing applied yet, are never a gap', () => {
		assert.equal(tcgSeqGap(3, [{type: 'draw'}]), false);
		assert.equal(tcgSeqGap(3, undefined), false);
		assert.equal(tcgSeqGap(0, rows(40, 41)), false);
		const r = room();
		r.receive({events: rows(40, 41), seq: 41});
		assert.deepEqual(r.applied, [40, 41]);
		assert.equal(r.requests, 0);
	});

	it('a gapped batch applies none of its rows', () => {
		const r = room();
		r.receive({events: rows(1, 2), seq: 2});
		r.receive({events: rows(3, 4, 6, 7), seq: 7});
		assert.deepEqual(r.applied, [1, 2]);
		assert.equal(r.seen, 2);
		assert.equal(r.requests, 1);
	});

	it('asks once while the resync is pending, and again only after the retry delay', () => {
		const r = room();
		r.receive({events: rows(1, 2), seq: 2});
		r.receive({events: rows(5), seq: 5});
		r.now += 10;
		r.receive({events: rows(6), seq: 6});
		r.receive({events: rows(7, 8), seq: 8});
		assert.equal(r.requests, 1);
		r.now += TCG_RESYNC_RETRY_MS;
		r.receive({events: rows(9), seq: 9});
		assert.equal(r.requests, 2);
	});

	it('the resync snapshot ends the wait, and rows after it apply', () => {
		const r = room();
		r.receive({events: rows(1, 2), seq: 2});
		r.receive({events: rows(5), seq: 5});
		assert.notEqual(r.pendingAt, null);
		r.receive({kind: 'you', resync: true, snapshot: true, seq: 6, events: []});
		assert.equal(r.pendingAt, null);
		assert.equal(r.seen, 6);
		r.receive({events: rows(5, 6), seq: 6});
		r.receive({events: rows(7, 8), seq: 8});
		assert.deepEqual(r.applied, [1, 2, 7, 8]);
		assert.equal(r.requests, 1);
		r.receive({events: rows(11), seq: 11});
		assert.equal(r.requests, 2);
	});

	it('a spectator resync (watch) recovers the same way', () => {
		const r = room();
		r.receive({kind: 'watch', events: rows(1, 2, 3), seq: 3});
		r.receive({kind: 'watch', events: rows(7), seq: 7});
		assert.equal(r.requests, 1);
		r.receive({kind: 'watch', resync: true, snapshot: true, seq: 9, events: []});
		r.receive({kind: 'watch', events: rows(10), seq: 10});
		assert.deepEqual(r.applied, [1, 2, 3, 10]);
		assert.equal(r.pendingAt, null);
	});

	it('a first join mid-game takes its place from the resync snapshot', () => {
		const r = room();
		r.receive({kind: 'watch', resync: true, snapshot: true, seq: 40, events: []});
		assert.equal(r.seen, 40);
		r.receive({kind: 'watch', events: rows(41, 42), seq: 42});
		r.receive({kind: 'watch', events: rows(44), seq: 44});
		assert.deepEqual(r.applied, [41, 42]);
		assert.equal(r.requests, 1);
	});

	it('a snapshot that is not a resync does not end the wait', () => {
		const state = {seen: 2, pendingAt: 500};
		const step = tcgSeqStep(state, {snapshot: true, events: rows(9), seq: 9}, 600);
		assert.equal(step.drop, true);
		assert.equal(step.request, false);
		assert.equal(step.pendingAt, 500);
		assert.deepEqual(tcgSeqStep(fresh(), {resync: true, snapshot: true, seq: 3}, 1).seen, 3);
	});
});

describe('stale snapshots', () => {
	it('a resync board older than what is applied is dropped and ends no wait', () => {
		const state = {seen: 20, pendingAt: 500};
		const step = tcgSeqStep(state, {resync: true, snapshot: true, seq: 12, events: []}, 600);
		assert.equal(step.drop, true);
		assert.equal(step.request, false);
		assert.equal(step.seen, 20, 'the sequence never moves back');
		assert.equal(step.pendingAt, 500, 'the wait goes on');
	});

	it('a resync board at the applied sequence is taken (a login or rename resync)', () => {
		const step = tcgSeqStep({seen: 20, pendingAt: null}, {resync: true, snapshot: true, seq: 20, events: []}, 1);
		assert.equal(step.drop, false);
		assert.equal(step.seen, 20);
	});
});

describe('the room pipeline: gate, then repeats, then the board', () => {
	function battleRoom() {
		const r = {
			tcgSeqSeen: 0, tcgResyncAt: null, tcgReplayMode: false, requests: 0, board: null,
			requestTcgResync() { this.requests++; },
			receive(data, skipFx = false, now = 1000) {
				const gate = tcgSeqGate(this, {
					events: data.events, seq: data.seq, snapshot: !!data.snapshot, resync: !!data.resync,
				}, skipFx, now);
				if (gate.drop) return 'dropped';
				const fresh = tcgFreshEvents(this, data.events, skipFx);
				if (gate.seqAfter > this.tcgSeqSeen) this.tcgSeqSeen = gate.seqAfter;
				this.board = data.snapshot ? data.snapshot : applyTcgEvents(this.board, fresh);
				return 'applied';
			},
		};
		return r;
	}
	const draw = (seq, id) => ({type: 'draw', seq, seat: 0, n: 1, ids: [id]});
	const board = (hand, seq) => ({
		you: 0, status: 'playing', turn: 0, actions: [], appliedSeq: seq,
		players: [{name: 'Red', hand, deck: {count: 10}, discard: [], prizes: {count: 6}}, {name: 'Blue', hand: {count: 5}}],
	});

	it('a missed batch asks once, applies nothing, and the snapshot restores the board', () => {
		const r = battleRoom();
		r.receive({kind: 'you', seq: 2, snapshot: board(['a', 'b'], 2), events: [draw(1, 'a'), draw(2, 'b')]});
		assert.equal(r.tcgSeqSeen, 2);
		assert.equal(r.receive({kind: 'you', seq: 4, events: [draw(4, 'd')]}), 'dropped');
		assert.equal(r.receive({kind: 'you', seq: 5, events: [draw(5, 'e')]}), 'dropped');
		assert.equal(r.requests, 1);
		assert.deepEqual(r.board.players[0].hand, ['a', 'b'], 'the dropped batches changed nothing');
		assert.equal(r.tcgSeqSeen, 2);
		assert.equal(r.receive({kind: 'you', resync: true, seq: 5, events: [], snapshot: board(['a', 'b', 'c', 'd', 'e'], 5)}), 'applied');
		assert.equal(r.tcgResyncAt, null);
		assert.equal(r.tcgSeqSeen, 5);
		assert.deepEqual(r.board.players[0].hand, ['a', 'b', 'c', 'd', 'e']);
		assert.equal(r.receive({kind: 'you', seq: 5, events: [draw(5, 'e')]}), 'applied');
		assert.equal(r.board.players[0].hand.length, 5, 'a repeat adds no card');
		r.receive({kind: 'you', seq: 6, events: [draw(6, 'f')]});
		assert.deepEqual(r.board.players[0].hand, ['a', 'b', 'c', 'd', 'e', 'f']);
		assert.equal(r.requests, 1);
	});

	it('a late, older resync does not move the board or the sequence back', () => {
		const r = battleRoom();
		r.receive({kind: 'you', seq: 2, snapshot: board(['a', 'b'], 2), events: [draw(1, 'a'), draw(2, 'b')]});
		r.receive({kind: 'you', seq: 4, events: [draw(4, 'd')]});
		r.receive({kind: 'you', resync: true, seq: 4, events: [], snapshot: board(['a', 'b', 'c', 'd'], 4)});
		r.receive({kind: 'you', seq: 5, events: [draw(5, 'e')]});
		assert.equal(r.receive({kind: 'you', resync: true, seq: 3, events: [], snapshot: board(['a', 'b', 'c'], 3)}), 'dropped');
		assert.equal(r.tcgSeqSeen, 5);
		assert.deepEqual(r.board.players[0].hand, ['a', 'b', 'c', 'd', 'e']);
	});

	it('does not check replays or silent echoes', () => {
		const r = battleRoom();
		r.receive({kind: 'you', seq: 2, snapshot: board(['a', 'b'], 2), events: [draw(1, 'a'), draw(2, 'b')]});
		assert.equal(r.receive({kind: 'you', seq: 9, events: [draw(9, 'z')]}, true), 'applied');
		r.tcgReplayMode = true;
		assert.equal(r.receive({kind: 'you', seq: 20, events: [draw(20, 'y')]}), 'applied');
		assert.equal(r.requests, 0);
	});

	it('asks again after the retry delay if no board came', () => {
		const r = battleRoom();
		r.receive({kind: 'you', seq: 2, snapshot: board(['a', 'b'], 2), events: [draw(1, 'a'), draw(2, 'b')]});
		r.receive({kind: 'you', seq: 4, events: [draw(4, 'd')]}, false, 1000);
		r.receive({kind: 'you', seq: 5, events: [draw(5, 'e')]}, false, 2000);
		assert.equal(r.requests, 1);
		r.receive({kind: 'you', seq: 6, events: [draw(6, 'f')]}, false, 1000 + TCG_RESYNC_RETRY_MS);
		assert.equal(r.requests, 2);
	});
});

describe('the bounded retry while a resync is unanswered', () => {
	function clock() {
		const c = {now: 0, timers: [], cleared: [], set(fn, ms) {
			const t = {fn, at: c.now + ms, live: true};
			c.timers.push(t);
			return t;
		}, clear(t) { t.live = false; c.cleared.push(t); }};
		c.advance = ms => {
			const target = c.now + ms;
			for (;;) {
				const due = c.timers.filter(t => t.live && t.at <= target).sort((x, y) => x.at - y.at)[0];
				if (!due) break;
				c.now = due.at;
				due.live = false;
				due.fn();
			}
			c.now = target;
		};
		c.fireStale = () => { for (const t of c.cleared) t.fn(); };
		c.active = () => c.timers.filter(t => t.live).length;
		return c;
	}
	function harness(over = {}) {
		const h = {sends: 0, pendingNow: true, aliveNow: true, clock: clock()};
		h.retry = createTcgResyncRetry({
			send() { h.sends++; },
			pending: () => h.pendingNow,
			alive: () => h.aliveNow,
			timers: h.clock,
			...over,
		});
		return h;
	}

	it('asks at once, then every retry delay, and stops after the maximum', () => {
		assert.equal(TCG_RESYNC_MAX_TRIES, 3);
		const h = harness();
		h.retry.request();
		assert.equal(h.sends, 1);
		h.clock.advance(TCG_RESYNC_RETRY_MS - 1);
		assert.equal(h.sends, 1, 'not before the delay');
		h.clock.advance(1);
		assert.equal(h.sends, 2);
		h.clock.advance(TCG_RESYNC_RETRY_MS);
		assert.equal(h.sends, 3);
		h.clock.advance(TCG_RESYNC_RETRY_MS * 10);
		assert.equal(h.sends, 3, 'exhausted: no more');
		assert.equal(h.clock.active(), 0, 'and no timer is left');
		assert.equal(h.retry.running(), false);
	});

	it('the retry delay is longer than the host throttle of one second', () => {
		assert.ok(TCG_RESYNC_RETRY_MS > 1000);
	});

	it('a second request while a cycle runs adds no request and no timer', () => {
		const h = harness();
		h.retry.request();
		h.retry.request();
		h.retry.request();
		assert.equal(h.sends, 1);
		assert.equal(h.clock.active(), 1);
		h.clock.advance(TCG_RESYNC_RETRY_MS);
		assert.equal(h.sends, 2);
		assert.equal(h.clock.active(), 1);
	});

	it('a new request after exhaustion starts one more bounded cycle', () => {
		const h = harness();
		h.retry.request();
		h.clock.advance(TCG_RESYNC_RETRY_MS * 5);
		assert.equal(h.sends, 3);
		h.retry.request();
		assert.equal(h.sends, 4);
		h.clock.advance(TCG_RESYNC_RETRY_MS * 5);
		assert.equal(h.sends, 6, 'three in the second cycle too, never more');
	});

	it('recovery stops the retries: cancelled, and a late timer does nothing', () => {
		const h = harness();
		h.retry.request();
		h.retry.cancel();
		assert.equal(h.clock.active(), 0);
		h.clock.advance(TCG_RESYNC_RETRY_MS * 3);
		h.clock.fireStale();
		assert.equal(h.sends, 1);
		const g = harness();
		g.retry.request();
		g.pendingNow = false;
		g.clock.advance(TCG_RESYNC_RETRY_MS);
		assert.equal(g.sends, 1);
		assert.equal(g.clock.active(), 0);
	});

	it('a room that reset, closed, or lost its connection sends nothing', () => {
		const h = harness();
		h.retry.request();
		h.aliveNow = false;
		h.clock.advance(TCG_RESYNC_RETRY_MS);
		assert.equal(h.sends, 1);
		assert.equal(h.clock.active(), 0);
		const g = harness();
		g.aliveNow = false;
		g.retry.request();
		assert.equal(g.sends, 0);
		assert.equal(g.clock.active(), 0);
	});

	it('a timer from before a reset never asks for the next battle', () => {
		const h = harness();
		h.retry.request();
		h.retry.cancel();
		h.retry.request();
		assert.equal(h.sends, 2);
		h.clock.fireStale();
		assert.equal(h.sends, 2, 'the old timer is dead');
		assert.equal(h.clock.active(), 1, 'only the new battle\'s timer is armed');
		h.clock.advance(TCG_RESYNC_RETRY_MS);
		assert.equal(h.sends, 3);
	});

	it('the gate tells the room when a resync board ends the wait, and not for a stale one', () => {
		const room = {
			tcgSeqSeen: 10, tcgResyncAt: null, tcgReplayMode: false, requests: 0, done: 0,
			requestTcgResync() { this.requests++; },
			tcgResyncDone() { this.done++; },
		};
		tcgSeqGate(room, {events: rows(14), seq: 14}, false, 1000);
		assert.equal(room.requests, 1);
		assert.equal(room.done, 0);
		tcgSeqGate(room, {resync: true, snapshot: true, seq: 6, events: []}, false, 1100);
		assert.equal(room.done, 0);
		assert.notEqual(room.tcgResyncAt, null);
		const g = tcgSeqGate(room, {resync: true, snapshot: true, seq: 14, events: []}, false, 1200);
		assert.equal(g.drop, false);
		assert.equal(room.done, 1);
		assert.equal(room.tcgResyncAt, null);
		tcgSeqGate(room, {events: rows(15), seq: 15}, false, 1300);
		assert.equal(room.done, 1);
	});

	it('the real room flow: gap, lost reply, retries, then recovery cancels', () => {
		const h = harness();
		const room = {
			tcgSeqSeen: 10, tcgResyncAt: null, tcgReplayMode: false,
			requestTcgResync() { h.retry.request(); },
			tcgResyncDone() { h.retry.cancel(); },
		};
		h.pendingNow = false;
		const wait = () => { h.pendingNow = room.tcgResyncAt != null; };
		tcgSeqGate(room, {events: rows(14), seq: 14}, false, h.clock.now);
		wait();
		assert.equal(h.sends, 1);
		h.clock.advance(TCG_RESYNC_RETRY_MS);
		assert.equal(h.sends, 2, 'the reply was lost: asked again with no further traffic');
		tcgSeqGate(room, {resync: true, snapshot: true, seq: 14, events: []}, false, h.clock.now);
		wait();
		assert.equal(h.clock.active(), 0, 'the board came: the retry is gone');
		h.clock.advance(TCG_RESYNC_RETRY_MS * 4);
		assert.equal(h.sends, 2);
	});
});
