'use strict';


const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it, before, beforeEach} = require('node:test');
const vm = require('vm');

const webRoot = path.resolve(__dirname, '../play.pokemonshowdown.com');

global.window = global;
global.window.addEventListener = function () {};
global.window.removeEventListener = function () {};
global.toID = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
global.preact = {
	Component: function (props) {
		this.props = props || {};
		this.state = {};
	},
	h() { return null; },
	render() {},
};
global.preact.Component.prototype.forceUpdate = function () {};
global.preact.Component.prototype.setState = function (partial) {
	this.state = Object.assign({}, this.state, partial);
};
global.PS = {alerts: [], send() {}, alert(text) { this.alerts.push(text); }};
global.Net = function (url) {
	const file = path.join(webRoot, url.split('/').pop());
	return {get() { return Promise.resolve(fs.readFileSync(file, 'utf8')); }};
};

for (const name of ['battle-tcg-deck.js', 'panel-tcg-deck.js']) {
	const file = path.join(webRoot, 'js', name);
	vm.runInThisContext(fs.readFileSync(file, 'utf8'), {filename: file});
}
const {
	TcgDeckEditor, allTcgCards, deckProblemsClient, exportTcgDeck, getTcgCard, importTcgDeck, loadTcgCardIndex,
	packTcgDeck, tcgCardPrinting, tcgDeckCatalog, unpackTcgDeck,
} = global;

before(() => loadTcgCardIndex());

function idOf(line, format = 'custom') {
	const {ids, errors} = importTcgDeck(line, format);
	assert.deepEqual(errors, [], line);
	assert.ok(ids.length, line);
	return ids[0];
}

function errorOf(line, format = 'standard') {
	const {ids, errors} = importTcgDeck(line, format);
	assert.deepEqual(ids, [], `${line} must not import anything`);
	assert.equal(errors.length, 1, line);
	return errors[0];
}

const LOPUNNY_LIST = `Pokémon: 23
4 Duskull PRE 35
3 Dusclops PRE 36
3 Dusknoir PRE 37
2 Dunsparce JTG 120
1 Dunsparce TEF 128
2 Dudunsparce TEF 129
1 Dudunsparce ex JTG 121
2 Buneary PFL 83
2 Mega Lopunny ex PFL 84
1 Budew ASC 16
1 Fan Rotom SCR 118
1 Meowth ex POR 62

Trainer: 31
3 Lillie's Determination MEG 119
3 Boss's Orders MEG 114
3 Hilda WHT 84
2 Dawn PFL 87
4 Rare Candy MEG 125
4 Buddy-Buddy Poffin TEF 144
4 Poké Pad POR 81
2 Ultra Ball MEG 131
1 Night Stretcher ASC 196
2 Air Balloon ASC 181
3 Nighttime Mine ASC 197

Energy: 6
4 Mist Energy TEF 161
1 Enriching Energy SSP 191
1 Telepathic Psychic Energy POR 88

Total Cards: 60
`;

const LOPUNNY_PRINTINGS = {
	'sv8pt5-35': 4, 'sv8pt5-36': 3, 'sv8pt5-37': 3, 'sv9-120': 2, 'sv5-128': 1, 'sv5-129': 2, 'sv9-121': 1,
	'me2-83': 2, 'me2-84': 2, 'me2pt5-16': 1, 'sv7-118': 1, 'me3-62': 1,
	'me1-119': 3, 'me1-114': 3, 'rsv10pt5-84': 3, 'me2-87': 2, 'me1-125': 4, 'sv5-144': 4, 'me3-81': 4,
	'me1-131': 2, 'me2pt5-196': 1, 'me2pt5-181': 2, 'me2pt5-197': 3,
	'sv5-161': 4, 'sv8-191': 1, 'me3-88': 1,
};

const WORLDS_2013 = [
	['4 Darkrai-EX DEX 63', 'bw5-63', 4],
	['3 Sableye DEX 62', 'bw5-62', 3],
	['2 Keldeo-EX BCR 49', 'bw7-49', 2],
	['1 Mr. Mime PLF 47', 'bw9-47', 1],
	['4 Professor Juniper DEX 98', 'bw5-98', 4],
	['4 N DEX 96', 'bw5-96', 4],
	['4 Dark Patch DEX 93', 'bw5-93', 4],
	['3 Ultra Ball DEX 102', 'bw5-102', 3],
	['1 Computer Search BCR 137', 'bw7-137', 1],
	['10 Darkness Energy BLW 111', 'bw1-111', 10],
];

function countIds(ids) {
	const counts = {};
	for (const id of ids) counts[id] = (counts[id] || 0) + 1;
	return counts;
}

describe('TCG Live deck lists', () => {
	it('imports a normal list with section headers and a total', () => {
		const {ids, errors, warnings} = importTcgDeck(LOPUNNY_LIST, 'standard');
		assert.deepEqual(errors, []);
		assert.deepEqual(warnings, []);
		assert.equal(ids.length, 60);
		assert.deepEqual(countIds(ids), LOPUNNY_PRINTINGS);
	});

	it('reads the set code and number from the spec examples', () => {
		assert.equal(idOf('4 Darkrai-EX DEX 63'), 'bw5-63');
		assert.equal(idOf("2 Professor's Research SVI 189"), 'sv1-189');
	});

	it('resolves the exact printing when several share a name', () => {
		assert.equal(idOf('4 Darkrai-EX DEX 63'), 'bw5-63');
		assert.equal(idOf('4 Darkrai-EX DEX 107'), 'bw5-107');
		assert.equal(idOf('4 Darkrai-EX LTR 88'), 'bw11-88');
		assert.equal(idOf('4 Darkrai-EX BKP 74'), 'xy9-74');
		assert.equal(idOf('4 Ultra Ball DEX 102'), 'bw5-102');
		assert.equal(idOf('4 Ultra Ball SVI 196'), 'sv1-196');
		assert.equal(idOf('4 Ultra Ball MEG 131'), 'me1-131');
		assert.equal(idOf("2 Professor's Research SVI 190"), 'sv1-190');
		assert.equal(idOf("2 Professor's Research SVI 241"), 'sv1-241');
	});

	it('accepts a lower-case set code', () => {
		assert.equal(idOf('4 darkrai-ex dex 63'), 'bw5-63');
	});
});

