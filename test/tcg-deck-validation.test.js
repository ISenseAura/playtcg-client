'use strict';


const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it, beforeEach} = require('node:test');
const vm = require('vm');

global.window = global;
global.window.addEventListener = function () {};
global.window.removeEventListener = function () {};
global.toID = function (text) {
	return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
};
function h(type, props, ...children) {
	return {type, props: props || {}, children: children.flat(Infinity)};
}
global.preact = {
	Component: function (props) {
		this.props = props || {};
		this.state = {};
	},
	Fragment: 'fragment',
	h,
	render() {},
};
global.preact.Component.prototype.forceUpdate = function () {};
global.preact.Component.prototype.setState = function (partial) {
	this.state = Object.assign({}, this.state, partial);
};
global.PS = {
	send() {},
	alerts: [],
	alert(text) { this.alerts.push(text); },
	teams: {byKey: {}},
};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};

const webRoot = path.resolve(__dirname, '../play.pokemonshowdown.com/js');
for (const name of ['battle-tcg-deck.js', 'panel-tcg-deck.js']) {
	const file = path.join(webRoot, name);
	vm.runInThisContext(fs.readFileSync(file, 'utf8'), {filename: file});
}

const {
	tcgDeckCatalog, tcgDeckFormatOf, deckProblemsClient, cardLegalInFormat, unpackTcgDeck, packTcgDeck,
	requestTcgValidate, receiveTcgValidate, cancelTcgValidate, tcgHostDeckDecision, TcgDeckEditor,
	TCG_AMBIGUOUS_VALIDATION_ERROR, resetTcgFormatMetadata, receiveTcgFormatMetadata,
	tcgValidateState,
} = global;

function team(format, packed) {
	return {
		name: 'Saved',
		format,
		packedTeam: packed,
		key: 'k-' + format,
		folder: '',
		iconCache: null,
	};
}

function editorFor(format, ids) {
	const saved = team(format, packTcgDeck(ids));
	const editor = new TcgDeckEditor({team: saved, onChange() {}});
	editor.componentDidMount();
	return {saved, editor};
}

function texts(node, out = []) {
	if (node == null || node === false || node === true) return out;
	if (typeof node === 'string' || typeof node === 'number') {
		out.push(String(node));
		return out;
	}
	if (Array.isArray(node)) {
		for (const child of node) texts(child, out);
		return out;
	}
	if (node.children) texts(node.children, out);
	return out;
}

function tick() {
	return new Promise(resolve => setImmediate(resolve));
}

function hostReply(ok, errors, format, deckSize) {
	receiveTcgValidate({
		ok, errors, deckSize, format, rulesId: format.includes('pocket') ? 'pocket' : 'standard',
	});
}

describe('deck format hints', () => {
	it('maps the three constructed formats and does not treat hidden ids as Standard', () => {
		assert.equal(tcgDeckFormatOf('gen9tcgstandard'), 'standard');
		assert.equal(tcgDeckFormatOf('tcgstandard'), 'standard');
		assert.equal(tcgDeckFormatOf('tcgstandardrandom'), 'standard');
		assert.equal(tcgDeckFormatOf('gen9tcgpocket'), 'pocket');
		assert.equal(tcgDeckFormatOf('tcgpocketrandom'), 'pocket');
		assert.equal(tcgDeckFormatOf('tcgcustomgame'), 'custom');
		for (const id of ['tcgunlimited', 'tcgexpanded', 'tcgglc', 'tcggen1', 'tcggen9', 'tcgnope', '']) {
			assert.equal(tcgDeckFormatOf(id), null, id);
		}
	});

	it('keeps the local size hints for Standard, Pocket, and Custom Game', () => {
		assert.ok(deckProblemsClient([], 'standard').some(e => e.includes('must be 60 cards')));
		assert.ok(deckProblemsClient([], 'pocket').some(e => e.includes('must be 20 cards')));
		assert.ok(deckProblemsClient([], 'custom').some(e => e.includes('must have 1–60 cards')));
	});
});

