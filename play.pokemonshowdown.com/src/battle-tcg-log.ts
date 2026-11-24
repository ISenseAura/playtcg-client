import {
	type TcgChatEntry,
	type TcgEvent,
	type TcgPlayerView,
	type TcgPokemonView,
	type TcgSlot,
	type TcgSnapshot,
	findMonSlot,
	findMonView,
} from "./battle-tcg-types";
import {
	type HitStyle,
	clusterSkip,
	energyElement,
	pickedFromDiscard,
} from "./battle-tcg-flights";

declare const Net: (url: string) => { get: () => Promise<string> };

export type PkFx = {
	cls: string,
	dataFx?: string,
	tick?: number,
	element?: string,
	status?: string,
	moveTag?: string,
	moveName?: string,
	energyType?: string,
	hitStyle?: HitStyle,
	contact?: boolean,
	targetIid?: string,
	note?: string,
};

export type KoGhost = {
	iid: string,
	cardId: string,
	name: string,
	image?: string,
	hp?: number,
	maxHp?: number,
	seat: number,
	slot: TcgSlot,
};

export function whoName(players: TcgPlayerView[] | undefined, seat: number | undefined): string {
	if (seat == null) return 'a player';
	return players?.[seat]?.name || `Player ${seat + 1}`;
}

export function actorLabel(
	players: TcgPlayerView[] | undefined,
	seat: number | undefined,
	you?: number | null
): string {
	if (seat == null) return 'A player';
	if (you != null && seat === you) return 'You';
	if (you != null) return 'Opponent';
	return whoName(players, seat);
}

export function actorIsYou(seat: number | undefined, you?: number | null): boolean {
	return you != null && seat != null && seat === you;
}

export const seenMonNames: { [iid: string]: string } = Object.create(null);
export const seenCardNames: { [id: string]: string } = Object.create(null);

export function clearSeenTcgNames() {
	for (const k in seenMonNames) delete seenMonNames[k];
	for (const k in seenCardNames) delete seenCardNames[k];
}

export function noteTcgMons(players: TcgPlayerView[] | undefined) {
	if (!players) return;
	for (const p of players) {
		const mons = [p?.active, ...(p?.bench || [])];
		for (const mon of mons) {
			if (mon?.iid && mon.name) seenMonNames[mon.iid] = mon.name;
			if (mon?.cardId && mon.name && mon.name !== mon.cardId) seenCardNames[mon.cardId] = mon.name;
		}
	}
}

export function eventCardIds(events: readonly TcgEvent[] | undefined): string[] {
	const out: string[] = [];
	const add = (id: unknown) => {
		if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
	};
	for (const ev of events || []) {
		const row = ev as unknown as { cardId?: unknown, fromCardId?: unknown, ids?: unknown, source?: { cardId?: unknown } };
		add(row.cardId);
		add(row.fromCardId);
		if (Array.isArray(row.ids)) row.ids.forEach(add);
		add(row.source?.cardId);
	}
	return out;
}

/** the shipped name files don't count as a source */
export function unnamedCardIds(ids: readonly string[]): string[] {
	return ids.filter(id => !seenCardNames[id]);
}

export function cardNamesOfEvents(events: readonly TcgEvent[] | undefined): { [id: string]: string } {
	const out: { [id: string]: string } = {};
	for (const id of eventCardIds(events)) if (seenCardNames[id]) out[id] = seenCardNames[id];
	return out;
}

export function noteTcgCardNames(
	snap: { cardNames?: { [id: string]: string | null } } | null | undefined,
	rootEl?: HTMLElement | null
) {
	const names = snap?.cardNames;
	if (!names) return;
	let added = false;
	for (const id in names) {
		if (!names[id] || seenCardNames[id] === names[id]) continue;
		seenCardNames[id] = names[id];
		added = true;
	}
	if (added) rewriteLoggedCardIds(rootEl);
}

export function monName(players: TcgPlayerView[] | undefined, iid?: string): string {
	return findMonView(players, iid)?.name || (iid && seenMonNames[iid]) || 'a Pokémon';
}

export const printedNames: { [id: string]: string } = Object.assign(Object.create(null), {
	'base1-97': 'Grass Energy',
	'base1-98': 'Fire Energy',
	'base1-99': 'Water Energy',
	'base1-100': 'Lightning Energy',
	'base1-101': 'Psychic Energy',
	'base1-102': 'Fighting Energy',
	'sve-1': 'Grass Energy', 'sve-2': 'Fire Energy', 'sve-3': 'Water Energy', 'sve-4': 'Lightning Energy',
	'sve-5': 'Psychic Energy', 'sve-6': 'Fighting Energy', 'sve-7': 'Darkness Energy', 'sve-8': 'Metal Energy',
	'sve-9': 'Grass Energy', 'sve-10': 'Fire Energy', 'sve-11': 'Water Energy', 'sve-12': 'Lightning Energy',
	'sve-13': 'Psychic Energy', 'sve-14': 'Fighting Energy', 'sve-15': 'Darkness Energy', 'sve-16': 'Metal Energy',
});

const printedNamesLoaded: { [file: string]: boolean } = Object.create(null);

function namesUrl(file: string): string {
	if (file.startsWith('/') && typeof document !== 'undefined' && document.location?.host) {
		return document.location.protocol + '//' + document.location.host + file;
	}
	return file;
}

export function rewriteLoggedCardIds(rootEl?: HTMLElement | null) {
	if (!rootEl && typeof document === 'undefined') return;
	const container = rootEl || document;
	if (!container || typeof container.querySelectorAll !== 'function') return;
	const spans = container.querySelectorAll<HTMLElement>('.tcg-log-card-id[data-card-id]');
	for (const span of spans) {
		const id = span.getAttribute('data-card-id');
		if (!id) continue;
		const name = seenCardNames[id] || printedName(id);
		if (name && span.textContent !== name) {
			span.textContent = name;
		}
	}
}