describe('historical printing substitution', () => {
	const text = WORLDS_2013.map(([line]) => line).join('\n');

	it('keeps every printing of the reported Worlds 2013 list', () => {
		const {ids, errors, warnings} = importTcgDeck(text, 'custom');
		assert.deepEqual(errors, []);
		assert.deepEqual(warnings, []);
		const expected = {};
		for (const [, id, n] of WORLDS_2013) expected[id] = n;
		assert.deepEqual(countIds(ids), expected);
	});

	it('keeps those printings in Standard too, where they are reported as illegal', () => {
		const {ids, errors, warnings} = importTcgDeck(text, 'standard');
		assert.deepEqual(errors, []);
		assert.equal(ids[0], 'bw5-63');
		assert.ok(!ids.includes('svp-110'), 'not the modern Darkrai ex');
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /Not legal in Standard: Darkrai-EX \(DEX 63\)/);
	});

	it('never turns a paper Ho-Oh-EX into a Pocket Ho-Oh ex', () => {
		assert.equal(idOf('2 Ho-Oh-EX DRX 22', 'standard'), 'bw6-22');
		const byName = getTcgCard(idOf('2 Ho-Oh-EX', 'standard'));
		assert.equal(byName.n, 'Ho-Oh-EX');
		assert.equal(byName.k, 'p');
	});

	it('does not read a name search as a different card with a similar name', () => {
		assert.equal(getTcgCard(idOf('4 Darkrai-EX', 'standard')).n, 'Darkrai-EX');
		assert.equal(getTcgCard(idOf('4 Darkrai ex', 'standard')).n, 'Darkrai ex');
	});
});

describe('deck export', () => {
	it('writes quantity, printed name, official set code and number', () => {
		const deck = ['bw5-63', 'bw5-63', 'bw5-63', 'bw5-63', 'sv1-189', 'sv1-189', 'bw1-111'];
		assert.equal(exportTcgDeck(deck, 'live'), [
			'Pokémon: 4',
			'4 Darkrai-EX DEX 63',
			'',
			'Trainer: 2',
			"2 Professor's Research SVI 189",
			'',
			'Energy: 1',
			'1 Darkness Energy BLW 111',
			'',
			'Total Cards: 7',
			'',
		].join('\n'));
	});

	it('keeps the card id export as the default', () => {
		assert.equal(exportTcgDeck(['bw5-63']), 'Pokémon: 1\n1 Darkrai-EX bw5-63\n\nTrainer: 0\n\nEnergy: 0\n');
	});

	it('round-trips a full deck with its quantities', () => {
		const first = importTcgDeck(LOPUNNY_LIST, 'standard').ids;
		for (const style of ['live', 'ids']) {
			const again = importTcgDeck(exportTcgDeck(first, style), 'standard');
			assert.deepEqual(again.errors, []);
			assert.deepEqual(again.warnings, []);
			assert.deepEqual(countIds(again.ids), LOPUNNY_PRINTINGS);
		}
	});

	it('round-trips every card in the catalog in both styles', () => {
		for (const format of ['standard', 'pocket', 'custom']) {
			const cards = allTcgCards().filter(c => format === 'custom' || c.k === (format === 'pocket' ? 'k' : 'p'));
			assert.ok(cards.length > 3000);
			for (const style of ['live', 'ids']) {
				const failed = cards.filter(c => {
					const {ids} = importTcgDeck(exportTcgDeck([c.id, c.id], style), format);
					return ids.length !== 2 || ids[0] !== c.id || ids[1] !== c.id;
				});
				assert.deepEqual(failed.map(c => c.id), [], `${format} ${style}`);
			}
		}
	});

	it('exports a card id when a set has no official code, and does not invent one', () => {
		const card = allTcgCards().find(c => c.id.startsWith('pop1-'));
		assert.equal(tcgCardPrinting(card), null);
		const text = exportTcgDeck([card.id], 'live');
		assert.ok(text.includes(`1 ${card.n} ${card.id}\n`), text);
		assert.deepEqual(importTcgDeck(text, 'custom').ids, [card.id]);
	});

	it('leaves an unknown saved card visible instead of dropping it', () => {
		const text = exportTcgDeck(['bw5-63', 'gone-1'], 'live');
		assert.ok(text.includes('1 gone-1 gone-1'), text);
		assert.match(importTcgDeck(text, 'custom').errors[0], /gone-1/);
	});
});

describe('promos and special sets', () => {
	it('resolves promo sets by their official code', () => {
		assert.equal(idOf('4 Darkrai-EX PR-BLW BW46'), 'bwp-BW46');
		assert.equal(idOf('4 Darkrai ex PR-SV 110'), 'svp-110');
		assert.equal(idOf("4 Boss's Orders PR-SW SWSH251"), 'swshp-SWSH251');
		assert.equal(idOf('1 Aipom PR-SM SM244'), 'smp-SM244');
	});

	it('accepts a promo written by its set id, as Limitless writes SVP', () => {
		assert.equal(idOf('4 Darkrai ex SVP 110'), 'svp-110');
	});

	it('separates a set from the subset sharing its code by collector number', () => {
		assert.equal(idOf("1 Professor's Research BRS 147"), 'swsh9-147');
		assert.equal(getTcgCard(idOf(`1 ${getTcgCard('swsh9tg-TG24').n} BRS TG24`)).id, 'swsh9tg-TG24');
		assert.equal(idOf(`1 ${getTcgCard('swsh12pt5gg-GG57').n} CRZ GG57`), 'swsh12pt5gg-GG57');
		assert.equal(idOf(`1 ${getTcgCard('sma-SV81').n} HIF SV81`), 'sma-SV81');
		assert.equal(idOf('1 Alcremie SHF SV058'), 'swsh45sv-SV058');
	});

	it('separates cards sharing a code and number by name', () => {
		assert.equal(idOf('1 Lunala CEL 15'), 'cel25-15');
		assert.equal(idOf('1 Venusaur CEL 15'), 'cel25c-15_A1');
		assert.equal(idOf('1 Here Comes Team Rocket! CEL 15'), 'cel25c-15_A2');
		assert.equal(idOf("1 Rocket's Zapdos CEL 15"), 'cel25c-15_A3');
		assert.equal(idOf('1 Claydol CEL 15'), 'cel25c-15_A4');
		assert.equal(idOf('1 Palkia LV.X 30C 106'), 'me55c-106p');
		assert.equal(idOf('1 M Gardevoir-EX 30C 106'), 'me55c-106m');
	});

	it('reports a name that matches none of the cards at a shared number', () => {
		const error = errorOf('1 Pikachu CEL 15', 'custom');
		assert.match(error, /CEL 15 is .*Lunala \(cel25-15\)/);
		assert.match(error, /not "Pikachu"/);
	});
});