describe('host validation decides, local hints do not', () => {
	let sent;

	beforeEach(() => {
		sent = [];
		global.PS.send = msg => sent.push(msg);
		cancelTcgValidate();
		resetTcgFormatMetadata();
	});

	it('asks the host with the format id the player selected', () => {
		requestTcgValidate('gen9tcgstandard', ['sv1-1']);
		requestTcgValidate('gen9tcgpocket', ['a1-1']);
		requestTcgValidate('tcgcustomgame', ['sv1-1']);
		assert.deepEqual(sent, [
			'/cmd tcgvalidate gen9tcgstandard ["sv1-1"]',
			'/cmd tcgvalidate gen9tcgpocket ["a1-1"]',
			'/cmd tcgvalidate tcgcustomgame ["sv1-1"]',
		]);
	});

	it('does not queue a deck the host rejects, including a hidden format', async () => {
		const hidden = tcgHostDeckDecision('tcgexpanded', ['sv1-1']);
		receiveTcgValidate({
			ok: false,
			format: 'tcgexpanded',
			rulesId: 'expanded',
			errors: ['Expanded is not available.'],
			deckSize: 1,
			rulesSize: 60,
		});
		const decision = await hidden;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, ['Expanded is not available.']);
		assert.equal(tcgDeckFormatOf('tcgexpanded'), null);
	});

	it('queues a deck the host accepts even when the local date hint disagrees', async () => {
		const card = {
			id: 'future-1', n: 'Futuremon', s: 'P', u: [], t: [], set: 'sv1', r: 'H', k: 'p', i: '',
			std: 1, pkt: 0, b: 1, be: 0, ace: 0, rad: 0, prism: 0, lf: '2099-01-01',
		};
		tcgDeckCatalog.byId[card.id] = card;
		try {
			assert.equal(cardLegalInFormat(card, 'standard'), false);
			const ids = Array(60).fill(card.id);
			assert.ok(deckProblemsClient(ids, 'standard').some(e => /Not legal in Standard: Futuremon/.test(e)));

			const pending = tcgHostDeckDecision('gen9tcgstandard', ids);
			receiveTcgValidate({
				ok: true,
				format: 'gen9tcgstandard',
				rulesId: 'standard',
				errors: [],
				deckSize: 60,
				rulesSize: 60,
			});
			const decision = await pending;
			assert.equal(decision.submit, true);
			assert.deepEqual(decision.errors, []);
		} finally {
			delete tcgDeckCatalog.byId[card.id];
		}
	});

	it('does not treat a failed request or an empty rejection as legal', async () => {
		global.PS.send = () => {
			throw new Error('offline');
		};
		const failed = await tcgHostDeckDecision('tcgstandard', ['sv1-1']);
		assert.equal(failed.submit, false);
		assert.deepEqual(failed.errors, ['Server did not respond. Client checks are shown above.']);

		cancelTcgValidate();
		global.PS.send = msg => sent.push(msg);
		const rejected = tcgHostDeckDecision('tcgcustomgame', []);
		receiveTcgValidate({ok: false, format: 'tcgcustomgame', rulesId: 'customgame', deckSize: 0, rulesSize: 60});
		const decision = await rejected;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, ['The server could not validate this deck.']);
	});

	it('does not treat a same-size reply as the current deck while a timeout is unmatched', async () => {
		const first = requestTcgValidate('gen9tcgstandard', ['old-card'], 15);
		const timedOut = await first;
		assert.equal(timedOut.ok, false);
		assert.equal(timedOut.ambiguous, undefined);

		const second = tcgHostDeckDecision('gen9tcgstandard', ['new-card']);
		hostReply(false, ['B-REJECT'], 'gen9tcgstandard', 1);
		hostReply(true, [], 'gen9tcgstandard', 1);
		const decision = await second;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, [TCG_AMBIGUOUS_VALIDATION_ERROR]);
	});

	it('does not let a timed-out Standard reply accept a Pocket deck of the same size', async () => {
		await requestTcgValidate('gen9tcgstandard', ['a'], 15);
		const pocket = tcgHostDeckDecision('gen9tcgpocket', ['a']);
		receiveTcgValidate({
			ok: true, errors: [], deckSize: 1, format: 'gen9tcgstandard', rulesId: 'standard',
		});
		receiveTcgValidate({
			ok: false,
			errors: ['Pocket decks must be 20 cards (got 1).'],
			deckSize: 1,
			format: 'gen9tcgpocket',
			rulesId: 'pocket',
		});
		const decision = await pocket;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, ['Pocket decks must be 20 cards (got 1).']);
	});

	it('ignores a late reply that arrives before the next validate', async () => {
		await requestTcgValidate('gen9tcgstandard', ['old-card'], 15);
		receiveTcgValidate({
			ok: true, errors: [], deckSize: 1, format: 'gen9tcgstandard', rulesId: 'standard',
		});
		const next = requestTcgValidate('gen9tcgstandard', ['new-card'], 500);
		receiveTcgValidate({
			ok: false, errors: ['HOST-NEXT'], deckSize: 1, format: 'gen9tcgstandard', rulesId: 'standard',
		});
		const result = await next;
		assert.deepEqual(result.errors, ['HOST-NEXT']);
	});

	it('authorizes two same-size decks when each check finishes before the next starts', async () => {
		const first = tcgHostDeckDecision('gen9tcgstandard', ['card-a']);
		hostReply(true, [], 'gen9tcgstandard', 1);
		assert.equal((await first).submit, true);

		const second = tcgHostDeckDecision('gen9tcgstandard', ['card-b']);
		hostReply(true, [], 'gen9tcgstandard', 1);
		const decision = await second;
		assert.equal(decision.submit, true);
		assert.deepEqual(decision.errors, []);
	});

	it('does not queue either deck when same-size replies arrive out of order', async () => {
		const first = tcgHostDeckDecision('gen9tcgstandard', ['card-a']);
		const second = tcgHostDeckDecision('gen9tcgstandard', ['card-b']);
		hostReply(false, ['B-REJECT'], 'gen9tcgstandard', 1);
		hostReply(true, [], 'gen9tcgstandard', 1);
		assert.equal((await first).submit, false);
		const decision = await second;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, [TCG_AMBIGUOUS_VALIDATION_ERROR]);
	});

	it('does not authorize the later deck when the earlier success arrives first', async () => {
		const second = (() => {
			tcgHostDeckDecision('gen9tcgstandard', ['card-a']);
			return tcgHostDeckDecision('gen9tcgstandard', ['card-b']);
		})();
		hostReply(true, [], 'gen9tcgstandard', 1);
		let settled = false;
		second.then(() => {
			settled = true;
		});
		await tick();
		assert.equal(settled, false);
		hostReply(false, ['B-REJECT'], 'gen9tcgstandard', 1);
		const decision = await second;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, [TCG_AMBIGUOUS_VALIDATION_ERROR]);
	});

	it('keeps a Pocket rejection when a Standard success of the same size is also in flight', async () => {
		const standard = tcgHostDeckDecision('gen9tcgstandard', ['card-a']);
		const pocket = tcgHostDeckDecision('gen9tcgpocket', ['card-b']);
		hostReply(true, [], 'gen9tcgstandard', 1);
		hostReply(false, ['POCKET-REJECT'], 'gen9tcgpocket', 1);
		assert.equal((await standard).submit, false);
		const decision = await pocket;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, ['POCKET-REJECT']);
	});

	it('still matches different deck sizes when the replies arrive in order', async () => {
		const small = tcgHostDeckDecision('gen9tcgstandard', ['card-a']);
		const large = tcgHostDeckDecision('gen9tcgstandard', ['card-a', 'card-b']);
		hostReply(true, [], 'gen9tcgstandard', 1);
		hostReply(false, ['SIZE-REJECT'], 'gen9tcgstandard', 2);
		assert.equal((await small).submit, false);
		const decision = await large;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, ['SIZE-REJECT']);
	});

	it('authorizes a fresh check after the overlapped replies have been consumed', async () => {
		const first = tcgHostDeckDecision('gen9tcgstandard', ['card-a']);
		const second = tcgHostDeckDecision('gen9tcgstandard', ['card-b']);
		hostReply(false, ['B-REJECT'], 'gen9tcgstandard', 1);
		hostReply(true, [], 'gen9tcgstandard', 1);
		assert.equal((await second).submit, false);
		await first;

		const fresh = tcgHostDeckDecision('gen9tcgstandard', ['card-c']);
		hostReply(true, [], 'gen9tcgstandard', 1);
		const decision = await fresh;
		assert.equal(decision.submit, true);
		assert.deepEqual(decision.errors, []);
	});

	it('drops a reply whose echoed format is not the pending deck', async () => {
		const pocket = tcgHostDeckDecision('gen9tcgpocket', ['card-b']);
		hostReply(true, [], 'gen9tcgstandard', 1);
		let settled = false;
		pocket.then(() => {
			settled = true;
		});
		await tick();
		assert.equal(settled, false);
		hostReply(false, ['POCKET-REJECT'], 'gen9tcgpocket', 1);
		const decision = await pocket;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, ['POCKET-REJECT']);
	});

	it('drops the previous deck when the list changes while validation is pending', async () => {
		const first = tcgHostDeckDecision('gen9tcgstandard', ['a', 'b']);
		const second = tcgHostDeckDecision('gen9tcgstandard', ['a', 'b', 'c']);
		assert.equal((await first).submit, false);
		receiveTcgValidate({
			ok: true, errors: [], deckSize: 2, format: 'gen9tcgstandard', rulesId: 'standard',
		});
		let settled = false;
		second.then(() => {
			settled = true;
		});
		await tick();
		assert.equal(settled, false);
		receiveTcgValidate({
			ok: false,
			errors: ['Standard decks must be 60 cards (got 3).'],
			deckSize: 3,
			format: 'gen9tcgstandard',
			rulesId: 'standard',
		});
		const decision = await second;
		assert.equal(decision.submit, false);
		assert.deepEqual(decision.errors, ['Standard decks must be 60 cards (got 3).']);
	});
});

