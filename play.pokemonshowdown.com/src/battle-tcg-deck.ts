/**
 * tcg deck packing and client-side legality helpers. a packed tcg team is a JSON array of card ids (see the
 * server's parseTcgDeck).
 * don't define a local `toID` here. babel turns imports into globals, so it would overwrite Dex's and break
 * PSIcon / getPokemonIcon
 */

import { toID } from "./battle-dex";
import { Net } from "./client-connection";

export type TcgCardRow = {
	id: string,
	n: string,
	/** P / T / E */
	s: string,
	u: string[],
	t: string[],
	set: string,
	r: string,
	/** p = paper, k = pocket */
	k: string,
	i: string,
	std: number,
	pkt: number,
	b: number,
	be: number,
	ace: number,
	rad: number,
	prism: number,
	/** name it evolves from, not set on basics */
	ef?: string,
	/** energy types its attacks need, not counting colorless. not set when there are none */
	ec?: string[],
	/** date it becomes standard-legal (`YYYY-MM-DD`), if that was still ahead at build time */
	lf?: string,
	/**
- The name used for copy counting. canonicalCardName removes reviewed character
- labels (e.g. "Boss's Orders (Ghetsis)" becomes "Boss's Orders"). Unmapped cards
- keep their original name. But this is only a temp solution, i have plans for it at a bigger level engine-side.
  */
	cn?: string,
};

export type TcgDeckFormat = 'standard' | 'pocket' | 'custom';

export type TcgDeckRules = {
	id: TcgDeckFormat,
	minDeckSize?: number,
	name: string,
	deckSize: number,
	copyLimit: number,
	energyZone: boolean,
	allowAceSpec: boolean,
	allowRadiant: boolean,
	/** showdown format id prefix, without the gen */
	psFormat: string,
};

export const TCG_DECK_RULES: { [id in TcgDeckFormat]: TcgDeckRules } = {
	standard: {
		id: 'standard',
		name: 'Standard',
		deckSize: 60,
		copyLimit: 4,
		energyZone: false,
		allowAceSpec: true,
		allowRadiant: true,
		psFormat: 'tcgstandard',
	},
	pocket: {
		id: 'pocket',
		name: 'Pocket',
		deckSize: 20,
		copyLimit: 2,
		energyZone: true,
		allowAceSpec: false,
		allowRadiant: false,
		psFormat: 'tcgpocket',
	},
	custom: {
		id: 'custom',
		name: 'Custom Game',
		minDeckSize: 1,
		deckSize: 60,
		copyLimit: 60,
		energyZone: false,
		allowAceSpec: true,
		allowRadiant: true,
		psFormat: 'tcgcustomgame',
	},
};

/** a paper set with no official code has no `code` */
export type TcgSetRow = { id: string, name: string, code?: string };

type TcgSetIndex = {
	paper: TcgSetRow[],
	pocket: TcgSetRow[],
	/** collector numbers for cards whose id isn't `set-number` */
	numbers: { [id: string]: string },
};

type TcgSetLookup = {
	byId: { [id: string]: TcgSetRow },
	/** some codes cover two sets, like a set and its trainer gallery */
	byCode: { [code: string]: TcgSetRow[] },
	byLower: { [token: string]: TcgSetRow[] },
};

const tcgDeckCatalog: {
	rows: TcgCardRow[] | null,
	byId: { [id: string]: TcgCardRow },
	byIdLower: { [id: string]: TcgCardRow },
	byName: { [name: string]: TcgCardRow[] },
	/** keyed by game (row `k`). null if tcg-sets-index.json didn't load */
	sets: { [game: string]: TcgSetLookup } | null,
	numbers: { [id: string]: string },
	/** cards by `game|setId|numberKey` */
	byPrinting: { [key: string]: TcgCardRow[] },
	searchText: string[] | null,
	marks: { [format: string]: string[] },
	loadPromise: Promise<TcgCardRow[]> | null,
	loadFailed: boolean,
} = {
	rows: null,
	byId: Object.create(null) as { [id: string]: TcgCardRow },
	byIdLower: Object.create(null) as { [id: string]: TcgCardRow },
	byName: Object.create(null) as { [name: string]: TcgCardRow[] },
	sets: null,
	numbers: Object.create(null) as { [id: string]: string },
	byPrinting: Object.create(null) as { [key: string]: TcgCardRow[] },
	searchText: null,
	marks: Object.create(null) as { [format: string]: string[] },
	loadPromise: null,
	loadFailed: false,
};

function tcgPrintedName(name: string): string {
	return name.replace(/\s*\([^)]*\)\s*$/, '');
}

const TCG_ENERGY_SYMBOLS: { [symbol: string]: string } = {
	G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy',
};