export function loadPrintedNames(file = '/tcg-names.json') {
	if (printedNamesLoaded[file] || typeof Net !== 'function') return;
	printedNamesLoaded[file] = true;
	Net(namesUrl(file)).get().then(text => {
		const data = JSON.parse(text);
		if (data && typeof data === 'object') Object.assign(printedNames, data);
		rewriteLoggedCardIds();
	}).catch(() => {});
}

if (typeof Net === 'function') {
	loadPrintedNames();
}

export function loadPaperNames() {
	loadPrintedNames('/tcg-names-paper.json');
}

export function printedName(id?: string): string {
	if (!id) return '';
	if (printedNames[id]) return printedNames[id];
	const promo = /^P-([A-Za-z])-0*(\d+)$/.exec(id);
	if (promo) {
		const key = `PROMO-${promo[1].toUpperCase()}-${promo[2]}`;
		if (printedNames[key]) return printedNames[key];
	}
	const num = /^(.*)-0*(\d+)$/.exec(id);
	if (num && printedNames[`${num[1]}-${num[2]}`]) return printedNames[`${num[1]}-${num[2]}`];
	const energy = /^energy-([a-z]+)$/i.exec(id);
	if (energy) {
		const t = energy[1].toLowerCase();
		return t.charAt(0).toUpperCase() + t.slice(1) + ' Energy';
	}
	return '';
}

export function cardName(players: TcgPlayerView[] | undefined, cardId?: string, iid?: string): string {
	const fromIid = findMonView(players, iid)?.name;
	if (fromIid && fromIid !== cardId) return fromIid;
	if (cardId && players) {
		for (const p of players) {
			const mons = [p?.active, ...(p?.bench || [])];
			for (const mon of mons) {
				if (mon?.cardId === cardId && mon.name && mon.name !== cardId) return mon.name;
			}
		}
	}
	if (iid && seenMonNames[iid] && seenMonNames[iid] !== cardId) return seenMonNames[iid];
	if (cardId && seenCardNames[cardId]) return seenCardNames[cardId];
	return printedName(cardId);
}

/**
 * a card the rows point to always comes with its printed name, so a missing one is a data bug: log it and mark
 * the text so it's clearly not a card name. never show an internal id
 */
export const MISSING_CARD_NAME = '(card name missing)';
const reportedMissing: { [id: string]: boolean } = Object.create(null);
export function missingCardName(id: string): string {
	if (!reportedMissing[id]) {
		reportedMissing[id] = true;
		console.error(`[tcg] The log names card id "${id}" but no printed name was delivered for it.`);
	}
	return MISSING_CARD_NAME;
}

export function cardLabel(id?: string): string {
	if (!id) return 'a card';
	return seenCardNames[id] || printedName(id) || missingCardName(id);
}

export function formatCardSpan(id?: string, name?: string): string {
	if (!id) return name || 'a card';
	const resolved = name || seenCardNames[id] || printedName(id);
	if (resolved && resolved !== id) return resolved;
	// the id stays on the span for the console report, it's never the visible text
	return `<span class="tcg-log-card-id" data-card-id="${id}">${missingCardName(id)}</span>`;
}

export function statusWord(s: string | null | undefined): string {
	const t = String(s || '').toLowerCase();
	if (t === 'asleep') return 'Asleep';
	if (t === 'burned') return 'Burned';
	if (t === 'confused') return 'Confused';
	if (t === 'paralyzed') return 'Paralyzed';
	if (t === 'poisoned') return 'Poisoned';
	return s || '';
}

export function statusBadges(mon: TcgPokemonView): { id: string, label: string, title: string }[] {
	const out: { id: string, label: string, title: string }[] = [];
	const main = String(mon.status || '').toLowerCase();
	if (main === 'asleep') out.push({ id: 'slp', label: 'SLP', title: 'Asleep' });
	else if (main === 'paralyzed') out.push({ id: 'par', label: 'PAR', title: 'Paralyzed' });
	else if (main === 'confused') out.push({ id: 'cnf', label: 'CNF', title: 'Confused' });
	if ((mon as any).poisoned || main === 'poisoned') out.push({ id: 'psn', label: 'PSN', title: 'Poisoned' });
	if ((mon as any).burned || main === 'burned') out.push({ id: 'brn', label: 'BRN', title: 'Burned' });
	return out;
}

export function sourceName(src?: { kind?: string, name?: string, cardId?: string } | null): string {
	if (!src?.kind) return '';
	const kind = src.kind;
	if (kind === 'play' || kind === 'turn' || kind === 'search' || kind === 'promote' || kind === 'retreat' ||
		kind === 'evolve') {
		return '';
	}
	if (src.name) return src.name;
	if (src.cardId) return cardLabel(src.cardId);
	if (kind === 'poison') return 'Poison';
	if (kind === 'burn') return 'Burn';
	if (kind === 'asleep') return 'Sleep';
	if (kind === 'paralyzed') return 'Paralysis';
	if (kind === 'confusion') return 'Confusion';
	if (kind === 'checkup') return 'Pokémon Checkup';
	if (kind === 'ko') return 'a Knock Out';
	return '';
}

export function fromSource(e: { source?: { kind?: string, name?: string, cardId?: string }, ids?: string[] }): string {
	if (e.source?.kind === 'ko') return ' for the Knock Out';
	const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
	if (e.source?.cardId && ids.length && ids.every(id => id === e.source?.cardId)) return '';
	const name = sourceName(e.source);
	return name ? ` from ${name}` : '';
}

export function userName(ev: TcgEvent, players?: TcgPlayerView[], batch?: TcgEvent[]): string {
	if (ev.cardId) return cardName(players, ev.cardId) || cardLabel(ev.cardId);
	const evo = (batch || []).find(e => e?.type === 'evolve' && e.iid === ev.iid && e.fromCardId);
	if (evo?.fromCardId) return cardName(players, evo.fromCardId) || cardLabel(evo.fromCardId);
	return monName(players, ev.iid);
}

