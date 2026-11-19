'use strict';


const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {describe, it} = require('node:test');
const vm = require('vm');
const {pathToFileURL} = require('url');

const root = path.resolve(__dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oop-tcg-a1-'));

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
const applied = [];
const realApply = BattlePanel.prototype.applyTcgPayload;
BattlePanel.prototype.applyTcgPayload = function (data) {
	applied.push(data && data.seq);
	return realApply.call(this, data);
};

function seat(name) {
	return {
		id: name.toLowerCase(), name, active: null, bench: [], hand: [],
		deck: {count: 1}, discard: [],
	};
}

function line(name, seq) {
	return ['tcg', JSON.stringify({
		kind: 'you',
		seq,
		snapshot: {
			status: 'playing', you: 0, turn: 0, turnNumber: 1, winner: null, actions: [],
			players: [seat(name), seat('Foe')],
		},
		events: [{type: 'start', seq}],
	})];
}

const MALFORMED = 'Ignored a malformed |tcg| message.';

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
		room.log = {add(args) { room.logLines.push(args.slice()); }};
	}
	return panel;
}

function openRoom(id) {
	const room = new BattleRoom({id});
	const panel = mount(room, {log: true});
	panel.componentDidMount();
	return {room, panel};
}

function walk(node, visit) {
	if (node == null || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const child of node) walk(child, visit);
		return;
	}
	visit(node);
	if (node.props) walk(node.props.children, visit);
}

function textOf(node) {
	const parts = [];
	walk(node, n => {
		const kids = n.props && n.props.children;
		const list = Array.isArray(kids) ? kids : kids == null ? [] : [kids];
		for (const kid of list) {
			if (typeof kid === 'string' || typeof kid === 'number') parts.push(String(kid));
		}
	});
	return parts.join('');
}

function findRole(node, role) {
	let found = null;
	walk(node, n => {
		if (!found && n.props && n.props.role === role) found = n;
	});
	return found;
}

