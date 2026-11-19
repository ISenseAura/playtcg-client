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
	Fragment: function () {},
};
global.PS = {prefs: {}, user: {}, rooms: {}, addRoomType() {}};
global.toID = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.Config = {routes: {client: 'play', replays: 'replay'}};
global.document = {querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }};
global.lookupAttackHit = function () { return null; };
global.getTcgCard = function () { return undefined; };
global.ChatRoom = function ChatRoom() {};
global.PSRoom = function PSRoom() {};
global.PSRoomPanel = function PSRoomPanel() {};
global.Battle = function Battle() {};
global.Dex = {};

function load(file) {
	const p = path.resolve(__dirname, '../play.pokemonshowdown.com/js', file);
	vm.runInThisContext(fs.readFileSync(p, 'utf8'), {filename: p});
}
load('battle-tcg-choice.js');
load('battle-tcg.js');
load('panel-battle.js');

const {TcgBoard, applyTcgEvents} = global;

function seat(name, patch) {
	return Object.assign({
		id: name.toLowerCase(),
		name,
		active: null,
		bench: [],
		hand: [],
		deck: {count: 20},
		discard: [],
		prizes: {count: 6},
		lostZone: {count: 0},
		setup: 'done',
	}, patch);
}

function snap(format, players, patch) {
	return Object.assign({
		status: 'playing',
		turn: 0,
		turnNumber: 2,
		you: 0,
		winner: null,
		actions: [],
		players,
		format,
	}, patch);
}

function board(snapshot, extra) {
	const b = new TcgBoard();
	b.props = {
		snapshot, fxSnapshot: null, events: [], onEvent() {}, onAct() {},
		fxKey: 1, waiting: false, ended: false, ...extra,
	};
	b.state = {...b.state, fx: null, koHide: {}};
	b.setState = patch => Object.assign(b.state, typeof patch === 'function' ? patch(b.state) : patch);
	return b;
}

function all(node, test, out = []) {
	if (!node || typeof node !== 'object') return out;
	if (test(node)) out.push(node);
	(node.children || []).forEach(c => all(c, test, out));
	return out;
}
const classOf = n => String((n.props && n.props.class) || '');
const byClass = (tree, cls) => all(tree, n => classOf(n).split(' ').includes(cls));
const named = (tree, name) => all(tree, n => n.type && n.type.name === name);

function painted(node) {
	const render = node && node.type && node.type.prototype && node.type.prototype.render;
	if (!render) return node;
	return render.call({props: node.props});
}

const pocketFormat = {id: 'pocket', benchSize: 3, prizes: 3, energyZone: true};
const standardFormat = {id: 'standard', benchSize: 5, prizes: 6};