describe('collector numbers with letters and symbols', () => {
	it('keeps a lettered variant apart from the plain number', () => {
		assert.equal(idOf('1 Acerola BUS 112a'), 'sm3-112a');
		assert.equal(idOf('1 Acerola BUS 112A'), 'sm3-112a');
		assert.equal(idOf(`1 ${getTcgCard('sm3-112').n} BUS 112`), 'sm3-112');
	});

	it('reads word and prefixed numbers', () => {
		assert.equal(idOf('1 Alph Lithograph HS ONE'), 'hgss1-ONE');
		assert.equal(idOf('1 Alakazam SK H1'), 'ecard3-H1');
	});

	it('treats padded and unpadded numbers as the same printing', () => {
		assert.equal(idOf('1 Alcremie SHF SV58'), 'swsh45sv-SV058');
		assert.equal(idOf('1 Darkrai-EX DEX 063'), 'bw5-63');
		assert.equal(idOf(`1 ${getTcgCard('swsh9tg-TG05').n} BRS TG5`), 'swsh9tg-TG05');
	});

	it('uses catalog numbers that differ from the id', () => {
		assert.equal(idOf('1 Venusaur CEL 15_A1'), 'cel25c-15_A1');
		assert.equal(idOf('1 Antique Cover Fossil BLK 60'), 'zsv10pt5-80');
		assert.equal(idOf('1 Antique Cover Fossil BLK 80'), 'zsv10pt5-80');
		assert.equal(idOf('1 Escavalier BLK 60'), 'zsv10pt5-60');
	});

	it('has a set and number for every card that is not a generic Energy', () => {
		const orphans = allTcgCards().filter(c => {
			const set = c.k === 'k' ? c.set : c.id.slice(0, c.id.indexOf('-'));
			return !tcgDeckCatalog.sets[c.k].byId[set];
		});
		assert.deepEqual(orphans.map(c => c.id).sort(), ['energy-colorless', 'energy-fairy']);
	});
});

describe('names with punctuation and special characters', () => {
	it('matches apostrophes, ampersands and periods', () => {
		assert.equal(idOf("1 Farfetch'd TWM 132"), 'sv6-132');
		assert.equal(idOf('1 Farfetch’d TWM 132'), 'sv6-132');
		assert.equal(idOf('1 Anthea & Concordia ASC 182'), 'me2pt5-182');
		assert.equal(idOf("1 Billy & O'Nare JTG 142"), 'sv9-142');
		assert.equal(idOf('1 Mr. Mime TEF 63'), 'sv5-63');
		assert.equal(idOf('1 Nidoran ♀ JU 57'), 'base2-57');
	});

	it('matches with or without accents', () => {
		assert.equal(idOf('1 Flabébé TWM 86'), 'sv6-86');
		assert.equal(idOf('1 Flabebe TWM 86'), 'sv6-86');
		assert.equal(idOf('4 Poke Pad POR 81'), 'me3-81');
		assert.equal(getTcgCard(idOf('4 Poke Pad', 'standard')).n, 'Poké Pad');
	});

	it('reads a name ending in a number as a name, not a set and number', () => {
		assert.equal(getTcgCard(idOf('2 Pokégear 3.0', 'standard')).n, 'Pokégear 3.0');
		assert.equal(idOf('2 Pokégear 3.0 BLK 84'), 'zsv10pt5-84');
	});

	it('matches a print variant the catalog writes in brackets', () => {
		assert.equal(idOf("4 Boss's Orders PAL 172"), 'sv2-172');
		assert.equal(idOf("4 Boss's Orders (Ghetsis) PAL 172"), 'sv2-172');
	});

	it('keeps the two Basic Energy prints in SVE apart', () => {
		assert.equal(idOf('4 Grass Energy SVE 1'), 'sve-1');
		assert.equal(idOf('4 Basic Grass Energy SVE 9'), 'sve-9');
		assert.equal(idOf('4 Grass Energy SVE 9'), 'sve-9');
	});
});

const FESTIVAL_LEAD_LIST = `Pokémon: 22
3 Applin TWM 126
1 Applin TWM 17
3 Dipplin TWM 18
3 Grookey MEP 52
3 Thwackey TWM 15
2 Goldeen TWM 44
1 Seaking PRE 21
2 Rellor TEF 23
2 Rabsca TEF 24
1 Shaymin DRI 10
1 Psyduck ASC 39

Trainer: 33
4 Lillie's Determination MEG 119
2 Gladion's Final Battle PBL 77
2 Boss's Orders MEG 114
1 Lana's Aid TWM 155
1 Kieran TWM 154
4 Buddy-Buddy Poffin TEF 144
4 Poké Pad POR 81
3 Ultra Ball MEG 131
2 Night Stretcher ASC 196
1 Switch MEG 130
1 Secret Box TWM 163
2 Air Balloon ASC 181
2 Brave Bangle WHT 80
4 Festival Grounds TWM 149

Energy: 5
3 Growing Grass Energy POR 86
2 Grass Energy MEE 9

Total Cards: 60`;

const MEE_TYPES = [
	['Grass', 'G'], ['Fire', 'R'], ['Water', 'W'], ['Lightning', 'L'],
	['Psychic', 'P'], ['Fighting', 'F'], ['Darkness', 'D'], ['Metal', 'M'],
];

