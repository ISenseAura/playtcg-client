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
global.PS = {send() {}, teams: {byKey: {}, update() {}}, alerts: [], alert() {}};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.BattleFormats = {};
global.NonBattleGames = {};

const webRoot = path.resolve(__dirname, '../play.pokemonshowdown.com/js');
for (const name of ['battle-tcg-deck.js', 'panel-tcg-deck.js']) {
	const file = path.join(webRoot, name);
	vm.runInThisContext(fs.readFileSync(file, 'utf8'), {filename: file});
}

const {
	TCG_DECK_RULES,
	parseTcgFormatMetadata,
	cachedTcgFormatMetadata,
	loadTcgFormatMetadata,
	refreshTcgFormatMetadata,
	receiveTcgFormatMetadata,
	resetTcgFormatMetadata,
	tcgDeckRulesFor,
	tcgAssignedDeck,
	tcgLegalityHint,
	deckProblemsClient,
	tcgDeckCatalog,
	TcgDeckEditor,
	packTcgDeck,
} = global;

function deck(extra) {
	return Object.assign({
		minSize: 60,
		maxSize: 60,
		copyLimit: 4,
		energyZone: false,
		allowAceSpec: true,
		allowRadiant: true,
		allowRuleBox: true,
	}, extra);
}

function row(hostFormatId, engineRulesId, name, description, deckSource, extra) {
	return {
		hostFormatId,
		engineRulesId,
		name,
		description,
		deckSource,
		deck: deck(extra),
	};
}

function activeFormats() {
	return [
		row('tcgstandard', 'standard', 'Standard', 'Pokémon TCG Standard via WaveTCG (60 cards, regulation H+). Ladder games are vs the CPU.', 'player', {legality: 'standard', regulationMin: 'H'}),
		row('tcgstandardrandom', 'standardrandom', 'Standard Random', 'Pokémon TCG Standard with a randomly generated 60-card deck. Ladder games are vs the CPU. No deck required.', 'assigned', {legality: 'standard', regulationMin: 'H'}),
		row('tcgpocket', 'pocket', 'Pocket', 'Pokémon TCG Pocket via WaveTCG. Ladder games are vs the CPU.', 'player', {minSize: 20, maxSize: 20, copyLimit: 2, energyZone: true, allowAceSpec: false, allowRadiant: false, allowRuleBox: false}),
		row('tcgpocketrandom', 'pocketrandom', 'Pocket Random', 'Pokémon TCG Pocket with a random assigned deck. Ladder games are vs the CPU. No deck required.', 'assigned', {minSize: 20, maxSize: 20, copyLimit: 2, energyZone: true, allowAceSpec: false, allowRadiant: false, allowRuleBox: false}),
		row('tcgcustomgame', 'customgame', 'Custom Game', 'Pokémon TCG Custom Game via WaveTCG (1–60 cards, no other deckbuilding rules). Ladder games are vs the CPU.', 'player', {minSize: 1, maxSize: 60, copyLimit: 60}),
	];
}

function envelope(formats, extra) {
	return Object.assign({
		schema: 1,
		revision: 1,
		complete: true,
		validateRequestId: false,
		formats,
	}, extra);
}

let sent;

beforeEach(() => {
	sent = [];
	delete global.PS.mainmenu;
	global.PS.send = msg => sent.push(msg);
	resetTcgFormatMetadata();
});