export function bySource(e: { source?: { kind?: string, name?: string, cardId?: string } }): string {
	const name = sourceName(e.source);
	return name ? ` by ${name}` : '';
}

/** `reveal.mulligan` is that player's mulligan number in this deal */
export function mulliganWords(n: number): string {
	return n > 1 ? `took mulligan ${n}` : 'took a mulligan';
}

export function setupRevealAt(events: TcgEvent[] | undefined, i: number): boolean {
	if (!events || i < 0) return false;
	let j = i - 1;
	while (j >= 0 && events[j]?.type === 'place') j--;
	return events[j]?.type === 'setupEnd';
}

export function placeTalk(
	e: TcgEvent,
	players?: TcgPlayerView[],
	reveal = false
): { tag: string, extra: string, text: string } {
	const actor = whoName(players, e.seat);
	const bench = e.slot !== 'active' && e.slot != null;
	if (reveal) {
		const shown = e.name || cardName(players, e.cardId, e.iid) || cardLabel(e.cardId);
		const where = bench ? 'on the Bench' : 'in the Active Spot';
		return { tag: 'REVEAL', extra: shown, text: `${actor} revealed ${shown} ${where}.` };
	}
	if (e.faceDown) {
		return bench ?
			{ tag: 'BENCH', extra: 'Face down', text: `${actor} put a Pokémon face down on the Bench.` } :
			{ tag: 'ACTIVE', extra: 'Face down', text: `${actor} put a Pokémon face down in the Active Spot.` };
	}
	const name = e.name || cardName(players, e.cardId, e.iid) || cardLabel(e.cardId);
	const kind = e.source?.kind || '';
	const by = sourceName(e.source);
	if (kind === 'retreat') {
		return bench ?
			{ tag: 'BENCH', extra: name, text: `${name} retreated to the Bench.` } :
			{ tag: 'RETREAT', extra: name, text: `${name} retreated to the Active Spot.` };
	}
	if (kind === 'promote') {
		return { tag: 'ACTIVE', extra: name, text: `${name} was sent to the Active Spot.` };
	}
	if (by && (kind === 'attack' || kind === 'ability' || kind === 'trainer' || kind === 'stadium' || kind === 'tool')) {
		return bench ?
			{ tag: 'BENCH', extra: name, text: `${name} was switched to the Bench by ${by}.` } :
			{ tag: 'ACTIVE', extra: name, text: `${name} was switched to the Active Spot by ${by}.` };
	}
	if (bench) return { tag: 'BENCH', extra: name, text: `${actor} benched ${name}.` };
	return { tag: 'ACTIVE', extra: name, text: `${name} came into the Active Spot.` };
}

export function dmgSrc(events: TcgEvent[], i: number, players?: TcgPlayerView[]): { key: string, label: string } {
	const e = events[i];
	if (e?.type !== 'damage') return { key: 'effect', label: 'Damage' };
	const named = sourceName(e.source);
	if (e.source?.kind && named) return { key: e.source.kind, label: named };
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) break;
		const t = String(p.type || '');
		if (clusterSkip(t) && t !== 'damage' && t !== 'heal' && t !== 'status') continue;
		if (t === 'attack') return { key: 'attack', label: p.name || 'Attack' };
		if (t === 'ability') return { key: 'ability', label: p.name || 'Ability' };
		if (t === 'trainer') return { key: 'trainer', label: cardLabel(p.cardId) };
		if (t === 'checkup') {
			const mon = findMonView(players, e.iid);
			if ((mon as any)?.poisoned || mon?.status === 'poisoned') return { key: 'poison', label: 'Poison' };
			if ((mon as any)?.burned || mon?.status === 'burned') return { key: 'burn', label: 'Burn' };
			return { key: 'checkup', label: 'Pokémon Checkup' };
		}
		break;
	}
	return { key: 'effect', label: 'Damage' };
}

export function searchZoneText(
	snap: TcgSnapshot | null | undefined, seat: number | undefined, own: boolean, eventZone?: string
): string {
	const whose = own ? 'your' : 'their';
	const zone = eventZone || (snap?.you != null && seat === snap.you ? snap.pendingSearch?.zone : undefined);
	if (zone === 'discard') return `${whose} discard pile`;
	if (zone === 'prizes') return `${whose} Prize cards`;
	if (zone === 'deck') return `${whose} deck`;
	return 'for a card';
}

export function damageModifierNote(mods: { delta?: number, summary?: string }[] | undefined): string {
	if (!Array.isArray(mods) || !mods.length) return '';
	const parts = mods.map(m => {
		if (m.summary) return m.summary;
		const d = Number(m.delta);
		if (!d) return '';
		return d > 0 ? `+${d}` : `−${Math.abs(d)}`;
	}).filter(Boolean);
	return parts.length ? ` (${parts.join(', ')})` : '';
}

export function calcStepNote(step: {
	op?: string,
	value?: number,
	reason?: string,
	source?: { kind?: string, name?: string, cardId?: string },
}): string {
	const value = Number(step.value) || 0;
	const op = step.op;
	const amount = op === 'multiply' ? `×${value}` :
		op === 'subtract' || value < 0 ? `−${Math.abs(value)}` :
		`+${value}`;
	const named: { [k: string]: string } = {
		weakness: 'Weakness', resistance: 'Resistance', plusPower: 'PlusPower',
		defender: 'Defender', lessNext: 'taking less',
	};
	const who = sourceName(step.source) || named[String(step.reason || '')] || '';
	return who ? `${amount} ${who}` : amount;
}