describe('Mega Evolution Energy and MEP promos', () => {
	it('resolves every MEE line the 25 tournament lists used to fail on', () => {
		const lines = {
			'14 Grass Energy MEE 9': 'mee-9',
			'3 Fire Energy MEE 10': 'mee-10',
			'3 Water Energy MEE 11': 'mee-11',
			'2 Lightning Energy MEE 12': 'mee-12',
			'4 Psychic Energy MEE 13': 'mee-13',
			'10 Fighting Energy MEE 14': 'mee-14',
			'8 Darkness Energy MEE 15': 'mee-15',
			'16 Metal Energy MEE 16': 'mee-16',
		};
		for (const [line, id] of Object.entries(lines)) {
			const {ids, errors} = importTcgDeck(line, 'standard');
			assert.deepEqual(errors, [], line);
			assert.equal(ids.length, Number(line.split(' ')[0]), line);
			assert.ok(ids.every(found => found === id), line);
		}
	});

	it('resolves the MEP promo to its own printing, not another Grookey', () => {
		assert.equal(idOf('3 Grookey MEP 52', 'standard'), 'mep-52');
		assert.equal(idOf('3 Grookey mep 052', 'standard'), 'mep-52');
		assert.equal(idOf('3 Grookey TWM 14', 'standard'), 'sv6-14');
	});

	it('imports a complete tournament list using both sets, with no warnings', () => {
		const {ids, errors, warnings} = importTcgDeck(FESTIVAL_LEAD_LIST, 'standard');
		assert.deepEqual(errors, []);
		assert.deepEqual(warnings, []);
		assert.equal(ids.length, 60);
		assert.equal(ids.filter(id => id === 'mep-52').length, 3);
		assert.equal(ids.filter(id => id === 'mee-9').length, 2);
		assert.deepEqual(deckProblemsClient(ids, 'standard'), []);
	});

	it('reads every name form a Basic Energy line can use', () => {
		MEE_TYPES.forEach(([type, symbol], i) => {
			for (const number of [i + 1, i + 9]) {
				for (const name of [`${type} Energy`, `Basic ${type} Energy`, `Basic {${symbol}} Energy`]) {
					assert.equal(idOf(`4 ${name} MEE ${number}`, 'standard'), `mee-${number}`, `${name} ${number}`);
				}
			}
		});
	});

	it('still reports a name that disagrees with the printing', () => {
		assert.match(errorOf('4 Fire Energy MEE 9'), /MEE 9 is Basic Grass Energy \(mee-9\), not "Fire Energy"/);
		assert.match(errorOf('4 Basic {R} Energy MEE 9'), /MEE 9 is Basic Grass Energy \(mee-9\)/);
		assert.match(errorOf('4 Basic {X} Energy MEE 9'), /MEE 9 is Basic Grass Energy \(mee-9\)/);
		assert.match(errorOf('3 Pikachu MEP 52'), /MEP 52 is Grookey \(mep-52\), not "Pikachu"/);
		assert.match(errorOf('3 Thwackey MEP 52'), /MEP 52 is Grookey \(mep-52\)/);
	});

	it('still reports an unknown collector number, with no same-name substitute', () => {
		assert.match(errorOf('4 Grass Energy MEE 17'), /MEE \(Mega Evolution Energy\) has no card numbered 17/);
		assert.match(errorOf('4 Grass Energy MEE 0'), /has no card numbered 0/);
		// MEP 111-117 are announced but not out yet (2026-11-14), so the catalog has no MEP 111.
		assert.match(errorOf('1 Grookey MEP 111'), /MEP \(MEP Black Star Promos\) has no card numbered 111/);
		assert.match(errorOf('1 Meganium MEP 0'), /has no card numbered 0/);
	});

	it('resolves the MEP promos with no effect text to their own printings', () => {
		const prints = {
			20: 'Sneasel', 27: 'Haunter', 40: 'Turtwig', 42: 'Piplup', 43: 'Rowlet', 46: 'Chikorita', 47: 'Cyndaquil',
			48: 'Totodile', 49: 'Snivy', 54: 'Sobble', 55: 'Treecko', 56: 'Torchic', 57: 'Mudkip', 59: 'Fennekin',
			60: 'Froakie', 61: 'Sprigatito', 63: 'Quaxly', 68: 'Makuhita', 69: 'Chikorita', 79: 'Charmeleon',
		};
		for (const [number, name] of Object.entries(prints)) {
			assert.equal(idOf(`2 ${name} MEP ${number}`, 'standard'), `mep-${number}`, name);
		}
		assert.notEqual(idOf('1 Chikorita MEP 46', 'standard'), idOf('1 Chikorita MEP 69', 'standard'));
		assert.equal(getTcgCard('mep-27').ef, 'Gastly');
		assert.equal(getTcgCard('mep-79').ef, 'Charmander');
	});

	it('reads the lines Limitless writes for TCG Live', () => {
		assert.equal(idOf('3 Grookey MEP 52', 'standard'), 'mep-52');
		assert.equal(idOf('2 Grass Energy MEE 9', 'standard'), 'mee-9');
		assert.equal(idOf('1 Terapagos ex PR-SV 165', 'standard'), 'svp-165');
		assert.equal(idOf('1 Alakazam V PR-SW SWSH083'), 'swshp-SWSH083');
	});

	it('reports the older Live forms it cannot map, and never picks another printing', () => {
		for (const line of [
			"1 Acerola's Premonition BRS-TG 24",
			'1 Deoxys CRZ-GG 12',
			'1 Charizard GEN-RC 5',
			'1 Pheromosa HIF 74',
			'1 Grass Energy Energy 45',
			'3 Grookey MEP 52 PH',
			'2 Grass Energy SVALT 1',
		]) {
			const {ids, errors} = importTcgDeck(line, 'custom');
			assert.deepEqual(ids, [], line);
			assert.equal(errors.length, 1, line);
		}
	});

	it('resolves the MEP promos whose printed text needs a script, now that each has one', () => {
		// These were left out until their scripts existed; they were added on 2026-11-14.
		const prints = {1: 'Meganium', 50: 'Tepig', 51: 'Oshawott', 53: 'Scorbunny', 110: 'Umbreon ex'};
		for (const [number, name] of Object.entries(prints)) {
			assert.equal(idOf(`1 ${name} MEP ${number}`, 'standard'), `mep-${number}`, name);
		}
		assert.match(errorOf('1 Tepig MEP 111'), /has no card numbered 111/);
	});

	it('resolves SVE 17-24 as their own printings, in the right type order', () => {
		MEE_TYPES.forEach(([type, symbol], i) => {
			const id = `sve-${i + 17}`;
			for (const name of [`${type} Energy`, `Basic ${type} Energy`, `Basic {${symbol}} Energy`]) {
				assert.equal(idOf(`4 ${name} SVE ${i + 17}`, 'standard'), id, name);
			}
			assert.equal(getTcgCard(id).be, 1);
			assert.deepEqual(getTcgCard(id).t, [type.toLowerCase()]);
		});
		assert.match(errorOf('4 Fire Energy SVE 17'), /SVE 17 is Basic Grass Energy \(sve-17\)/);
	});

	it('still reports a number past the end of SVE', () => {
		assert.match(errorOf('4 Metal Energy SVE 25'), /has no card numbered 25/);
	});

	it('keeps same-name Basic Energy printings apart', () => {
		const prints = {'MEE 1': 'mee-1', 'MEE 9': 'mee-9', 'SVE 1': 'sve-1', 'SVE 9': 'sve-9', 'SVE 17': 'sve-17'};
		for (const [printing, id] of Object.entries(prints)) {
			assert.equal(idOf(`4 Grass Energy ${printing}`, 'standard'), id);
		}
		const mixed = Object.values(prints);
		const {ids} = importTcgDeck(exportTcgDeck(mixed, 'live'), 'standard');
		assert.deepEqual(ids.slice().sort(), mixed.slice().sort());
	});

	it('exports the new printings as Live lines and reads them back', () => {
		assert.match(exportTcgDeck(['mee-13', 'mee-13'], 'live'), /^2 Basic Psychic Energy MEE 13$/m);
		assert.match(exportTcgDeck(['mep-52'], 'live'), /^1 Grookey MEP 52$/m);
		for (let number = 1; number <= 16; number++) {
			const {ids, errors} = importTcgDeck(exportTcgDeck([`mee-${number}`], 'live'), 'standard');
			assert.deepEqual(errors, []);
			assert.deepEqual(ids, [`mee-${number}`]);
		}
	});

	it('keeps paper printings out of Pocket decks', () => {
		for (const line of ['2 Grass Energy MEE 9', '3 Grookey MEP 52', '2 mee-9', '3 mep-52']) {
			const {ids, errors} = importTcgDeck(line, 'pocket');
			assert.deepEqual(ids, [], line);
			assert.equal(errors.length, 1, line);
		}
		assert.equal(importTcgDeck('["mee-9"]', 'pocket').errors.length, 1);
		assert.equal(tcgDeckCatalog.sets.k.byId.mee, undefined);
		assert.equal(tcgDeckCatalog.sets.k.byId.mep, undefined);
	});

	it('imports the new printings through the existing id and JSON formats', () => {
		assert.deepEqual(importTcgDeck('2 mee-9', 'standard').ids, ['mee-9', 'mee-9']);
		assert.deepEqual(importTcgDeck('2 Basic Grass Energy mee-9', 'standard').ids, ['mee-9', 'mee-9']);
		assert.deepEqual(importTcgDeck('["mep-52","mee-16"]', 'standard').ids, ['mep-52', 'mee-16']);
		assert.deepEqual(unpackTcgDeck(packTcgDeck(['mep-52', 'mee-16'])), ['mep-52', 'mee-16']);
	});

	it('fails the whole list when one line is a printing the catalog lacks', () => {
		const {ids, errors} = importTcgDeck('14 Grass Energy MEE 9\n3 Grookey MEP 52\n4 Grass Energy MEE 17', 'standard');
		assert.deepEqual(ids, []);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /^Line 3 /);
	});

	it('adds each printing to the catalog once, as paper', () => {
		const rows = allTcgCards();
		assert.equal(new Set(rows.map(c => c.id)).size, rows.length);
		const added = rows.filter(c => /^(mee|mep)-/.test(c.id));
		// MEE 1-16 and MEP 1-110 (every MEP promo out on 2026-11-14).
		assert.equal(added.length, 16 + 110);
		assert.ok(added.every(c => c.k === 'p' && c.pkt === 0 && c.std === 1));
		assert.ok(added.filter(c => c.id.startsWith('mee-')).every(c => c.be === 1 && c.t.length === 1));
		assert.deepEqual(MEE_TYPES.map(([type], i) => getTcgCard(`mee-${i + 9}`).n), MEE_TYPES.map(([type]) => `Basic ${type} Energy`));
		assert.equal(getTcgCard('mep-52').r, 'J');
		for (const code of ['MEE', 'MEP']) assert.equal(tcgDeckCatalog.sets.p.byCode[code].length, 1, code);
	});

	it('still warns on a name-only line, which has no printing to be exact about', () => {
		for (const name of ['Grookey', 'Basic Grass Energy']) {
			const {errors, warnings} = importTcgDeck(`2 ${name}`, 'standard');
			assert.deepEqual(errors, [], name);
			assert.match(warnings.join('\n'), new RegExp(`Multiple prints of ${name}`), name);
		}
	});
});

