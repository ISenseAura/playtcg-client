'use strict';
// Replays of an ended TCG battle, opened as each kind of viewer from the same recorded game.
//
// Reported (Smogon, "[Replays] Can't interact with replay in the account that played it"): logged in as a player of the
// battle, none of the replay buttons did anything, though the same link worked logged out; and for everyone, Next turn
// after Replay jumped to the end, Prev turn went to the second-to-last turn, and the button never offered Play again.
//
// A seat holder's client drops the public room log (its board comes from private payloads), and on reopening an ended
// battle the server sends a seat one resync board. So its replay held two payloads. And while a replay animated, the
// scrub position stayed "at the end".
//
// The fixture was recorded by playing a game through the host's TcgBattleStream: the public room log every joiner gets,
// then each viewer's resync after the end. Only the account changes between the cases below.


const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {describe, it} = require('node:test');
const vm = require('vm');
const {pathToFileURL} = require('url');

const root = path.resolve(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oop-tcg-replay-'));

const loc = {
	protocol: 'https:',
	host: 'localhost',
	hostname: 'localhost',
	origin: 'https://localhost',
	pathname: '/Battle Room',
	hash: '',
	href: 'https://localhost/Battle%20Room',
};
global.window = global;
global.location = loc;
global.innerWidth = 900;
global.innerHeight = 700;
global.addEventListener = function () {};
global.removeEventListener = function () {};
global.preact = {
	Component: function Component(props) { this.props = props || {}; },
	h(type, props, ...children) {
		props = props ? Object.assign({}, props) : {};
		if (props.children == null && children.length) {
			props.children = children.length === 1 ? children[0] : children;
		}
		return {type, props};
	},
	render() {},
	Fragment: function Fragment() {},
};
global.preact.Component.prototype.setState = function (update) {
	const patch = typeof update === 'function' ? update(this.state, this.props) : update;
	this.state = Object.assign({}, this.state, patch || {});
};
global.preact.Component.prototype.forceUpdate = function () {};
global.PS = {
	prefs: {noanim: true},
	user: {userid: 'guest', named: false},
	rooms: {},
	server: {id: 'localhost'},
	pendingFocus: null,
	leftPanelWidth: 0,
	addRoomType() {},
	update() {},
	isVisible() { return true; },
	subscribe() { return {unsubscribe() {}}; },
	join() {},
	chooseBattleLayout() {
		return {layout: 'left-right', battleHeight: 360, battleWidth: 640, overlayControls: false};
	},
};
global.toID = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
global.TL = (strings, ...vals) => {
	if (typeof strings === 'string') return strings;
	return strings.reduce((out, part, i) => out + part + (i < vals.length ? vals[i] : ''), '');
};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.Config = {routes: {client: 'play.pokemonshowdown.com'}};
global.localStorage = {getItem() { return null; }, setItem() {}, removeItem() {}};
global.document = {
	location: loc,
	cookie: '',
	title: '',
	body: {classList: {toggle() {}}, style: {}},
	head: {appendChild() {}},
	querySelector() { return null; },
	querySelectorAll() { return []; },
	getElementById() { return null; },
	createElement() { return {}; },
};
global.lookupAttackHit = function () { return null; };
global.getTcgCard = function () { return undefined; };
global.BattleLog = function () {};
global.BattleTextParser = {parseNameParts() { return {name: '', group: ''}; }, ui() { return ''; }};
global.Dex = {};
global.Battle = function () {};
global.PSPanelWrapper = function (props) { return props && props.children; };
global.ChatLog = function () { return null; };
global.ChatTextEntry = function () { return null; };
global.ChatUserList = function () { return null; };
global.PSIcon = function () { return null; };

function compileFromSource() {
	const script = path.join(outDir, 'compile.mjs');
	const compilerURL = pathToFileURL(path.join(root, 'build-tools', 'compiler.mjs')).href;
	const babelrc = path.join(root, '.babelrc');
	const src = name => path.join(root, 'play.pokemonshowdown.com', 'src', name).replace(/\\/g, '/');
	const jobs = [
		[src('client-core.ts'), 'client-core.js'],
		[src('panels.tsx'), 'panels.js'],
		[src('battle-tcg-choice.ts'), 'battle-tcg-choice.js'],
		[[
			src('battle-tcg-types.ts'),
			src('battle-tcg-protocol.ts'),
			src('battle-tcg-hand.ts'),
			src('battle-tcg-reducer.ts'),
			src('battle-tcg-flights.ts'),
			src('battle-tcg-log.ts'),
			src('battle-tcg-fx.tsx'),
			src('battle-tcg-cards.tsx'),
			src('battle-tcg.tsx'),
		], 'battle-tcg.js'],
		[src('panel-battle.tsx'), 'panel-battle.js'],
	];
	fs.writeFileSync(script, `
import fs from 'node:fs';
import * as compiler from ${JSON.stringify(compilerURL)};
const opts = eval('(' + fs.readFileSync(${JSON.stringify(babelrc)}, 'utf8') + ')');
delete opts.ignore;
opts.sourceMaps = false;
const jobs = ${JSON.stringify(jobs)};
const outDir = ${JSON.stringify(outDir)};
for (const [input, name] of jobs) {
  const n = await compiler.compileToFile(input, outDir + '/' + name, opts);
  if (!n) throw new Error('compiled nothing for ' + name);
}
console.log('compiled ' + jobs.length + ' test bundles into ' + outDir);
`);
	const result = spawnSync(process.execPath, [script], {
		cwd: root,
		encoding: 'utf8',
	});
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || 'test compile failed');
	}
	return jobs.map(([, name]) => path.join(outDir, name));
}