export function damageBreakdown(ev: {
	calc?: { steps?: unknown[] },
	modifiers?: { delta?: number, summary?: string }[],
}): string {
	const steps = Array.isArray(ev.calc?.steps) ? ev.calc.steps : [];
	const fromCalc = steps.map(s => calcStepNote(s as any)).filter(Boolean);
	if (fromCalc.length) return ` (${fromCalc.join(', ')})`;
	return damageModifierNote(ev.modifiers);
}

export function dealCount(e: { counts?: number[] }): number {
	const counts = Array.isArray(e.counts) ? e.counts : [];
	return counts.length ? Number(counts[0]) || 0 : 7;
}

export function turnOrderOf(snap: TcgSnapshot, seat: number): '' | 'first' | 'second' {
	if (snap.pendingFirst != null || (snap.firstPlayer !== 0 && snap.firstPlayer !== 1)) return '';
	return snap.firstPlayer === seat ? 'first' : 'second';
}

export type TcgOpeningFormat = {
	id?: string,
	name?: string,
	displayName?: string,
	deckSize?: number,
	minDeckSize?: number,
	copyLimit?: number,
	prizes?: number,
	prizeCards?: boolean,
	benchSize?: number,
	regulationMin?: string,
	legality?: string,
	series?: string[],
	samePokemonType?: boolean,
	allowRuleBox?: boolean,
	allowAceSpec?: boolean,
	allowRadiant?: boolean,
	firstPlayerMayAttack?: boolean,
	firstPlayerMaySupporter?: boolean,
	firstPlayerMayAttach?: boolean,
	mayEvolveOnFirstTurn?: boolean,
	energyZone?: boolean,
	openingHand?: number,
	maxHand?: number,
	noMulligan?: boolean,
	noDeckout?: boolean,
	coinWinnerGoesFirst?: boolean,
	weaknessPlus?: number,
	confusedSelfDamage?: number,
	maxTurns?: number,
	assignedDeck?: boolean,
};

export function tcgOpeningRules(format: TcgOpeningFormat | null | undefined): string[] {
	if (!format) return [];
	const lines: string[] = [];
	const max = format.deckSize;
	const min = format.minDeckSize;
	if (typeof max === 'number') {
		lines.push(typeof min === 'number' && min !== max ? `Deck: ${min}–${max} cards` : `Deck: ${max} cards`);
	}
	if (typeof format.copyLimit === 'number' && typeof max === 'number') {
		if (format.copyLimit >= max) lines.push('Copies: any number of each card');
		else if (format.copyLimit === 1) lines.push('Copies: 1 of each card');
		else lines.push(`Copies: up to ${format.copyLimit} of each card`);
	}
	if (typeof format.prizes === 'number') {
		lines.push(format.prizeCards === false ? `Points: ${format.prizes} to win` : `Prize cards: ${format.prizes}`);
	}
	if (typeof format.benchSize === 'number') lines.push(`Bench: ${format.benchSize}`);
	if (format.regulationMin) lines.push(`Regulation: ${format.regulationMin} and later`);
	else if (format.legality) {
		const word = format.legality.charAt(0).toUpperCase() + format.legality.slice(1);
		lines.push(`Legality: ${word}`);
	}
	if (format.series?.length) lines.push(`Series: ${format.series.join(', ')}`);
	if (format.samePokemonType) lines.push('Type: every Pokémon shares a type');
	if (format.allowRuleBox === false) lines.push('Rule Box: not allowed');
	if (format.allowAceSpec === false) lines.push('ACE SPEC: not allowed');
	if (format.allowRadiant === false) lines.push('Radiant: not allowed');
	if (
		typeof format.firstPlayerMayAttack === 'boolean' &&
		typeof format.firstPlayerMaySupporter === 'boolean' &&
		typeof format.firstPlayerMayAttach === 'boolean'
	) {
		lines.push(`Going first: ${[
			format.firstPlayerMayAttack ? 'may attack' : 'cannot attack',
			format.firstPlayerMaySupporter ? 'may play a Supporter' : 'cannot play a Supporter',
			format.firstPlayerMayAttach ? 'may attach Energy' : 'cannot attach Energy',
		].join(', ')}`);
	}
	if (typeof format.mayEvolveOnFirstTurn === 'boolean') {
		lines.push(format.mayEvolveOnFirstTurn ? 'First turn: may evolve' : 'First turn: cannot evolve');
	}
	if (format.energyZone) lines.push('Energy Zone: Energy is not in the deck');
	if (typeof format.openingHand === 'number') lines.push(`Opening hand: ${format.openingHand} cards`);
	if (typeof format.maxHand === 'number') lines.push(`Hand limit: ${format.maxHand} cards`);
	if (format.noMulligan) lines.push('Mulligan: none');
	if (format.noDeckout) lines.push('Deck out: an empty deck is not a loss');
	if (format.coinWinnerGoesFirst) lines.push('Turn order: the opening coin flip chooses who goes first');
	if (typeof format.weaknessPlus === 'number') lines.push(`Weakness: +${format.weaknessPlus} damage`);
	if (format.confusedSelfDamage === 0) lines.push('Confusion: no damage to yourself');
	if (typeof format.maxTurns === 'number') lines.push(`Turn cap: ${format.maxTurns} turns`);
	if (format.assignedDeck) lines.push('Decks: assigned when the battle starts');
	return lines;
}

export function tcgFormatTitle(format: TcgOpeningFormat | null | undefined): string {
	return format?.displayName || format?.name || format?.id || '';
}

export function firstPlayerBanner(snap: TcgSnapshot, you: number | null | undefined, hold = false): string {
	if (hold || snap.status !== 'setup') return '';
	if (!turnOrderOf(snap, 0)) return '';
	const first = snap.firstPlayer!;
	if (you === first) return 'You go first';
	return `${snap.players?.[first]?.name || 'Your opponent'} goes first`;
}

/**
 * The open choice when only the opponent is deciding, on either turn. `what` describes
 * their action using only public `pendingChoice` data, never their available choices.
 * Empty string if there's nothing to add to "Waiting for opponent", null if it's your
 * choice too or no choice is open.
 */