describe('|tcg| parse boundary', () => {
	it('compiles from source and does not load repo bundles', () => {
		assert.equal(compiled.length, 5);
		for (const file of compiled) {
			assert.equal(file.startsWith(outDir), true, file);
			assert.equal(file.includes(repoJs), false, file);
			assert.equal(fs.existsSync(file), true, file);
		}
		assert.match(String(PSRoomPanel.prototype.componentDidMount), /this\.props\.room\.subscribe/);
		assert.match(String(PSStreamModel.prototype.update), /this\.backlog/);
		console.log('test bundles:\n' + compiled.join('\n'));
	});

	it('applies the valid lines around a malformed |tcg| line and reports it', () => {
		const {room} = openRoom('battle-tcg-parse');
		room.receiveBatch([
			line('One', 1),
			['tcg', '{'],
			line('Two', 2),
			['title', 'Table'],
		]);
		assert.equal(room.tcgSnapshot.players[0].name, 'Two');
		assert.equal(room.tcgSeqSeen, 2);
		assert.equal(room.title, 'Table');
		assert.deepEqual(room.logLines, [['error', MALFORMED]]);
		assert.equal(room.tcgNotice, '');
	});

	it('applies a valid |tcg| line that follows a malformed first line', () => {
		const {room} = openRoom('battle-tcg-parse-first');
		room.receiveBatch([
			['tcg', 'not-json'],
			line('Only', 1),
		]);
		assert.equal(room.tcgSnapshot.players[0].name, 'Only');
		assert.equal(room.tcgSeqSeen, 1);
		assert.deepEqual(room.logLines, [['error', MALFORMED]]);
	});

	it('drains the backlog once, then applies later lines once through the subscription', () => {
		applied.length = 0;
		const room = new BattleRoom({id: 'battle-tcg-lifecycle'});
		assert.equal(room.subscriptions.length, 0);
		room.receiveBatch([
			line('One', 1),
			['tcg', '{'],
			line('Two', 2),
		]);
		assert.deepEqual(applied, []);
		assert.equal(room.tcgSnapshot, null);
		assert.equal(room.backlog.length, 3);

		const panel = mount(room, {log: false});
		const paints = [];
		panel.forceUpdate = () => { paints.push('paint'); };
		panel.componentDidMount();

		assert.deepEqual(applied, [1, 2]);
		assert.equal(room.backlog, null);
		assert.equal(room.subscriptions.length, 1);
		assert.equal(room.tcgSnapshot.players[0].name, 'Two');
		assert.equal(room.tcgSeqSeen, 2);
		assert.equal(room.tcgNotice, MALFORMED);
		assert.equal(room.log, undefined);
		assert.deepEqual(paints, ['paint']);

		room.receiveBatch([line('Three', 3)]);
		assert.deepEqual(applied, [1, 2, 3]);
		assert.equal(room.tcgSnapshot.players[0].name, 'Three');
		assert.equal(room.tcgSeqSeen, 3);
		assert.equal(room.subscriptions.length, 1);

		const boardNode = (() => {
			let found = null;
			walk(panel.render(), n => {
				if (!found && n.type === TcgBoard) found = n;
			});
			return found;
		})();
		assert.ok(boardNode, 'mounted board');
		assert.equal(boardNode.props.notice, MALFORMED);
		const board = new TcgBoard(boardNode.props);
		board.componentDidMount();
		assert.equal(board.state.refuse.text, MALFORMED);
		const status = findRole(board.render(), 'status');
		assert.ok(status, 'board status');
		assert.equal(textOf(status), MALFORMED);
	});

	it('shows a malformed pre-log message when no board exists yet', () => {
		const room = new BattleRoom({id: 'battle-tcg-notice'});
		room.receiveBatch([['tcg', '{"seq":']]);
		const panel = mount(room, {log: false});
		let painted = 0;
		panel.forceUpdate = () => { painted++; };
		panel.componentDidMount();
		assert.equal(room.tcgSnapshot, null);
		assert.equal(room.tcgNotice, MALFORMED);
		assert.equal(room.log, undefined);
		assert.equal(painted, 1);
		const status = findRole(panel.render(), 'status');
		assert.ok(status, 'panel status');
		assert.equal(textOf(status), MALFORMED);
		assert.equal(textOf(panel.render()).includes('Shuffling'), false);
	});

	it('does not report an applyTcgPayload throw as malformed JSON', () => {
		const {room, panel} = openRoom('battle-tcg-parse-apply');
		panel.applyTcgPayload = () => { throw new Error('apply failed'); };
		assert.throws(
			() => panel.receiveTcgLine(['tcg', '{"seq":1}']),
			err => err instanceof Error && err.message === 'apply failed'
		);
		assert.deepEqual(room.logLines, []);
		assert.equal(room.tcgNotice, '');
		assert.equal(room.tcgSeqSeen, 0);
	});

	it('does not change the last snapshot or sequence when the JSON is malformed', () => {
		const {room} = openRoom('battle-tcg-parse-state');
		room.receiveBatch([line('Kept', 1)]);
		const snapshot = room.tcgSnapshot;
		const seen = room.tcgSeqSeen;
		room.receiveBatch([['tcg', '{']]);
		assert.equal(room.tcgSnapshot, snapshot);
		assert.equal(room.tcgSeqSeen, seen);
		assert.equal(snapshot.players[0].name, 'Kept');
	});

	it('still buffers a non-TCG battle that has no Battle object yet', () => {
		const room = new BattleRoom({id: 'battle-gen9-1'});
		assert.equal(room.tcgMode, false);
		room.receiveBatch([['player', 'p1', 'Red']]);
		assert.deepEqual(room.pendingLines, [['player', 'p1', 'Red']]);
		assert.equal(room.tcgMode, false);
		assert.equal(room.tcgSnapshot, null);
		assert.deepEqual(room.backlog, []);
	});

	it('does not enter TCG mode because a request body contains "tcg":true as text', () => {
		const room = new BattleRoom({id: 'battle-gen9ou-1'});
		const nested = JSON.stringify({requestType: 'move', side: {name: 'Red', tcg: true}});
		const loose = '{"requestType":"move"} "tcg":true';
		assert.equal(nested.includes('"tcg":true'), true);
		assert.equal(loose.includes('"tcg":true'), true);
		room.receiveBatch([
			['request', nested],
			['request', loose],
			['player', 'p1', 'Red'],
		]);
		assert.equal(room.tcgMode, false);
		assert.equal(room.tcgSnapshot, null);
		assert.equal(room.pendingLines.length, 3);
		assert.deepEqual(room.backlog, []);
	});

	it('still enters TCG mode for a parsed host request with tcg true', () => {
		const room = new BattleRoom({id: 'battle-gen9-side'});
		const body = JSON.stringify({tcg: true, wait: true, turn: 1});
		room.receiveBatch([['request', body]]);
		assert.equal(room.tcgMode, true);
		assert.deepEqual(room.pendingLines, []);
		assert.equal(room.backlog.length, 1);
		assert.equal(room.backlog[0][0], 'request');
	});
});