const compiled = compileFromSource();
const repoJs = path.join(root, 'play.pokemonshowdown.com', 'js') + path.sep;

function load(file) {
	if (file.startsWith(repoJs) || file.includes(`${path.sep}play.pokemonshowdown.com${path.sep}js${path.sep}`)) {
		throw new Error(`refusing to load a repo bundle: ${file}`);
	}
	vm.runInThisContext(fs.readFileSync(file, 'utf8'), {filename: file});
}

load(path.join(outDir, 'client-core.js'));

function PSRoom(options) {
	PSStreamModel.call(this);
	this.id = options && options.id || '';
	this.title = options && options.title || '';
	this.notifications = [];
	this.connected = false;
	this.location = 'left';
	this.parentElem = null;
	this.width = 0;
	this.height = 0;
}
PSRoom.prototype = Object.create(PSStreamModel.prototype);
PSRoom.prototype.constructor = PSRoom;
PSRoom.prototype.receiveLine = function () {};
PSRoom.prototype.handleLine = function (args) {
	if (args[0] === 'title') {
		this.title = args[1];
		PS.update();
		return true;
	}
	return false;
};
PSRoom.prototype.notify = function () {};
PSRoom.prototype.dismissNotification = function () {};
PSRoom.prototype.send = function () {};
PSRoom.prototype.sendDirect = function () {};
global.PSRoom = PSRoom;

function ChatRoom(options) { PSRoom.call(this, options); }
ChatRoom.prototype = Object.create(PSRoom.prototype);
ChatRoom.prototype.constructor = ChatRoom;
global.ChatRoom = ChatRoom;

{
	const panelsFile = path.join(outDir, 'panels.js');
	const panelsSrc = fs.readFileSync(panelsFile, 'utf8');
	const helpersEnd = panelsSrc.indexOf('/**');
	let start = panelsSrc.indexOf('PSRoomPanel=function');
	if (start > 0 && panelsSrc.slice(Math.max(0, start - 16), start).trimEnd().endsWith('var')) {
		start = panelsSrc.lastIndexOf('var', start);
	}
	const marker = '}(preact.Component);';
	const end = start < 0 ? -1 : panelsSrc.indexOf(marker, start);
	if (helpersEnd < 0 || start < 0 || end < 0) {
		throw new Error('compiled panels.js has no PSRoomPanel');
	}
	vm.runInThisContext(
		panelsSrc.slice(0, helpersEnd) + '\n' + panelsSrc.slice(start, end + marker.length),
		{filename: panelsFile}
	);
}
load(path.join(outDir, 'battle-tcg-choice.js'));
load(path.join(outDir, 'battle-tcg.js'));
load(path.join(outDir, 'panel-battle.js'));

const {BattleRoom, BattlePanel, TcgBoard} = global;
function mount(room, options) {
	const log = !options || options.log !== false;
	room.width = 900;
	room.height = 700;
	const panel = new BattlePanel({room});
	panel.base = {
		offsetWidth: 900,
		offsetHeight: 700,
		querySelector(sel) {
			return log && sel === '.battle-log' ? {nodeType: 1} : null;
		},
	};
	if (log) {
		room.logLines = [];
		room.log = {add(args) { room.logLines.push(args.slice()); }, reset() { room.logLines = []; }};
	}
	return panel;
}