describe('resolved rules on the board', () => {
	it('paints a Pocket bench, three points, and the current Energy type', () => {
		const snapshot = snap(pocketFormat, [
			seat('Alice', {
				prizes: {count: 3},
				energyZone: {type: 'fire', ready: true, types: ['fire', 'lightning']},
			}),
			seat('Bob', {prizes: {count: 3}, energyZone: {type: 'water', ready: false}}),
		]);
		const tree = board(snapshot).render();
		assert.ok(classOf(byClass(tree, 'tcg-table')[0]).includes('pocket'));
		for (const side of ['me', 'foe']) {
			const bench = byClass(tree, 'tcg-bench').find(n => classOf(n).includes(side));
			assert.equal(bench.children.length, 3, side);
		}
		const points = named(tree, 'TcgPoints');
		assert.equal(points.length, 2);
		assert.deepEqual(points.map(n => n.props.need), [3, 3]);
		assert.equal(named(tree, 'TcgPrizeRail').length, 0);
		const chips = points.map(painted);
		assert.equal(byClass(chips[0], 'tcg-point').length, 3);
		const now = byClass(tree, 'tcg-ezone-now');
		assert.equal(now.length, 1);
		assert.equal(all(now[0], n => n.type === 'img')[0].props.src, '/fx/tcg/energy-symbols/fire.png');
		assert.equal(byClass(tree, 'tcg-ezone-next').length, 0);
		assert.equal(JSON.stringify(now).includes('lightning'), false);
	});

	it('paints a Standard bench of five and six prizes, with no Energy Zone', () => {
		const snapshot = snap(standardFormat, [
			seat('Alice', {bench: [{iid: 'm1', name: 'Bulbasaur'}]}),
			seat('Bob'),
		]);
		const tree = board(snapshot).render();
		assert.ok(classOf(byClass(tree, 'tcg-table')[0]).includes('live'));
		assert.equal(classOf(byClass(tree, 'tcg-table')[0]).includes('pocket'), false);
		for (const side of ['me', 'foe']) {
			const bench = byClass(tree, 'tcg-bench').find(n => classOf(n).includes(side));
			assert.equal(bench.children.length, 5, side);
		}
		const rails = named(tree, 'TcgPrizeRail');
		assert.equal(rails.length, 2);
		assert.deepEqual(rails.map(n => n.props.max), [6, 6]);
		assert.equal(named(tree, 'TcgPoints').length, 0);
		assert.equal(byClass(tree, 'tcg-ezone').length, 0);
		const slots = rails.map(n => byClass(painted(n), 'tcg-prize').length);
		assert.deepEqual(slots, [6, 6]);
	});

	it('follows energyZone events for the current type and the next type', () => {
		let snapshot = snap(pocketFormat, [
			seat('Alice', {
				energyZone: {type: 'grass', ready: false, types: ['fire', 'lightning']},
			}),
			seat('Bob', {energyZone: {type: 'water'}}),
		]);
		let tree = board(snapshot).render();
		assert.equal(all(byClass(tree, 'tcg-ezone-now')[0], n => n.type === 'img')[0].props.src, '/fx/tcg/energy-symbols/grass.png');
		assert.ok(classOf(byClass(tree, 'tcg-ezone')[0]).includes('off'));

		snapshot = applyTcgEvents(snapshot, [{
			type: 'energyZone', seq: 1, seat: 0,
			energyType: 'fire', next: 'lightning', ready: true,
			types: ['fire', 'lightning'],
		}]);
		assert.equal(snapshot.players[0].energyZone.type, 'fire');
		assert.equal(snapshot.players[0].energyZone.next, 'lightning');
		assert.equal(snapshot.players[0].energyZone.ready, true);
		assert.equal(snapshot.players[0].energyZone.types, undefined);
		tree = board(snapshot).render();
		assert.equal(all(byClass(tree, 'tcg-ezone-now')[0], n => n.type === 'img')[0].props.src, '/fx/tcg/energy-symbols/fire.png');
		assert.equal(all(byClass(tree, 'tcg-ezone-next')[0], n => n.type === 'img')[0].props.src, '/fx/tcg/energy-symbols/lightning.png');
		assert.equal(byClass(tree, 'tcg-ezone-now').length, 1);
		assert.ok(classOf(byClass(tree, 'tcg-ezone')[0]).includes('off'));

		snapshot = {...snapshot, actions: [{type: 'attachZone'}]};
		tree = board(snapshot).render();
		assert.ok(classOf(byClass(tree, 'tcg-ezone')[0]).includes('ready'));
		assert.equal(all(byClass(tree, 'tcg-ezone-now')[0], n => n.type === 'img')[0].props.src, '/fx/tcg/energy-symbols/fire.png');
	});

	it('keeps the old fallbacks when format fields are missing', () => {
		const bare = snap(undefined, [seat('Alice'), seat('Bob')]);
		delete bare.format;
		let tree = board(bare).render();
		assert.equal(byClass(tree, 'tcg-bench')[0].children.length, 3);
		assert.deepEqual(named(tree, 'TcgPrizeRail').map(n => n.props.max), [6, 6]);

		const noBench = snap({id: 'standard', prizes: 6}, [
			seat('Alice', {bench: [{iid: 'm1'}]}),
			seat('Bob', {bench: [{iid: 'm2'}, {iid: 'm3'}]}),
		]);
		tree = board(noBench).render();
		assert.equal(byClass(tree, 'tcg-bench')[0].children.length, 3);
		assert.deepEqual(named(tree, 'TcgPrizeRail').map(n => n.props.max), [6, 6]);

		const noPrizes = snap({id: 'pocket', benchSize: 3, energyZone: true}, [
			seat('Alice', {energyZone: {type: 'grass'}}),
			seat('Bob', {energyZone: {type: 'fire'}}),
		]);
		tree = board(noPrizes).render();
		assert.equal(byClass(tree, 'tcg-bench')[0].children.length, 3);
		assert.deepEqual(named(tree, 'TcgPoints').map(n => n.props.need), [3, 3]);

		const legacy = snap({
			id: 'standard', name: 'Standard', kind: 'constructed',
			deckSize: 60, copyLimit: 4, prizes: 6, benchSize: 5,
		}, [seat('Alice'), seat('Bob')]);
		tree = board(legacy).render();
		assert.equal(byClass(tree, 'tcg-bench')[0].children.length, 5);
		assert.deepEqual(named(tree, 'TcgPrizeRail').map(n => n.props.max), [6, 6]);
		assert.equal(byClass(tree, 'tcg-ezone').length, 0);
	});

	it('ends the game from a public replay and ignores manifestId', () => {
		const snapshot = snap(pocketFormat, [
			seat('Alice', {energyZone: {type: 'grass'}}),
			seat('Bob', {energyZone: {type: 'fire'}}),
		]);
		const ended = applyTcgEvents(snapshot, [{
			type: 'gameEnd', seq: 4,
			result: {winner: 1, reason: 'Bob won.'},
			replay: {
				audience: 'public',
				manifestId: 'digest-not-a-format',
				formatId: 'pocket',
				spectator: {snapshot, events: []},
			},
		}]);
		assert.equal(ended.status, 'over');
		assert.equal(ended.winner, 1);
		assert.equal(ended.winReason, 'Bob won.');
		assert.equal(ended.format.id, 'pocket');
		assert.equal(ended.format.benchSize, 3);
		assert.equal(ended.manifestId, undefined);
		const tree = board(ended, {ended: true}).render();
		const banner = byClass(tree, 'tcg-win-banner')[0];
		assert.equal(JSON.stringify(banner).includes('Bob'), true);
		assert.equal(JSON.stringify(banner).includes('digest-not-a-format'), false);
		assert.equal(byClass(tree, 'tcg-bench')[0].children.length, 3);
	});
});