describe('tcgformats parser', () => {
	it('accepts the five active formats', () => {
		const parsed = parseTcgFormatMetadata(envelope(activeFormats()));
		assert.equal(parsed.schema, 1);
		assert.equal(parsed.revision, 1);
		assert.equal(parsed.complete, true);
		assert.equal(parsed.validateRequestId, false);
		assert.deepEqual(parsed.formats.map(format => format.hostFormatId), [
			'tcgstandard', 'tcgstandardrandom', 'tcgpocket', 'tcgpocketrandom', 'tcgcustomgame',
		]);
		assert.equal(parsed.formats[0].deck.regulationMin, 'H');
		assert.equal(parsed.formats[2].deck.energyZone, true);
		assert.equal(parsed.formats[4].deck.minSize, 1);
		assert.equal(parsed.formats[4].deck.maxSize, 60);
	});

	it('accepts an empty formats array', () => {
		const parsed = parseTcgFormatMetadata(envelope([]));
		assert.deepEqual(parsed.formats, []);
	});

	it('rejects a bad schema or revision', () => {
		assert.equal(parseTcgFormatMetadata(envelope([], {schema: 2})), null);
		assert.equal(parseTcgFormatMetadata(envelope([], {schema: '1'})), null);
		assert.equal(parseTcgFormatMetadata(envelope([], {revision: 0})), null);
		assert.equal(parseTcgFormatMetadata(envelope([], {revision: 1.5})), null);
		assert.equal(parseTcgFormatMetadata(envelope([], {revision: -1})), null);
	});

	it('rejects complete when it is false or missing', () => {
		assert.equal(parseTcgFormatMetadata(envelope([], {complete: false})), null);
		const missing = envelope([]);
		delete missing.complete;
		assert.equal(parseTcgFormatMetadata(missing), null);
	});

	it('rejects a non-boolean validateRequestId', () => {
		assert.equal(parseTcgFormatMetadata(envelope([], {validateRequestId: 'false'})), null);
		const missing = envelope([]);
		delete missing.validateRequestId;
		assert.equal(parseTcgFormatMetadata(missing), null);
		assert.ok(parseTcgFormatMetadata(envelope([], {validateRequestId: true})));
	});

	it('rejects missing or empty required fields', () => {
		for (const key of ['hostFormatId', 'engineRulesId', 'name', 'description']) {
			const formats = activeFormats();
			formats[0][key] = '  ';
			assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
			delete formats[0][key];
			assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
		}
		const formats = activeFormats();
		formats[0].deckSource = 'random';
		assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
	});

	it('does not invent a host id from the engine rules id', () => {
		const formats = activeFormats();
		delete formats[0].hostFormatId;
		assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
	});

	it('rejects invalid optional fields', () => {
		const cases = [
			{minPokemon: 0},
			{minPokemon: 1.5},
			{samePokemonType: 'yes'},
			{legality: 'glc'},
			{regulationMin: 'HH'},
			{regulationMin: 'h'},
			{series: ['']},
			{series: [1]},
		];
		for (const extra of cases) {
			const formats = activeFormats();
			Object.assign(formats[0].deck, extra);
			assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
		}
		const formats = activeFormats();
		formats[0].deck.series = ['sv'];
		formats[0].deck.minPokemon = 1;
		formats[0].deck.samePokemonType = true;
		const parsed = parseTcgFormatMetadata(envelope(formats));
		assert.deepEqual(parsed.formats[0].deck.series, ['sv']);
		assert.equal(parsed.formats[0].deck.minPokemon, 1);
	});

	it('rejects invalid deck sizes and copy limits', () => {
		const cases = [
			{minSize: 0},
			{minSize: 60.5},
			{maxSize: 59},
			{copyLimit: 0},
			{copyLimit: -1},
			{energyZone: 1},
			{allowAceSpec: 'true'},
		];
		for (const extra of cases) {
			const formats = activeFormats();
			Object.assign(formats[0].deck, extra);
			assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
		}
		for (const key of ['energyZone', 'allowAceSpec', 'allowRadiant', 'allowRuleBox']) {
			const formats = activeFormats();
			delete formats[0].deck[key];
			assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
		}
	});

	it('rejects duplicate host format ids', () => {
		const formats = activeFormats();
		formats[1].hostFormatId = formats[0].hostFormatId;
		assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
	});

	it('rejects the whole response when one row is malformed', () => {
		const formats = activeFormats();
		formats[3].deck.copyLimit = 0;
		assert.equal(parseTcgFormatMetadata(envelope(formats)), null);
		assert.equal(cachedTcgFormatMetadata(), null);
	});
});

