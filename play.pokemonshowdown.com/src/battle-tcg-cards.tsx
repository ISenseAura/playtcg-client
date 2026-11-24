import preact from "../js/lib/preact";
import {
	type TcgSlot, type TcgAction, type TcgEvent, type TcgPokemonView, type TcgPlayerView, type TcgSnapshot,
	cardKind, energyCategory,
} from "./battle-tcg-types";
import {
	cardLabel, statusBadges, energySymbolUrl, type PkFx,
} from "./battle-tcg-log";
import {
	energyElement,
} from "./battle-tcg-flights";
import {
	tcgReduceMotion, fxMs, StatusBurst, TypeHit,
} from "./battle-tcg-fx";
import {
	choiceFromText, findChoiceMon,
} from "./battle-tcg-choice";

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

export type Preview = { cardId: string, image?: string, name?: string, handAt?: number };

export const TYPE_COLOR: { [type: string]: string } = {
	grass: '#3dcc5a', fire: '#ff5a4a', water: '#3da9ff', lightning: '#f5d031',
	psychic: '#c45ae8', fighting: '#e86838', darkness: '#5b6ad6', metal: '#9aacb8',
	fairy: '#f472b6', dragon: '#8b6cff', colorless: '#e8eef2',
};

export function isPocketCardId(cardId: string): boolean {
	if (!cardId) return false;
	if (/^P-A-\d+/i.test(cardId)) return true;
	const cut = cardId.lastIndexOf('-');
	const set = (cut >= 0 ? cardId.slice(0, cut) : cardId).trim();
	if (!set) return false;
	if (/^P-A$/i.test(set)) return true;
	if (/^[A-Z]\d+[a-z]?$/i.test(set)) return true;
	return false;
}

export const BASIC_ENERGY_ART: { [type: string]: string } = {
	grass: 'sve-1',
	fire: 'sve-2',
	water: 'sve-3',
	lightning: 'sve-4',
	psychic: 'sve-5',
	fighting: 'sve-6',
	darkness: 'sve-7',
	metal: 'sve-8',
	fairy: 'xy1-140',
	colorless: 'sve-1',
	dragon: 'sve-1',
};

export function paperTcgIoArt(cardId: string, large = false): string {
	const cut = cardId.lastIndexOf('-');
	if (cut < 0) return '';
	const set = cardId.slice(0, cut);
	const num = cardId.slice(cut + 1);
	if (!set || !num) return '';
	return `https://images.pokemontcg.io/${set}/${num}${large ? '_hires' : ''}.png`;
}

export function scrydexArt(cardId: string, large = false): string {
	return `https://images.scrydex.com/pokemon/${encodeURIComponent(cardId)}/${large ? 'large' : 'small'}`;
}

export function pocketCardImage(cardId: string, large = false): string {
	return cardArt(cardId, { large, pocket: true });
}

