export function isTcgBattleId(id: string): boolean {
	return id.startsWith('battle-tcg') || id.startsWith('game-tcg');
}

export type TcgSlot = 'active' | number;
export type TcgAction = { type: string, [k: string]: any };

export type TcgEvent = {
	seq?: number,
	type: string,
	seat?: number,
	iid?: string,
	slot?: TcgSlot,
	cardId?: string,
	from?: string,
	dest?: string,
	revealed?: boolean,
	waiting?: number[],
	kind?: string,
	ids?: string[],
	ids0?: string[],
	ids1?: string[],
	legal?: string[],
	seen?: string[],
	hiddenPick?: boolean,
	action?: TcgAction,
	/** the attack, ability, trainer or other effect behind this event. any event can have it */
	source?: TcgSource,
	/** cards per seat on `deal`, `prizeSet` and `setupEnd` */
	counts?: [number, number],
	/** `damage`: the modifiers applied to the amount, in order */
	modifiers?: { effectId: string, delta: number, when: 'beforeWR' | 'afterWR', summary: string }[],
	/** `damage` and `noDamage`: how the amount was reached */
	calc?: { base: number, steps: TcgDamageStep[], total: number },
	/** `evolve`: the pokemon's types. `energy`: the energy types the card provides */
	types?: string[],
	[k: string]: any,
};

export type TcgSource = { kind: string, cardId?: string, name?: string, iid?: string, seat?: number };

export type TcgDamageStep = {
	stage: 'beforeWR' | 'weakness' | 'resistance' | 'afterWR',
	op: 'add' | 'subtract' | 'multiply',
	value: number,
	before: number,
	after: number,
	reason: string,
	source?: TcgSource,
	effectId?: string,
};

export type TcgFxEvent = TcgEvent;

export interface TcgPokemonView {
	iid: string;
	cardId: string;
	name: string;
	hp: number;
	maxHp: number;
	types: string[];
	energy: string[];
	energyCards: string[];
	tools: string[];
	previousStages?: string[];
	status?: string | null;
	lastDelta?: number;
	weakness?: string;
	resistance?: string;
	retreatCost?: number;
	faceDown?: boolean;
	retreat?: number;
	attacks?: { name: string, cost?: string[], damage?: string, text?: string, sourceCardId?: string }[];
	abilities?: { name: string, text?: string, type?: string }[];
	/** card art from the engine. the room drops it from live snapshots, so the board falls back to the card id */
	image?: string;
}

export interface TcgPlayerView {
	id: string;
	name: string;
	active: TcgPokemonView | null;
	bench: TcgPokemonView[];
	hand: string[] | { count: number };
	deck: { count: number };
	discard: string[];
	prizes?: { count: number, ids?: string[] } | string[];
	lostZone?: { count: number };
	stadium?: string | null;
	stadiumIds?: string[];
	setup?: string;
	energyZone?: { type: string, next?: string, ready?: boolean };
	points?: number;
	attachedEnergyThisTurn?: boolean;
	playedSupporterThisTurn?: boolean;
	playedStadiumThisTurn?: boolean;
	retreatedThisTurn?: boolean;
}