describe('tcgformats cache', () => {
	it('keeps a valid cache when a later response is invalid, null, or unavailable', async () => {
		const pending = loadTcgFormatMetadata();
		assert.equal(sent.at(-1), '/cmd tcgformats');
		receiveTcgFormatMetadata(envelope(activeFormats()));
		const cached = await pending;
		assert.equal(cached.formats.length, 5);

		receiveTcgFormatMetadata(envelope([], {schema: 2}));
		receiveTcgFormatMetadata(null);
		assert.equal(cachedTcgFormatMetadata(), cached);

		global.PS.send = () => { throw new Error('offline'); };
		const again = await refreshTcgFormatMetadata();
		assert.equal(again, cached);
		assert.equal(cachedTcgFormatMetadata(), cached);
	});

	it('replaces the cache with a valid empty list', async () => {
		const pending = loadTcgFormatMetadata();
		receiveTcgFormatMetadata(envelope(activeFormats()));
		await pending;
		const next = refreshTcgFormatMetadata();
		receiveTcgFormatMetadata(envelope([]));
		const cached = await next;
		assert.deepEqual(cached.formats, []);
		assert.equal(cachedTcgFormatMetadata(), cached);
	});

	it('shares one in-flight fetch and allows a retry after failure', async () => {
		const first = loadTcgFormatMetadata();
		const second = loadTcgFormatMetadata();
		assert.equal(sent.length, 1);
		receiveTcgFormatMetadata(null);
		assert.equal(await first, null);
		assert.equal(await second, null);
		assert.equal(cachedTcgFormatMetadata(), null);

		const retry = loadTcgFormatMetadata();
		assert.equal(sent.length, 2);
		receiveTcgFormatMetadata(envelope(activeFormats()));
		assert.equal((await retry).formats.length, 5);
	});

	it('shares one makeQuery call when the main menu is available', async () => {
		const replies = [];
		let calls = 0;
		global.PS.mainmenu = {
			makeQuery(id) {
				assert.equal(id, 'tcgformats');
				calls++;
				return new Promise(resolve => replies.push(resolve));
			},
		};
		const first = loadTcgFormatMetadata();
		const second = loadTcgFormatMetadata();
		assert.equal(calls, 1);
		replies[0](null);
		assert.equal(await first, null);
		assert.equal(await second, null);
		const retry = loadTcgFormatMetadata();
		assert.equal(calls, 2);
		replies[1](envelope([]));
		assert.deepEqual((await retry).formats, []);
	});

	it('follows an in-flight fetch with one new fetch after |formats| refresh', async () => {
		const first = loadTcgFormatMetadata();
		const refreshed = refreshTcgFormatMetadata();
		assert.equal(sent.length, 1);
		receiveTcgFormatMetadata(envelope(activeFormats()));
		assert.equal((await first).formats.length, 5);
		assert.equal(sent.length, 2);
		receiveTcgFormatMetadata(envelope([]));
		assert.deepEqual((await refreshed).formats, []);
	});

	it('treats a null reply from an older host as no metadata', async () => {
		const pending = loadTcgFormatMetadata();
		receiveTcgFormatMetadata(null);
		assert.equal(await pending, null);
		assert.equal(cachedTcgFormatMetadata(), null);
		assert.equal(TCG_DECK_RULES.standard.deckSize, 60);
		assert.equal(TCG_DECK_RULES.pocket.deckSize, 20);
	});

	it('fetches when the deck editor opens and skips a second fetch once cached', () => {
		const team = {
			name: 'Saved',
			format: 'gen9tcgstandard',
			packedTeam: packTcgDeck([]),
			key: 'k',
			folder: '',
			iconCache: null,
		};
		const editor = new TcgDeckEditor({team, onChange() {}});
		editor.componentDidMount();
		assert.deepEqual(sent, ['/cmd tcgformats']);
		receiveTcgFormatMetadata(envelope(activeFormats()));
		sent.length = 0;
		const again = new TcgDeckEditor({team, onChange() {}});
		again.componentDidMount();
		assert.deepEqual(sent, []);
	});
});

function ruled(id) {
	return tcgDeckRulesFor(id);
}