export function cardArt(cardId: string, opts?: { large?: boolean, pocket?: boolean }): string {
	if (!cardId) return '';
	const large = !!opts?.large;
	const pocket = opts?.pocket ?? isPocketCardId(cardId);

	const energy = /^energy-(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless)$/i.exec(cardId);
	if (energy) {
		const printId = BASIC_ENERGY_ART[energy[1].toLowerCase()] || 'sve-1';
		return paperTcgIoArt(printId, large) || scrydexArt(printId, large);
	}

	if (pocket) {
		const cut = cardId.lastIndexOf('-');
		if (cut < 0) return '';
		const set = cardId.slice(0, cut);
		let num = cardId.slice(cut + 1);
		if (/^\d+$/.test(num)) {
			num = num.replace(/^0+/, '') || '0';
			while (num.length < 3) num = '0' + num;
		}
		const base = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${set}/${set}_${num}_EN`;
		return large ? `${base}.webp` : `${base}_SM.webp`;
	}

	return scrydexArt(cardId, large);
}

export function cardBackArt(): string {
	return '/fx/tcg/cardback.webp';
}

export const CARD_BACK_FALLBACK = '/fx/tcg/cardback.jpg';

export const SCRYDEX_NO_ART: { [size: string]: number[] } = {
	'245x341': [
		71, 91, 110, 119, 133, 135, 113, 130, 132, 108, 125, 135, 114, 134, 160, 155, 149, 149, 166, 135, 128, 81, 101, 131,
		78, 103, 139, 133, 149, 161, 173, 180, 183, 111, 132, 157, 120, 137, 146, 113, 132, 135, 118, 135, 136, 69, 88, 104,
	],
	'640x892': [
		64, 82, 103, 113, 128, 125, 116, 132, 129, 107, 120, 130, 75, 99, 137, 188, 157, 153, 150, 118, 119, 47, 77, 122,
		52, 79, 124, 136, 151, 167, 174, 183, 189, 74, 96, 132, 117, 131, 135, 118, 135, 130, 113, 128, 121, 60, 78, 98,
	],
};

export function isScrydexNoArt(w: number, h: number, px: number[]): boolean {
	const ref = SCRYDEX_NO_ART[`${w}x${h}`];
	if (ref?.length !== px.length) return false;
	let off = 0;
	for (let i = 0; i < ref.length; i++) off += Math.abs(ref[i] - px[i]);
	return off / ref.length < 10;
}

export const noArtCards: { [id: string]: true } = Object.create(null);

export function scrydexUrl(src: string): boolean {
	return src.startsWith('https://images.scrydex.com/');
}

export function sampleNoArt(img: HTMLImageElement): boolean {
	try {
		if (!SCRYDEX_NO_ART[`${img.naturalWidth}x${img.naturalHeight}`]) return false;
		const c = document.createElement('canvas');
		c.width = 4;
		c.height = 4;
		const g = c.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
		if (!g) return false;
		g.drawImage(img, 0, 0, 4, 4);
		const d = g.getImageData(0, 0, 4, 4).data;
		const px: number[] = [];
		for (let i = 0; i < d.length; i += 4) px.push(d[i], d[i + 1], d[i + 2]);
		return isScrydexNoArt(img.naturalWidth, img.naturalHeight, px);
	} catch {
		return false;
	}
}

export function NoArtFace(props: { cardId: string, label: string }) {
	const k = cardKind(props.cardId);
	const kind = k.energy ? 'Energy' : k.pokemon ? 'Pokémon' : k.stadium ? 'Stadium' : k.tool ? 'Pokémon Tool' :
		k.supporter ? 'Supporter' : k.item ? 'Item' : k.trainer ? 'Trainer' : '';
	const at = props.cardId.lastIndexOf('-');
	const set = at > 0 ? props.cardId.slice(0, at) : props.cardId;
	const num = at > 0 ? props.cardId.slice(at + 1) : '';
	return <span class="tcg-card-noart">
		{kind && <span class="tcg-noart-kind">{kind}</span>}
		<strong class="tcg-noart-name">{props.label}</strong>
		<span class="tcg-noart-id">{num ? `${set.toUpperCase()} ${num}` : set}</span>
		<span class="tcg-noart-note">No image</span>
	</span>;
}

export function CardBackFace() {
	return <img
		class="tcg-card-backface"
		src={cardBackArt()}
		alt=""
		draggable={false}
		onError={(ev: any) => {
			const img = ev?.currentTarget as HTMLImageElement | null;
			if (!img) return;
			if (img.dataset.fallback === '1') return;
			img.dataset.fallback = '1';
			img.src = CARD_BACK_FALLBACK;
		}}
	/>;
}

export function choiceArtFallback(img: HTMLImageElement) {
	const id = img.dataset.card || '';
	const step = Number(img.dataset.fallback || '0');
	img.dataset.fallback = String(step + 1);
	if (step === 0) img.src = cardArt(id, { large: true }) || cardBackArt();
	else if (step === 1) img.src = cardBackArt();
}

export function pileCount(pile: string[] | { count: number } | undefined): number {
	if (!pile) return 0;
	return Array.isArray(pile) ? pile.length : pile.count;
}

export function handIds(hand: string[] | { count: number } | undefined): string[] | null {
	return Array.isArray(hand) ? hand : null;
}

export function sameSlot(a: TcgSlot | null, b: TcgSlot | undefined): boolean {
	if (a == null || b == null) return false;
	if (a === 'active' || b === 'active') return a === b;
	return Number(a) === Number(b);
}

export function actionTouchesHand(a: TcgAction, hand: number): boolean {
	return a.hand === hand || (a.type === 'playStadium' && a.pair === hand);
}

export function samePairedPlays(acts: TcgAction[], hand: number | null | undefined, ids: string[] | null): TcgAction[] {
	if (hand == null || !ids) return acts;
	const seen: { [id: string]: true } = Object.create(null);
	return acts.filter(a => {
		if (a.type !== 'playStadium' || a.pair !== hand || a.hand == null) return true;
		const first = ids[a.hand];
		if (seen[first]) return false;
		seen[first] = true;
		return true;
	});
}

/**
 * a discard picked from the opponent's revealed hand. `hand` on these rows is a spot in THEIR hand, so it never
 * matches the player's own cards
 */
export function foeHandChoice(snap: TcgSnapshot): { ids: string[], need: number, to?: string } | null {
	const pending = snap.pendingDiscard;
	if (!pending?.fromFoe) return null;
	return { ids: pending.cardIds || [], need: pending.need, to: pending.to };
}

/**
 * these are answered on the hand, not the search panel (that's for the deck, discard or prizes). an "up to" hand
 * choice also offers `searchDone`, so that row alone doesn't make it a search
 */
export function ownHandChoice(snap: TcgSnapshot, acts: TcgAction[]): 'discard' | 'energy' | null {
	if (snap.pendingSearch || snap.pendingDiscard?.fromFoe || snap.discardRequest?.fromFoe) return null;
	if (snap.pendingHandEnergy?.phase === 'card' || acts.some(a => a.type === 'handEnergyPick')) return 'energy';
	const handRow = (a: TcgAction) =>
		a.type === 'discardPick' || (a.type === 'unstagePick' && a.of?.type === 'discardPick');
	if (snap.pendingDiscard || acts.some(handRow)) return 'discard';
	return null;
}

/** with `ask` the choice bar says it instead, so this is '' then */
export function slotPickHint(snap: TcgSnapshot, acts: TcgAction[]): string {
	const pick = snap.pendingSlotPick;
	if (!pick || pick.ask || !acts.some(a => a.type === 'pickSlot')) return '';
	const n = Math.max(1, Number(pick.left) || 1);
	return `Choose ${n} of ${pick.side === 'foe' ? 'your opponent\'s' : 'your'} Pokémon`;
}

export function cardCountText(min: number, max: number): string {
	const cards = max === 1 ? 'card' : 'cards';
	if (min >= max) return `${max} ${cards}`;
	if (min <= 0) return `up to ${max} ${cards}`;
	return `${min}–${max} ${cards}`;
}

/**
 * an "up to" choice without a held count is the one that offers `searchDone`. where the cards go is the engine's
 * `to`
 */
export function ownHandHint(snap: TcgSnapshot, acts: TcgAction[], held?: HeldChoice | null): string {
	if (snap.pendingHandEnergy?.phase === 'pokemon') return 'Choose a Pokémon to attach that Energy to';
	const which = ownHandChoice(snap, acts);
	if (which === 'energy') return 'Choose a Basic Energy from your hand to attach';
	if (which !== 'discard' || !snap.pendingDiscard) return '';
	const max = held?.max || Number(snap.pendingDiscard.need) || 1;
	const min = held ? held.min : snap.pendingDiscard.upTo || acts.some(a => a.type === 'searchDone') ? 0 : max;
	const count = cardCountText(min, max);
	const to = snap.pendingDiscard.to;
	if (to === 'deck') return `Choose ${count} from your hand to put into your deck`;
	if (to === 'lost') return `Choose ${count} from your hand to put in the Lost Zone`;
	if (to === 'prizes') return `Choose ${count} from your hand to put with your Prize cards`;
	return `Drag ${count} to Discard`;
}

export function foeHandRows(ids: string[], picks: TcgAction[]): { id: string, action?: TcgAction }[] {
	return ids.map((id, at) => ({ id, action: picks.find(a => a.type === 'discardPick' && a.hand === at) }));
}

export function foeSlotTargets(acts: TcgAction[], slot: TcgSlot): TcgAction[] {
	return acts.filter(a => a.hand == null && sameSlot(slot, a.foeSlot));
}

export function rowsStillOffered(
	rows: readonly (TcgAction | null | undefined)[], offered: readonly TcgAction[]
): boolean {
	const now = offered.map(a => JSON.stringify(a));
	return rows.every(a => !a || now.includes(JSON.stringify(a)));
}

/** `slot`, `targetSlot` and `bench` are the player's own board, `foeSlot` is the other board */
export function actionTouchesSlot(a: TcgAction, slot: TcgSlot): boolean {
	return sameSlot(slot, a.slot) || sameSlot(slot, a.targetSlot) || (typeof slot === 'number' && a.bench === slot);
}

/** the same bench number is two pokemon, one per board. the side that was clicked decides which */
export function actionTouchesSide(a: TcgAction, slot: TcgSlot, foe: boolean): boolean {
	return foe ? sameSlot(slot, a.foeSlot) : actionTouchesSlot(a, slot);
}

export function hasBoardTarget(a: TcgAction): boolean {
	return a.slot != null || a.bench != null || a.targetSlot != null || a.foeSlot != null;
}

export type DropKind = 'slot' | 'play' | 'stadium' | 'discard';
export type DropTarget = {
	kind: DropKind,
	slot?: TcgSlot,
	foe?: boolean,
	empty?: boolean,
};
export type DragSource = {
	source: 'hand' | 'zone',
	hand?: number,
	cardId?: string,
	image?: string,
	name?: string,
};
export type DragState = DragSource & {
	x: number,
	y: number,
	active: boolean,
	originX: number,
	originY: number,
	over: DropTarget | null,
	hint: string,
};

export function dropVerb(a: TcgAction): string {
	switch (a.type) {
	case 'setActive': return 'Set Active';
	case 'setBench': case 'playBasic': case 'mulliganBench': return 'Bench';
	case 'evolve': return 'Evolve';
	case 'attachEnergy': case 'attachZone': return 'Attach Energy';
	case 'attachTool': return 'Attach Tool';
	case 'playTrainer': return 'Play';
	case 'playStadium': return 'Play Stadium';
	case 'useStadium': return 'Use';
	case 'discardPick': return 'Discard';
	case 'promote': return 'Promote';
	case 'retreat': return 'Retreat here';
	case 'pickSlot': return 'Choose';
	default: return 'Play';
	}
}

export function actionsForDrop(acts: TcgAction[], drag: DragSource, drop: DropTarget): TcgAction[] {
	if (drag.source === 'zone') {
		if (drop.kind !== 'slot' || drop.foe) return [];
		return acts.filter(a => a.type === 'attachZone' && actionTouchesSlot(a, drop.slot!));
	}
	const hand = drag.hand;
	if (hand == null) return [];
	const mine = acts.filter(a => actionTouchesHand(a, hand));
	if (drop.kind === 'play') {
		return mine.filter(a => a.type === 'playTrainer' && !hasBoardTarget(a));
	}
	if (drop.kind === 'stadium') {
		const played = mine.filter(a => a.type === 'playStadium');
		const used = drag.cardId ?
			acts.filter(a => a.type === 'useStadium' && a.pick === drag.cardId) : [];
		return played.concat(used);
	}
	if (drop.kind === 'discard') {
		return mine.filter(a => a.type === 'discardPick');
	}
	if (drop.kind === 'slot') {
		if (drop.foe) {
			return mine.filter(a =>
				sameSlot(drop.slot!, a.foeSlot) ||
				(a.type === 'pickSlot' && actionTouchesSlot(a, drop.slot!)) ||
				(a.type === 'playTrainer' && sameSlot(drop.slot!, a.foeSlot))
			);
		}
		if (drop.empty) {
			if (drop.slot === 'active') {
				return mine.filter(a => a.type === 'setActive');
			}
			return mine.filter(a =>
				a.type === 'playBasic' || a.type === 'setBench' || a.type === 'mulliganBench'
			);
		}
		return mine.filter(a => actionTouchesSlot(a, drop.slot!));
	}
	return [];
}

export function canDropAnywhere(acts: TcgAction[], drag: DragSource, drop: DropTarget): boolean {
	return actionsForDrop(acts, drag, drop).length > 0;
}

export type WhyCtx = {
	hand?: number,
	drop?: DropTarget | null,
	slot?: TcgSlot,
	foe?: boolean,
	zone?: boolean,
	source?: 'hand' | 'zone',
};

export function handCardId(snap: TcgSnapshot, hand: number): string {
	const you = snap.you;
	if (you == null) return '';
	const handv = snap.players[you]?.hand;
	return Array.isArray(handv) ? (handv[hand] || '') : '';
}

export function benchFull(p: TcgPlayerView | undefined, snap: TcgSnapshot): boolean {
	const size = snap.format?.benchSize || (snap.format?.energyZone ? 3 : 5);
	return (p?.bench || []).filter(Boolean).length >= size;
}

export function firstPlayerTurn(snap: TcgSnapshot): boolean {
	return snap.status === 'playing' && snap.turnNumber === 1 && snap.turn === snap.you;
}

export function whyCant(snap: TcgSnapshot, ctx: WhyCtx, _waiting?: boolean): string {
	const you = snap.you;
	if (you == null) return '';
	if (snap.status === 'over' || snap.winner != null) return 'The game is over.';
	if (snap.pendingPrize?.seat === you) return 'Take a Prize card first.';
	if (snap.pendingSearch) return 'Finish searching your deck first.';
	if (snap.pendingDiscard) return 'Choose a card to discard first.';
	if (snap.pendingHandEnergy) {
		return snap.pendingHandEnergy.phase === 'pokemon' ?
			'Choose a Pokémon for that Energy first.' : 'Choose a Basic Energy from your hand first.';
	}
	if (snap.pendingRetreatPay) return 'Choose Energy to discard for the retreat.';
	if (snap.pendingDiscardEnergy) return 'Choose an Energy card to discard.';
	if (snap.pendingConfirm) return 'Confirm this effect first.';
	if (snap.pendingPromote != null && snap.pendingPromote === you && ctx.slot == null) {
		return 'Choose a Pokémon to promote first.';
	}
	if (snap.pendingFirst === you) return 'Choose who goes first.';
	if (snap.status === 'playing' && snap.turn !== you) return 'Wait for your turn';

	if (ctx.zone || ctx.source === 'zone') {
		if (ctx.drop) {
			if (actionsForDrop(snap.actions || [], { source: 'zone' }, ctx.drop).length) return '';
			return whyBadDrop(snap, { ...ctx, source: 'zone' });
		}
		if ((snap.actions || []).some(a => a.type === 'attachZone')) return 'Drop this Energy on one of your Pokémon.';
		return whyZone(snap);
	}
	if (ctx.hand != null) {
		const drag: DragSource = { source: 'hand', hand: ctx.hand };
		if (ctx.drop) {
			if (actionsForDrop(snap.actions || [], drag, ctx.drop).length) return '';
			return whyBadDrop(snap, { ...ctx, source: 'hand' });
		}
		const mine = (snap.actions || []).filter(a => actionTouchesHand(a, ctx.hand!));
		if (!mine.length) return whyCard(snap, handCardId(snap, ctx.hand));
		return whereToPlay(mine);
	}
	if (ctx.slot != null) return whyMon(snap, ctx.slot);
	return '';
}

/**
 * a batch plays out beat by beat, and between an answer and the next request there are no rows at all. that's
 * not the prompt closing, and queued picks have to survive it
 */
export function retreatPayOver(acts: TcgAction[], status?: string): boolean {
	if (acts.some(a => a.type === 'payEnergy')) return false;
	return acts.length > 0 || status !== 'playing';
}

const HELD_PICK_TYPES = ['searchPick', 'discardPick', 'pickSlot', 'discardEnergyPick', 'payEnergy'];

export interface HeldChoice {
	type: string;
	picked: number;
	min: number;
	max: number;
	held: { of: TcgAction, undo: TcgAction }[];
	confirm: TcgAction | null;
	none: TcgAction | null;
	open?: boolean;
}

export function heldChoice(acts: TcgAction[]): HeldChoice | null {
	const info = acts.find(a => a.multi)?.multi;
	if (!info) return null;
	const held = acts.filter(a => a.type === 'unstagePick' && a.of).map(a => ({ of: a.of as TcgAction, undo: a }));
	const type = held[0]?.of.type || acts.find(a => HELD_PICK_TYPES.includes(a.type))?.type || '';
	return {
		type,
		picked: Number(info.picked) || 0,
		min: Number(info.min) || 0,
		max: Number(info.max) || 0,
		held,
		confirm: acts.find(a => a.type === 'confirmPicks') || null,
		none: held.length ? null : acts.find(a => a.type === 'searchDone') || null,
		open: acts.some(a => HELD_PICK_TYPES.includes(a.type)),
	};
}

export function isHeldPickType(type: string): boolean {
	return HELD_PICK_TYPES.includes(type);
}

export function heldPickKey(a: TcgAction): string {
	if (a.type === 'searchPick') return `s:${a.pick}`;
	if (a.type === 'discardPick') return `h:${a.hand}`;
	if (a.type === 'pickSlot') return `p:${a.slot}`;
	if (a.type === 'discardEnergyPick' || a.type === 'payEnergy') return `e:${a.index}`;
	return '';
}

export function heldUndoFor(choice: HeldChoice | null, a: TcgAction): TcgAction | undefined {
	if (!choice) return undefined;
	const key = heldPickKey(a);
	if (!key) return undefined;
	for (let i = choice.held.length - 1; i >= 0; i--) {
		if (heldPickKey(choice.held[i].of) === key) return choice.held[i].undo;
	}
	return undefined;
}

export function heldCount(choice: HeldChoice | null, a: TcgAction): number {
	if (!choice) return 0;
	const key = heldPickKey(a);
	return key ? choice.held.filter(h => heldPickKey(h.of) === key).length : 0;
}

export function heldOrbIndexes(rows: TcgAction[], choice: HeldChoice | null): number[] {
	const out: number[] = [];
	const add = (n: number) => {
		if (!out.includes(n)) out.push(n);
	};
	for (const a of rows) add(Number(a.index));
	for (const h of choice?.held || []) {
		if (h.of.type === 'discardEnergyPick' || h.of.type === 'payEnergy') add(Number(h.of.index));
	}
	return out.sort((a, b) => a - b);
}

export function heldGroups(choice: HeldChoice): { of: TcgAction, n: number, undo: TcgAction }[] {
	const out: { of: TcgAction, n: number, undo: TcgAction }[] = [];
	const keys: string[] = [];
	for (const h of choice.held) {
		const at = keys.indexOf(heldPickKey(h.of));
		if (at >= 0) {
			out[at].n++;
			out[at].undo = h.undo;
		} else {
			keys.push(heldPickKey(h.of));
			out.push({ of: h.of, n: 1, undo: h.undo });
		}
	}
	return out;
}

export function heldPickLabel(a: TcgAction, snap: TcgSnapshot): { cardId: string, text: string } {
	const me = snap.players[snap.you ?? 0];
	const foe = snap.players[snap.you === 0 ? 1 : 0];
	if (a.type === 'searchPick') return { cardId: String(a.pick), text: cardLabel(String(a.pick)) };
	if (a.type === 'discardPick') {
		const ids: string[] = snap.pendingDiscard?.fromFoe ?
			(snap.pendingDiscard.cardIds || []) :
			(Array.isArray(me?.hand) ? me.hand : []);
		const id = ids[Number(a.hand)] || '';
		return { cardId: id, text: id ? cardLabel(id) : `Card ${Number(a.hand) + 1}` };
	}
	if (a.type === 'pickSlot') {
		const side = snap.pendingSlotPick?.side === 'foe' ? foe : me;
		const mon = a.slot === 'active' ? side?.active : side?.bench?.[Number(a.slot)];
		const where = a.slot === 'active' ? 'Active' : `Bench ${Number(a.slot) + 1}`;
		return { cardId: mon?.cardId || '', text: mon?.name ? `${mon.name} (${where})` : where };
	}
	if (a.type === 'discardEnergyPick') {
		const id = snap.pendingDiscardEnergy?.cardIds?.[Number(a.index)] || '';
		return { cardId: id, text: id ? cardLabel(id) : 'Energy' };
	}
	if (a.type === 'payEnergy') {
		const id = me?.active?.energyCards?.[Number(a.index)] || '';
		return { cardId: id, text: id ? cardLabel(id) : 'Energy' };
	}
	return { cardId: '', text: '' };
}

export function heldCountText(choice: HeldChoice): string {
	if (choice.type === 'discardEnergyPick' || choice.type === 'payEnergy') {
		return `${choice.picked} of ${choice.max} Energy selected`;
	}
	if (choice.min === choice.max) return `${choice.picked} of ${choice.max} selected`;
	if (choice.min === 0) return `${choice.picked} selected (up to ${choice.max})`;
	return `${choice.picked} selected (${choice.min}–${choice.max})`;
}

export function playChoiceCardId(a: TcgAction): string | null {
	if (a.type !== 'playTrainer' || typeof a.pick !== 'string') return null;
	return /^(?:[A-Za-z0-9]+-)+[A-Za-z]{0,6}\d+[A-Za-z]?$/.test(a.pick) ? a.pick : null;
}

export function playChoiceText(a: TcgAction, snap: TcgSnapshot): string {
	if (a.label) return a.label;
	const text = describeAction(a, snap);
	return typeof a.pick === 'string' && a.pick ? `${text} (${a.pick})` : text;
}

export function whereToPlay(acts: TcgAction[]): string {
	const types: { [k: string]: true } = {};
	for (const a of acts) types[a.type] = true;
	if (types['attachEnergy'] || types['attachTool']) return 'Drop this on one of your Pokémon.';
	if (types['evolve']) return 'Drop this on the Pokémon it evolves from.';
	if (types['playBasic'] || types['setBench'] || types['setActive'] || types['mulliganBench']) {
		return 'Drop this on an empty spot on your side.';
	}
	if (types['playStadium']) return 'Drop this on the Stadium spot.';
	if (types['discardPick']) return 'Drop this on the discard pile.';
	if (types['playTrainer']) return 'Drop this on the Active field.';
	return 'Drop this on a valid target.';
}

export function whyZone(snap: TcgSnapshot): string {
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	if (snap.status === 'setup') return "You can't attach Energy during setup.";
	if (firstPlayerTurn(snap) && snap.format?.energyZone) return "You can't attach Energy on your first turn.";
	if (me?.attachedEnergyThisTurn) return 'You already attached Energy this turn.';
	if (me?.energyZone?.ready === false) return 'You already attached Energy this turn.';
	return "You can't attach Energy right now.";
}

export function whyCard(snap: TcgSnapshot, id: string): string {
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	const k = cardKind(id);
	const pocket = !!snap.format?.energyZone;
	if (snap.status === 'setup') {
		if (!(k.pokemon && k.basic)) return 'During setup you can only play Basic Pokémon.';
		if (me?.active && benchFull(me, snap)) return 'Your Bench is full.';
		return "You can't play this Pokémon right now.";
	}
	if (k.supporter) {
		if (me?.playedSupporterThisTurn) return 'You already played a Supporter this turn.';
		if (firstPlayerTurn(snap)) return "You can't play a Supporter on your first turn.";
	}
	if (k.stadium && me?.playedStadiumThisTurn) return 'You already played a Stadium this turn.';
	if (k.energy) {
		if (me?.attachedEnergyThisTurn) return 'You already attached Energy this turn.';
		if (firstPlayerTurn(snap) && pocket) return "You can't attach Energy on your first turn.";
		return "You can't attach Energy right now.";
	}
	if (k.stage) {
		if (firstPlayerTurn(snap)) return "You can't evolve on your first turn.";
		return "This card can't evolve any of your Pokémon right now.";
	}
	if (k.pokemon && k.basic) {
		if (me?.active && benchFull(me, snap)) return 'Your Bench is full.';
		return "You can't play this Pokémon right now.";
	}
	if (k.tool) return "You can't attach this Tool right now.";
	return "You can't play this card right now.";
}

export function whyBadDrop(snap: TcgSnapshot, ctx: WhyCtx): string {
	const drop = ctx.drop;
	if (!drop) return '';
	const fromZone = ctx.source === 'zone';
	const id = fromZone || ctx.hand == null ? '' : handCardId(snap, ctx.hand);
	const k = cardKind(id);
	const acts = (snap.actions || []).filter(a =>
		fromZone ? a.type === 'attachZone' : ctx.hand != null && actionTouchesHand(a, ctx.hand));
	if (!acts.length) return fromZone ? whyZone(snap) : whyCard(snap, id);
	if (drop.kind === 'discard') return "You're not discarding a card right now.";
	if (drop.kind === 'stadium') {
		return k.stadium ? "You can't play that Stadium right now." : 'Only Stadium cards go on the Stadium spot.';
	}
	if (drop.kind === 'play') {
		if (k.pokemon || fromZone) {
			return fromZone ? 'Drop this Energy on one of your Pokémon.' : 'Drop this Pokémon on an empty spot on your side.';
		}
		if (k.energy) return 'Drop this Energy on one of your Pokémon.';
		if (k.stadium) return 'Drop Stadium cards on the Stadium spot.';
		if (k.tool) return 'Drop this Tool on one of your Pokémon.';
		return "You can't play this card there.";
	}
	if (drop.foe) {
		if (k.energy || fromZone) return 'Energy attaches to your own Pokémon.';
		if (k.pokemon) return 'Play this on your side of the board.';
		if (k.tool) return 'Tools attach to your own Pokémon.';
		return "This card can't target that Pokémon.";
	}
	if (drop.empty) {
		if (k.energy || fromZone) return 'Drop Energy on a Pokémon, not an empty spot.';
		if (k.stage) return 'Drop this on the Pokémon it evolves from.';
		if (k.trainer || k.tool) return "This card doesn't play onto an empty spot.";
		if (drop.slot === 'active') return "This can't be your Active Pokémon.";
		return 'That Bench spot is not open for this card.';
	}
	if (k.energy || fromZone) {
		return acts.some(a => a.type === 'attachEnergy' || a.type === 'attachZone') ?
			"You can't attach Energy to that Pokémon." :
			(fromZone ? whyZone(snap) : whyCard(snap, id));
	}
	if (k.basic && !k.stage) return 'That spot is taken.';
	if (k.stage) return "This card can't evolve that Pokémon.";
	if (k.tool) return "You can't attach this Tool to that Pokémon.";
	if (k.stadium) return 'Drop Stadium cards on the Stadium spot.';
	if (k.trainer) return "This card can't target that Pokémon.";
	return "You can't play this card there.";
}

export function whyMon(snap: TcgSnapshot, slot: TcgSlot): string {
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	const mon = slot === 'active' ? me?.active : me?.bench?.[Number(slot)];
	if (!mon) return 'There is no Pokémon there.';
	if (snap.status === 'setup') return 'Finish setting up your Pokémon first.';
	if (slot !== 'active') {
		if (snap.pendingPromote != null && snap.pendingPromote === snap.you) {
			return 'Choose a different Pokémon to promote.';
		}
		return 'This Benched Pokémon has nothing it can use right now.';
	}
	const st = String(mon.status || '').toLowerCase();
	if (st === 'asleep') return 'This Pokémon is Asleep and can\'t attack or retreat.';
	if (st === 'paralyzed') return 'This Pokémon is Paralyzed and can\'t attack or retreat.';
	if (firstPlayerTurn(snap)) return "You can't attack on your first turn.";
	const energy = mon.energy || [];
	if (!energy.length) return "This Pokémon doesn't have enough Energy to attack.";
	const acts = (snap.actions || []).filter(a =>
		a.type === 'attack' || a.type === 'retreat' ||
		(a.type === 'ability' && (a.slot == null || a.slot === 'active' || sameSlot(a.slot, 'active')))
	);
	if (!acts.length) {
		if (me?.attachedEnergyThisTurn && !(mon.attacks || []).length) {
			return "This Pokémon can't attack or retreat right now.";
		}
		return "This Pokémon has no actions available right now.";
	}
	return "This Pokémon can't attack or retreat right now.";
}

export function sameDrop(a: DropTarget | null, b: DropTarget | null): boolean {
	if (!a || !b) return a === b;
	if (a.kind !== b.kind) return false;
	if (a.kind === 'slot') {
		return a.foe === b.foe && sameSlot(a.slot!, b.slot) && !!a.empty === !!b.empty;
	}
	return true;
}

export function prizesLeft(p: TcgPlayerView, need: number, status?: string): number {
	const n = pileCount(p.prizes);
	return status === 'setup' && !n ? need : n;
}

export function scoredPoints(p: TcgPlayerView, need: number, status?: string): number {
	if (typeof p.points === 'number') return p.points;
	return Math.max(0, need - prizesLeft(p, need, status));
}

export function pip(type: string, key?: string | number) {
	const t = energyElement(type) || type || 'colorless';
	return <span
		key={key}
		class={`tcg-pip t-${t}`}
		title={t}
	>
		<img src={energySymbolUrl(t)} alt="" draggable={false} />
	</span>;
}

/**
 * `unclassified` is attached energy we can't tell (not in the index, not an energy card, or no card ids). it's
 * plain "Energy", never guessed
 */
export type AttachedKind = 'energy' | 'special' | 'unclassified' | 'tool';
export type AttachedCard = { cardId: string, kind: AttachedKind };

export function attachedKindLabel(kind: AttachedKind): string {
	if (kind === 'tool') return 'Tool';
	if (kind === 'special') return 'Special Energy';
	if (kind === 'energy') return 'Basic Energy';
	return 'Energy';
}

export function attachedEnergyKind(cardId: string): AttachedKind {
	const category = energyCategory(cardId);
	if (category === 'basic') return 'energy';
	if (category === 'special') return 'special';
	return 'unclassified';
}

export function attachedCardsOf(mon: TcgPokemonView | null | undefined): AttachedCard[] {
	if (!mon) return [];
	const out: AttachedCard[] = [];
	const cards = mon.energyCards;
	if (cards?.length) {
		for (const id of cards) {
			if (!id) continue;
			out.push({ cardId: id, kind: attachedEnergyKind(id) });
		}
	} else {
		for (const t of mon.energy || []) {
			const el = energyElement(t) || 'colorless';
			out.push({ cardId: `energy-${el}`, kind: 'unclassified' });
		}
	}
	for (const id of mon.tools || []) {
		if (!id || id === 'tool') continue;
		out.push({ cardId: id, kind: 'tool' });
	}
	return out;
}

/**
 * earlier evolution stages are history, not attachments, so `attachedCardsOf` and every attached count never
 * include them
 */
export function previousStagesOf(mon: TcgPokemonView | null | undefined): string[] {
	if (!mon || mon.faceDown) return [];
	return (mon.previousStages || []).filter(Boolean);
}

export type AttachBrowse = { title: string, cards: AttachedCard[], stages: string[] };

export function attachBrowseOf(mon: TcgPokemonView): AttachBrowse {
	const cards = attachedCardsOf(mon);
	const stages = previousStagesOf(mon);
	const name = mon.name || mon.cardId;
	return { title: cards.length ? `Attached to ${name}` : `Under ${name}`, cards, stages };
}

export function attachPeeksOf(cards: AttachedCard[], max = 3): AttachedCard[] {
	if (cards.length <= max) return cards;
	const tools = cards.filter(c => c.kind === 'tool');
	const specials = cards.filter(c => c.kind === 'special');
	const rest = cards.filter(c => c.kind !== 'tool' && c.kind !== 'special');
	const preferred = tools.concat(specials);
	if (preferred.length >= max) return preferred.slice(preferred.length - max);
	const need = max - preferred.length;
	return preferred.concat(rest.slice(Math.max(0, rest.length - need)));
}

export function searchPromptState(
	committed: TcgSnapshot['pendingSearch'] | undefined,
	painted: TcgSnapshot['pendingSearch'] | undefined
): TcgSnapshot['pendingSearch'] | undefined {
	if (committed?.ids?.length || committed?.seen?.length) return committed;
	if (painted?.ids?.length || painted?.seen?.length) return painted;
	return committed || painted;
}

export function searchDeckRows(
	pending: { ids?: string[], seen?: string[], legal?: string[] } | undefined,
	picks: { type: string, pick?: string }[]
): { id: string, legal: boolean }[] | null {
	const ids = pending?.ids?.length ? pending.ids : (pending?.seen?.length ? pending.seen : null);
	if (!ids) return null;
	const offered = picks.filter(a => a.type === 'searchPick' && a.pick).map(a => String(a.pick));
	const marked = Array.isArray(pending?.legal) ? pending.legal : null;
	return ids.map(id => ({
		id,
		legal: marked ? marked.includes(id) && offered.includes(id) : offered.includes(id),
	}));
}

export function promptHeading(
	snap: TcgSnapshot,
	kind: string,
	searchState?: TcgSnapshot['pendingSearch']
): { title: string, sub?: string } {
	if (kind === 'confirm') {
		return {
			title: snap.pendingConfirm?.title || 'Confirm',
			sub: snap.pendingConfirm?.text,
		};
	}
	if (kind === 'first') return { title: 'Who goes first?' };
	if (kind === 'foeHand') {
		const choice = foeHandChoice(snap);
		const n = choice?.need ?? 1;
		const what = n === 1 ? 'a card' : `${n} cards`;
		const verb = choice?.to === 'deck' ? 'to put into their deck' : choice?.to === 'lost' ? 'to put in the Lost Zone' :
			choice?.to === 'prizes' ? 'to put with their Prize cards' : 'to discard';
		return { title: 'Your opponent\'s hand', sub: `Choose ${what} ${verb}. Highlighted cards can be chosen.` };
	}
	if (kind === 'search') {
		const ps = searchState || snap.pendingSearch;
		if (ps?.seen?.length) {
			return {
				title: 'Look',
				sub: ps.legal?.length ?
					'Highlighted cards can be taken. The rest stay where they are.' :
					'Only you can see these cards. Press Done to continue.',
			};
		}
		const left = ps?.left != null ? ` (${ps.left} left)` : '';
		const dest = ps?.dest === 'bench' ? ' to the Bench' :
			ps?.dest === 'hand' ? ' to your hand' : '';
		const zone = ps?.zone === 'discard' ? 'from your discard pile' :
			ps?.zone === 'prizes' ? 'from your Prize cards' : 'from your deck';
		// a search of the deck stays open with nothing left to take (closing would tell the opponent) so say so
		const nothing = Array.isArray(ps?.legal) && !ps.legal.length;
		const highlight = ps?.ids?.length && !ps.seen?.length ?
			`. ${ps.ids.length} cards, in order. ${nothing ? 'Nothing here can be taken: press Done to finish.' : 'Highlighted cards can be taken.'}` :
			ps?.ids?.length ? '. Highlighted cards can be taken.' : '';
		return { title: `Choose a card${dest}`, sub: `${zone}${left}${highlight}` };
	}
	if (kind === 'pay') {
		return {
			title: 'Discard Energy to retreat',
			sub: snap.pendingRetreatPay?.need != null ? `Choose ${snap.pendingRetreatPay.need}` : undefined,
		};
	}
	if (kind === 'energyDiscard') {
		const left = snap.pendingDiscardEnergy?.need;
		return { title: 'Discard Energy', sub: left != null ? `Choose ${left}` : undefined };
	}
	if (kind === 'mulliganDraw') {
		const max = snap.pendingMulliganDraw?.max;
		return { title: 'Mulligan', sub: max != null ? `Draw up to ${max}, or none` : 'Choose how many cards to draw' };
	}
	if (kind === 'mulligan') return { title: 'Mulligan', sub: 'Place Basics on the Bench, or keep your hand' };
	if (kind === 'endTurn') return { title: 'End your turn?', sub: 'You still have actions available' };
	if (kind === 'prize') return { title: 'Take a Prize card', sub: 'Select a Prize from your prize row' };
	if (kind === 'copy') {
		const ask = snap.pendingCopyAttack?.ask;
		const from = choiceFromText(snap.pendingCopyAttack?.from, iid => findChoiceMon(snap, iid)?.mon.name || '', cardLabel);
		if (ask) return { title: ask, sub: from || undefined };
		return {
			title: snap.pendingCopyAttack?.title || 'Make a choice',
			sub: snap.pendingCopyAttack?.text,
		};
	}
	return { title: 'Choose' };
}

export function isOwnCopyPromptRow(snap: TcgSnapshot, a: TcgAction): boolean {
	if (!snap.pendingCopyAttack || (a.type !== 'attack' && a.type !== 'ability')) return false;
	return (snap.actions || []).some(x => x.type === a.type && x.index === a.index && x.pick === a.pick &&
		x.slot === a.slot && x.foeSlot === a.foeSlot && x.bench === a.bench && x.targetSlot === a.targetSlot);
}

export function optionalAttackPair(acts: TcgAction[], index: number): { yes: TcgAction, no: TcgAction } | null {
	const group = acts.filter(a => a.type === 'attack' && a.index === index);
	if (group.length !== 2) return null;
	const yes = group.find(a => a.pick === 'yes');
	const no = group.find(a => a.pick === 'skip');
	if (!yes || !no) return null;
	return { yes, no };
}

export function copyPickCardId(a: TcgAction): string | null {
	if (a.type !== 'attack' || typeof a.pick !== 'string') return null;
	return /^(?:[A-Za-z0-9]+-)+[A-Za-z]{0,6}\d+[A-Za-z]?$/.test(a.pick) ? a.pick : null;
}

export function describeAction(
	a: TcgAction, snap: TcgSnapshot, opts?: { targetOnly?: boolean, moveOnly?: boolean }
): string {
	const me = snap.players[snap.you ?? 0];
	const foe = snap.players[snap.you === 0 ? 1 : 0];
	const handId = (i?: number) => (Array.isArray(me?.hand) && i != null ? me.hand[i] : '') || '';
	const cardAt = (i?: number) => cardLabel(handId(i));
	const slotName = (s?: TcgSlot) => s === 'active' ? 'Active' : s == null ? '' : `Bench ${Number(s) + 1}`;
	const monAt = (s?: TcgSlot, side?: TcgPlayerView) => {
		const p = side || me;
		if (!p || s == null) return '';
		if (s === 'active') return p.active?.name || 'Active';
		return p.bench?.[Number(s)]?.name || slotName(s);
	};
	const labeledMon = (s: TcgSlot | undefined, side?: TcgPlayerView) => {
		const name = monAt(s, side);
		if (!name || s == null || !side) return name || slotName(s);
		let same = side.active?.name === name ? 1 : 0;
		for (const b of side.bench || []) if (b?.name === name) same++;
		if (same < 2) return name;
		if (s === 'active') return `${name} (Active)`;
		return `${name} (Bench ${Number(s) + 1})`;
	};
	const targetIsFoe = a.foeSlot != null;
	const targetLabel = (() => {
		if (a.foeSlot != null) return monAt(a.foeSlot, foe) || `Foe ${slotName(a.foeSlot)}`;
		if (a.targetSlot != null) {
			const mine = monAt(a.targetSlot, me);
			const theirs = monAt(a.targetSlot, foe);
			if (mine && !theirs) return mine;
			if (theirs && !mine) return theirs;
			if (targetIsFoe) return theirs || mine || slotName(a.targetSlot);
			return mine || theirs || slotName(a.targetSlot);
		}
		if (a.bench != null && (a.type === 'retreat' || a.type === 'promote' || a.type === 'ability' || a.type === 'attack')) {
			return monAt(a.bench, me) || slotName(a.bench);
		}
		if (a.type === 'attack' && a.copies) return '';
		if (a.type === 'attack' && a.slot != null) return labeledMon(a.slot, me);
		if (a.slot != null && a.type !== 'attack' && a.type !== 'ability') return monAt(a.slot, me) || slotName(a.slot);
		return '';
	})();
	const moveName = (() => {
		if (a.type === 'ability') {
			if (a.name) return a.name;
			const mon = a.slot === 'active' ? me?.active : me?.bench?.[Number(a.slot)];
			return mon?.abilities?.[a.index]?.name || 'Ability';
		}
		if (a.type === 'attack') {
			// the copying attack comes first, it's the attack being used
			if (a.copies?.name && !opts?.moveOnly) {
				return `${a.name || me?.active?.attacks?.[a.index]?.name || 'Attack'}: ${a.copies.name}`;
			}
			if (a.copies?.name) return a.name || me?.active?.attacks?.[a.index]?.name || 'Attack';
			if (a.label) return a.label;
			if (a.name) return a.name;
			return me?.active?.attacks?.[a.index]?.name || `Attack ${(a.index ?? 0) + 1}`;
		}
		return '';
	})();
	// the engine's `label`, like the card Spiteful Evolution evolves into
	const abilityPick = a.type === 'ability' && a.label && !opts?.moveOnly ? `: ${a.label}` : '';
	switch (a.type) {
	case 'setupDone': return 'Ready';
	case 'setupReturn': return 'Return to hand';
	case 'endTurn': return 'End Turn';
	case 'setActive': return `Active: ${cardAt(a.hand)}`;
	case 'setBench': return `Bench: ${cardAt(a.hand)}`;
	case 'playBasic': return `Bench ${cardAt(a.hand)}`;
	case 'evolve': return `Evolve ${monAt(a.slot)} → ${cardAt(a.hand)}`;
	case 'attachEnergy': return `Attach ${cardAt(a.hand)} to ${monAt(a.slot)}`;
	case 'attachTool': return `Tool ${cardAt(a.hand)} → ${monAt(a.slot)}`;
	case 'playTrainer': {
		const errata = a.errata ? ' (errata)' : '';
		return (targetLabel ? `Play ${cardAt(a.hand)} → ${targetLabel}` : `Play ${cardAt(a.hand)}`) + errata;
	}
	case 'playStadium': return `Stadium ${cardAt(a.hand)}`;
	case 'useStadium': return 'Use Stadium';
	case 'ability': {
		if (opts?.moveOnly) return moveName;
		if (opts?.targetOnly && targetLabel) return targetLabel;
		if (targetLabel) return `${moveName}${abilityPick} → ${targetLabel}`;
		return moveName + abilityPick;
	}
	case 'retreat': return `Retreat → ${monAt(a.bench)}`;
	case 'payEnergy': return 'Discard Energy';
	case 'discardEnergyPick': return 'Discard this Energy';
	case 'attack': {
		if (opts?.moveOnly) return moveName;
		if (opts?.targetOnly && targetLabel) return targetLabel;
		if (targetLabel) return `${moveName} → ${targetLabel}`;
		return moveName;
	}
	case 'searchPick': return `Take ${cardLabel(a.pick)}`;
	case 'searchDone': return 'Done searching';
	case 'discardPick': return `Discard ${cardAt(a.hand)}`;
	case 'handEnergyPick': return `Attach ${cardAt(a.hand)}`;
	case 'confirmYes': return 'Yes';
	case 'confirmNo': return 'No';
	case 'promote': return `Promote ${monAt(a.bench)}`;
	case 'chooseFirst': return a.goFirst ? 'Go first' : 'Go second';
	case 'mulliganDraw': return a.n ? `Draw ${a.n}` : 'Draw none';
	case 'mulliganBench': return `Bench ${cardAt(a.hand)}`;
	case 'mulliganDone': return 'Keep hand';
	case 'takePrize': return `Take Prize ${Number(a.index) + 1}`;
	case 'attachZone': return `Attach Energy → ${monAt(a.slot)}`;
	case 'pickSlot': {
		const pickSide = a.foeSlot != null ? foe : me;
		const pick = a.foeSlot != null ? a.foeSlot : a.slot;
		return `Choose ${monAt(pick, pickSide) || slotName(pick)}`;
	}
	case 'playVunion': return `Play ${a.name || 'V-UNION'}`;
	default: return a.type;
	}
}

export function actionTargetKey(a: TcgAction): string {
	if (a.foeSlot != null) return `f:${a.foeSlot}`;
	if (a.targetSlot != null) return `t:${a.targetSlot}`;
	if (a.bench != null) return `b:${a.bench}`;
	if (a.slot != null) return `s:${a.slot}`;
	return '';
}

export function actionIdentityKey(a: TcgAction): string {
	if (a.type === 'attack') {
		const pick = (a.pick === 'yes' || a.pick === 'skip') ? '' : (a.pick || '');
		return `attack:${a.index != null ? a.index : (a.name || '')}:${pick}`;
	}
	if (a.type === 'ability') {
		return `ability:${a.index != null ? a.index : (a.name || '')}:${a.slot ?? ''}:${a.pick || ''}`;
	}
	return `${a.type}:${a.name || a.index || ''}`;
}

export function isMultiTargetGroup(acts: TcgAction[], a: TcgAction): boolean {
	const id = actionIdentityKey(a);
	const keys: string[] = [];
	for (const x of acts) {
		if (actionIdentityKey(x) !== id) continue;
		const k = actionTargetKey(x);
		if (k && !keys.includes(k)) keys.push(k);
	}
	return keys.length > 1;
}

export function moveTargetGroup(acts: TcgAction[], a: TcgAction): TcgAction[] {
	const id = actionIdentityKey(a);
	return acts.filter(x => actionIdentityKey(x) === id);
}

export function uniqueTargetActions(group: TcgAction[]): TcgAction[] {
	const seen: string[] = [];
	return group.filter(a => {
		const k = actionTargetKey(a) || `_:${seen.length}`;
		if (seen.includes(k)) return false;
		seen.push(k);
		return true;
	});
}

export function describeMoveTarget(a: TcgAction, snap: TcgSnapshot): { name: string, slot: string, foe: boolean } {
	const me = snap.players[snap.you ?? 0];
	const foe = snap.players[snap.you === 0 ? 1 : 0];
	const slotWord = (s?: TcgSlot | null) => {
		if (s === 'active') return 'Active';
		if (s == null) return '';
		return `Bench ${Number(s) + 1}`;
	};
	const monName = (s: TcgSlot | undefined, side?: TcgPlayerView) => {
		if (!side || s == null) return '';
		if (s === 'active') return side.active?.name || '';
		return side.bench?.[Number(s)]?.name || '';
	};
	if (a.foeSlot != null) {
		const slot = slotWord(a.foeSlot);
		return { name: monName(a.foeSlot, foe) || slot || 'Opponent', slot, foe: true };
	}
	if (a.targetSlot != null) {
		const mine = monName(a.targetSlot, me);
		const theirs = monName(a.targetSlot, foe);
		const slot = slotWord(a.targetSlot);
		if (theirs && !mine) return { name: theirs, slot, foe: true };
		if (mine) return { name: mine, slot, foe: false };
		return { name: slot || 'Pokémon', slot, foe: false };
	}
	if (a.bench != null && (a.type === 'retreat' || a.type === 'promote' || a.type === 'ability' || a.type === 'attack')) {
		const slot = slotWord(a.bench);
		return { name: monName(a.bench, me) || slot, slot, foe: false };
	}
	if (a.type === 'attack' && a.slot != null) {
		const slot = slotWord(a.slot);
		return { name: monName(a.slot, me) || slot, slot, foe: false };
	}
	if (a.slot != null && a.type === 'ability') {
		const slot = slotWord(a.slot);
		return { name: monName(a.slot, me) || slot, slot, foe: false };
	}
	const fallback = describeAction(a, snap, { targetOnly: true });
	return { name: fallback || 'Pokémon', slot: '', foe: false };
}

export function retreatSignature(a: TcgAction): string {
	const keys = Object.keys(a).filter(k => k !== 'type' && k !== 'bench').sort();
	return keys.map(k => `${k}:${JSON.stringify(a[k])}`).join('|');
}

export function retreatChoice(actions: TcgAction[], clicked: TcgAction, bench?: number): TcgAction | 'pick' | null {
	if (clicked.type !== 'retreat') return null;
	const sig = retreatSignature(clicked);
	const group = actions.filter(a => a.type === 'retreat' && retreatSignature(a) === sig);
	if (bench == null) {
		if (group.length === 1) return group[0];
		return group.length > 1 ? 'pick' : null;
	}
	const hit = group.filter(a => a.bench === bench);
	return hit.length === 1 ? hit[0] : null;
}

export function deckLookPrompt(acts: TcgAction[], hand: number): {
	pile: string[], need: number, note: string, actions: TcgAction[],
} | null {
	const group = acts.filter(a =>
		a.type === 'playTrainer' && a.hand === hand && !hasBoardTarget(a) &&
		Array.isArray(a.lookPile) && a.lookPile.length > 0 && deckLookIndexes(a.pick)
	);
	if (group.length < 2) return null;
	const pile = group[0].lookPile as string[];
	const need = deckLookIndexes(group[0].pick)?.length || 0;
	if (need < 1) return null;
	if (group.some(a => (deckLookIndexes(a.pick)?.length || 0) !== need)) return null;
	return {
		pile,
		need,
		note: String(group[0].lookNote || `Choose ${need}.`),
		actions: group,
	};
}

export function deckLookAction(actions: TcgAction[], picked: number[]): TcgAction | null {
	const key = picked.slice().sort((a, b) => a - b).join(',');
	return actions.find(a => {
		const idxs = deckLookIndexes(a.pick);
		if (!idxs) return false;
		return idxs.slice().sort((x, y) => x - y).join(',') === key;
	}) || null;
}

export function deckLookIndexes(pick: string | undefined): number[] | null {
	const raw = String(pick ?? '');
	if (!/^\d+(,\d+)*$/.test(raw)) return null;
	const idxs = raw.split(',').map(Number);
	if (idxs.some(i => !Number.isInteger(i) || i < 0)) return null;
	return idxs;
}

export function visibleMenuActions(menu: TcgAction[]): TcgAction[] {
	const seenRetreat: string[] = [];
	const seenMove: string[] = [];
	return menu.filter(a => {
		if (a.type === 'retreat') {
			const sig = retreatSignature(a);
			if (seenRetreat.includes(sig)) return false;
			seenRetreat.push(sig);
			return true;
		}
		if (a.type === 'attack' || a.type === 'ability') {
			const id = actionIdentityKey(a);
			if (seenMove.includes(id)) return false;
			seenMove.push(id);
			return true;
		}
		return true;
	});
}

export type MenuRow = {
	key: string,
	kind: 'attack' | 'ability' | 'other',
	label: string,
	action: TcgAction | null,
	why: string,
	cost?: string[],
	damage?: string,
	sub?: string,
	type?: string,
};

const PS_MOVE_TYPE: { [type: string]: string } = {
	grass: 'Grass', fire: 'Fire', water: 'Water', lightning: 'Electric', psychic: 'Psychic', fighting: 'Fighting',
	darkness: 'Dark', metal: 'Steel', fairy: 'Fairy', dragon: 'Dragon', colorless: 'Normal',
};
export function psMoveType(type?: string): string {
	return PS_MOVE_TYPE[energyElement(type) || String(type || '').toLowerCase()] || '';
}

function usedAbility(text?: string): boolean {
	return /\bonce during your turn\b|\byou may use this ability\b|\bas often as you like during your turn\b/i.test(text || '');
}

export function energyCovers(cost: string[] | undefined, energy: string[] | undefined): boolean {
	const left = (energy || []).map(e => energyElement(e) || String(e).toLowerCase());
	let colorless = 0;
	for (const raw of cost || []) {
		const t = energyElement(raw) || String(raw).toLowerCase();
		if (t === 'colorless') {
			colorless++;
			continue;
		}
		const at = left.indexOf(t);
		if (at < 0) return false;
		left.splice(at, 1);
	}
	return left.length >= colorless;
}

/**
 * Whether `a` uses the `i`th printed Ability of `mon`, the card in `slot`. A pokemon's menu also holds rows that
 * only target it, like another pokemon's Sky Transport switching it in, and rows used from the discard pile carry
 * `slot: "active"`: `index` alone would put those under this Pokemon's Ability and send them when it is clicked.
 * The engine names the pokemon (`iid`) and the Ability (`name`) on each row; both are checked when present.
 */
export function ownAbilityRow(
	a: TcgAction, slot: TcgSlot, mon: { iid?: string } | null | undefined, i: number, name?: string
): boolean {
	if (a.type !== 'ability' || a.from === 'discard' || Number(a.index) !== i || !sameSlot(a.slot, slot)) return false;
	if (a.iid != null && mon?.iid != null && a.iid !== mon.iid) return false;
	return a.name == null || name == null || a.name === name;
}

/** On an Ability row in another pokemon's menu, or one used from the discard pile: whose Ability it is. */
export function abilitySourceLabel(a: TcgAction, snap: TcgSnapshot, slot: TcgSlot): string {
	if (a.type !== 'ability') return '';
	if (a.from === 'discard') return `From your discard pile${a.cardId ? ` (${cardLabel(a.cardId)})` : ''}`;
	if (sameSlot(a.slot, slot)) return '';
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	const atSlot = a.slot === 'active' ? me?.active : me?.bench?.[Number(a.slot)];
	const mon = a.iid ? [me?.active, ...(me?.bench || [])].find(m => m?.iid === a.iid) || atSlot : atSlot;
	if (!mon) return '';
	return `${mon.name}'s Ability (${a.slot === 'active' ? 'Active' : `Bench ${Number(a.slot) + 1}`})`;
}

export function menuRows(snap: TcgSnapshot, slot: TcgSlot, menu: TcgAction[], hideIllegal = false): MenuRow[] {
	const me = snap.you != null ? snap.players[snap.you] : undefined;
	const mon = slot === 'active' ? me?.active : me?.bench?.[Number(slot)];
	const legal = visibleMenuActions(menu);
	const used: TcgAction[] = [];
	const take = (a: TcgAction | undefined) => {
		if (a) used.push(a);
		return a || null;
	};
	const rows: MenuRow[] = [];
	const playing = snap.status === 'playing' && !!mon && !mon.faceDown;
	const myTurn = snap.turn === snap.you;
	const st = String(mon?.status || '').toLowerCase();
	const stuck = st === 'asleep' ? 'Asleep' : st === 'paralyzed' ? 'Paralyzed' : '';
	const type = mon?.types?.[0];

	if (playing && slot === 'active') {
		(mon.attacks || []).forEach((atk, i) => {
			const action = take(legal.find(a => a.type === 'attack' && !a.attacker && Number(a.index) === i && !used.includes(a)));
			let why = '';
			if (action) why = '';
			else if (!myTurn) why = "It's not your turn.";
			else if (stuck) why = `${stuck} Pokémon can't attack.`;
			else if (firstPlayerTurn(snap)) why = "You can't attack on your first turn.";
			else if (!energyCovers(atk.cost, mon.energy)) why = 'Not enough Energy attached.';
			else why = "This attack can't be used right now.";
			// printed `mon.attacks` decides which rows exist. `action.name` only labels a legal row (copied attacks etc),
			// it's not a reason to skip updating `mon.attacks` after a face change
			rows.push({
				key: `attack-${i}`, kind: 'attack',
				label: action && !action.copies && action.label ? action.label :
				(action?.name || atk.name),
				action, why, type,
				cost: action?.cost as string[] | undefined || atk.cost,
				damage: action?.damage as string | undefined || atk.damage,
				sub: action && choiceSub(action, snap) ||
					(atk.sourceCardId ? `From ${cardLabel(atk.sourceCardId)}` : undefined),
			});
		});
	}
	if (playing) {
		(mon.abilities || []).forEach((ab, i) => {
			const action = take(legal.find(a => ownAbilityRow(a, slot, mon, i, ab.name) && !used.includes(a)));
			if (!action && !usedAbility(ab.text)) return;
			rows.push({
				key: `ability-${i}`, kind: 'ability', label: ab.name, action,
				why: action ? '' : !myTurn ? "It's not your turn." : "This Ability can't be used right now.",
				sub: action && choiceSub(action, snap) || undefined,
			});
		});
	}
	for (const a of legal) {
		if (used.includes(a)) continue;
		used.push(a);
		const kind = a.type === 'attack' ? 'attack' : a.type === 'ability' ? 'ability' : 'other';
		// a row with its choice on the line under it (`choiceSub`) is named like the printed row above it
		const choice = a.attacker ? attackerLabel(a, snap) : choiceSub(a, snap);
		const label = a.type === 'retreat' ?
			(legal.filter(x => x.type === 'retreat').length > 1 ?
				(a.name ? `Retreat: ${a.name}` : a.text ? `Retreat: ${a.text}` : 'Retreat') : 'Retreat') :
			describeAction(a, snap, { moveOnly: isMultiTargetGroup(menu, a) || !!(choice && !a.attacker) });
		// another mon's Ability that only targets this one (Sky Transport switching it in), or one from the discard pile
		const sub = [choice, abilitySourceLabel(a, snap, slot)].filter(Boolean).join(' · ');
		rows.push({
			key: `${a.type}-${actionIdentityKey(a)}-${rows.length}`, kind, label, action: a, why: '',
			cost: a.cost as string[] | undefined, damage: a.damage as string | undefined,
			sub: sub || undefined, type: kind === 'attack' ? type : undefined,
		});
	}
	if (playing && slot === 'active' && !legal.some(a => a.type === 'retreat')) {
		let why = "This Pokémon can't retreat right now.";
		if (!myTurn) why = "It's not your turn.";
		else if (me?.retreatedThisTurn) why = 'You already retreated this turn.';
		else if (stuck) why = `${stuck} Pokémon can't retreat.`;
		else if (!me?.bench?.length) why = 'You have no Benched Pokémon to switch in.';
		else if ((mon.energy || []).length < (mon.retreat ?? 0)) why = 'Not enough Energy attached to retreat.';
		rows.push({ key: 'retreat', kind: 'other', label: 'Retreat', action: null, why });
	}
	return hideIllegal ? rows.filter(r => r.action) : rows;
}

export function choiceSub(a: TcgAction, snap: TcgSnapshot): string {
	if (a.type === 'attack' && a.copies?.name) {
		const c = a.copies;
		const found = c.iid ? findChoiceMon(snap, c.iid) : null;
		const mine = found ? found.seat === snap.you : false;
		const spot = !found ? '' : found.slot === 'active' ?
			(mine ? 'your Active' : "opponent's Active") :
			`${mine ? 'your' : "opponent's"} Bench ${Number(found.slot) + 1}`;
		const from = c.from ? (spot ? `${c.from}, ${spot}` : c.from) : spot;
		return from ? `Uses ${c.name} (${from})` : `Uses ${c.name}`;
	}
	if (a.type === 'ability' && a.label) return a.label;
	return '';
}

export function attackerLabel(a: TcgAction, snap: TcgSnapshot): string {
	const from = a.attacker;
	if (!from) return '';
	const mon = snap.players[snap.you ?? 0]?.bench?.find(m => m?.iid === from.iid);
	return `${from.name}, Bench ${Number(from.bench) + 1}${mon ? `, ${mon.hp} HP` : ''}`;
}

export function menuActionsForSlot(acts: TcgAction[], slot: TcgSlot, iid?: string): TcgAction[] {
	if (slot === 'active') {
		return acts.filter(a =>
			a.type === 'attack' ||
			a.type === 'retreat' ||
			(a.type === 'setupReturn' && a.slot === 'active') ||
			(a.type === 'ability' && (a.slot == null || a.slot === 'active' || sameSlot(a.slot, 'active')))
		);
	}
	return acts.filter(a =>
		(a.type === 'attack' && a.attacker?.bench === slot && (iid == null || a.attacker.iid === iid)) ||
		(a.type === 'ability' && actionTouchesSlot(a, slot)) ||
		(a.type === 'useStadium' && actionTouchesSlot(a, slot)) ||
		(a.type === 'promote' && typeof slot === 'number' && a.bench === slot) ||
		(a.type === 'setupReturn' && typeof slot === 'number' && a.slot === slot)
	);
}

export function stadiumClickAction(acts: TcgAction[]): TcgAction | null {
	const uses = acts.filter(a => a.type === 'useStadium');
	return uses.length === 1 ? uses[0] : null;
}

export function stadiumUseHint(acts: TcgAction[]): string {
	const uses = acts.filter(a => a.type === 'useStadium');
	if (uses.length < 2) return '';
	if (uses.some(a => a.pick)) return 'Drag a card onto the Stadium.';
	if (uses.some(a => a.bench != null)) return 'Choose a Pokémon.';
	return 'Choose how to use the Stadium.';
}

export function prizeSlotsAfterTakes(max: number, takes: number[]): number[] {
	const available: number[] = [];
	for (let i = 0; i < max; i++) available.push(i);
	for (const raw of takes) {
		const index = Number(raw);
		if (!Number.isInteger(index) || index < 0 || index >= available.length) continue;
		available.splice(index, 1);
	}
	return available;
}

export type PrizeRailSlot = {
	slot: number,
	taken: boolean,
	serverIndex: number | null,
};

export function bindPrizeSlots(
	max: number,
	remaining: number,
	takes: number[],
	picked: number[]
): PrizeRailSlot[] {
	const n = Math.max(0, max);
	const left = Math.max(0, Math.min(n, remaining));
	let available: number[];
	if (!takes.length && left < n) {
		available = [];
		for (let i = 0; i < left; i++) available.push(i);
	} else {
		available = prizeSlotsAfterTakes(n, takes);
	}
	const taken: boolean[] = [];
	for (let i = 0; i < n; i++) taken[i] = !available.includes(i);
	for (const raw of picked) {
		const index = Number(raw);
		if (!Number.isInteger(index) || index < 0 || index >= available.length) continue;
		const slot = available[index];
		if (slot != null) taken[slot] = true;
	}
	const out: PrizeRailSlot[] = [];
	for (let slot = 0; slot < n; slot++) {
		const serverIndex = available.indexOf(slot);
		out.push({
			slot,
			taken: !!taken[slot],
			serverIndex: serverIndex < 0 ? null : serverIndex,
		});
	}
	return out;
}

export function pendingPrizePicks(pickBase: number, remaining: number, picked: number[]): number[] {
	if (!(pickBase > 0) || remaining < pickBase) return [];
	return picked.slice();
}

export function prizePromptWaits(
	playing: boolean,
	events?: { type?: string }[] | null,
	fxKind?: string | null
): boolean {
	if (fxKind === 'attack' || fxKind === 'ability' || fxKind === 'ko' || fxKind === 'damage') return true;
	if (!playing || !events?.length) return false;
	for (const ev of events) {
		const t = ev?.type;
		if (t === 'attack' || t === 'ability' || t === 'ko' || t === 'damage') return true;
	}
	return false;
}

export function collectPrizeTakes(
	items: { events?: TcgEvent[] | null }[],
	throughIndex: number
): [number[], number[]] {
	const takes: [number[], number[]] = [[], []];
	const end = throughIndex < 0 ? items.length - 1 : throughIndex;
	for (let i = 0; i <= end && i < items.length; i++) {
		const events = items[i].events || [];
		for (const ev of events) {
			if (ev.type !== 'act' || ev.action?.type !== 'takePrize') continue;
			const seat: 0 | 1 | null = ev.seat === 1 ? 1 : ev.seat === 0 ? 0 : null;
			if (seat == null) continue;
			const index = Number(ev.action.index);
			if (!Number.isFinite(index)) continue;
			takes[seat].push(index);
		}
	}
	return takes;
}

export class TcgCardFace extends preact.Component<{
	cardId?: string, image?: string, name?: string, size?: CardSize, selected?: boolean,
	back?: boolean, playable?: boolean, arrive?: boolean, fanIndex?: number, fanCount?: number,
	dragging?: boolean, pocket?: boolean, incoming?: boolean,
	onClick?: (ev: MouseEvent) => void,
	onInspect?: (p: Preview) => void,
	onPointerDown?: (e: PointerEvent) => void,
	onHold?: () => void,
}, { noArt?: string }> {
	holdTimer: number | null = null;
	held = false;
	holdX = 0;
	holdY = 0;
	clearHold() {
		if (this.holdTimer != null) window.clearTimeout(this.holdTimer);
		this.holdTimer = null;
	}
	inspect = (ev?: Event) => {
		const { cardId, image, name, back, onInspect } = this.props;
		if (back || !cardId || !onInspect) return;
		ev?.preventDefault();
		ev?.stopPropagation();
		onInspect({ cardId, image, name });
	};
	onPointerDown = (ev: PointerEvent) => {
		if (ev.button != null && ev.button !== 0) return;
		ev.stopPropagation();
		this.held = false;
		this.holdX = ev.clientX;
		this.holdY = ev.clientY;
		this.props.onPointerDown?.(ev);
		if (!this.props.onInspect || this.props.back || !this.props.cardId) return;
		this.clearHold();
		this.holdTimer = window.setTimeout(() => {
			this.holdTimer = null;
			this.held = true;
			this.props.onHold?.();
			this.inspect();
		}, 420);
	};
	onPointerUp = () => {
		this.clearHold();
	};
	onPointerMove = (ev: PointerEvent) => {
		if (this.holdTimer == null) return;
		if (Math.hypot(ev.clientX - this.holdX, ev.clientY - this.holdY) > 8) this.clearHold();
	};
	onClick = (ev: MouseEvent) => {
		if (this.held) {
			this.held = false;
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}
		if (!this.props.onClick) return;
		ev.stopPropagation();
		this.props.onClick(ev);
	};
	markNoArt(cardId: string) {
		noArtCards[cardId] = true;
		if (this.state.noArt !== cardId) this.setState({ noArt: cardId });
	}
	onImgLoad = (ev: Event) => {
		const img = ev.currentTarget as HTMLImageElement | null;
		const cardId = this.props.cardId;
		if (!img || !cardId || this.props.image || !scrydexUrl(img.src)) return;
		if (sampleNoArt(img)) this.markNoArt(cardId);
	};
	onImgError = (ev: Event) => {
		const img = ev.currentTarget as HTMLImageElement | null;
		const cardId = this.props.cardId;
		if (!img || !cardId) return;
		const step = Number(img.dataset.fallback || '0');
		const forcePocket = !!this.props.pocket || isPocketCardId(cardId);
		img.removeAttribute('crossorigin');

		if (forcePocket) {
			if (step < 1) {
				img.dataset.fallback = '1';
				img.src = cardArt(cardId, { pocket: true, large: false });
				return;
			}
			if (step < 2) {
				img.dataset.fallback = '2';
				img.src = cardArt(cardId, { pocket: true, large: true });
				return;
			}
			return;
		}

		if (step < 1) {
			img.dataset.fallback = '1';
			img.src = paperTcgIoArt(cardId, false);
			return;
		}
		if (step < 2) {
			img.dataset.fallback = '2';
			img.src = paperTcgIoArt(cardId, true);
			return;
		}
		if (step < 3) {
			img.dataset.fallback = '3';
			img.src = scrydexArt(cardId, true);
			return;
		}
		if (!this.props.image) this.markNoArt(cardId);
	};
	override render() {
		const {
			cardId, image, name, size, selected, back, playable, arrive, fanIndex, fanCount, dragging,
			pocket, onInspect,
		} = this.props;
		const src = image || (cardId ? cardArt(cardId, pocket ? { pocket: true } : undefined) : '');
		const cls = [
			'tcg-card', `tcg-card-${size || 'md'}`,
			selected ? 'tcg-card-selected' : '',
			back ? 'tcg-card-back' : '',
			this.props.onClick || this.props.onPointerDown || onInspect ? 'tcg-card-click' : '',
			playable ? 'tcg-card-playable' : '',
			arrive ? 'tcg-card-arrive' : '',
			this.props.incoming ? 'tcg-card-incoming' : '',
			dragging ? 'tcg-card-dragging' : '',
			fanCount ? 'tcg-card-fan' : '',
		].filter(Boolean).join(' ');
		const label = name || (cardId ? cardLabel(cardId) : '');
		const noArt = !back && !!cardId && !image && (this.state.noArt === cardId || !!noArtCards[cardId]);
		const mid = fanCount ? (fanCount - 1) / 2 : 0;
		const style = fanCount != null && fanIndex != null ? {
			'--fan': String(fanIndex - mid),
			zIndex: selected ? 30 : fanIndex + 1,
		} as any : undefined;
		return <button
			type="button" class={cls} style={style}
			onClick={onInspect || this.props.onClick ? this.onClick : undefined}
			onPointerDown={onInspect || this.props.onPointerDown ? this.onPointerDown : undefined}
			onPointerUp={this.onPointerUp}
			onPointerCancel={this.onPointerUp}
			onPointerMove={this.onPointerMove}
			onContextMenu={onInspect ? this.inspect : ev => ev.preventDefault()}
			title={label} aria-label={label || undefined} aria-pressed={selected}
		>
			<span class="tcg-card-inner">
				{back || !src ?
					<CardBackFace /> :
					noArt ?
						<NoArtFace cardId={cardId} label={label} /> :
						<img
							key={src}
							crossOrigin={scrydexUrl(src) ? 'anonymous' : undefined}
							src={src} alt={label} draggable={false}
							onLoad={this.onImgLoad} onError={this.onImgError}
						/>}
			</span>
		</button>;
	}
}

export class TcgMon extends preact.Component<{
	mon: TcgPokemonView | null, slot: TcgSlot, size?: CardSize, selected?: boolean,
	activeSpot?: boolean, legal?: boolean, foe?: boolean, pkFx?: PkFx | null,
	dropOk?: boolean, dropHot?: boolean, dropLabel?: string,
	reveal?: boolean, incoming?: boolean, landing?: number,
	onClick?: (ev: MouseEvent) => void, onInspect?: (p: Preview) => void,
	onAttachBrowse?: (mon: TcgPokemonView) => void,
	keyPick?: boolean, choiceFrom?: boolean,
}> {
	baseEl: HTMLElement | null = null;
	holdTimer: number | null = null;
	held = false;
	clearHold() {
		if (this.holdTimer != null) window.clearTimeout(this.holdTimer);
		this.holdTimer = null;
	}
	onPointerDown = (ev: PointerEvent) => {
		const mon = this.props.mon;
		if (!mon || !this.props.onInspect) return;
		if (ev.button != null && ev.button !== 0) return;
		this.held = false;
		this.clearHold();
		this.holdTimer = window.setTimeout(() => {
			this.holdTimer = null;
			this.held = true;
			this.props.onInspect?.({ cardId: mon.cardId, image: mon.image, name: mon.name });
		}, 420);
	};
	onPointerUp = () => {
		this.clearHold();
	};
	onClick = (ev: MouseEvent) => {
		if (this.held) {
			this.held = false;
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}
		this.props.onClick?.(ev);
	};

	hpEl: HTMLElement | null = null;
	hpFill: HTMLElement | null = null;
	hpRaf: number | null = null;
	writeHp(hp: number) {
		if (this.hpEl) this.hpEl.textContent = String(hp);
		const max = this.props.mon?.maxHp || 0;
		if (this.hpFill && max > 0) {
			const pct = Math.max(0, Math.min(100, (hp / max) * 100));
			this.hpFill.style.width = `${pct}%`;
		}
	}
	tweenHp(from: number, to: number) {
		if (from === to) return;
		if (tcgReduceMotion()) {
			this.writeHp(to);
			return;
		}
		if (!this.hpEl && !this.hpFill) return;
		if (this.hpRaf != null) cancelAnimationFrame(this.hpRaf);
		const start = performance.now();
		const dur = fxMs(780);
		this.hpEl?.classList.add(to < from ? 'hp-dropping' : 'hp-rising');
		this.writeHp(from);
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / dur);
			const e = 1 - (1 - t) ** 3;
			this.writeHp(Math.round(from + (to - from) * e));
			if (t < 1) {
				this.hpRaf = requestAnimationFrame(tick);
			} else {
				this.hpRaf = null;
				this.writeHp(to);
				this.hpEl?.classList.remove('hp-dropping', 'hp-rising');
			}
		};
		this.hpRaf = requestAnimationFrame(tick);
	}
	override componentWillUnmount() {
		if (this.hpRaf != null) cancelAnimationFrame(this.hpRaf);
		this.clearHold();
	}
	override componentDidUpdate(prev: this['props']) {
		if (prev.mon?.iid !== this.props.mon?.iid && this.hpRaf != null) {
			cancelAnimationFrame(this.hpRaf);
			this.hpRaf = null;
			this.hpEl?.classList.remove('hp-dropping', 'hp-rising');
		}
		if (prev.pkFx?.cls && !this.props.pkFx?.cls && this.hpRaf != null && this.props.mon) {
			cancelAnimationFrame(this.hpRaf);
			this.hpRaf = null;
			this.hpEl?.classList.remove('hp-dropping', 'hp-rising');
			this.writeHp(this.props.mon.hp);
		}
		if (prev.mon && prev.mon.iid === this.props.mon?.iid && prev.mon.hp !== this.props.mon.hp) {
			this.tweenHp(prev.mon.hp, this.props.mon.hp);
		} else if (this.props.mon && this.hpEl && this.hpRaf == null && this.hpEl.textContent !== String(this.props.mon.hp)) {
			this.hpEl.textContent = String(this.props.mon.hp);
		}
		const cur = this.props.pkFx;
		const was = prev.pkFx;
		if (!cur?.cls || !this.baseEl) return;
		if (cur.tick == null || cur.tick === was?.tick) return;
		const el = this.baseEl;
		const keepLunge = !!(cur.contact && was?.contact && /\bfx-lunge\b/.test(cur.cls) && /\bfx-lunge\b/.test(was.cls || ''));
		if (keepLunge) {
			if (cur.dataFx) el.setAttribute('data-fx', cur.dataFx);
			return;
		}
		const prevParts = (was?.cls || '').split(/\s+/).filter(Boolean);
		const parts = cur.cls.split(/\s+/).filter(Boolean);
		for (const part of prevParts) el.classList.remove(part);
		for (const part of parts) el.classList.remove(part);
		el.removeAttribute('data-fx');
		if (typeof el.getAnimations === 'function') {
			el.getAnimations().forEach(a => {
				if (a.id === 'tcg-lunge') return;
				a.cancel();
			});
		}
		el.style.animation = 'none';
		void el.offsetWidth;
		el.style.animation = '';
		for (const part of parts) el.classList.add(part);
		if (cur.dataFx) el.setAttribute('data-fx', cur.dataFx);
	}

	openAttachBrowse = (ev: MouseEvent) => {
		ev.preventDefault();
		ev.stopPropagation();
		const mon = this.props.mon;
		if (!mon || !this.props.onAttachBrowse) return;
		if (!attachedCardsOf(mon).length && !previousStagesOf(mon).length) return;
		this.props.onAttachBrowse(mon);
	};

	override render() {
		const {
			mon, selected, activeSpot, legal, foe, pkFx,
			dropOk, dropHot, dropLabel,
			onClick, onInspect, size,
		} = this.props;
		const cardSize: CardSize = size || (activeSpot ? 'lg' : 'sm');
		if (!mon) {
			return <div
				class={`tcg-mon empty ${activeSpot ? 'active' : ''} ${legal ? 'legal' : ''} ${selected ? 'selected' : ''} ${
					dropOk ? 'drop-ok' : ''
				} ${dropHot ? 'drop-hot' : ''}`}
				onClick={onClick}
				data-drop-slot={String(this.props.slot)}
				data-drop-foe={foe ? '1' : '0'}
				data-drop-empty="1"
			>
				<span>{activeSpot ? 'Active' : 'Bench'}</span>
				{dropHot && dropLabel && <em class="tcg-drop-tag">{dropLabel}</em>}
			</div>;
		}
		const pct = mon.maxHp ? Math.max(0, Math.min(100, (mon.hp / mon.maxHp) * 100)) : 0;
		const hpTone = pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low';
		if (mon.faceDown) {
			const incoming = this.props.incoming ? ' is-incoming' : '';
			return <div
				ref={el => { this.baseEl = el as HTMLElement | null; }}
				class={`tcg-mon face-down ${activeSpot ? 'active' : ''} ${foe ? 'foe' : ''} ${pkFx?.cls || ''}${incoming}`}
				data-iid={mon.iid}
				data-drop-slot={String(this.props.slot)}
				data-drop-foe={foe ? '1' : '0'}
				data-drop-empty="0"
				title="Face-down Pokémon"
				aria-label="Face-down Pokémon"
				onContextMenu={ev => ev.preventDefault()}
			>
				<TcgCardFace cardId="" name="Face-down Pokémon" size={cardSize} back />
			</div>;
		}
		const attached = attachedCardsOf(mon);
		const peeks = attachPeeksOf(attached, 3);
		const stageCount = previousStagesOf(mon).length;
		const toolCount = attached.filter(c => c.kind === 'tool').length;
		const specialCount = attached.filter(c => c.kind === 'special').length;
		const attachTitle = [
			attached.length ? `${attached.length} attached` : '',
			stageCount ? `${stageCount} previous stage${stageCount === 1 ? '' : 's'}` : '',
			specialCount ? `${specialCount} Special Energy` : '',
			toolCount ? `${toolCount} Tool` : '',
		].filter(Boolean).join(', ') + '. Click to view.';
		const cls = [
			'tcg-mon', activeSpot ? 'active' : '', foe ? 'foe' : '',
			selected ? 'selected' : '', legal ? 'legal' : '',
			dropOk ? 'drop-ok' : '', dropHot ? 'drop-hot' : '',
			attached.length ? 'has-attach' : '',
			toolCount ? 'has-tool' : '',
			specialCount ? 'has-special' : '',
			pkFx?.cls || '',
			this.props.reveal ? 'fx-reveal' : '',
			this.props.incoming ? 'is-incoming' : '',
			this.props.choiceFrom ? 'choice-from' : '',
		].filter(Boolean).join(' ');
		return <div
			ref={el => { this.baseEl = el as HTMLElement | null; }}
			class={cls}
			title={mon.name}
			aria-label={mon.name}
			{...(this.props.keyPick ? { 'tabIndex': 0, 'role': 'button', 'aria-pressed': selected ? 'true' : 'false' } : {})}
			onKeyDown={this.props.keyPick ? (ev: KeyboardEvent) => {
				if (ev.key !== 'Enter' && ev.key !== ' ') return;
				ev.preventDefault();
				this.props.onClick?.(ev as unknown as MouseEvent);
			} : undefined}
			onClick={this.onClick}
			onPointerDown={this.onPointerDown}
			onPointerUp={this.onPointerUp}
			onPointerCancel={this.onPointerUp}
			onContextMenu={ev => {
				ev.preventDefault();
				if (mon) this.props.onInspect?.({ cardId: mon.cardId, image: mon.image, name: mon.name });
			}}
			data-iid={mon.iid}
			data-fx={pkFx?.dataFx || undefined}
			data-fx-tick={pkFx?.tick != null ? String(pkFx.tick) : undefined}
			data-el={pkFx?.element || undefined}
			data-lunge-to={pkFx?.contact && pkFx.targetIid ? pkFx.targetIid : undefined}
			data-drop-slot={String(this.props.slot)}
			data-drop-foe={foe ? '1' : '0'}
			data-drop-empty="0"
		>
			{pkFx?.note && <span class="tcg-fx-note" key={`note${pkFx.tick ?? ''}`} aria-hidden="true">{pkFx.note}</span>}
			{attached.length > 0 && this.props.onAttachBrowse && <>
				<button
					type="button"
					class="tcg-attach-stack"
					title={attachTitle}
					aria-label={`Attached cards (${attached.length})${
						stageCount ? `, ${stageCount} previous stage${stageCount === 1 ? '' : 's'}` : ''
					}${toolCount ? `, ${toolCount} tool` : ''}${specialCount ? `, ${specialCount} special energy` : ''}`}
					onClick={this.openAttachBrowse}
					onPointerDown={(ev: any) => ev.stopPropagation()}
				>
					{peeks.map((a, i) =>
						<span
							key={`${a.kind}-${a.cardId}-${i}`}
							class={`tcg-attach-peek kind-${a.kind}`}
							data-card={a.cardId}
							style={{ '--i': String(i), '--n': String(peeks.length) } as any}
							aria-hidden="true"
						>
							<img
								src={cardArt(a.cardId) || cardBackArt()}
								alt=""
								draggable={false}
								onError={(ev: any) => {
									const img = ev?.currentTarget as HTMLImageElement | null;
									if (!img) return;
									const step = Number(img.dataset.fallback || '0');
									if (step < 1) {
										img.dataset.fallback = '1';
										img.src = paperTcgIoArt(a.cardId, false) || scrydexArt(a.cardId, false);
										return;
									}
									if (step < 2) {
										img.dataset.fallback = '2';
										img.src = scrydexArt(a.cardId, false) || cardBackArt();
										return;
									}
									if (step < 3) {
										img.dataset.fallback = '3';
										img.src = cardBackArt();
									}
								}}
							/>
						</span>
					)}
				</button>
				<em
					class={`tcg-attach-count${attached.length > (this.props.landing || 0) ? '' : ' is-incoming'}`}
					title={attachTitle}
					onClick={this.openAttachBrowse}
					onPointerDown={(ev: any) => ev.stopPropagation()}
				>{Math.max(0, attached.length - (this.props.landing || 0))}</em>
			</>}
			{attached.length === 0 && stageCount > 0 && this.props.onAttachBrowse &&
				<button
					type="button"
					class="tcg-evo-btn"
					title={attachTitle}
					aria-label={`Previous Evolution stages (${stageCount})`}
					onClick={this.openAttachBrowse}
					onPointerDown={(ev: any) => ev.stopPropagation()}
				><i class="fa fa-clone" aria-hidden="true"></i></button>}
			<TcgCardFace
				cardId={mon.cardId} image={mon.image} name={mon.name} size={cardSize}
				onClick={onClick} onInspect={onInspect}
			/>
			<div class={`tcg-hp ${hpTone}`} title={`${mon.hp} / ${mon.maxHp || mon.hp} HP`}>
				<span class="tcg-hp-val" ref={el => { this.hpEl = el as HTMLElement | null; }}>{mon.hp}</span>
				<span class="tcg-hp-track" aria-hidden="true">
					<span class="tcg-hp-fill" ref={el => { this.hpFill = el as HTMLElement | null; }} style={{ width: `${pct}%` }}></span>
				</span>
			</div>
			{((mon.energy || []).length > 0 || toolCount > 0) &&
				<div class="tcg-energy-row" aria-hidden="true">
					{(mon.energy || []).map((t, i) => pip(t, i))}
					{toolCount > 0 && <span
						class="tcg-tool-pip" title={toolCount === 1 ? 'Tool attached' : `${toolCount} Tools attached`}
					>T</span>}
				</div>}
			{statusBadges(mon).length > 0 &&
				<div class="tcg-status">
					{statusBadges(mon).map(b => <span key={b.id} class={b.id} title={b.title}>{b.label}</span>)}
				</div>}
			{pkFx?.moveName && pkFx?.moveTag &&
				<div
					class={`tcg-move-banner k-${pkFx.moveTag === 'Ability' ? 'ability' : 'attack'}`}
					aria-hidden="true"
				>
					<strong>{pkFx.moveTag}</strong>
					<em>{pkFx.moveName}</em>
				</div>}
			{pkFx?.status != null && <StatusBurst kind={pkFx.status} />}
			{pkFx?.element && !pkFx.energyType && /\bfx-hit\b/.test(pkFx.cls || '') &&
				<TypeHit type={pkFx.element} style={pkFx.hitStyle} tick={pkFx.tick} />}
			{pkFx?.energyType &&
				<span
					class={`tcg-energy-attach-fx t-${pkFx.energyType}`}
					aria-hidden="true"
				>
					<img src={energySymbolUrl(pkFx.energyType)} alt="" draggable={false} />
				</span>}
			{dropHot && dropLabel && <em class="tcg-drop-tag">{dropLabel}</em>}
		</div>;
	}
}