describe('import errors', () => {
	it('reports an unknown set code with the line and the catalog printings', () => {
		const error = errorOf('4 Darkrai-EX XYZ 63');
		assert.match(error, /^Line 1 \(4 Darkrai-EX XYZ 63\): Unknown set code "XYZ"/);
		assert.match(error, /Printings of Darkrai-EX in this catalog: .*DEX 63/);
	});

	it('reports a set missing from the catalog, with no same-name substitute', () => {
		const error = errorOf('14 Grass Energy ZZZ 9');
		assert.match(error, /Unknown set code "ZZZ"/);
		assert.match(error, /Printings of Grass Energy in this catalog: SVE 1,/);
		assert.match(errorOf('3 Grookey ZZZ 52'), /Unknown set code "ZZZ"/);
	});

	it('reports an unknown collector number and never falls back to the name', () => {
		const error = errorOf('4 Darkrai-EX DEX 999');
		assert.match(error, /DEX \(Dark Explorers\) has no card numbered 999/);
		assert.match(error, /Printings of Darkrai-EX in this catalog: .*DEX 63/);
	});

	it('reports a name that disagrees with the set and number', () => {
		const error = errorOf('4 Pikachu DEX 63');
		assert.match(error, /DEX 63 is Darkrai-EX \(bw5-63\), not "Pikachu"/);
	});

	it('rejects invalid quantities', () => {
		for (const qty of ['0', '61', '100', '-1', '1.5', '+2', '00']) {
			assert.match(errorOf(`${qty} Darkrai-EX DEX 63`), /Invalid quantity/, qty);
		}
		assert.equal(importTcgDeck('60 Darkness Energy BLW 111', 'custom').ids.length, 60);
		assert.equal(importTcgDeck('4x Darkrai-EX DEX 63', 'custom').ids.length, 4);
	});

	it('rejects malformed lines', () => {
		assert.match(errorOf('4'), /Missing card after the quantity/);
		assert.match(errorOf('hello world'), /Could not find card "hello world"/);
		assert.match(errorOf('4 @@@ ###'), /Could not find card/);
		assert.match(errorOf('Energy: lots'), /Could not find card/);
	});

	it('reports every bad line by number, and imports nothing', () => {
		const {ids, errors} = importTcgDeck('4 Darkrai-EX DEX 63\n\n4 Nothing XYZ 1\n0 N DEX 96\n', 'custom');
		assert.deepEqual(ids, []);
		assert.equal(errors.length, 2);
		assert.match(errors[0], /^Line 3 /);
		assert.match(errors[1], /^Line 4 /);
	});

	it('fails an empty list instead of emptying the deck', () => {
		assert.match(importTcgDeck('  \n ', 'standard').errors[0], /Nothing to import/);
		assert.match(importTcgDeck('Pokémon: 0\nTrainer: 0\nEnergy: 0\n', 'standard').errors[0], /no cards/);
		assert.match(importTcgDeck('[]', 'standard').errors[0], /no cards/);
	});

	it('warns when a card is listed twice, and counts both lines', () => {
		const {ids, warnings} = importTcgDeck('2 Darkrai-EX DEX 63\n1 N DEX 96\n3 Darkrai-EX bw5-63', 'custom');
		assert.equal(ids.filter(id => id === 'bw5-63').length, 5);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /Line 3 repeats Darkrai-EX \(bw5-63\) from line 1/);
	});

	it('reads no set-code line by name when the set index failed to load', () => {
		const sets = tcgDeckCatalog.sets;
		tcgDeckCatalog.sets = null;
		try {
			assert.match(errorOf('4 Darkrai-EX DEX 63'), /Set codes did not load/);
			assert.equal(idOf('4 Darkrai-EX bw5-63'), 'bw5-63');
		} finally {
			tcgDeckCatalog.sets = sets;
		}
	});
});