describe('metadata-backed deck rules', () => {
	it('uses host metadata for each active format', () => {
		const formats = activeFormats();
		formats[0].deck = Object.assign({}, formats[0].deck, { copyLimit: 7, minSize: 55, maxSize: 55 });
		formats[2].deck = Object.assign({}, formats[2].deck, { copyLimit: 3 });
		formats[4].deck = Object.assign({}, formats[4].deck, { maxSize: 40 });
		receiveTcgFormatMetadata(envelope(formats));

		const standard = ruled('tcgstandard');
		assert.equal(standard.origin, 'metadata');
		assert.equal(standard.hostFormatId, 'tcgstandard');
		assert.equal(standard.engineRulesId, 'standard');
		assert.equal(standard.copyLimit, 7);
		assert.equal(standard.minSize, 55);
		assert.equal(standard.maxSize, 55);
		assert.equal(standard.deckSource, 'player');
		assert.equal(standard.energyZone, false);
		assert.equal(standard.legality, 'standard');
		assert.equal(standard.regulationMin, 'H');
		assert.equal(standard.allowRuleBox, true);
		assert.equal(TCG_DECK_RULES.standard.copyLimit, 4);
		assert.equal(TCG_DECK_RULES.standard.deckSize, 60);
		assert.ok(deckProblemsClient([], 'standard').some(error => error.includes('must be 55 cards')));

		const random = ruled('tcgstandardrandom');
		assert.equal(random.origin, 'metadata');
		assert.equal(random.deckSource, 'assigned');
		assert.equal(random.copyLimit, 4);
		assert.equal(tcgAssignedDeck('tcgstandardrandom'), true);
		assert.equal(tcgAssignedDeck('gen9tcgstandardrandom'), true);

		const pocket = ruled('tcgpocket');
		assert.equal(pocket.origin, 'metadata');
		assert.equal(pocket.energyZone, true);
		assert.equal(pocket.copyLimit, 3);
		assert.equal(pocket.deckSource, 'player');
		assert.equal(pocket.legality, undefined);
		assert.equal(pocket.regulationMin, undefined);
		assert.equal(pocket.minPokemon, undefined);
		assert.equal(pocket.samePokemonType, undefined);
		assert.equal(pocket.series, undefined);

		const pocketRandom = ruled('tcgpocketrandom');
		assert.equal(pocketRandom.origin, 'metadata');
		assert.equal(pocketRandom.deckSource, 'assigned');
		assert.equal(pocketRandom.energyZone, true);
		assert.equal(tcgAssignedDeck('tcgpocketrandom'), true);
		assert.equal(tcgAssignedDeck('tcgpocket'), false);

		const custom = ruled('tcgcustomgame');
		assert.equal(custom.origin, 'metadata');
		assert.equal(custom.deckSource, 'player');
		assert.equal(custom.minSize, 1);
		assert.equal(custom.maxSize, 40);
		assert.equal(tcgAssignedDeck('tcgcustomgame'), false);
	});

	it('keeps an explicit false restriction distinct from an omitted one', () => {
		const formats = activeFormats();
		formats[4].deck = Object.assign({}, formats[4].deck, { samePokemonType: false, minPokemon: 1 });
		receiveTcgFormatMetadata(envelope(formats));
		const custom = ruled('tcgcustomgame');
		assert.equal(custom.samePokemonType, false);
		assert.equal(custom.minPokemon, 1);
		assert.equal(ruled('tcgpocket').samePokemonType, undefined);
	});

	it('falls back when metadata is missing, empty, invalid, or has no matching row', () => {
		assert.equal(ruled('tcgstandard').origin, 'fallback');
		assert.equal(ruled('tcgstandard').maxSize, 60);
		assert.equal(ruled('tcgstandard').copyLimit, 4);
		assert.equal(ruled('tcgpocket').maxSize, 20);
		assert.equal(ruled('tcgpocket').energyZone, true);
		assert.equal(ruled('tcgcustomgame').minSize, 1);
		assert.equal(ruled('tcgcustomgame').maxSize, 60);
		assert.equal(ruled('tcgexpanded'), null);
		assert.ok(deckProblemsClient([], 'standard').some(error => error.includes('must be 60 cards')));
		assert.ok(deckProblemsClient([], 'pocket').some(error => error.includes('must be 20 cards')));
		assert.ok(deckProblemsClient([], 'custom').some(error => error.includes('must have 1–60 cards')));

		receiveTcgFormatMetadata(null);
		receiveTcgFormatMetadata(envelope([], { schema: 2 }));
		assert.equal(ruled('tcgstandard').origin, 'fallback');
		assert.equal(ruled('tcgunlimited'), null);

		receiveTcgFormatMetadata(envelope([]));
		assert.equal(ruled('tcgstandard').origin, 'fallback');
		assert.equal(ruled('tcgstandard').maxSize, 60);
		assert.equal(ruled('tcgexpanded'), null);

		receiveTcgFormatMetadata(envelope(activeFormats().filter(row => row.hostFormatId === 'tcgpocket')));
		assert.equal(ruled('tcgpocket').origin, 'metadata');
		assert.equal(ruled('tcgstandard').origin, 'fallback');
		assert.equal(ruled('tcgstandard').maxSize, 60);
		assert.equal(ruled('tcgexpanded'), null);
	});

	it('normalizes a gen prefix and does not look up a rules id as a host id', () => {
		const formats = activeFormats();
		formats[0].deck = Object.assign({}, formats[0].deck, { copyLimit: 7 });
		formats.push(Object.assign({}, formats[0], {
			hostFormatId: 'tcgspecial',
			engineRulesId: 'specialrules',
			name: 'Special',
		}));
		receiveTcgFormatMetadata(envelope(formats));

		assert.equal(ruled('gen9tcgstandard').hostFormatId, 'tcgstandard');
		assert.equal(ruled('gen9tcgstandard').copyLimit, 7);
		assert.equal(ruled('tcgstandard').copyLimit, 7);
		assert.equal(ruled('standard').origin, 'fallback');
		assert.equal(ruled('standard').copyLimit, 4);
		assert.equal(ruled('specialrules'), null);
		assert.equal(ruled('tcgspecial').origin, 'metadata');
		assert.equal(ruled('tcgspecial').engineRulesId, 'specialrules');
		assert.equal(ruled('tcgspecial').hostFormatId, 'tcgspecial');
	});

	it('shows the metadata size on the deck editor and leaves assigned formats assigned', () => {
		const formats = activeFormats();
		formats[0].deck = Object.assign({}, formats[0].deck, { minSize: 55, maxSize: 55 });
		receiveTcgFormatMetadata(envelope(formats));
		const team = {
			name: 'Saved',
			format: 'gen9tcgstandard',
			packedTeam: packTcgDeck([]),
			key: 'k',
			folder: '',
			iconCache: null,
		};
		const editor = new TcgDeckEditor({ team, onChange() {} });
		editor.componentDidMount();
		const texts = [];
		const walk = node => {
			if (node == null || node === false || node === true) return;
			if (typeof node === 'string' || typeof node === 'number') {
				texts.push(String(node));
				return;
			}
			if (Array.isArray(node)) {
				node.forEach(walk);
				return;
			}
			walk(node.children);
		};
		walk(editor.render());
		assert.ok(texts.join('').includes('/55'));
		assert.equal(tcgAssignedDeck('tcgstandard'), false);
		assert.equal(tcgAssignedDeck('tcgstandardrandom'), true);
		assert.equal(ruled('tcgstandardrandom').deckSource, 'assigned');
	});
});