/** compares names across deck lists: ignores accents, punctuation, print variants and `Basic` on energy */
function tcgNameKey(name: string): string {
	const plain = tcgPrintedName(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
		.replace(/\{([A-Z])\}/g, (symbol, letter: string) => TCG_ENERGY_SYMBOLS[letter] || symbol);
	return toID(plain.replace(/^basic\s+(?=.*energy\s*$)/i, ''));
}

/** `TG01` and `tg1` are the same, `112` and `112a` aren't */
function tcgNumberKey(num: string): string {
	return num.toUpperCase().replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
}

/** a paper row has no set in the index, but paper set ids never have a hyphen */
function tcgCardSetId(c: TcgCardRow): string {
	return c.k === 'k' ? c.set : c.id.slice(0, c.id.indexOf('-'));
}

function tcgCardNumber(c: TcgCardRow): string {
	return tcgDeckCatalog.numbers[c.id] ?? c.id.slice(tcgCardSetId(c).length + 1);
}

function indexTcgSets(index: TcgSetIndex) {
	const lookup = (rows: TcgSetRow[]) => {
		const sets: TcgSetLookup = {
			byId: Object.create(null) as TcgSetLookup['byId'],
			byCode: Object.create(null) as TcgSetLookup['byCode'],
			byLower: Object.create(null) as TcgSetLookup['byLower'],
		};
		const addLower = (token: string, set: TcgSetRow) => {
			const list = sets.byLower[token.toLowerCase()] ||= [];
			if (!list.includes(set)) list.push(set);
		};
		for (const set of rows) {
			sets.byId[set.id] = set;
			addLower(set.id, set);
			if (!set.code) continue;
			(sets.byCode[set.code] ||= []).push(set);
			addLower(set.code, set);
		}
		return sets;
	};
	tcgDeckCatalog.sets = { p: lookup(index.paper), k: lookup(index.pocket) };
	tcgDeckCatalog.numbers = Object.assign(Object.create(null), index.numbers);
}

function indexTcgDeckCards(rows: TcgCardRow[]) {
	const nextById = Object.create(null) as { [id: string]: TcgCardRow };
	const nextByIdLower = Object.create(null) as { [id: string]: TcgCardRow };
	const nextByName = Object.create(null) as { [name: string]: TcgCardRow[] };
	const nextByPrinting = Object.create(null) as { [key: string]: TcgCardRow[] };
	for (const c of rows) {
		nextById[c.id] = c;
		nextByIdLower[c.id.toLowerCase()] = c;
		const key = tcgNameKey(c.n);
		const list = nextByName[key] || [];
		list.push(c);
		nextByName[key] = list;
		const setId = tcgCardSetId(c);
		if (!tcgDeckCatalog.sets?.[c.k]?.byId[setId]) continue;
		const number = tcgNumberKey(tcgCardNumber(c));
		(nextByPrinting[`${c.k}|${setId}|${number}`] ||= []).push(c);
		// a few cards share a catalog number, so the id's own suffix finds them too
		const suffix = tcgNumberKey(c.id.slice(setId.length + 1));
		if (suffix !== number) (nextByPrinting[`${c.k}|${setId}|${suffix}`] ||= []).push(c);
	}
	tcgDeckCatalog.rows = rows;
	tcgDeckCatalog.byId = nextById;
	tcgDeckCatalog.byIdLower = nextByIdLower;
	tcgDeckCatalog.byName = nextByName;
	tcgDeckCatalog.byPrinting = nextByPrinting;
	tcgDeckCatalog.searchText = null;
	tcgDeckCatalog.marks = Object.create(null) as { [format: string]: string[] };
}

export function isTcgFormatId(format: string | undefined | null): boolean {
	const id = toID(format || '');
	return id.replace(/^gen\d/, '').startsWith('tcg');
}

export function isTcgRandomFormat(format: string | undefined | null): boolean {
	const id = toID(format || '');
	return id.includes('tcg') && id.includes('random');
}

/**
 * standard, pocket or custom game. hidden and unknown ids give null so they don't get checked as standard.
 * `gen9tcgstandard` and `tcgstandardrandom` still count as standard
 */
export function tcgDeckFormatOf(format: string | undefined | null): TcgDeckFormat | null {
	const id = toID(format || '');
	if (id.includes('pocket')) return 'pocket';
	if (id.includes('custom')) return 'custom';
	const bare = id.replace(/^gen\d/, '');
	if (bare === 'tcgstandard' || bare === 'tcgstandardrandom' || bare === 'standard') return 'standard';
	return null;
}

/** host format id without a leading `genN`. engine rules ids aren't host ids */
export function tcgCanonicalHostFormatId(format: string | undefined | null): string | null {
	const bare = toID(format || '').replace(/^gen\d/, '');
	return bare.startsWith('tcg') ? bare : null;
}

export type TcgDeckRuleRow = {
	hostFormatId: string,
	engineRulesId: string,
	name: string,
	deckSource: 'player' | 'assigned',
	deck: {
		minSize: number,
		maxSize: number,
		copyLimit: number,
		energyZone: boolean,
		allowAceSpec: boolean,
		allowRadiant: boolean,
		allowRuleBox: boolean,
		minPokemon?: number,
		samePokemonType?: boolean,
		legality?: 'standard' | 'expanded' | 'unlimited',
		regulationMin?: string,
		series?: string[],
	},
};

export type TcgResolvedDeckRules = {
	hostFormatId: string,
	name: string,
	format: TcgDeckFormat | null,
	minSize: number,
	maxSize: number,
	copyLimit: number,
	energyZone: boolean,
	allowAceSpec: boolean,
	allowRadiant: boolean,
	deckSource: 'player' | 'assigned',
	origin: 'metadata' | 'fallback',
	engineRulesId?: string,
	allowRuleBox?: boolean,
	minPokemon?: number,
	samePokemonType?: boolean,
	legality?: 'standard' | 'expanded' | 'unlimited',
	regulationMin?: string,
	series?: string[],
};

let tcgPublishedFormatRules: readonly TcgDeckRuleRow[] | null = null;

export function publishTcgFormatRules(rows: readonly TcgDeckRuleRow[] | null) {
	tcgPublishedFormatRules = rows;
}

function metadataRuleRow(hostFormatId: string): TcgDeckRuleRow | null {
	const rows = tcgPublishedFormatRules;
	if (!rows) return null;
	for (const row of rows) {
		if (row.hostFormatId === hostFormatId) return row;
	}
	return null;
}

function fallbackDeckRules(format: string): TcgResolvedDeckRules | null {
	const category = tcgDeckFormatOf(format);
	if (!category) return null;
	const table = TCG_DECK_RULES[category];
	const canonical = tcgCanonicalHostFormatId(format);
	return {
		hostFormatId: canonical || table.psFormat,
		name: table.name,
		format: category,
		minSize: table.minDeckSize || table.deckSize,
		maxSize: table.deckSize,
		copyLimit: table.copyLimit,
		energyZone: table.energyZone,
		allowAceSpec: table.allowAceSpec,
		allowRadiant: table.allowRadiant,
		deckSource: isTcgRandomFormat(format) ? 'assigned' : 'player',
		origin: 'fallback',
	};
}

function metadataDeckRules(row: TcgDeckRuleRow): TcgResolvedDeckRules {
	const rules: TcgResolvedDeckRules = {
		hostFormatId: row.hostFormatId,
		engineRulesId: row.engineRulesId,
		name: row.name,
		format: tcgDeckFormatOf(row.hostFormatId),
		minSize: row.deck.minSize,
		maxSize: row.deck.maxSize,
		copyLimit: row.deck.copyLimit,
		energyZone: row.deck.energyZone,
		allowAceSpec: row.deck.allowAceSpec,
		allowRadiant: row.deck.allowRadiant,
		allowRuleBox: row.deck.allowRuleBox,
		deckSource: row.deckSource,
		origin: 'metadata',
	};
	if (row.deck.minPokemon !== undefined) rules.minPokemon = row.deck.minPokemon;
	if (row.deck.samePokemonType !== undefined) rules.samePokemonType = row.deck.samePokemonType;
	if (row.deck.legality !== undefined) rules.legality = row.deck.legality;
	if (row.deck.regulationMin !== undefined) rules.regulationMin = row.deck.regulationMin;
	if (row.deck.series !== undefined) rules.series = row.deck.series.slice();
	return rules;
}

/**
 * a cached row wins, otherwise use the old table for standard, pocket and custom game. unknown ids stay
 * unresolved, and a rules id isn't a host id
 */
export function tcgDeckRulesFor(format: string | undefined | null): TcgResolvedDeckRules | null {
	const canonical = tcgCanonicalHostFormatId(format);
	if (canonical && tcgPublishedFormatRules) {
		const row = metadataRuleRow(canonical);
		if (row) return metadataDeckRules(row);
	}
	return fallbackDeckRules(format || '');
}

export function tcgAssignedDeck(format: string | undefined | null): boolean {
	const rules = tcgDeckRulesFor(format);
	if (rules) return rules.deckSource === 'assigned';
	return isTcgRandomFormat(format);
}

function activeDeckRules(format: TcgDeckFormat, hostFormat?: string | null): TcgResolvedDeckRules {
	if (hostFormat) {
		const specific = tcgDeckRulesFor(hostFormat);
		if (specific?.format === format) return specific;
	}
	const resolved = tcgDeckRulesFor(TCG_DECK_RULES[format].psFormat);
	if (!resolved) throw new Error('Missing TCG deck rules');
	return resolved;
}

export function showdownFormatFor(rules: TcgDeckFormat): string {
	const needle = TCG_DECK_RULES[rules].psFormat;
	const formats = typeof BattleFormats !== 'undefined' ? BattleFormats : null;
	if (formats) {
		const hit = Object.keys(formats).find(id => {
			const bare = id.replace(/^gen\d/, '');
			return bare === needle && !id.includes('random');
		});
		if (hit) return hit;
	}
	return needle;
}

export function packTcgDeck(ids: string[]): string {
	return JSON.stringify(ids.filter(Boolean));
}

export function unpackTcgDeck(packed: string | undefined | null): string[] {
	const s = String(packed || '').trim();
	if (!s) return [];
	if (s.startsWith('[')) {
		try {
			const v = JSON.parse(s) as unknown;
			if (!Array.isArray(v)) return [];
			return v.filter((x): x is string => typeof x === 'string' && !!x);
		} catch {
			return [];
		}
	}
	if (s.includes('|')) return [];
	return s.split(/[\s,]+/).filter(Boolean);
}

export function isTcgPacked(packed: string | undefined | null): boolean {
	const s = String(packed || '').trim();
	if (!s) return true;
	if (s.startsWith('[')) {
		try {
			const v = JSON.parse(s);
			return Array.isArray(v);
		} catch {
			return false;
		}
	}
	return !s.includes('|');
}

/** these indexes ship with the client. Net would send a root path to the sprite host */
function tcgIndexUrl(file: string): string {
	return (typeof document !== 'undefined' && document.location?.host) ?
		document.location.protocol + '//' + document.location.host + '/' + file :
		'/' + file;
}

/** the deck builder works without set data, only lines with set codes fail then */
function loadTcgSetIndex(): Promise<void> {
	return Net(tcgIndexUrl('tcg-sets-index.json')).get()
		.then(text => {
			const index = JSON.parse(text) as TcgSetIndex;
			if (!Array.isArray(index?.paper) || !Array.isArray(index.pocket)) throw new Error('tcg-sets-index.json');
			indexTcgSets(index);
		})
		.catch(err => {
			tcgDeckCatalog.sets = null;
			console.warn(err);
		});
}

export type TcgCardIndexStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** a card missing from a `ready` index really is unknown */
export function tcgCardIndexStatus(): TcgCardIndexStatus {
	if (tcgDeckCatalog.rows) return 'ready';
	if (tcgDeckCatalog.loadPromise) return 'loading';
	return tcgDeckCatalog.loadFailed ? 'failed' : 'idle';
}

/** after a failure the rows are empty and the next call tries again */
export function loadTcgCardIndex(): Promise<TcgCardRow[]> {
	if (tcgDeckCatalog.rows) return Promise.resolve(tcgDeckCatalog.rows);
	if (tcgDeckCatalog.loadPromise) return tcgDeckCatalog.loadPromise;
	tcgDeckCatalog.loadFailed = false;
	const setsLoaded = loadTcgSetIndex();
	tcgDeckCatalog.loadPromise = Net(tcgIndexUrl('tcg-cards-index.json')).get()
		.then(text => {
			const rows = JSON.parse(text) as TcgCardRow[];
			if (!Array.isArray(rows)) throw new Error('tcg-cards-index.json');
			return setsLoaded.then(() => {
				indexTcgDeckCards(rows);
				tcgDeckCatalog.loadPromise = null;
				return rows;
			});
		})
		.catch(err => {
			tcgDeckCatalog.loadPromise = null;
			tcgDeckCatalog.loadFailed = true;
			console.warn(err);
			return [] as TcgCardRow[];
		});
	return tcgDeckCatalog.loadPromise;
}

export function getTcgCard(id: string): TcgCardRow | undefined {
	if (!id) return undefined;
	return tcgDeckCatalog.byId[id] || tcgDeckCatalog.byIdLower[id.toLowerCase()];
}

export function allTcgCards(): TcgCardRow[] {
	return tcgDeckCatalog.rows || [];
}

function tcgLocalDate(): string {
	const now = new Date();
	const pad = (n: number) => `0${n}`.slice(-2);
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function cardLegalInFormat(card: TcgCardRow, format: TcgDeckFormat): boolean {
	if (format === 'custom') return true;
	if (format === 'pocket') return !!card.pkt;
	return !!card.std && !(card.lf && card.lf > tcgLocalDate());
}

/**
 * the index covers standard (regulation H), pocket and custom game. a restriction it can't check is `unknown`:
 * the deck builder doesn't flag the card, the host decides
 */
export type TcgLegalityHint = 'legal' | 'illegal' | 'unknown';

const TCG_INDEX_REGULATION = 'H';

export function tcgLegalityHint(
	card: TcgCardRow, format: TcgDeckFormat, hostFormat?: string | null
): TcgLegalityHint {
	const rules = hostFormat ? tcgDeckRulesFor(hostFormat) : tcgDeckRulesFor(TCG_DECK_RULES[format].psFormat);
	const meta = rules?.origin === 'metadata' && rules.format === format ? rules : null;
	if (meta?.series?.length) return 'unknown';
	if (format === 'custom') return 'legal';
	if (format === 'pocket') {
		if (meta?.legality) return 'unknown';
		if (typeof card.pkt !== 'number') return 'unknown';
		return card.pkt ? 'legal' : 'illegal';
	}
	if (meta?.legality && meta.legality !== 'standard') return 'unknown';
	if (meta?.regulationMin && meta.regulationMin !== TCG_INDEX_REGULATION) return 'unknown';
	if (typeof card.std !== 'number') return 'unknown';
	return cardLegalInFormat(card, 'standard') ? 'legal' : 'illegal';
}

/**
 * legal in standard only as a reprint (Tournament Handbook §4.1.3). its own mark is old or missing, so the badge
 * says why it's allowed. `std` is the engine's call, this just explains it
 */
export function tcgLegalAsReprint(card: TcgCardRow, format: TcgDeckFormat | null, hostFormat?: string | null): boolean {
	if (!format || format === 'pocket' || format === 'custom' || card.be || card.k !== 'p') return false;
	if (tcgLegalityHint(card, format, hostFormat) !== 'legal') return false;
	const mark = tcgRegulationMark(card);
	return !mark || mark < TCG_INDEX_REGULATION;
}

export function tcgRegulationMark(card: TcgCardRow): string {
	return /^[A-Z]$/.test(card.r || '') ? card.r : '';
}

/** `H+`: marks go in alphabetical order, a card with no mark meets no minimum */
export function tcgMeetsRegulation(card: TcgCardRow, min: string): boolean {
	const mark = tcgRegulationMark(card);
	return !!mark && mark >= min;
}

export function tcgRegulationMarks(format: TcgDeckFormat): string[] {
	const cached = tcgDeckCatalog.marks[format];
	if (cached) return cached;
	const seen: { [mark: string]: 1 } = Object.create(null);
	for (const c of allTcgCards()) {
		const mark = tcgRegulationMark(c);
		if (mark && tcgGamesFor(format).includes(c.k)) seen[mark] = 1;
	}
	const marks = Object.keys(seen).sort();
	tcgDeckCatalog.marks[format] = marks;
	return marks;
}

/** some basic energy rows have no types, but the name tells us */
export function tcgCardTypes(card: TcgCardRow): string[] {
	if (card.t?.length || !card.be) return card.t || [];
	const type = /\b(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy)\b/i.exec(card.n);
	return type ? [type[1].toLowerCase()] : [];
}

/** letters for the symbols in card names, so `Nidoran ♀` and `Flygon δ` can be typed and told apart */
const TCG_NAME_SYMBOLS: { [symbol: string]: string } = {
	'♀': 'f', '♂': 'm', 'δ': 'delta', '★': 'star', '◇': 'prism',
};

/** ignores case, accents, spacing and punctuation. `poke ball` finds `Poké Ball` */
export function tcgSearchKey(text: string): string {
	const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
	return toID(plain.replace(/[♀♂δ★◇]/g, symbol => TCG_NAME_SYMBOLS[symbol]));
}

/** spaces keep a match inside one field, so `ata1` doesn't match `Zubat` + `A1-172` */
function tcgSearchTexts(): string[] {
	if (tcgDeckCatalog.searchText) return tcgDeckCatalog.searchText;
	const texts = allTcgCards().map(c => {
		const code = tcgDeckCatalog.sets?.[c.k]?.byId[tcgCardSetId(c)]?.code || '';
		const printing = code ? tcgSearchKey(code + tcgCardNumber(c)) : '';
		return `${tcgSearchKey(c.n)} ${tcgSearchKey(c.id)} ${printing} ${tcgSearchKey(c.set)}`;
	});
	tcgDeckCatalog.searchText = texts;
	return texts;
}

export type TcgCardFilters = {
	format: TcgDeckFormat | null,
	q?: string,
	/** P / T / E, or '' for all */
	super?: string,
	type?: string,
	/** oldest regulation mark to include */
	reg?: string,
};

export function filterTcgCards(filters: TcgCardFilters): TcgCardRow[] {
	const { format, q = '', super: kind = '', type = '', reg = '' } = filters;
	const rows = allTcgCards();
	const query = tcgSearchKey(q);
	const texts = query ? tcgSearchTexts() : null;
	const games = tcgGamesFor(format);
	const legal: TcgCardRow[] = [];
	const illegal: TcgCardRow[] = [];
	for (let i = 0; i < rows.length; i++) {
		const c = rows[i];
		if (!games.includes(c.k)) continue;
		if (kind && c.s !== kind) continue;
		if (type && !tcgCardTypes(c).includes(type)) continue;
		if (reg && !tcgMeetsRegulation(c, reg)) continue;
		if (texts && !texts[i].includes(query)) continue;
		(format && tcgLegalityHint(c, format) === 'illegal' ? illegal : legal).push(c);
	}
	return legal.concat(illegal);
}

export function copyMaxFor(card: TcgCardRow, format: TcgDeckFormat, hostFormat?: string | null): number {
	const rules = activeDeckRules(format, hostFormat);
	if (format === 'custom') return rules.copyLimit;
	if (card.be) return 99;
	let max = rules.copyLimit;
	if (card.ace || card.rad || card.prism) max = Math.min(max, 1);
	return max;
}

/** the name copies are counted by. a character label (`cn`) is not part of it, so its printings share the limit */
export function tcgCopyName(card: TcgCardRow): string {
	return card.cn || card.n;
}

/** copy limits go by name, so two printings share a limit. basic energy counts by printing */
export function canAddTcgCard(
	ids: string[], card: TcgCardRow, format: TcgDeckFormat, hostFormat?: string | null
): boolean {
	const name = tcgCopyName(card);
	const copies = ids.filter(id => {
		if (card.be) return id === card.id;
		const c = getTcgCard(id);
		return !!c && tcgCopyName(c) === name;
	}).length;
	return copies < copyMaxFor(card, format, hostFormat);
}

export type TcgDeckLine = { id: string, card: TcgCardRow | undefined, n: number };

export function groupDeck(ids: string[]): TcgDeckLine[] {
	const order: string[] = [];
	const counts: { [id: string]: number } = Object.create(null);
	for (const id of ids) {
		if (!counts[id]) order.push(id);
		counts[id] = (counts[id] || 0) + 1;
	}
	return order.map(id => ({ id, card: getTcgCard(id), n: counts[id] }));
}

export function deckProblemsClient(ids: string[], format: TcgDeckFormat, hostFormat?: string | null): string[] {
	const rules = activeDeckRules(format, hostFormat);
	const errors: string[] = [];
	const unknown = (id: string) => {
		const error = `Unknown card ${id}.`;
		if (!errors.includes(error)) errors.push(error);
	};
	if (format === 'custom') {
		const min = rules.minSize;
		if (ids.length < min || ids.length > rules.maxSize) {
			errors.push(`${rules.name} decks must have ${min}–${rules.maxSize} cards (got ${ids.length}).`);
		}
		for (const id of ids) {
			if (!getTcgCard(id)) unknown(id);
		}
		return errors;
	}
	if (ids.length !== rules.maxSize) {
		errors.push(`${rules.name} decks must be ${rules.maxSize} cards (got ${ids.length}).`);
	}
	const named: { [name: string]: number } = Object.create(null);
	let ace = 0;
	let radiant = 0;
	let basics = 0;
	let energyCards = 0;
	const illegal: string[] = [];
	const over: string[] = [];

	for (const id of ids) {
		const c = getTcgCard(id);
		if (!c) {
			unknown(id);
			continue;
		}
		if (tcgLegalityHint(c, format, hostFormat) === 'illegal') {
			illegal.push(`${c.n} (${c.id}${c.r ? `, ${c.r}` : ''})`);
		}
		if (c.b) basics++;
		if (c.ace) ace++;
		if (c.rad) radiant++;
		if (rules.energyZone && c.s === 'E') {
			energyCards++;
			continue;
		}
		if (c.be) continue;
		const name = tcgCopyName(c);
		const n = (named[name] || 0) + 1;
		named[name] = n;
		if (n === copyMaxFor(c, format, hostFormat) + 1) over.push(`${name} (max ${copyMaxFor(c, format, hostFormat)})`);
	}

	if (illegal.length) {
		errors.push(`Not legal in ${rules.name}: ${illegal.slice(0, 6).join(', ')}${illegal.length > 6 ? '…' : ''}`);
	}
	if (energyCards) errors.push(`${rules.name} decks do not include Energy cards (Energy Zone).`);
	if (over.length) errors.push(`Too many copies: ${over.slice(0, 6).join(', ')}${over.length > 6 ? '…' : ''}`);
	if (!rules.allowAceSpec && ace) errors.push(`${rules.name} does not allow ACE SPEC.`);
	else if (ace > 1) errors.push('Only 1 ACE SPEC card per deck.');
	if (!rules.allowRadiant && radiant) errors.push(`${rules.name} does not allow Radiant Pokemon.`);
	else if (radiant > 1) errors.push('Only 1 Radiant Pokemon per deck.');
	if (ids.length && !basics) errors.push('Deck needs at least one Basic Pokemon.');
	return errors;
}

export function deckCounts(ids: string[]) {
	let pokemon = 0, trainer = 0, energy = 0;
	for (const id of ids) {
		const c = getTcgCard(id);
		if (!c) continue;
		if (c.s === 'P') pokemon++;
		else if (c.s === 'T') trainer++;
		else if (c.s === 'E') energy++;
	}
	return { pokemon, trainer, energy, total: ids.length };
}

export function deckPreviewCards(ids: string[], limit = 6): TcgCardRow[] {
	const seen: { [id: string]: 1 } = Object.create(null);
	const poke: TcgCardRow[] = [];
	const other: TcgCardRow[] = [];
	for (const id of ids) {
		if (seen[id]) continue;
		seen[id] = 1;
		const c = getTcgCard(id);
		if (!c) continue;
		if (c.s === 'P') poke.push(c);
		else other.push(c);
	}
	return poke.concat(other).slice(0, limit);
}

const SECTION_LABEL: { [s: string]: string } = {
	P: 'Pokémon',
	T: 'Trainer',
	E: 'Energy',
};

/** `live`: `4 Darkrai-EX DEX 63` like TCG Live and Limitless write it. `ids`: `4 Darkrai-EX bw5-63` */
export type TcgExportStyle = 'live' | 'ids';

/**
 * set code and number that import back to exactly this card. null if there isn't one: no official code, or
 * another card would match the same line
 */
export function tcgCardPrinting(c: TcgCardRow): { code: string, number: string } | null {
	const code = tcgDeckCatalog.sets?.[c.k]?.byId[tcgCardSetId(c)]?.code;
	if (!code) return null;
	const number = tcgCardNumber(c);
	const hit = tcgResolvePrinting(c.n, code, number, ['p', 'k']);
	return hit && 'id' in hit && hit.id === c.id ? { code, number } : null;
}

function tcgLiveLine(line: TcgDeckLine): string {
	const printing = line.card && tcgCardPrinting(line.card);
	if (!printing) return `${line.n} ${line.card?.n || line.id} ${line.id}`;
	return `${line.n} ${tcgPrintedName(line.card!.n)} ${printing.code} ${printing.number}`;
}

export function tcgCardLabel(c: TcgCardRow): string {
	const printing = tcgCardPrinting(c);
	const print = printing ? `${printing.code} ${printing.number}` : c.set;
	const mark = tcgRegulationMark(c);
	return print && mark ? `${print} (${mark})` : print || mark;
}

export function exportTcgDeck(ids: string[], style: TcgExportStyle = 'ids'): string {
	const lines = groupDeck(ids);
	const out: string[] = [];
	const cardLine = (line: TcgDeckLine) =>
		(style === 'live' ? tcgLiveLine(line) : `${line.n} ${line.card?.n || line.id} ${line.id}`);
	const pushGroup = (label: string, group: TcgDeckLine[]) => {
		let count = 0;
		for (const line of group) count += line.n;
		out.push(`${label}: ${count}`);
		for (const line of group) out.push(cardLine(line));
		out.push('');
	};
	const sections = ['P', 'T', 'E'];
	for (const section of sections) {
		const group: TcgDeckLine[] = [];
		for (const line of lines) {
			if ((line.card?.s || '?') === section) group.push(line);
		}
		pushGroup(SECTION_LABEL[section], group);
	}
	const unknown: TcgDeckLine[] = [];
	for (const line of lines) {
		if (!line.card || !SECTION_LABEL[line.card.s]) unknown.push(line);
	}
	if (unknown.length) pushGroup('Other', unknown);
	if (style === 'live') out.push(`Total Cards: ${ids.length}`);
	return out.join('\n').replace(/\s+$/, '') + '\n';
}

function preferLegal(cards: TcgCardRow[], format: TcgDeckFormat | null): TcgCardRow[] {
	if (!format) return cards;
	const legal = cards.filter(c => tcgLegalityHint(c, format) === 'legal' || (format === 'standard' && c.be));
	return legal.length ? legal : cards;
}

function tcgGamesFor(format: TcgDeckFormat | null): string[] {
	if (!format || format === 'custom') return ['p', 'k'];
	return format === 'pocket' ? ['k'] : ['p'];
}

const TCG_GAME_LABEL: { [game: string]: string } = { p: 'paper', k: 'TCG Pocket' };

/**
 * exact code beats exact id, then either in any case. order matters: `G1` is Gym Heroes' code, but the set with
 * id `g1` is Generations
 */
function tcgSetsForToken(token: string, game: string): TcgSetRow[] {
	const sets = tcgDeckCatalog.sets?.[game];
	if (!sets) return [];
	if (sets.byCode[token]) return sets.byCode[token];
	if (sets.byId[token]) return [sets.byId[token]];
	return sets.byLower[token.toLowerCase()] || [];
}

export type TcgResolved = { id: string, warning?: string } | { error: string };

/**
 * the name only splits cards that share a number, or flags a list that disagrees with the catalog. it never
 * picks another printing
 */
function tcgResolvePrinting(name: string, token: string, number: string, games: string[]): TcgResolved | null {
	const labels: string[] = [];
	const found: TcgCardRow[] = [];
	for (const game of games) {
		for (const set of tcgSetsForToken(token, game)) {
			labels.push(`${set.code || set.id} (${set.name})`);
			found.push(...(tcgDeckCatalog.byPrinting[`${game}|${set.id}|${tcgNumberKey(number)}`] || []));
		}
	}
	if (!labels.length) return null;
	if (!found.length) {
		return { error: `${labels.join(' / ')} has no card numbered ${number}.${tcgPrintingHint(name, games)}` };
	}
	const key = tcgNameKey(name);
	const named = found.filter(c => tcgNameKey(c.n) === key);
	if (named.length === 1) return { id: named[0].id };
	if (named.length) {
		const ids = named.map(c => c.id).join(', ');
		return { error: `${token} ${number} matches more than one ${named[0].n}. Use a card id instead: ${ids}.` };
	}
	const actual = found.map(c => `${c.n} (${c.id})`).join(' or ');
	return { error: `${token} ${number} is ${actual}, not "${name}". Check the name, set code and number.` };
}

function tcgPrintingLabel(c: TcgCardRow): string {
	const printing = tcgCardPrinting(c);
	return printing ? `${printing.code} ${printing.number}` : c.id;
}

function tcgPrintingHint(name: string, games: string[]): string {
	const current = Object.values(TCG_BASIC_ENERGY);
	const prints = (tcgDeckCatalog.byName[tcgNameKey(name)] || [])
		.filter(c => games.includes(c.k))
		.sort((a, b) => Number(b.n === name) - Number(a.n === name) ||
			Number(current.includes(b.id)) - Number(current.includes(a.id)) ||
			b.std - a.std || (b.r || '').localeCompare(a.r || '') || a.id.localeCompare(b.id));
	if (!prints.length) return '';
	const shown = prints.slice(0, 5).map(tcgPrintingLabel).join(', ');
	return ` Printings of ${name} in this catalog: ${shown}${prints.length > 5 ? ', …' : ''}.`;
}

function tcgResolveByName(name: string, format: TcgDeckFormat | null): { id: string, warning?: string } | null {
	const named = tcgDeckCatalog.byName[tcgNameKey(name)] || [];
	// custom game covers both games, but a name means paper when paper has it
	let cards = tcgGamesFor(format).map(game => named.filter(c => c.k === game)).find(list => list.length) || [];
	// `Darkrai-EX` and `Darkrai ex` share a key but are different cards
	const exact = cards.filter(c => c.n.toLowerCase() === name.toLowerCase());
	if (exact.length) cards = exact;
	const matches = preferLegal(cards, format);
	if (!matches.length) return null;
	if (matches.length === 1) return { id: matches[0].id };
	matches.sort((a, b) => (b.r || '').localeCompare(a.r || '') || a.id.localeCompare(b.id));
	return {
		id: matches[0].id,
		warning: `Multiple prints of ${matches[0].n}; using ${matches[0].id}`,
	};
}

function tcgCardForFormat(card: TcgCardRow, format: TcgDeckFormat | null): TcgResolved {
	if (!format || tcgGamesFor(format).includes(card.k)) return { id: card.id };
	const deck = activeDeckRules(format).name;
	return { error: `${card.n} (${card.id}) is a ${TCG_GAME_LABEL[card.k]} card, so it cannot go in a ${deck} deck.` };
}

/**
 * a line with a set and number resolves to that exact printing or fails. only a line without printing info falls
 * back to a name search
 */
export function resolveImportCard(rest: string, format: TcgDeckFormat | null): TcgResolved {
	rest = rest.trim().replace(/\s+/g, ' ');
	const expected = 'Expected a line like "4 Darkrai-EX DEX 63", "4 Darkrai-EX bw5-63" or a card id.';
	if (!rest) return { error: `Missing card. ${expected}` };

	// bare card id
	const direct = getTcgCard(rest);
	if (direct) return tcgCardForFormat(direct, format);

	const parts = rest.split(' ');
	const last = parts[parts.length - 1];
	// trailing card id: "Abomasnow sv10-60"
	const byTail = parts.length >= 2 ? getTcgCard(last) : undefined;
	if (byTail) {
		const name = parts.slice(0, -1).join(' ');
		if (tcgNameKey(name) === tcgNameKey(byTail.n)) return tcgCardForFormat(byTail, format);
		return { error: `${byTail.id} is ${byTail.n}, not "${name}". Check the name and card id.` };
	}

	// the whole text is a name, even names that look like a set and number: "Pokégear 3.0"
	const byName = tcgResolveByName(rest, format);
	if (byName) return byName;

	// trailing SET NUM: "Darkrai-EX DEX 63" → bw5-63
	if (parts.length >= 3) {
		const set = parts[parts.length - 2];
		const name = parts.slice(0, -2).join(' ');
		const games = tcgGamesFor(format);
		const printing = tcgResolvePrinting(name, set, last, games);
		if (printing) return printing;
		const otherGame = ['p', 'k'].find(game => !games.includes(game) && tcgSetsForToken(set, game).length);
		if (otherGame && format) {
			const deck = activeDeckRules(format).name;
			return { error: `${set} is a ${TCG_GAME_LABEL[otherGame]} set, so it cannot go in a ${deck} deck.` };
		}
		if (!tcgDeckCatalog.sets) {
			return { error: `Set codes did not load, so "${set} ${last}" cannot be read. Reload and try again.` };
		}
		if (/^[A-Z0-9-]+$/.test(set) && /\d/.test(last)) {
			return { error: `Unknown set code "${set}". This catalog has no such set.${tcgPrintingHint(name, games)}` };
		}
	}

	return { error: `Could not find card "${rest}". ${expected}` };
}

/** basic energy prints by type. fairy and dragon have no basic energy in standard */
export const TCG_BASIC_ENERGY: { [type: string]: string } = {
	grass: 'sve-1',
	fire: 'sve-2',
	water: 'sve-3',
	lightning: 'sve-4',
	psychic: 'sve-5',
	fighting: 'sve-6',
	darkness: 'sve-7',
	metal: 'sve-8',
};

type FillStaple = {
	id: string,
	/** copies the deck should have, counting ones already in it */
	n: number,
	/** only when the deck has a stage 2 pokemon */
	stage2?: boolean,
	/** only when the deck has an evolution pokemon */
	evolution?: boolean,
};

/**
 * type-neutral trainers from the standard random and pocket random lists, in the order the filler adds them.
 * every id is legal and has a card script
 */
const FILL_TRAINERS: { [id in TcgDeckFormat]: FillStaple[] } = {
	standard: [
		{ id: 'me1-119', n: 4 }, // Lillie's Determination
		{ id: 'me1-131', n: 4 }, // Ultra Ball
		{ id: 'me1-114', n: 3 }, // Boss's Orders
		{ id: 'me1-125', n: 3, stage2: true }, // Rare Candy
		{ id: 'rsv10pt5-84', n: 2, evolution: true }, // Hilda
		{ id: 'me2pt5-196', n: 2 }, // Night Stretcher
		{ id: 'me3-81', n: 2 }, // Poké Pad
		{ id: 'zsv10pt5-84', n: 2 }, // Pokégear 3.0
		{ id: 'me1-130', n: 2 }, // Switch
		{ id: 'me2pt5-181', n: 2 }, // Air Balloon
		{ id: 'me3-76', n: 1 }, // Judge
	],
	pocket: [
		{ id: 'P-A-007', n: 2 }, // Professor's Research
		{ id: 'P-A-005', n: 2 }, // Poké Ball
		{ id: 'A3-144', n: 2, stage2: true }, // Rare Candy
		{ id: 'B1-225', n: 1 }, // Copycat
		{ id: 'A1-225', n: 1 }, // Sabrina
		{ id: 'A2-150', n: 1 }, // Cyrus
		{ id: 'P-A-002', n: 1 }, // X Speed
		{ id: 'A2-146', n: 1 }, // Pokémon Communication
		{ id: 'B3-147', n: 1 }, // Field Blower
		{ id: 'A2b-070', n: 1 }, // Pokémon Center Lady
		{ id: 'A1-223', n: 1 }, // Giovanni
		{ id: 'P-A-006', n: 1 }, // Red Card
		{ id: 'B2-145', n: 1 }, // Lucky Ice Pop
		{ id: 'P-A-001', n: 1 }, // Potion
	],
	custom: [
		{ id: 'me1-119', n: 4 }, // Lillie's Determination
		{ id: 'me1-131', n: 4 }, // Ultra Ball
		{ id: 'me1-114', n: 3 }, // Boss's Orders
		{ id: 'me1-125', n: 3, stage2: true }, // Rare Candy
		{ id: 'rsv10pt5-84', n: 2, evolution: true }, // Hilda
		{ id: 'me2pt5-196', n: 2 }, // Night Stretcher
		{ id: 'me3-81', n: 2 }, // Poké Pad
		{ id: 'zsv10pt5-84', n: 2 }, // Pokégear 3.0
		{ id: 'me1-130', n: 2 }, // Switch
		{ id: 'me2pt5-181', n: 2 }, // Air Balloon
		{ id: 'me3-76', n: 1 }, // Judge
	],
};

/** support pokemon that fit any standard deck (each is in half of the standard random lists) */
const FILL_SUPPORT: { [id in TcgDeckFormat]: string[] } = {
	standard: ['me2pt5-142', 'me3-62'], // Fezandipiti ex, Meowth ex
	pocket: [],
	custom: ['me2pt5-142', 'me3-62'],
};

const FILL_POKEMON_TARGET: { [id in TcgDeckFormat]: number } = { standard: 12, pocket: 8, custom: 12 };
const FILL_ENERGY_TARGET = 10;

export type TcgFillResult = {
	ids: string[],
	added: TcgDeckLine[],
	notes: string[],
};

function stageOf(card: TcgCardRow): number {
	if (card.u.includes('Stage 2')) return 2;
	return card.ef ? 1 : 0;
}

/**
 * fill a partial deck around the player's cards: missing pre-evolutions, more copies of the chosen pokemon,
 * type-neutral trainers and (standard only) basic energy for attack costs. always gives the same result
 */
export function fillTcgDeck(ids: string[], format: TcgDeckFormat, hostFormat?: string | null): TcgFillResult {
	const rules = activeDeckRules(format, hostFormat);
	const out = ids.slice();
	const notes: string[] = [];
	const room = () => rules.maxSize - out.length;
	const done = (): TcgFillResult => ({ ids: out, added: groupDeck(out.slice(ids.length)), notes });
	if (room() <= 0) {
		notes.push(`The deck already has ${out.length} cards.`);
		return done();
	}
	const deckCards = () => out.map(id => getTcgCard(id)).filter((c): c is TcgCardRow => !!c);
	const pokemon = () => deckCards().filter(c => c.s === 'P');
	if (!pokemon().length) {
		notes.push('Add at least one Pokémon, then fill the rest.');
		return done();
	}

	const countNamed = (name: string) => deckCards().filter(c => tcgCopyName(c) === name && !c.be).length;
	const legal = (c: TcgCardRow) => tcgLegalityHint(c, format, hostFormat) === 'legal' &&
		!(rules.energyZone && c.s === 'E');
	const canAdd = (c: TcgCardRow) => {
		if (room() <= 0 || !legal(c)) return false;
		if (c.be) return true;
		if (countNamed(tcgCopyName(c)) >= copyMaxFor(c, format, hostFormat)) return false;
		if (c.ace && deckCards().some(x => x.ace)) return false;
		if (c.rad && deckCards().some(x => x.rad)) return false;
		return true;
	};
	const fillTo = (c: TcgCardRow, want: number) => {
		while (countNamed(tcgCopyName(c)) < want && canAdd(c)) out.push(c.id);
	};

	// 1. pre-evolutions. stage 2 first so the stage 1 it adds gets its basic on the next pass. each pre-evolution
	// gets one more copy than what evolves from it
	for (const stage of [2, 1]) {
		const preNames: string[] = [];
		for (const c of pokemon()) {
			if (c.ef && stageOf(c) === stage && !preNames.includes(c.ef)) preNames.push(c.ef);
		}
		preNames.forEach(preName => {
			const evolutions = pokemon().filter(c => c.ef === preName);
			const owned = deckCards().find(c => c.n === preName);
			const types = evolutions[0].t;
			const pick = owned || (tcgDeckCatalog.byName[tcgNameKey(preName)] || [])
				.filter(c => c.n === preName && legal(c))
				.sort((a, b) =>
					Number(b.t.some(t => types.includes(t))) - Number(a.t.some(t => types.includes(t))) ||
					(b.r || '').localeCompare(a.r || '') || a.id.localeCompare(b.id))[0];
			if (!pick || !legal(pick)) {
				notes.push(`No ${rules.name}-legal ${preName} for ${evolutions[0].n}.`);
				return;
			}
			fillTo(pick, Math.min(copyMaxFor(pick, format, hostFormat), evolutions.length + 1));
		});
	}

	// 2. support pokemon, then more copies of the chosen pokemon. basics first, never more copies of an evolution
	// than of what it evolves from
	const target = Math.min(FILL_POKEMON_TARGET[format], rules.maxSize);
	for (const id of FILL_SUPPORT[format]) {
		const c = getTcgCard(id);
		if (c && pokemon().length < target) fillTo(c, 1);
	}
	const lines = pokemon()
		.filter((c, i, all) => all.findIndex(x => x.n === c.n) === i && !FILL_SUPPORT[format].includes(c.id))
		.sort((a, b) => stageOf(a) - stageOf(b));
	for (let grew = true; grew && pokemon().length < target;) {
		grew = false;
		for (const c of lines) {
			if (pokemon().length >= target) break;
			const have = countNamed(c.n);
			if (c.ef && have >= countNamed(c.ef)) continue;
			fillTo(c, have + 1);
			if (countNamed(c.n) > have) grew = true;
		}
	}

	// 3. trainers, leaving room for energy in standard
	const energyN = () => deckCards().filter(c => c.s === 'E').length;
	const reserve = () => (rules.energyZone ? 0 : Math.max(0, FILL_ENERGY_TARGET - energyN()));
	const hasStage2 = pokemon().some(c => stageOf(c) === 2);
	const hasEvolution = pokemon().some(c => c.ef);
	const staples = FILL_TRAINERS[format].filter(s => (!s.stage2 || hasStage2) && (!s.evolution || hasEvolution));
	// second pass raises each staple to its copy limit if there's room left
	for (const pass of [0, 1]) {
		for (const s of staples) {
			const c = getTcgCard(s.id);
			if (!c || room() <= reserve()) break;
			const want = pass ? copyMaxFor(c, format, hostFormat) : s.n;
			while (countNamed(c.n) < want && room() > reserve() && canAdd(c)) out.push(c.id);
		}
	}

	// 4. basic energy for attack costs, split by how many pokemon need each type
	if (!rules.energyZone && room() > 0) {
		const weight: { [type: string]: number } = Object.create(null);
		for (const c of pokemon()) {
			for (const t of c.ec || []) if (TCG_BASIC_ENERGY[t]) weight[t] = (weight[t] || 0) + 1;
		}
		if (!Object.keys(weight).length) {
			for (const c of pokemon()) for (const t of c.t) if (TCG_BASIC_ENERGY[t]) weight[t] = (weight[t] || 0) + 1;
		}
		if (!Object.keys(weight).length) {
			weight.grass = 1;
			notes.push('The attacks only need Colorless Energy, so Grass Energy was added. Any Basic Energy works.');
		}
		const types = Object.keys(weight).sort((a, b) => weight[b] - weight[a] || a.localeCompare(b));
		const total = types.reduce((n, t) => n + weight[t], 0);
		const count = room();
		// largest remainder, so the split adds up to exactly `count`
		const share = types.map(t => ({ t, exact: (count * weight[t]) / total }));
		const n = share.map(s => Math.floor(s.exact));
		let left = count - n.reduce((a, b) => a + b, 0);
		const byRemainder = share.map((_s, i) => i).sort((a, b) =>
			(share[b].exact - Math.floor(share[b].exact)) - (share[a].exact - Math.floor(share[a].exact)) || a - b);
		for (const i of byRemainder) {
			if (left <= 0) break;
			n[i]++;
			left--;
		}
		types.forEach((t, i) => {
			for (let k = 0; k < n[i]; k++) out.push(TCG_BASIC_ENERGY[t]);
		});
	}

	const poke = pokemon().length;
	// a fossil line starts from an item, so the deck can still have no basic to open with
	if (!pokemon().some(c => c.b)) notes.push('No Basic Pokémon yet. Add one so the deck can start a game.');
	if (poke < target) notes.push(`Only ${poke} Pokémon. Add more Pokémon for a steadier deck.`);
	if (room() > 0) notes.push(`Could not find enough cards to fill the last ${room()}.`);
	return done();
}

/** more copies than any deck can have, so it's a typo */
const TCG_MAX_LINE_QUANTITY = 60;

/** section labels and banners from live, limitless and older tcg online exports */
function tcgIsListHeader(line: string): boolean {
	if (line.startsWith('===') || /^format\s*:/i.test(line)) return true;
	if (/^\*{2,}.*\*{2,}$/.test(line) || /^deck list generated\b/i.test(line)) return true;
	const label = line.replace(/^#+\s*/, '');
	return /^(?:pok[eé]mon|trainers?|energy|other)(?:\s+cards)?(?:\s*[:(-]\s*\d*\)?)?$/i.test(label) ||
		/^total(?:\s+cards)?\s*[:-]\s*\d+$/i.test(label);
}

/** no quantity (like a bare card id) means 1 */
function tcgSplitQuantity(line: string): { qty: number, rest: string } | { error: string } {
	const first = line.split(/\s+/, 1)[0];
	const rest = line.slice(first.length).trim();
	if (/^\d+x?$/i.test(first)) {
		if (!rest) return { error: 'Missing card after the quantity. Expected a line like "4 Darkrai-EX DEX 63".' };
		const qty = parseInt(first, 10);
		if (qty >= 1 && qty <= TCG_MAX_LINE_QUANTITY) return { qty, rest };
		return { error: `Invalid quantity ${first}. Use a whole number from 1 to ${TCG_MAX_LINE_QUANTITY}.` };
	}
	if (rest && /^[-+]?\d*[.,]?\d+x?$/i.test(first)) {
		return { error: `Invalid quantity ${first}. Use a whole number from 1 to ${TCG_MAX_LINE_QUANTITY}.` };
	}
	return { qty: 1, rest: line };
}

function tcgIllegalWarnings(ids: string[], format: TcgDeckFormat | null): string[] {
	if (!format) return [];
	const illegal = ids
		.filter((id, i) => ids.indexOf(id) === i)
		.map(id => getTcgCard(id)!)
		.filter(c => tcgLegalityHint(c, format) === 'illegal')
		.map(c => `${c.n} (${tcgPrintingLabel(c)})`);
	if (!illegal.length) return [];
	const list = illegal.slice(0, 6).join(', ') + (illegal.length > 6 ? ', …' : '');
	const name = activeDeckRules(format).name;
	return [`Not legal in ${name}: ${list}. These printings were kept, so replace them or change format.`];
}

export type TcgImportResult = {
	/** empty whenever there are errors, so a failed import never replaces part of a deck */
	ids: string[],
	errors: string[],
	warnings: string[],
};

function tcgImportFailed(errors: string[], warnings: string[] = []): TcgImportResult {
	return { ids: [], errors, warnings };
}

function tcgImportIds(tokens: string[], format: TcgDeckFormat | null): TcgImportResult {
	const ids: string[] = [];
	const errors: string[] = [];
	for (const token of tokens) {
		const card = getTcgCard(token);
		const hit: TcgResolved = card ? tcgCardForFormat(card, format) : { error: `Unknown card id: ${token}` };
		if ('error' in hit) errors.push(hit.error);
		else ids.push(hit.id);
	}
	if (errors.length) return tcgImportFailed(errors);
	return { ids, errors, warnings: tcgIllegalWarnings(ids, format) };
}

/** each line is read on its own, so styles can be mixed. any error fails the whole import */
export function importTcgDeck(text: string, format: TcgDeckFormat | null): TcgImportResult {
	const source = String(text || '');
	const trimmed = source.trim();
	if (!trimmed) return tcgImportFailed(['Nothing to import. Paste a deck list first.']);

	if (trimmed.startsWith('[')) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return tcgImportFailed(['That text starts with [ but is not a valid JSON array of card ids.']);
		}
		if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string' || !id)) {
			return tcgImportFailed(['A JSON deck must be an array of card ids.']);
		}
		if (!parsed.length) return tcgImportFailed(['That list has no cards in it.']);
		return tcgImportIds(parsed as string[], format);
	}

	// card ids separated by spaces or commas, like a packed deck
	const tokens = trimmed.split(/[\s,]+/);
	if (tokens.every(token => getTcgCard(token))) return tcgImportIds(tokens, format);

	const ids: string[] = [];
	const errors: string[] = [];
	const warnings: string[] = [];
	const firstLine: { [id: string]: number } = Object.create(null);

	source.split(/\r?\n/).forEach((raw, i) => {
		const lineNumber = i + 1;
		const line = raw.trim();
		if (!line || tcgIsListHeader(line)) return;
		const fail = (error: string) => errors.push(`Line ${lineNumber} (${line}): ${error}`);

		// strip a leading bullet, but not the sign of a negative quantity
		const parsed = tcgSplitQuantity(line.replace(/^(?:[*•]\s*|-\s+)/, ''));
		if ('error' in parsed) return fail(parsed.error);
		const resolved = resolveImportCard(parsed.rest, format);
		if ('error' in resolved) return fail(resolved.error);

		if (resolved.warning) warnings.push(`Line ${lineNumber}: ${resolved.warning}`);
		if (firstLine[resolved.id]) {
			const label = `${getTcgCard(resolved.id)!.n} (${resolved.id})`;
			warnings.push(`Line ${lineNumber} repeats ${label} from line ${firstLine[resolved.id]}. Both were counted.`);
		} else {
			firstLine[resolved.id] = lineNumber;
		}
		for (let n = 0; n < parsed.qty; n++) ids.push(resolved.id);
	});

	if (errors.length) return tcgImportFailed(errors, warnings);
	if (!ids.length) return tcgImportFailed(['That list has no cards in it.'], warnings);
	return { ids, errors, warnings: warnings.concat(tcgIllegalWarnings(ids, format)) };
}