describe('deck editor', () => {
	let sent;

	beforeEach(() => {
		sent = [];
		global.PS.send = msg => sent.push(msg);
		cancelTcgValidate();
		resetTcgFormatMetadata();
	});

	it('loads a saved deck for each constructed format and keeps the card list', () => {
		for (const [format, kind] of [['gen9tcgstandard', 'standard'], ['gen9tcgpocket', 'pocket'], ['tcgcustomgame', 'custom']]) {
			const ids = ['sv1-1', 'sv1-1', 'a1-2'];
			const {saved, editor} = editorFor(format, ids);
			assert.deepEqual(editor.state.ids, ids);
			assert.equal(editor.state.format, kind);
			assert.deepEqual(unpackTcgDeck(saved.packedTeam), ids);
			editor.commit(ids.slice(0, 2));
			assert.deepEqual(unpackTcgDeck(saved.packedTeam), ids.slice(0, 2));
			assert.equal(saved.format, format);
		}
		const legacy = editorFor('tcgstandard', []);
		legacy.saved.packedTeam = 'sv1-9 sv1-9';
		legacy.editor.componentDidUpdate({team: team('tcgstandard', packTcgDeck([]))});
		assert.deepEqual(legacy.editor.state.ids, ['sv1-9', 'sv1-9']);
	});

	it('does not apply Standard rules to a hidden format, and ignores rulesId', async () => {
		const {saved, editor} = editorFor('tcgexpanded', ['sv1-1']);
		assert.equal(editor.state.format, null);
		assert.equal(saved.format, 'tcgexpanded');
		editor.setState({ready: true});
		const shown = texts(editor.renderDeckBuilder());
		assert.ok(shown.some(text => text.includes('no local deck rules')));
		assert.ok(!shown.some(text => text.includes('/60')));
		const fill = editor.renderDeckBuilder();
		const fillButton = [];
		(function walk(node) {
			if (!node || typeof node !== 'object') return;
			if (node.props && node.props.class === 'button tcg-deck-fill') fillButton.push(node);
			for (const child of node.children || []) walk(child);
		})(fill);
		assert.equal(fillButton[0].props.disabled, true);

		editor.commit(['sv1-1', 'sv1-2']);
		assert.equal(saved.format, 'tcgexpanded');
		assert.equal(editor.state.serverErrors, null);

		editor.validate();
		assert.equal(sent.at(-1), '/cmd tcgvalidate tcgexpanded ["sv1-1","sv1-2"]');
		receiveTcgValidate({
			ok: false,
			format: 'tcgexpanded',
			rulesId: 'expanded',
			errors: ['Expanded is not available.'],
			deckSize: 2,
			rulesSize: 60,
		});
		await tick();
		assert.deepEqual(editor.state.serverErrors, ['Expanded is not available.']);
		assert.equal(editor.state.format, null);
		assert.equal(saved.format, 'tcgexpanded');
		assert.equal(editor.state.rulesId, undefined);
	});

	it('keeps the host format when the reply carries an engine rules id', async () => {
		const {saved, editor} = editorFor('gen9tcgstandard', ['sv1-1']);
		editor.validate();
		receiveTcgValidate({
			ok: true,
			format: 'gen9tcgstandard',
			rulesId: 'pocket',
			errors: [],
			deckSize: 1,
			rulesSize: 60,
		});
		await tick();
		assert.equal(editor.state.validating, false);
		assert.deepEqual(editor.state.serverErrors, []);
		assert.equal(editor.state.format, 'standard');
		assert.equal(saved.format, 'gen9tcgstandard');
	});

	it('shows a host rejection with no error list instead of a clean deck', async () => {
		const {editor} = editorFor('gen9tcgpocket', ['a1-1']);
		editor.validate();
		receiveTcgValidate({ok: false, format: 'gen9tcgpocket', rulesId: 'pocket', deckSize: 1, rulesSize: 20});
		await tick();
		assert.deepEqual(editor.state.serverErrors, ['The server could not validate this deck.']);
		assert.equal(editor.state.format, 'pocket');
	});

	it('clears a pending result when the format changes, and does not apply the old reply', async () => {
		const {saved, editor} = editorFor('gen9tcgstandard', ['sv1-1']);
		editor.validate();
		assert.equal(editor.state.validating, true);
		saved.format = 'gen9tcgpocket';
		editor.props = {team: saved, onChange() {}};
		editor.componentDidUpdate({team: team('gen9tcgstandard', saved.packedTeam)});
		assert.equal(editor.state.format, 'pocket');
		assert.equal(editor.state.validating, false);
		assert.equal(editor.state.serverErrors, null);
		receiveTcgValidate({
			ok: true, errors: [], deckSize: 1, format: 'gen9tcgstandard', rulesId: 'standard',
		});
		await tick();
		assert.equal(editor.state.serverErrors, null);
		assert.equal(saved.format, 'gen9tcgpocket');
	});

	it('does not store an overlapped success as a clean result for the edited deck', async () => {
		const {editor} = editorFor('gen9tcgstandard', ['sv1-1']);
		editor.validate();
		editor.commit(['sv1-2']);
		assert.equal(editor.state.serverErrors, null);
		editor.validate();
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.notDeepEqual(editor.state.serverErrors, []);
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(editor.state.serverErrors, [TCG_AMBIGUOUS_VALIDATION_ERROR]);

		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(editor.state.serverErrors, [TCG_AMBIGUOUS_VALIDATION_ERROR]);

		editor.validate();
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(editor.state.serverErrors, []);
	});

	it('fill completes a list locally and does not ask the host or mark the deck legal', () => {
		const {editor} = editorFor('gen9tcgstandard', ['sv1-1']);
		const before = sent.length;
		editor.fillDeck();
		assert.equal(sent.length, before);
		assert.equal(editor.state.serverErrors, null);
		assert.ok(editor.state.fill.notes.some(note => note.includes('Add at least one')));
	});
});