describe('existing import formats', () => {
	it('imports card id lines, as the old export wrote them', () => {
		assert.deepEqual(importTcgDeck('4 Abomasnow sv10-60', 'standard').ids, Array(4).fill('sv10-60'));
		assert.equal(idOf('1 Abomasnow sv10 60'), 'sv10-60');
	});

	it('imports bare card ids on lines, or split by spaces and commas', () => {
		assert.deepEqual(importTcgDeck('bw5-63\nbw5-62', 'custom').ids, ['bw5-63', 'bw5-62']);
		assert.deepEqual(importTcgDeck('bw5-63 bw5-62, bw5-96', 'custom').ids, ['bw5-63', 'bw5-62', 'bw5-96']);
	});

	it('imports a JSON id array', () => {
		assert.deepEqual(importTcgDeck('["bw5-63","bw5-62"]', 'custom').ids, ['bw5-63', 'bw5-62']);
		assert.match(importTcgDeck('["nope-1"]', 'custom').errors[0], /Unknown card id: nope-1/);
		assert.match(importTcgDeck('[bad', 'custom').errors[0], /not a valid JSON array/);
		assert.match(importTcgDeck('["bw5-63", 4]', 'custom').errors[0], /array of card ids/);
	});

	it('reads an old export back to the same deck', () => {
		const deck = importTcgDeck(LOPUNNY_LIST, 'standard').ids;
		assert.deepEqual(countIds(importTcgDeck(exportTcgDeck(deck), 'standard').ids), LOPUNNY_PRINTINGS);
	});

	it('reports an id line whose name disagrees with the id', () => {
		assert.match(errorOf('4 Pikachu bw5-63'), /bw5-63 is Darkrai-EX, not "Pikachu"/);
	});

	it('leaves saved decks unchanged', () => {
		const packed = packTcgDeck(['bw5-63', 'bw5-63', 'sv1-189']);
		assert.equal(packed, '["bw5-63","bw5-63","sv1-189"]');
		assert.deepEqual(unpackTcgDeck(packed), ['bw5-63', 'bw5-63', 'sv1-189']);
	});

	it('still finds a card from a line with no printing information', () => {
		const {ids, warnings} = importTcgDeck('4 Ultra Ball', 'standard');
		assert.equal(ids.length, 4);
		assert.ok(getTcgCard(ids[0]).std, 'prefers a legal print');
		assert.match(warnings[0], /^Line 1: Multiple prints of Ultra Ball; using /);
	});
});

describe('Limitless and TCG Online list layouts', () => {
	it('imports the Limitless text export', () => {
		const list = 'Pokémon: 4\n4 Abomasnow DRI 60\n\nTrainer: 3\n3 Ultra Ball MEG 131\n\nEnergy: 1\n1 Mist Energy TEF 161\n';
		const {ids, errors} = importTcgDeck(list, 'standard');
		assert.deepEqual(errors, []);
		assert.deepEqual(countIds(ids), {'sv10-60': 4, 'me1-131': 3, 'sv5-161': 1});
	});

	it('imports a TCG Online export with its banner and bullets', () => {
		const list = [
			'****** Pokémon Trading Card Game Deck List ******',
			'',
			'##Pokémon - 4',
			'',
			'* 4 Darkrai-EX DEX 63',
			'',
			'##Trainer Cards - 3',
			'',
			'* 3 Ultra Ball DEX 102',
			'',
			'##Energy - 1',
			'',
			'* 1 Darkness Energy BLW 111',
			'',
			'Total Cards - 8',
			'',
			'****** Deck List Generated by the Pokémon TCG Online ******',
		].join('\r\n');
		const {ids, errors} = importTcgDeck(list, 'custom');
		assert.deepEqual(errors, []);
		assert.deepEqual(countIds(ids), {'bw5-63': 4, 'bw5-102': 3, 'bw1-111': 1});
	});

	it('mixes line styles in one list', () => {
		const {ids, errors} = importTcgDeck('1 Darkrai-EX DEX 63\n1 Abomasnow sv10-60\nbw5-62', 'custom');
		assert.deepEqual(errors, []);
		assert.deepEqual(ids, ['bw5-63', 'sv10-60', 'bw5-62']);
	});
});