const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'battle-tcg-replay-viewer.fixtures.json'), 'utf8'));

/** One protocol line as the room receives it: `|tcg|` and `|request|` keep their JSON whole. */
function args(line) {
	const m = /^\|([^|]*)\|?([\s\S]*)$/.exec(line);
	if (!m) return ['', line];
	if (m[1] === 'tcg' || m[1] === 'request') return [m[1], m[2]];
	return [m[1], ...m[2].split('|')];
}

const VIEWERS = {
	'player one (Alice)': {user: {userid: 'alice', name: 'Alice', named: true}, resync: 'p1'},
	'player two (Bob)': {user: {userid: 'bob', name: 'Bob', named: true}, resync: 'p2'},
	'another account (Carol)': {user: {userid: 'carol', name: 'Carol', named: true}, resync: 'spectator'},
	'a logged-out visitor': {user: {userid: 'guest4821', name: 'Guest 4821', named: false}, resync: 'spectator'},
};

/** Open the ended battle as `viewer`: the room log, then the resync the server sends that account. */
function open(viewer, id = 'battle-tcgstandard-2504') {
	PS.user = VIEWERS[viewer].user;
	PS.prefs.noanim = true;
	const room = new BattleRoom({id});
	const panel = mount(room, {log: true});
	panel.componentDidMount();
	room.receiveBatch([['init', 'battle'], ['title', 'Alice vs. Bob'], ...FIX.roomLog.map(args)]);
	room.receiveBatch(FIX.resync[VIEWERS[viewer].resync].map(args));
	return {room, panel};
}

/** The turn the board is on, the turn the log has reached, and whether this is the end of the replay. */
function at(room) {
	const heads = room.logLines.map(l => /Turn (\d+)/.exec(l.join('|'))).filter(Boolean);
	return {
		board: room.tcgSnapshot.turnNumber,
		log: heads.length ? Number(heads[heads.length - 1][1]) : 0,
		end: room.tcgSeekIndex < 0 && !room.tcgQueue.length,
	};
}
const turn = room => at(room).board;

/** The replay bar's buttons, by label, as `{cmd, off}`. */
function bar(panel) {
	const out = {};
	const visit = node => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(visit);
		if (node.props && node.props['data-cmd']) {
			out[node.props['aria-label']] = {cmd: node.props['data-cmd'], off: /\bdisabled\b/.test(node.props.class || '')};
		}
		visit(node.props && node.props.children);
	};
	visit(panel.renderTcgReplayBar());
	return out;
}

/** Animate a replay the way the board does: each beat ends with `onTcgFxDone`. */
function beats(room, n) {
	for (let i = 0; i < n && room.tcgQueue.length; i++) room.onTcgFxDone();
}
function animated(room) {
	PS.prefs.noanim = false;
	return room;
}