global.PSRoom = function PSRoom() {};
global.PSRoomPanel = function PSRoomPanel() {};
global.PS.rooms = {};
global.PS.prefs = {};
global.PS.addRoomType = function () {};
global.PS.teams.list = [];
global.PS.teams.teambuilderFormat = format => String(format || '');
global.PS.teams.loadTeam = () => Promise.resolve(true);
global.BattleLog = {formatName(name) { return name; }};
vm.runInThisContext(
	fs.readFileSync(path.join(webRoot, 'panel-mainmenu.js'), 'utf8'),
	{filename: path.join(webRoot, 'panel-mainmenu.js')},
);

function formFor(ids, onSubmit, onValidate) {
	const saved = team('gen9tcgstandard', packTcgDeck(ids));
	saved.key = 'deck-' + ids.join('-');
	global.PS.teams.byKey[saved.key] = saved;
	const form = new global.TeamForm({onSubmit, onValidate: onValidate || null});
	form.format = 'gen9tcgstandard';
	form.base = {querySelector() { return {value: saved.key}; }};
	return {form, saved};
}

function click() {
	return {preventDefault() {}};
}

describe('challenge and search queue', () => {
	beforeEach(() => {
		cancelTcgValidate();
		global.PS.alerts = [];
		global.PS.alert = text => global.PS.alerts.push(text);
		global.window.BattleFormats = {
			gen9tcgstandard: {name: 'Standard'},
			gen9tcgpocket: {name: 'Pocket'},
		};
	});

	it('queues a search when the host accepts a deck that was checked on its own', async () => {
		const queued = [];
		const {form} = formFor(['card-a'], (ev, format) => queued.push(format));
		form.submit(click());
		await tick();
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(queued, ['gen9tcgstandard']);
	});

	it('queues a challenge when the host accepts a deck that was checked on its own', async () => {
		const queued = [];
		const {form} = formFor(['card-a'], () => {}, (ev, format) => queued.push(format));
		form.submit(click(), 'validate');
		await tick();
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(queued, ['gen9tcgstandard']);
	});

	it('does not queue a search or a challenge from an overlapped success', async () => {
		const queued = [];
		const search = formFor(['card-a'], () => queued.push('search'));
		const challenge = formFor(['card-b'], () => {}, () => queued.push('challenge'));
		search.form.submit(click());
		challenge.form.submit(click(), 'validate');
		await tick();
		hostReply(false, ['B-REJECT'], 'gen9tcgstandard', 1);
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(queued, []);
		assert.ok(global.PS.alerts.some(text => text.includes('Validate again')));
	});

	it('does not queue after the format changes while the check is pending', async () => {
		const queued = [];
		const {form} = formFor(['card-a'], () => queued.push('search'));
		form.submit(click());
		await tick();
		form.format = 'gen9tcgpocket';
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(queued, []);
	});

	it('does not queue after the saved deck changes while the check is pending', async () => {
		const queued = [];
		const {form, saved} = formFor(['card-a'], () => queued.push('search'));
		form.submit(click());
		await tick();
		saved.packedTeam = packTcgDeck(['card-b']);
		hostReply(true, [], 'gen9tcgstandard', 1);
		await tick();
		assert.deepEqual(queued, []);
	});
});