describe('host format id on the room', () => {
	it('challenges the room id, not snapshot.format.id', () => {
		const snapshot = snap(pocketFormat, [seat('Alice'), seat('Bob')], {status: 'over', winner: 1});
		const room = Object.create(BattleRoom.prototype);
		Object.assign(room, {
			id: 'battle-tcgpocketrandom-4',
			tcgEnded: true,
			tcgReplayMode: false,
			tcgAborted: false,
			tcgSide: 0,
			tcgSeekIndex: -1,
			tcgQueue: [],
			tcgHistory: [{snapshot, events: [{type: 'start', seq: 1}]}],
			tcgSnapshot: snapshot,
			tcgP1: {id: 'alice', name: 'Alice'},
			tcgP2: {id: 'bob', name: 'Bob'},
			tcgWinner: 'Bob',
			tcgPaused: false,
			tcgPlaying: false,
		});
		assert.equal(room.tcgFormatId(), 'tcgpocketrandom');
		const panel = Object.create(BattlePanel.prototype);
		panel.props = {room};
		const tree = panel.renderTcgControls();
		const rematch = all(tree, n => n.props && typeof n.props['data-cmd'] === 'string' && n.props['data-cmd'].includes('/challenge'))[0];
		assert.equal(rematch.props['data-cmd'], '/closeand /challenge bob,tcgpocketrandom');
		const log = JSON.parse(room.buildTcgReplayDownload().slice('|tcgreplay|'.length));
		assert.equal(log.format, 'tcgpocketrandom');
		assert.equal(log.replay.snapshot.format.id, 'pocket');
	});
});