describe('a finished battle replays the same for every viewer', () => {
	for (const viewer of Object.keys(VIEWERS)) {
		describe(viewer, () => {
			it('steps through every turn, forward and back, with the board and the log on the same turn', () => {
				const {room} = open(viewer);
				room.fftoTcg(0);
				const seen = [at(room)];
				for (let i = 0; i < FIX.turns; i++) {
					room.fftoTcg('+1');
					seen.push(at(room));
				}
				assert.deepEqual(seen.map(s => s.board), [1, 2, 3, 4, 5, 5], 'First turn, then Next to the end');
				// The recorded game starts on turn 1 with no turn row, so the log names turns from turn 2.
				assert.deepEqual(seen.slice(1).map(s => s.log), seen.slice(1).map(s => s.board), 'the log is on the board\'s turn');
				assert.equal(seen[seen.length - 1].end, true, 'and the last step is the end');
				room.fftoTcg('-1');
				assert.equal(turn(room), 4, 'Prev turn from the end is the turn before the last');
				room.fftoTcg('-1');
				assert.equal(turn(room), 3);
				room.fftoTcg('end');
				assert.deepEqual([room.tcgSnapshot.status, room.tcgWinner], ['over', FIX.winner], 'Last turn is the result');
			});

			it('Replay plays from the start, and Next and Prev during playback move one turn', () => {
				const {room} = open(viewer);
				room.fftoTcg('end');
				animated(room).playTcgReplay();
				assert.equal(room.tcgAnimating(), true, 'it plays');
				beats(room, 1);
				assert.equal(turn(room), 2, 'the opening board, then the first beat: turn 2');
				room.fftoTcg('+1');
				assert.equal(turn(room), 3, 'Next turn goes to turn 3, not to the end');
				animated(room).playTcgReplay();
				beats(room, 1);
				room.fftoTcg('-1');
				assert.equal(turn(room), 3, 'Prev turn goes back one, not to the second-to-last turn');
			});

			it('the button says Replay at the end, Play on an earlier turn, Pause while playing', () => {
				const {room, panel} = open(viewer);
				room.fftoTcg('end');
				assert.deepEqual(Object.keys(bar(panel)).slice(0, 1), ['Replay']);
				assert.equal(bar(panel)['Next turn'].off, true, 'at the end, Next is unavailable');
				room.fftoTcg('-1');
				assert.deepEqual(bar(panel).Play, {cmd: '/play', off: false}, 'an earlier turn offers Play');
				assert.equal(bar(panel)['Next turn'].off, false);
				animated(room).playTcgReplay();
				assert.deepEqual(bar(panel).Pause, {cmd: '/pause', off: false});
			});

			it('Play continues from the turn on screen, and Pause keeps the rest for the next Play', () => {
				const {room} = open(viewer);
				room.fftoTcg(2);
				animated(room).playTcgReplay();
				beats(room, 1);
				assert.equal(turn(room), 3, 'from turn 2 the next beat is turn 3, not turn 1');
				room.tcgPaused = true;
				beats(room, 1);
				const stopped = turn(room);
				const left = room.tcgQueue.length;
				assert.ok(left > 0, 'beats are left while paused');
				room.playTcgReplay();
				assert.equal(room.tcgQueue.length, left, 'Play resumes without starting again');
				beats(room, left);
				assert.ok(stopped < 5);
				assert.deepEqual([at(room).end, room.tcgSnapshot.status], [true, 'over'], 'and reaches the end');
			});

			it('a downloaded replay has the whole game', () => {
				const {room} = open(viewer);
				const saved = JSON.parse(room.buildTcgReplayDownload().slice('|tcgreplay|'.length));
				const turns = saved.replay.events.filter(ev => ev.type === 'turn').map(ev => ev.number);
				assert.deepEqual(turns, [2, 3, 4, 5]);
				assert.equal(saved.winner, FIX.winner);
			});
		});
	}

	it('every viewer reaches the same boards at the same turns', () => {
		const boards = Object.keys(VIEWERS).map(viewer => {
			const {room} = open(viewer);
			room.fftoTcg(0);
			const out = [];
			for (let i = 0; i <= FIX.turns; i++) {
				const s = room.tcgSnapshot;
				out.push(JSON.stringify([s.turnNumber, s.players.map(p => [p.active && p.active.cardId, p.active && p.active.hp, (p.prizes || {}).count])]));
				room.fftoTcg('+1');
			}
			return out;
		});
		for (const b of boards) assert.deepEqual(b, boards[0]);
	});
});

describe('replay lifecycle', () => {
	it('reopening the battle (a refresh) gives a working replay again', () => {
		open('player one (Alice)').room.fftoTcg(2);
		const {room} = open('player one (Alice)');
		room.fftoTcg(0);
		room.fftoTcg('+1');
		assert.equal(turn(room), 2);
	});

	it('two open replays do not move each other', () => {
		const a = open('player one (Alice)', 'battle-tcgstandard-2504').room;
		const b = open('player two (Bob)', 'battle-tcgstandard-2505').room;
		a.fftoTcg(2);
		b.fftoTcg(4);
		assert.deepEqual([turn(a), turn(b)], [2, 4]);
		b.fftoTcg('end');
		assert.equal(turn(a), 2);
	});

	it('a player who watched the whole game keeps the replay of their own view', () => {
		const {room} = open('player one (Alice)');
		const full = room.tcgPublicHistory.map(item => ({...item, snapshot: item.snapshot && {...item.snapshot, you: 0}}));
		room.tcgHistory = full;
		room.useTcgPublicReplay();
		assert.equal(room.tcgHistory, full, 'a private history that covers the game is not replaced');
	});

	it('the saved game is not changed by playing it', () => {
		const {room} = open('player one (Alice)');
		room.fftoTcg(0);
		const before = JSON.stringify(room.tcgHistory);
		room.fftoTcg(3);
		animated(room).playTcgReplay();
		beats(room, 99);
		room.fftoTcg(1);
		assert.equal(JSON.stringify(room.tcgHistory), before);
	});
});