export function foeChoice(snap: TcgSnapshot, you: number | null | undefined): { what: string } | null {
	const choice = snap.pendingChoice;
	if (you == null || !choice?.seats?.length || choice.seats.includes(you)) return null;
	return { what: foeChoiceText(choice, you) };
}

function foeChoiceText(choice: NonNullable<TcgSnapshot['pendingChoice']>, you: number): string {
	switch (choice.kind) {
	case 'slot':
		if (choice.topic === 'benchDiscard') return 'Choosing Pokémon to discard';
		return choice.side === 'foe' ? 'Choosing from your Pokémon' : 'Choosing from their Pokémon';
	case 'promote':
	case 'switch':
		return 'Choosing a new Active Pokémon';
	case 'prize':
		return choice.n && choice.n > 1 ? `Taking ${choice.n} Prize cards` : 'Taking a Prize card';
	case 'search': {
		const whose = choice.pileSeat === you ? 'your' : 'their';
		if (choice.zone === 'discard') return `Looking through ${whose} discard pile`;
		if (choice.zone === 'prizes') return `Looking at ${whose} Prize cards`;
		return `Looking through ${whose} deck`;
	}
	case 'discard':
		if (choice.fromFoe) return 'Choosing cards from your hand';
		if (choice.to === 'deck') return 'Choosing cards to put into their deck';
		if (choice.to === 'lost') return 'Choosing cards to put in the Lost Zone';
		if (choice.to === 'prizes') return 'Choosing cards to put into their Prize cards';
		return 'Choosing cards to discard';
	case 'discardEnergy':
		return 'Choosing Energy to discard';
	case 'retreatPay':
		return 'Choosing Energy to discard to retreat';
	case 'handEnergy':
		return 'Choosing Energy to attach';
	case 'copy':
	case 'confirm':
		return 'Making a choice';
	case 'mulliganDraw':
		return 'Choosing how many cards to draw';
	}
	return '';
}

export const FIRST_BANNER_BLOCKS = '.tcg-mon:not([data-drop-empty="1"]), .tcg-pile, .tcg-prizes, .tcg-lost-zone, .tcg-stadium, .tcg-player, .tcg-hud-top > *, ' +
	'.tcg-ezone, .tcg-live-controls > *, .tcg-float-hint, .tcg-wait-banner, .tcg-hand-mine .tcg-card';

export function setupReturnBatch(batch: TcgEvent[] | undefined, seat: unknown): boolean {
	return !!batch?.some(e => e.type === 'act' && e.seat === seat && e.action?.type === 'setupReturn');
}