function requestCapability(enabled) {
	receiveTcgFormatMetadata({
		schema: 1,
		revision: 1,
		complete: true,
		validateRequestId: enabled,
		formats: [{
			hostFormatId: 'tcgstandard',
			engineRulesId: 'standard',
			name: 'Standard',
			description: 'Standard format',
			deckSource: 'player',
			deck: {
				minSize: 60, maxSize: 60, copyLimit: 4, energyZone: false,
				allowAceSpec: true, allowRadiant: true, allowRuleBox: true,
			},
		}],
	});
}

function reply(ok, requestId, deckSize = 1) {
	return {
		ok, errors: ok ? [] : ['no'], format: 'tcgstandard', rulesId: 'standard',
		deckSize, rulesSize: 60, requestId,
	};
}

describe('validation request ids', () => {
	let sent;

	beforeEach(() => {
		sent = [];
		global.PS.send = msg => sent.push(msg);
		cancelTcgValidate();
		resetTcgFormatMetadata();
	});

	it('sends an id only when metadata advertises the capability', () => {
		requestTcgValidate('tcgstandard', ['card-a']);
		assert.match(sent.at(-1), /^\/cmd tcgvalidate tcgstandard \[/);
		cancelTcgValidate();
		requestCapability(false);
		requestTcgValidate('tcgstandard', ['card-a']);
		assert.match(sent.at(-1), /^\/cmd tcgvalidate tcgstandard \[/);
		cancelTcgValidate();
		requestCapability(true);
		requestTcgValidate('tcgstandard', ['card-a']);
		assert.match(sent.at(-1), /^\/cmd tcgvalidate tcgstandard \d+ \[/);
	});

	it('authorizes only the request whose id comes back, even out of order', async () => {
		requestCapability(true);
		const first = tcgHostDeckDecision('tcgstandard', ['card-a']);
		const second = tcgHostDeckDecision('tcgstandard', ['card-b']);
		const ids = tcgValidateState.queue.map(entry => entry.requestId);
		receiveTcgValidate(reply(true, ids[0]));
		receiveTcgValidate(reply(true, ids[1]));
		assert.equal((await first).submit, false);
		assert.equal((await second).submit, true);
	});

	it('does not let a timed-out id authorize the next deck', async () => {
		requestCapability(true);
		const expired = requestTcgValidate('tcgstandard', ['card-a'], 15);
		const expiredId = tcgValidateState.queue.at(-1).requestId;
		const timeout = await expired;
		assert.equal(timeout.ok, false);
		receiveTcgValidate(reply(true, expiredId));
		const next = tcgHostDeckDecision('tcgstandard', ['card-b']);
		const nextId = tcgValidateState.queue.filter(entry => !entry.cancelled).at(-1).requestId;
		receiveTcgValidate(reply(true, nextId));
		assert.equal((await next).submit, true);
		assert.notEqual(nextId, expiredId);
	});

	it('authorizes neither request when two pending entries share an id', async () => {
		requestCapability(true);
		const first = tcgHostDeckDecision('tcgstandard', ['card-a']);
		const shared = tcgValidateState.queue.at(-1).requestId;
		tcgValidateState.nextId = shared - 1;
		const second = tcgHostDeckDecision('tcgstandard', ['card-b']);
		receiveTcgValidate(reply(true, shared));
		assert.equal((await first).submit, false);
		assert.equal((await second).submit, false);
	});

	it('ignores an unknown id and still accepts the real one', async () => {
		requestCapability(true);
		const pending = tcgHostDeckDecision('tcgstandard', ['card-a']);
		const id = tcgValidateState.queue.filter(entry => !entry.cancelled).at(-1).requestId;
		receiveTcgValidate(reply(true, id + 50));
		receiveTcgValidate(reply(false, id));
		assert.equal((await pending).submit, false);
	});

	it('keeps fail-closed matching when the reply has no request id', async () => {
		requestCapability(true);
		const first = tcgHostDeckDecision('tcgstandard', ['card-a']);
		const second = tcgHostDeckDecision('tcgstandard', ['card-b']);
		receiveTcgValidate({
			ok: true, errors: [], format: 'tcgstandard', rulesId: 'standard', deckSize: 1, rulesSize: 60,
		});
		assert.equal((await first).submit, false);
		const pending = await Promise.race([
			second.then(() => 'settled'),
			new Promise(resolve => setTimeout(() => resolve('pending'), 30)),
		]);
		assert.equal(pending, 'pending');
		cancelTcgValidate();
		assert.equal((await second).submit, false);
	});
});