describe('paper and Pocket catalogs', () => {
	it('reads a code both games use from the deck format', () => {
		assert.equal(idOf('1 Clefable B2 5', 'standard'), 'base4-5');
		assert.equal(idOf('1 Ledyba B2 1', 'pocket'), 'B2-001');
	});

	it('reports a card from the other game instead of matching it', () => {
		assert.match(errorOf('1 Ledyba B2 1', 'standard'), /B2 1 is .*\(base4-1\), not "Ledyba"/);
		assert.match(errorOf('1 Clefable B2 5', 'pocket'), /B2 5 is .*\(B2-005\), not "Clefable"/);
	});

	it('rejects a set from the other game', () => {
		assert.match(errorOf('2 Bulbasaur A1 1', 'standard'), /A1 is a TCG Pocket set, so it cannot go in a Standard deck/);
		assert.match(errorOf('4 Ultra Ball SVI 196', 'pocket'), /SVI is a paper set, so it cannot go in a Pocket deck/);
	});

	it('rejects ids from the other game in every id style', () => {
		const wrong = /Bulbasaur \(A1-001\) is a TCG Pocket card, so it cannot go in a Standard deck/;
		assert.match(errorOf('2 Bulbasaur A1-001', 'standard'), wrong);
		assert.match(errorOf('A1-001', 'standard'), wrong);
		assert.match(importTcgDeck('["A1-001"]', 'standard').errors[0], wrong);
		assert.match(errorOf('bw5-63', 'pocket'), /is a paper card, so it cannot go in a Pocket deck/);
	});

	it('searches names only in the deck game', () => {
		assert.equal(getTcgCard(idOf('2 Bulbasaur', 'pocket')).k, 'k');
		assert.equal(getTcgCard(idOf('2 Bulbasaur', 'standard')).k, 'p');
		assert.match(errorOf('2 Dark Patch', 'pocket'), /Could not find card/);
	});

	it('imports Pocket lines by set id, with or without padding', () => {
		assert.equal(idOf('2 Bulbasaur A1 1', 'pocket'), 'A1-001');
		assert.equal(idOf('2 Bulbasaur A1 001', 'pocket'), 'A1-001');
		assert.equal(idOf("2 Professor's Research P-A 7", 'pocket'), 'P-A-007');
		// C1 (Dual Fusion) has no paper ptcgoCode; Pocket lists use the set id as the list code.
		assert.equal(idOf('2 Bulbasaur C1 1', 'pocket'), 'C1-001');
		assert.equal(idOf('2 Bulbasaur C1 001', 'pocket'), 'C1-001');
		const c1 = getTcgCard('C1-001');
		assert.equal(c1.k, 'k');
		assert.equal(c1.set, 'C1');
		assert.deepEqual(tcgCardPrinting(c1), {code: 'C1', number: '001'});
		const live = exportTcgDeck(['C1-001', 'C1-001'], 'live');
		assert.ok(live.includes('2 Bulbasaur C1 001'), live);
		assert.deepEqual(importTcgDeck(live, 'pocket').ids, ['C1-001', 'C1-001']);
	});

	it('takes both games in Custom Game, as the server allows, with paper first for a bare name', () => {
		assert.equal(idOf('1 Ledyba B2 1', 'custom'), 'B2-001');
		assert.equal(idOf('1 Clefable B2 5', 'custom'), 'base4-5');
		assert.equal(getTcgCard(idOf('2 Bulbasaur', 'custom')).k, 'p');
	});

	it('prefers an exact official code over a set id in another case', () => {
		assert.equal(idOf("1 Erika's Vileplume G1 5"), 'gym1-5');
		assert.equal(idOf('1 Butterfree GEN 5'), 'g1-5');
		assert.equal(idOf('1 Butterfree g1 5'), 'g1-5');
	});
});