export interface TcgSnapshot {
	id?: string;
	/** printed name for each card id the board (or in a replay, the public rows) points to */
	cardNames?: { [id: string]: string };
	status: 'setup' | 'playing' | 'over' | 'aborted';
	turn: number;
	turnNumber: number;
	you: 0 | 1 | null;
	winner: number | null;
	winnerName?: string | null;
	actions: TcgAction[];
	players: [TcgPlayerView, TcgPlayerView];
	format?: {
		id: string,
		name?: string,
		benchSize?: number,
		energyZone?: boolean,
		prizes?: number,
		suddenDeath?: boolean,
		[k: string]: any,
	};
	/** set between the two attacks of a turn: `iid` can attack again, and only that or ending the turn is legal */
	attackAgain?: { iid: string };
	suddenDeath?: boolean;
	pendingMulligan?: number;
	pendingMulliganDraw?: { seat: number, max: number };
	pendingSearch?: {
		kind: 'pokemon' | 'energy' | 'trainer' | 'any',
		left?: number,
		upTo?: boolean,
		zone?: 'deck' | 'discard' | 'prizes',
		dest?: 'hand' | 'bench' | 'top' | 'deck' | 'attach-active' | 'discard' | 'lost' | 'replace-active',
		seen?: string[],
		/** part of the deck this seat can look at, a look is only that window */
		ids?: string[],
		legal?: string[],
	};
	pendingDiscard?: any;
	pendingRetreatPay?: any;
	pendingDiscardEnergy?: any;
	pendingConfirm?: any;
	pendingSlotPick?: any;
	pendingCopyAttack?: any;
	/** attaching a basic energy from the hand: "card" picks the energy, then "pokemon" picks where it goes */
	pendingHandEnergy?: { phase: 'card' | 'pokemon' };
	pendingPromote?: number;
	pendingFirst?: number;
	pendingPrize?: { seat: number, n: number };
	appliedSeq?: number;
	winReason?: string;
	firstPlayer?: 0 | 1;
	effectsActive?: any[];
	energyDetachIndex?: number;
	discardRequest?: any;
}

export type TcgChatEntry = {
	kind: string,
	label: string,
	text: string,
	turn?: number,
	seat?: number,
};

export function cloneTcgSnapshot(snap: TcgSnapshot): TcgSnapshot {
	return JSON.parse(JSON.stringify(snap)) as TcgSnapshot;
}

export const ENERGY_NAME_MAP: { [k: string]: string } = {
	grass: 'grass',
	fire: 'fire',
	water: 'water',
	lightning: 'lightning',
	psychic: 'psychic',
	fighting: 'fighting',
	darkness: 'darkness',
	metal: 'metal',
	fairy: 'fairy',
	dragon: 'dragon',
	colorless: 'colorless',
};

export function namedEnergyType(raw?: string): string {
	if (!raw) return 'colorless';
	const s = String(raw).toLowerCase().replace(/[^a-z]/g, '');
	return ENERGY_NAME_MAP[s] || 'colorless';
}

export function energyTypeFromCardId(cardId?: string, types?: string[]): string {
	if (types?.length) return namedEnergyType(types[0]);
	if (!cardId) return 'colorless';
	const id = String(cardId).toLowerCase();
	if (id.includes('grass')) return 'grass';
	if (id.includes('fire')) return 'fire';
	if (id.includes('water')) return 'water';
	if (id.includes('lightning')) return 'lightning';
	if (id.includes('psychic')) return 'psychic';
	if (id.includes('fighting')) return 'fighting';
	if (id.includes('darkness') || id.includes('dark')) return 'darkness';
	if (id.includes('metal') || id.includes('steel')) return 'metal';
	if (id.includes('fairy')) return 'fairy';
	if (id.includes('dragon')) return 'dragon';
	return 'colorless';
}

export function energyPipsFromEvent(e: TcgEvent): string[] {
	if (Array.isArray(e.types) && e.types.length) {
		return e.types.map(t => namedEnergyType(String(t || '')));
	}
	if (e.energyType) return [namedEnergyType(String(e.energyType))];
	if (e.cardId) return [energyTypeFromCardId(String(e.cardId))];
	return ['colorless'];
}

export function normalizeMonEnergy(mon: TcgPokemonView | null | undefined) {
	if (!mon) return;
	if (!Array.isArray(mon.energy)) mon.energy = [];
	if (!Array.isArray(mon.energyCards)) mon.energyCards = [];
	if (!Array.isArray(mon.tools)) mon.tools = [];
	if (mon.energy.length === 0 && mon.energyCards.length > 0) {
		const derived: string[] = [];
		for (const cid of mon.energyCards) {
			derived.push(energyTypeFromCardId(cid));
		}
		mon.energy = derived;
	}
}

export function normalizeTcgEnergy(snap: TcgSnapshot | null | undefined) {
	if (!snap || !Array.isArray(snap.players)) return;
	for (const p of snap.players) {
		if (!p) continue;
		normalizeMonEnergy(p.active);
		if (Array.isArray(p.bench)) {
			for (const b of p.bench) normalizeMonEnergy(b);
		}
	}
}