export class TcgPoints extends preact.Component<{ scored: number, need: number, pocket: boolean }> {
	override render() {
		const { scored, need, pocket } = this.props;
		const n = Math.max(need, 1);
		return <div
			class={`tcg-points ${pocket ? 'as-points' : 'as-prizes'}`}
			title={pocket ? `${scored} / ${n} points` : `${n - scored} prizes left`}
		>
			{Array.from({ length: n }, (_, i) =>
				<span class={`tcg-point ${i < scored ? 'on' : ''}`}></span>
			)}
			<small>{pocket ? `${scored}/${n}` : `${n - scored}`}</small>
		</div>;
	}
}

export class TcgPrizeRail extends preact.Component<{
	remaining: number, max: number, foe?: boolean,
	takes?: number[],
	picked?: number[],
	selected?: number[],
	takeActs?: TcgAction[], onTake?: (a: TcgAction) => void,
	prizeCards?: string[],
	onInspect?: (p: Preview) => void,
}> {
	override render() {
		const { remaining, max, foe, takeActs, onTake, takes, picked, selected, prizeCards, onInspect } = this.props;
		const n = Math.max(max, 1);
		const left = Math.max(0, Math.min(n, remaining));
		const slots = bindPrizeSlots(n, left, takes || [], picked || []);
		const shown = slots.filter(s => !s.taken).length;
		return <div class={`tcg-prizes ${foe ? 'foe' : 'me'}`} title={`${shown} Prize card${shown === 1 ? '' : 's'}`}>
			<strong class="tcg-prize-count">{shown}</strong>
			<div class="tcg-prize-stack">
				{slots.map(s => {
					const act = (!foe && !s.taken && s.serverIndex != null && takeActs) ?
						(takeActs.find(a => Number(a.index) === s.serverIndex) || null) : null;
					const cardId = (!s.taken && s.serverIndex != null && prizeCards) ? prizeCards[s.serverIndex] : undefined;
					const on = !s.taken && !!selected?.includes(s.slot);
					return <button
						type="button"
						key={s.slot}
						class={[
							'tcg-prize', s.taken ? 'taken' : 'up', act ? 'takeable' : '', on ? 'selected' : '', cardId ? 'has-card' : '',
						].filter(Boolean).join(' ')}
						disabled={!act && !cardId}
						onClick={act && onTake ? () => onTake(act) : (cardId && onInspect ? () => onInspect({ cardId }) : undefined)}
						aria-label={s.taken ? 'Taken' : `Prize ${s.slot + 1}`}
						aria-pressed={selected?.length ? on : undefined}
					>
						{cardId ? <TcgCardFace cardId={cardId} size="xs" onInspect={onInspect} /> : <CardBackFace />}
					</button>;
				})}
			</div>
		</div>;
	}
}