describe('legality after import', () => {
	it('passes a legal list through deck validation', () => {
		assert.deepEqual(deckProblemsClient(importTcgDeck(LOPUNNY_LIST, 'standard').ids, 'standard'), []);
	});

	it('validates the imported printing, not a legal reprint of it', () => {
		const {ids, warnings} = importTcgDeck('4 Darkrai-EX DEX 63', 'standard');
		assert.equal(ids.length, 4);
		assert.match(warnings[0], /These printings were kept/);
		assert.ok(deckProblemsClient(ids, 'standard').some(p => /Not legal in Standard: Darkrai-EX \(bw5-63/.test(p)));
	});

	it('leaves deck-building limits to validation', () => {
		const {ids, errors} = importTcgDeck('5 Ultra Ball MEG 131', 'standard');
		assert.deepEqual(errors, []);
		assert.ok(deckProblemsClient(ids, 'standard').some(p => /Too many copies: Ultra Ball/.test(p)));
	});

	it('raises no legality warning in Custom Game', () => {
		assert.deepEqual(importTcgDeck('4 Darkrai-EX DEX 63', 'custom').warnings, []);
		assert.deepEqual(deckProblemsClient(Array(4).fill('bw5-63'), 'custom'), []);
	});
});

describe('deck builder Import/Export tab', () => {
	const SAVED = ['sv1-196', 'sv1-196', 'bw5-63'];
	let team, changes, editor;

	beforeEach(async () => {
		global.PS.alerts = [];
		changes = 0;
		team = {name: 'Saved', format: 'tcgcustomgame', packedTeam: packTcgDeck(SAVED), key: 'k', folder: '', iconCache: null};
		editor = new TcgDeckEditor({team, onChange() { changes++; }});
		editor.componentDidMount();
		await loadTcgCardIndex();
		await Promise.resolve();
		editor.setMode('import');
	});

	function paste(text) {
		editor.onImportInput({currentTarget: {value: text}});
	}

	function assertDeckKept() {
		assert.equal(team.packedTeam, packTcgDeck(SAVED));
		assert.deepEqual(editor.state.ids, SAVED);
		assert.equal(changes, 0);
		assert.equal(editor.state.mode, 'import', 'stays on the tab so the list can be fixed');
	}

	for (const [label, text] of [
		['one bad line among good ones', '4 Darkrai-EX DEX 63\n4 Nothing XYZ 1'],
		['an unknown collector number', '4 Darkrai-EX DEX 999'],
		['an invalid quantity', '0 Darkrai-EX DEX 63'],
		['a malformed JSON array', '["bw5-63"'],
		['an empty box', ''],
		['a list with only headers', 'Pokémon: 0\nTrainer: 0'],
	]) {
		it(`keeps the saved deck and the pasted text on ${label}`, () => {
			paste(text);
			editor.applyImport();
			assertDeckKept();
			assert.equal(editor.state.importText, text);
			assert.ok(editor.state.importErrors.length, 'shows why');
		});
	}

	const afterClick = () => new Promise(resolve => { setTimeout(resolve); });

	it('replaces the deck on a clean import', async () => {
		paste('4 Darkrai-EX DEX 63\n3 Ultra Ball DEX 102');
		editor.applyImport();
		assert.deepEqual(unpackTcgDeck(team.packedTeam), [...Array(4).fill('bw5-63'), ...Array(3).fill('bw5-102')]);
		assert.equal(changes, 1);
		assert.equal(editor.state.mode, 'deck');
		assert.equal(editor.state.importErrors, null);
		await afterClick();
		assert.deepEqual(global.PS.alerts, []);
	});

	it('shows warnings after an import that succeeded', async () => {
		paste('2 Darkrai-EX DEX 63\n1 Darkrai-EX DEX 63');
		editor.applyImport();
		assert.equal(unpackTcgDeck(team.packedTeam).length, 3);
		await afterClick();
		assert.match(global.PS.alerts[0], /repeats Darkrai-EX/);
	});

	it('opens the warning after the click, because that click would close it', async () => {
		paste('1 Basic Grass Energy');
		editor.applyImport();
		assert.deepEqual(global.PS.alerts, [], 'nothing opens while the click is still running');
		await afterClick();
		assert.match(global.PS.alerts[0], /Multiple prints of Basic Grass Energy/);
	});

	it('opens on the TCG Live export and can switch to card ids', () => {
		assert.match(editor.state.importText, /2 Ultra Ball SVI 196/);
		editor.setExportStyle('ids');
		assert.match(editor.state.importText, /2 Ultra Ball sv1-196/);
		assert.equal(editor.state.importDirty, false);
		editor.setExportStyle('live');
		assert.match(editor.state.importText, /2 Ultra Ball SVI 196/);
	});

	it('renders both export styles and marks the current one', () => {
		const realH = global.preact.h;
		const buttons = [];
		global.preact.h = (type, props, ...children) => {
			if (type === 'button') buttons.push({class: props.class, text: children.join('').trim()});
			return {type, props, children};
		};
		try {
			editor.renderImportExport();
		} finally {
			global.preact.h = realH;
		}
		const live = buttons.find(b => b.text === 'TCG Live');
		const ids = buttons.find(b => b.text === 'Card ids');
		assert.ok(live.class.includes('cur'));
		assert.ok(!ids.class.includes('cur'));
	});

	it('keeps text the player edited when the export style changes', () => {
		paste('1 Darkrai-EX DEX 63');
		editor.setExportStyle('ids');
		assert.equal(editor.state.importText, '1 Darkrai-EX DEX 63');
		assert.equal(editor.state.importDirty, true);
	});
});

describe('deck builder card browser pages', () => {
	const PAGE_SIZE = 40;
	let editor;

	async function open(format, ids = []) {
		const team = {name: 'Saved', format, packedTeam: packTcgDeck(ids), key: 'k', folder: '', iconCache: null};
		const next = new TcgDeckEditor({team, onChange() {}});
		next.componentDidMount();
		await loadTcgCardIndex();
		await Promise.resolve();
		return next;
	}

	function allPages() {
		const results = editor.filteredCards();
		const {pageCount} = editor.resultPage(results);
		const seen = [];
		for (let page = 0; page < pageCount; page++) {
			editor.goToPage(page);
			seen.push(...editor.resultPage(results).cards);
		}
		return seen;
	}

	beforeEach(async () => { editor = await open('tcgstandard'); });

	it('reaches every Standard card, not only the first 120', () => {
		const results = editor.filteredCards();
		assert.ok(results.length > 120, `${results.length} results`);
		assert.deepEqual(allPages().map(c => c.id), results.map(c => c.id));
	});

	it('shows at most 40 cards on a page', () => {
		const results = editor.filteredCards();
		const {pageCount, cards} = editor.resultPage(results);
		assert.equal(cards.length, PAGE_SIZE);
		assert.equal(pageCount, Math.ceil(results.length / PAGE_SIZE));
		editor.goToPage(pageCount - 1);
		const last = editor.resultPage(results);
		assert.equal(last.cards.length, results.length - (pageCount - 1) * PAGE_SIZE);
		assert.ok(last.cards.length >= 1 && last.cards.length <= PAGE_SIZE);
	});

	it('reaches a card named late in the alphabet', () => {
		const results = editor.filteredCards();
		const last = results[results.length - 1];
		assert.ok(results.indexOf(last) >= 120);
		assert.ok(allPages().includes(last));
	});

	for (const [label, change] of [
		['search', e => e.setFilters({q: 'pikachu'})],
		['card kind', e => e.setFilters({super: 'E'})],
		['type', e => e.setFilters({type: 'fire'})],
		['regulation', e => e.setFilters({reg: 'J'})],
	]) {
		it(`returns to the first page when the ${label} filter changes`, () => {
			editor.goToPage(3);
			change(editor);
			assert.equal(editor.state.page, 0);
		});
	}

	it('applies the filters to every page', () => {
		editor.setFilters({super: 'E'});
		const pages = allPages();
		assert.ok(pages.length > 0);
		assert.ok(pages.every(c => c.s === 'E'));
	});

	it('falls back to the last page when a saved page is past the end', () => {
		editor.setState({page: 9999});
		const results = editor.filteredCards();
		const {page, pageCount, cards} = editor.resultPage(results);
		assert.equal(page, pageCount - 1);
		assert.ok(cards.length > 0);
	});

	it('treats no results as one empty page', () => {
		editor.setFilters({q: 'zzzznothingmatchesthis'});
		const {page, pageCount, cards} = editor.resultPage(editor.filteredCards());
		assert.deepEqual([page, pageCount, cards], [0, 1, []]);
	});

	it('keeps the page and the filtered list when the deck changes', () => {
		const results = editor.filteredCards();
		editor.goToPage(5);
		editor.addCard(results[0].id);
		assert.equal(editor.state.page, 5);
		assert.equal(editor.filteredCards(), results, 'a deck change does not filter the catalog again');
	});

	it('filters again when a filter changes', () => {
		const results = editor.filteredCards();
		editor.setFilters({super: 'T'});
		assert.notEqual(editor.filteredCards(), results);
		assert.ok(editor.filteredCards().every(c => c.s === 'T'));
	});

	it('starts from the first page when the deck changes format', () => {
		editor.goToPage(5);
		editor.props.team.format = 'tcgpocket';
		editor.componentDidUpdate(editor.props);
		assert.equal(editor.state.page, 0);
		assert.equal(editor.state.format, 'pocket');
		assert.ok(editor.filteredCards().every(c => c.k === 'k'));
	});

	it('pages through both games in a Custom Game deck', async () => {
		editor = await open('tcgcustomgame');
		const results = editor.filteredCards();
		assert.equal(results.length, allTcgCards().length);
		assert.equal(editor.resultPage(results).cards.length, PAGE_SIZE);
	});
});