export function chatEntryForEvent(
	ev: TcgEvent,
	players?: TcgPlayerView[],
	snap?: TcgSnapshot | null,
	batch?: TcgEvent[]
): TcgChatEntry | null {
	const w = (seat: number) => whoName(players, seat);
	const poke = (iid?: string) => monName(players, iid);
	const nm = (id?: string) => formatCardSpan(id, cardName(players, id));
	switch (ev.type) {
	case 'act':
		if (ev.action?.type === 'discardPick') {
			return { kind: 'trainer', label: 'Discard', text: `${w(ev.seat!)} discarded a card.`, seat: ev.seat };
		}
		if (ev.action?.type === 'searchDone') {
			if (batch && !batch.some(e => e.type === 'shuffle' && e.seat === ev.seat)) return null;
			return { kind: 'draw', label: 'Search', text: `${w(ev.seat!)} shuffled their deck.`, seat: ev.seat };
		}
		if (ev.action?.type === 'mulliganDraw') {
			const n = Number(ev.action.n) || 0;
			const cards = n === 1 ? 'card' : 'cards';
			const who = w(ev.seat ?? 0);
			return {
				kind: 'draw', label: 'Mulligan',
				text: n === 0 ?
					`${who} draws no cards for the mulligan.` :
					`${who} draws ${n} ${cards} for the mulligan.`,
				seat: ev.seat,
			};
		}
		if (ev.action?.type === 'chooseFirst') {
			const first = ev.action.goFirst ? (ev.seat!) : (ev.seat === 0 ? 1 : 0);
			return { kind: 'setup', label: 'First', text: `${w(first)} will go first.`, seat: first };
		}
		return null;
	case 'request':
		if (ev.kind === 'search') {
			const seat = (ev.waiting?.[0]) ?? 0;
			const own = snap?.you != null && seat === snap.you;
			return {
				kind: 'draw', label: 'Search',
				text: own ?
					`You are searching ${searchZoneText(snap, seat, true, ev.zone)}.` :
					`${w(seat)} is searching ${searchZoneText(snap, seat, false, ev.zone)}.`,
				seat,
			};
		}
		if (ev.kind === 'discardEnergy') {
			const seat = (ev.waiting?.[0]) ?? 0;
			return {
				kind: 'discard', label: 'Energy',
				text: `${w(seat)} chooses an Energy to discard.`,
				seat,
			};
		}
		if (ev.kind === 'mulliganDraw') {
			const seat = (ev.waiting?.[0]) ?? 0;
			const max = Number(ev.max) || 0;
			const cards = max === 1 ? 'card' : 'cards';
			return {
				kind: 'draw', label: 'Mulligan',
				text: `${w(seat)} may draw up to ${max} ${cards} for the mulligan, or none.`,
				seat,
			};
		}
		if (ev.kind === 'mulligan') {
			const seat = (ev.waiting?.[0]) ?? 0;
			const other = seat === 0 ? 1 : 0;
			return {
				kind: 'draw', label: 'Mulligan',
				text: `${w(other)} took a mulligan. ${w(seat)} may bench Basics from their extra cards.`,
				seat,
			};
		}
		return null;
	case 'start':
		return null;
	case 'first':
		return {
			kind: 'setup', label: 'First',
			text: ev.chooses ?
				`${w(ev.seat!)} won the coin flip and chooses who goes first.` :
				`${w(ev.seat!)} goes first.`,
			seat: ev.seat,
		};
	case 'deal': {
		const dealt = dealCount(ev);
		return { kind: 'setup', label: 'Deal', text: `Each player drew ${dealt} cards.` };
	}
	case 'coin': {
		const why = sourceName(ev.source);
		const face = ev.heads ? 'Heads.' : 'Tails.';
		return { kind: 'coin', label: 'Coin', text: why ? `${why}: ${face}` : `Coin flip: ${face}` };
	}
	case 'place': {
		const at = batch ? batch.findIndex(x => x === ev || (ev.seq != null && x.seq === ev.seq)) : -1;
		const reveal = at >= 0 ? setupRevealAt(batch, at) : !!batch && setupRevealAt([...batch, ev], batch.length);
		const talk = placeTalk(ev, players, reveal);
		const label = talk.tag === 'BENCH' ? 'Bench' : talk.tag === 'RETREAT' ? 'Retreat' : 'Active';
		return {
			kind: reveal ? 'setup' : 'switch',
			label: reveal ? 'Reveal' : label,
			text: talk.text,
			seat: ev.seat,
		};
	}
	case 'evolve': {
		const why = fromSource(ev);
		return {
			kind: 'evolve', label: 'Evolve',
			text: ev.devolved ?
				`${nm(ev.fromCardId)} devolved into ${nm(ev.cardId)}${why}.` :
				ev.fromCardId ?
					`${nm(ev.fromCardId)} evolved into ${nm(ev.cardId)}${why}.` :
					`Evolved into ${nm(ev.cardId)}${why}.`,
			seat: ev.seat,
		};
	}
	case 'attack':
		return { kind: 'attack', label: 'Attack', text: `${userName(ev, players, batch)} used ${ev.name}.` };
	// the engine's row for an attack used as this attack: "Night Joker uses N's Zekrom's Shred."
	case 'copiedAttack':
		return { kind: 'attack', label: 'Attack', text: `${ev.by} uses ${ev.fromCard}'s ${ev.name}.` };
	case 'attackFailed': {
		const why = ev.reason === 'confusion' ? 'it is Confused' :
			ev.reason === 'baby' ? 'of the Baby rule' : 'the flip was tails';
		return { kind: 'attack', label: 'Attack', text: `${ev.name} failed because ${why}.` };
	}
	case 'ability':
		return { kind: 'ability', label: 'Ability', text: `${userName(ev, players, batch)} used ${ev.name}.` };
	case 'trainer':
		return {
			kind: 'trainer', label: 'Play',
			text: ev.errata ?
				`${w(ev.seat!)} played ${nm(ev.cardId)} using its official errata.` :
				`${w(ev.seat!)} played ${nm(ev.cardId)}.`,
			seat: ev.seat,
		};
	case 'gameEnd':
		return null;
	case 'energyZone': {
		if (!ev.ready) return null;
		const type = String(ev.energyType || 'Energy');
		const label = type.charAt(0).toUpperCase() + type.slice(1);
		return {
			kind: 'energy', label: 'Energy',
			text: `${w(ev.seat!)}'s Energy Zone has ${label} Energy.`,
			seat: ev.seat,
		};
	}
	case 'energy': case 'tool': {
		const seat = ev.seat ?? findMonSlot(players, ev.iid)?.seat ?? 0;
		const why = fromSource(ev);
		return {
			kind: 'energy', label: ev.type === 'tool' ? 'Tool' : 'Energy',
			text: ev.from ?
				`${nm(ev.cardId)} moved from ${poke(ev.from)} to ${poke(ev.iid)}${why}.` :
				`${w(seat)} attached ${nm(ev.cardId)} to ${poke(ev.iid)}${why}.`,
			seat,
		};
	}
	case 'stadium':
		return { kind: 'trainer', label: 'Stadium', text: `${w(ev.seat!)} played ${nm(ev.cardId)}.`, seat: ev.seat };
	case 'stadiumEnd':
		return { kind: 'trainer', label: 'Stadium', text: `${nm(ev.cardId)} is no longer in play${fromSource(ev)}.` };
	case 'damage': {
		const counters = ev.counters ? Math.max(1, Math.round((Number(ev.amount) || 0) / 10)) : 0;
		const what = counters ?
			`${counters} damage counter${counters === 1 ? '' : 's'}` :
			`${ev.amount} damage`;
		return {
			kind: 'damage', label: 'Damage',
			text: `${poke(ev.iid)} took ${what}${damageBreakdown(ev)}${fromSource(ev)}.`,
		};
	}
	case 'heal': {
		const asked = ev.requested != null && Number(ev.requested) > Number(ev.amount);
		return {
			kind: 'heal', label: 'Heal',
			text: asked ?
				`${poke(ev.iid)} healed ${ev.amount} of ${ev.requested} damage${fromSource(ev)}.` :
				`${poke(ev.iid)} healed ${ev.amount} damage${fromSource(ev)}.`,
		};
	}
	case 'moveCounters': {
		const counters = Math.max(1, Math.round((Number(ev.amount) || 0) / 10));
		const why = fromSource(ev);
		return {
			kind: 'damage', label: 'Counters',
			text: ev.swap ?
				`${poke(ev.fromIid)} and ${poke(ev.iid)} switched damage counters${why}.` :
				`${poke(ev.fromIid)} moved ${counters} damage counter${counters === 1 ? '' : 's'} to ${poke(ev.iid)}${why}.`,
		};
	}
	case 'noDamage': {
		const stopped = bySource({ source: ev.prevention?.source });
		const tried = fromSource(ev);
		const breakdown = damageBreakdown(ev);
		return {
			kind: 'damage', label: 'No damage',
			text: ev.outcome === 'prevented' ?
				`The damage to ${poke(ev.iid)}${tried} was prevented${stopped}${breakdown}.` :
				`${poke(ev.iid)} took no damage${breakdown}${tried}.`,
		};
	}
	case 'prevent': {
		if (ev.what === 'moveCounters') {
			// a damage counter move stopped by an effect in play (Watchful Eye), nothing moved
			const src = ev.prevention?.source;
			const by = src?.kind === 'ability' && src.cardId && src.name ?
				` by ${cardLabel(src.cardId)}'s ${src.name}` : bySource({ source: src });
			return {
				kind: 'note', label: 'Prevented',
				text: `The damage counters on ${poke(ev.iid)}${fromSource(ev)} couldn't be moved${by}.`,
			};
		}
		const what = ev.what === 'heal' ?
			(ev.amount != null ? `heal of ${ev.amount}` : 'heal') :
			ev.what === 'status' ? (ev.status ? statusWord(ev.status) : 'Special Condition') :
			"attack's effects";
		const verb = ev.what === 'attackEffects' ? 'were' : 'was';
		return {
			kind: 'note', label: 'Prevented',
			text: `The ${what} on ${poke(ev.iid)}${fromSource(ev)} ${verb} prevented${bySource({ source: ev.prevention?.source })}.`,
		};
	}
	case 'status':
		return {
			kind: 'status', label: 'Status',
			text: ev.status ?
				`${poke(ev.iid)} is ${statusWord(ev.status)}${fromSource(ev)}.` :
				`${poke(ev.iid)} recovered from Special Conditions${fromSource(ev)}.`,
		};
	case 'ko':
		return { kind: 'ko', label: 'KO', text: `${poke(ev.iid)} was Knocked Out${bySource(ev)}.`, seat: ev.seat };
	case 'leavePlay': {
		if (ev.to === 'hand' && setupReturnBatch(batch, ev.seat)) {
			return {
				kind: 'note', label: 'Setup',
				text: `${w(ev.seat!)} returned ${ev.cardId ? nm(ev.cardId) : 'a face-down Pokémon'} to their hand.`,
				seat: ev.seat,
			};
		}
		const where =
			ev.to === 'hand' ? 'into the hand' :
			ev.to === 'deck' || ev.to === 'deckTop' ? 'into the deck' :
			ev.to === 'lost' ? 'into the Lost Zone' :
			'into the discard pile';
		const by = sourceName(ev.source);
		const who = nm(ev.cardId) || poke(ev.iid);
		return { kind: 'note', label: 'Left play', text: `${who} went ${where}${by ? ` by ${by}` : ''}.`, seat: ev.seat };
	}
	case 'shuffle': {
		const why = fromSource(ev);
		return {
			kind: 'note', label: 'Shuffle',
			text: ev.from === 'hand' ?
				`${w(ev.seat!)} shuffled their hand into the deck${why}.` :
				`${w(ev.seat!)} shuffled their deck${why}.`,
			seat: ev.seat,
		};
	}
	case 'toDiscard': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length ? ids.map(nm).join(', ') : '';
		return {
			kind: 'discard', label: 'Discard',
			text: named ? `${w(ev.seat!)} discarded ${named}${fromSource(ev)}.` :
			`${w(ev.seat!)} discarded ${ids.length || 1} card${(ids.length || 1) === 1 ? '' : 's'}${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'fromDiscard': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length ? ids.map(nm).join(', ') : '';
		return {
			kind: 'discard', label: 'Discard',
			text: named ? `${w(ev.seat!)} took ${named} from the discard pile${fromSource(ev)}.` :
			`${w(ev.seat!)} took a card from the discard pile${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'toDeck': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length ? ids.map(nm).join(', ') : '';
		const fromHand = ev.from === 'hand';
		return {
			kind: 'note', label: 'Deck',
			text: fromHand ?
				`${w(ev.seat!)} put ${named || 'a card'} into the deck${fromSource(ev)}.` :
				`${w(ev.seat!)} shuffled ${named || 'a card'} into the deck${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'toLost':
		return {
			kind: 'note', label: 'Lost Zone',
			text: (ev.n || 1) === 1 ?
				`${w(ev.seat!)} put a card in the Lost Zone${fromSource(ev)}.` :
				`${w(ev.seat!)} put ${ev.n} cards in the Lost Zone${fromSource(ev)}.`,
			seat: ev.seat,
		};
	case 'draw': {
		const n = ev.n || 1;
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const named = ids.length && ids.length === n ? ids.map(nm).join(', ') : '';
		return {
			kind: 'draw', label: 'Draw',
			text: named ? `${w(ev.seat!)} drew ${named}${fromSource(ev)}.` :
			n === 1 ? `${w(ev.seat!)} drew a card${fromSource(ev)}.` : `${w(ev.seat!)} drew ${n} cards${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'reveal': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const names = ids.map(nm).filter(Boolean);
		const list = names.length ? names.join(', ') : 'no cards';
		const what = ev.hand ? `their hand: ${list}` : list;
		if (ev.mulligan) {
			return {
				kind: 'note', label: 'Mulligan',
				text: `${w(ev.seat!)} ${mulliganWords(Number(ev.mulligan))} and revealed ${what}.`,
				seat: ev.seat,
			};
		}
		return {
			kind: 'note', label: 'Reveal',
			text: `${w(ev.seat!)} revealed ${what}${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'fromHand':
		return null;
	case 'find': {
		if (!ev.dest && !ev.revealed && setupReturnBatch(batch, ev.seat)) return null;
		if (batch && pickedFromDiscard(batch, batch.indexOf(ev))) return null;
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		const why = fromSource(ev);
		const dest = String(ev.dest || 'hand');
		const named = ids.length ? ids.map(nm).join(', ') : '';
		const where =
			dest === 'top' ? 'on top of their deck' :
			dest === 'bench' ? 'onto their Bench' :
			dest === 'deck' ? 'into their deck' :
			dest === 'discard' ? 'into their discard pile' :
			dest === 'lost' ? 'into the Lost Zone' :
			dest === 'attach-active' ? 'onto their Active Pokémon' :
			dest === 'attach' ? 'to be attached' :
			dest === 'replace-active' ? 'into the Active Spot' :
			'into their hand';
		const text = named ?
			`${w(ev.seat!)} put ${named} ${where}${why}.` :
			((ev.ids?.length) || ev.n || 1) === 1 ?
				`${w(ev.seat!)} put a card ${where}${why}.` :
				`${w(ev.seat!)} put ${(ev.ids?.length) || ev.n} cards ${where}${why}.`;
		return { kind: 'draw', label: 'Search', text, seat: ev.seat };
	}
	case 'prize':
		return {
			kind: 'prize', label: 'Prize',
			text: `${w(ev.seat!)} takes ${ev.n} Prize card${ev.n === 1 ? '' : 's'}${fromSource(ev)}.`,
			seat: ev.seat,
		};
	case 'prizeTake': {
		const ids = Array.isArray(ev.ids) ? ev.ids.filter(Boolean) : [];
		return {
			kind: 'prize', label: 'Prize',
			text: ids.length ? `${w(ev.seat!)} took a Prize card${fromSource(ev)}: ${ids.map(nm).join(', ')}.` :
			`${w(ev.seat!)} took a Prize card${fromSource(ev)}.`,
			seat: ev.seat,
		};
	}
	case 'points':
		return {
			kind: 'prize', label: 'Points',
			text: `${w(ev.seat!)} scored ${ev.n} point${ev.n === 1 ? '' : 's'}${fromSource(ev)} (total ${ev.total}).`,
			seat: ev.seat,
		};
	case 'turn':
		return {
			kind: 'turn', label: 'Turn', text: `${w(ev.seat!)}'s turn`,
			turn: ev.number, seat: ev.seat,
		};
	case 'checkup':
		return { kind: 'note', label: 'Checkup', text: 'Pokémon Checkup.' };
	case 'prizeSet': {
		const [a, b] = Array.isArray(ev.counts) ? ev.counts.map(Number) : [0, 0];
		const cards = (n: number) => `${n} Prize card${n === 1 ? '' : 's'}`;
		return {
			kind: 'setup', label: 'Prizes',
			text: a === b ? `Each player set aside ${cards(a)}.` : `${w(0)} set aside ${cards(a)}, ${w(1)} ${cards(b)}.`,
		};
	}
	case 'setupEnd':
		return { kind: 'setup', label: 'Setup', text: 'Setup is done. Both players reveal their Pokémon.' };
	case 'suddenDeath':
		return {
			kind: 'note', label: 'Tiebreaker',
			text: 'Sudden death. The board is reset and a new game begins.',
		};
	case 'over': {
		const named = typeof (ev as { winnerName?: string }).winnerName === 'string' ?
			(ev as { winnerName?: string }).winnerName!.trim() : '';
		const who = named || (ev.winner != null ? w(ev.winner) : '');
		// a named winner is a win even without a seat (`|win|Name` builds an `over` row with just `winnerName`). it's
		// only a draw when it says so or names nobody
		const draw = !!ev.tie || !who;
		return {
			kind: 'win',
			label: draw ? 'Draw' : 'Win',
			text: draw ? 'The battle ended in a draw.' : `${who} won the battle!`,
			seat: draw ? undefined : (ev.winner ?? undefined),
		};
	}
	default:
		return null;
	}
}

export function chatLineForEvent(ev: TcgEvent, players?: TcgPlayerView[]): string | null {
	return chatEntryForEvent(ev, players)?.text || null;
}

export function chatHtmlForEntry(entry: TcgChatEntry): string {
	const esc = (s: string) => String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;');
	const raw = entry.text || '';
	const parts = raw.split(/(<span class="tcg-log-card-id"[^>]*>.*?<\/span>)/g);
	const textHtml = parts.map(part => {
		if (part.startsWith('<span class="tcg-log-card-id"')) return part;
		return esc(part).replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}).join('');

	return `<div class="chat tcg-log-line k-${esc(entry.kind)}">` +
		`<span class="tcg-log-tag">${esc(entry.label)}</span> ` +
		`<span class="tcg-log-text">${textHtml}</span></div>`;
}

export function statusFxClass(status: string | null | undefined): string {
	const t = String(status || '').toLowerCase();
	if (t === 'poisoned') return 'fx-psn';
	if (t === 'burned') return 'fx-brn';
	if (t === 'asleep') return 'fx-slp';
	if (t === 'paralyzed') return 'fx-par';
	if (t === 'confused') return 'fx-cnf';
	return 'fx-cured';
}

export function pkClass(fx: { kind: string, announce?: boolean, fromBench?: boolean }): string {
	const kind = fx.kind;
	if (fx.announce) return 'fx-announce';
	if (kind === 'damage') return 'fx-hit';
	if (kind === 'attack') return 'fx-lunge';
	if (kind === 'heal') return 'fx-heal';
	if (kind === 'ko') return 'fx-ko';
	if (kind === 'place') return fx.fromBench ? 'fx-switch' : 'fx-place';
	if (kind === 'evolve') return 'fx-evolve';
	if (kind === 'energy' || kind === 'tool') return 'fx-energy';
	if (kind === 'status') return 'fx-status';
	if (kind === 'ability') return 'fx-ability';
	return 'fx-pulse';
}

export function energySymbolUrl(type?: string): string {
	const t = energyElement(type) || String(type || '').toLowerCase() || 'colorless';
	const known = [
		'grass', 'fire', 'water', 'lightning', 'psychic', 'fighting',
		'darkness', 'metal', 'fairy', 'dragon', 'colorless',
	];
	const id = known.includes(t) ? t : 'colorless';
	return `/fx/tcg/energy-symbols/${id}.png`;
}