export function handAsIds(hand: TcgPlayerView['hand'] | null | undefined): string[] | null {
	return Array.isArray(hand) ? hand : null;
}

export function sameSlot(a: TcgSlot | null, b: TcgSlot | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	return String(a) === String(b);
}

export function actionTouchesSlot(a: TcgAction, slot: TcgSlot): boolean {
	return sameSlot(a.slot, slot) || sameSlot(a.targetSlot, slot) || sameSlot(a.bench, slot);
}

export function actionTouchesHand(a: TcgAction, hand: number): boolean {
	return a.hand === hand || (a.type === 'playStadium' && a.pair === hand);
}

export function hasBoardTarget(a: TcgAction): boolean {
	return a.slot != null || a.targetSlot != null || a.foeSlot != null || a.bench != null;
}

export function findMonView(players: TcgPlayerView[] | undefined, iid?: string): TcgPokemonView | null {
	return findMonSlot(players, iid)?.mon || null;
}

export function findMonSlot(
	players: TcgPlayerView[] | undefined,
	iid?: string
): { mon: TcgPokemonView, slot: TcgSlot, seat: number } | null {
	if (!players || !iid) return null;
	for (let seat = 0; seat < players.length; seat++) {
		const p = players[seat];
		if (!p) continue;
		if (p.active?.iid === iid) return { mon: p.active, slot: 'active', seat };
		const bench = p.bench || [];
		for (let i = 0; i < bench.length; i++) {
			const b = bench[i];
			if (b?.iid === iid) return { mon: b, slot: i, seat };
		}
	}
	return null;
}

export function placeSlotOf(e: TcgEvent): TcgSlot {
	if (e.slot === 'active') return 'active';
	if (typeof e.slot === 'number') return e.slot;
	const s = String(e.slot || '');
	if (s === 'active') return 'active';
	const n = Number(s);
	// not a bench index: applyPlace adds a negative index to the end of the bench
	return Number.isFinite(n) ? n : -1;
}

export type CardKind = {
	known: boolean,
	pokemon: boolean,
	trainer: boolean,
	energy: boolean,
	basic: boolean,
	stage: boolean,
	supporter: boolean,
	item: boolean,
	stadium: boolean,
	tool: boolean,
};

declare const getTcgCard: ((id: string) => any) | undefined;

export function cardKind(id: string): CardKind {
	const fn = typeof getTcgCard === 'function' ? getTcgCard : undefined;
	const c = id && fn ? fn(id) : undefined;
	const subs: string[] = (c?.u || []).map((s: string) => s.toLowerCase());
	const has = (name: string) => subs.includes(name);
	return {
		known: !!c,
		pokemon: c?.s === 'P',
		trainer: c?.s === 'T',
		energy: c?.s === 'E' || /energy/i.test(id) || /^sve-\d+$/i.test(id),
		basic: has('basic'),
		stage: subs.some(s => s.startsWith('stage')),
		supporter: has('supporter'),
		item: has('item'),
		stadium: has('stadium'),
		tool: has('pokémon tool') || has('pokemon tool') || has('tool'),
	};
}

/**
 * `basic` and `special` come from the card index's `be` flag (WaveTCG's `isBasicEnergy`), never from the id, the
 * name or the energy it provides. `other` is a card attached as energy that isn't an energy card (Buzzap
 * attaches a pokemon). `unknown` is a card the index doesn't have yet: a newer set, or the index is still
 * loading
 */
export type EnergyCategory = 'basic' | 'special' | 'other' | 'unknown';

export function energyCategory(cardId?: string): EnergyCategory {
	if (!cardId) return 'unknown';
	// WaveTCG's id for energy zone energy when there's no basic energy card of that type (zoneEnergyAttach)
	if (/^zone-energy-[a-z]+$/i.test(cardId)) return 'basic';
	const fn = typeof getTcgCard === 'function' ? getTcgCard : undefined;
	const c = fn ? fn(cardId) : undefined;
	if (!c) return 'unknown';
	if (c.s !== 'E') return 'other';
	return c.be ? 'basic' : 'special';
}