function hintCard(extra) {
	return Object.assign({
		id: 'hint-1', n: 'Hintmon', s: 'P', u: [], t: [], set: 'sv1', r: 'H', k: 'p', i: '',
		std: 1, pkt: 0, b: 1, be: 0, ace: 0, rad: 0, prism: 0,
	}, extra);
}

describe('metadata legality hints', () => {
	it('keeps Standard, Pocket, and Custom hints when metadata is absent or regulation H', () => {
		const current = hintCard();
		const rotated = hintCard({ std: 0, r: 'G' });
		const waiting = hintCard({ lf: '2099-01-01' });
		const pocket = hintCard({ id: 'hint-k', k: 'k', std: 0, pkt: 1 });
		const notPocket = hintCard({ id: 'hint-p', k: 'k', pkt: 0 });
		assert.equal(tcgLegalityHint(current, 'standard'), 'legal');
		assert.equal(tcgLegalityHint(rotated, 'standard'), 'illegal');
		assert.equal(tcgLegalityHint(waiting, 'standard'), 'illegal');
		assert.equal(tcgLegalityHint(pocket, 'pocket'), 'legal');
		assert.equal(tcgLegalityHint(notPocket, 'pocket'), 'illegal');
		assert.equal(tcgLegalityHint(rotated, 'custom'), 'legal');

		receiveTcgFormatMetadata(envelope(activeFormats()));
		assert.equal(tcgLegalityHint(current, 'standard', 'tcgstandard'), 'legal');
		assert.equal(tcgLegalityHint(rotated, 'standard', 'tcgstandard'), 'illegal');
		assert.equal(tcgLegalityHint(pocket, 'pocket', 'tcgpocket'), 'legal');
		assert.equal(tcgLegalityHint(current, 'custom', 'tcgcustomgame'), 'legal');
	});

	it('does not reject cards when the index cannot evaluate the published restriction', () => {
		const formats = activeFormats();
		formats[0].deck = Object.assign({}, formats[0].deck, { regulationMin: 'I' });
		receiveTcgFormatMetadata(envelope(formats));
		const older = hintCard({ std: 0, r: 'G' });
		assert.equal(tcgLegalityHint(older, 'standard', 'tcgstandard'), 'unknown');
		tcgDeckCatalog.byId[older.id] = older;
		try {
			const problems = deckProblemsClient([older.id], 'standard', 'tcgstandard');
			assert.equal(problems.some(error => error.includes('Not legal')), false);
		} finally {
			delete tcgDeckCatalog.byId[older.id];
		}

		formats[0].deck = Object.assign({}, formats[0].deck, { regulationMin: 'H', series: ['SV'] });
		receiveTcgFormatMetadata(envelope(formats));
		assert.equal(tcgLegalityHint(hintCard(), 'standard', 'tcgstandard'), 'unknown');

		formats[0].deck = Object.assign({}, formats[0].deck, { series: undefined, legality: 'expanded' });
		receiveTcgFormatMetadata(envelope(formats));
		assert.equal(tcgLegalityHint(hintCard(), 'standard', 'tcgstandard'), 'unknown');
		formats[0].deck.legality = 'unlimited';
		receiveTcgFormatMetadata(envelope(formats));
		assert.equal(tcgLegalityHint(hintCard(), 'standard', 'tcgstandard'), 'unknown');
	});

	it('does not treat a missing index flag as legal', () => {
		const card = hintCard();
		delete card.std;
		assert.notEqual(tcgLegalityHint(card, 'standard'), 'legal');
		const pocket = hintCard({ k: 'k' });
		delete pocket.pkt;
		assert.equal(tcgLegalityHint(pocket, 'pocket'), 'unknown');
	});
});

describe('tcgformats |formats| refresh', () => {
	it('refetches when the lobby parses a formats line', async () => {
		global.PS.addRoomType = function () {};
		global.PSRoom = function () {};
		global.PSRoomPanel = function () {};
		global.BattleLog = {formatName(name) { return name; }};
		global.Dex = {
			gen: 9,
			formats: {
				load(data) { return data; },
			},
		};
		const file = path.join(webRoot, 'panel-mainmenu.js');
		vm.runInThisContext(fs.readFileSync(file, 'utf8'), {filename: file});
		const room = Object.create(global.MainMenuRoom.prototype);
		room.parseFormats(['formats']);
		assert.deepEqual(sent, ['/cmd tcgformats']);
		const pending = loadTcgFormatMetadata();
		receiveTcgFormatMetadata(envelope(activeFormats()));
		assert.equal((await pending).formats.length, 5);
		sent.length = 0;
		room.parseFormats(['formats']);
		assert.deepEqual(sent, ['/cmd tcgformats']);
	});
});
