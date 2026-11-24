/**
 * board choices the engine describes with choice metadata (WaveTCG docs/event-reference.md, `request`).
 * everything comes from the current snapshot and its legal rows, nothing is guessed from names. if the metadata
 * doesn't fully describe a choice, return null and the board keeps its older menu.
 * don't define a local `toID` here (see battle-tcg-deck.ts), babel turns this file into globals
 */

import type { TcgAction, TcgPokemonView, TcgSnapshot } from "./battle-tcg";

export interface TcgAttachedRef {
	iid: string;
	zone: 'energy' | 'tool';
	cardId: string;
	at: number[];
}

export interface TcgChoiceFrom {
	iid: string;
	cardIds?: string[];
}

export type TcgChoiceSlot = 'active' | number;

export interface BoardChoiceCard {
	row: TcgAction;
	ref: TcgAttachedRef;
}

export interface BoardChoiceSource {
	iid: string;
	seat: number;
	slot: TcgChoiceSlot;
	mon: TcgPokemonView;
	cards: BoardChoiceCard[];
}

export type BoardChoice = {
	kind: 'attached',
	/** changes whenever the offered rows change, a local selection under another key is stale */
	key: string,
	ask: string,
	from?: TcgChoiceFrom,
	sources: BoardChoiceSource[],
	done: TcgAction | null,
	picked: BoardChoiceSource | null,
} | {
	kind: 'slot',
	key: string,
	ask: string,
	from?: TcgChoiceFrom,
};

/** the client's own step: which pokemon's cards are open. never sent */
export interface BoardChoiceLocal {
	key: string;
	iid: string;
}

function isChoiceRef(v: any): v is TcgAttachedRef {
	return !!v && typeof v.iid === 'string' && (v.zone === 'energy' || v.zone === 'tool') &&
		typeof v.cardId === 'string' && Array.isArray(v.at) && v.at.length > 0 &&
		v.at.every((i: unknown) => Number.isInteger(i) && (i as number) >= 0);
}

export function findChoiceMon(
	snap: TcgSnapshot, iid: string
): { mon: TcgPokemonView, seat: number, slot: TcgChoiceSlot } | null {
	for (let seat = 0; seat < snap.players.length; seat++) {
		const p = snap.players[seat];
		if (!p) continue;
		if (p.active?.iid === iid) return { mon: p.active, seat, slot: 'active' };
		const bench = p.bench || [];
		for (let i = 0; i < bench.length; i++) {
			if (bench[i]?.iid === iid) return { mon: bench[i], seat, slot: i };
		}
	}
	return null;
}

function sourceWithIid(sources: BoardChoiceSource[], iid: string): BoardChoiceSource | null {
	for (const s of sources) if (s.iid === iid) return s;
	return null;
}

export function refCards(mon: TcgPokemonView, ref: TcgAttachedRef): string[] | null {
	const list = (ref.zone === 'energy' ? mon.energyCards : mon.tools) || [];
	const out: string[] = [];
	for (const i of ref.at) {
		if (list[i] !== ref.cardId) return null;
		out.push(list[i]);
	}
	return out;
}

function choiceFromOf(v: any): TcgChoiceFrom | undefined {
	if (!v || typeof v.iid !== 'string') return undefined;
	if (!Array.isArray(v.cardIds)) return { iid: v.iid };
	return { iid: v.iid, cardIds: v.cardIds.filter((x: unknown) => typeof x === 'string') };
}

/** `local` only counts under the same key and while it's still a source */
export function boardChoiceOf(
	snap: TcgSnapshot | null | undefined, local?: BoardChoiceLocal | null
): BoardChoice | null {
	if (snap?.you == null) return null;
	const acts = snap.actions || [];
	const copy = snap.pendingCopyAttack as ({ ask?: string, from?: unknown } | undefined);
	if (copy?.ask) {
		const rows = acts.filter(a => a.type === 'attack');
		const done = rows.find(a => a.pick === 'done' && !a.ref) || null;
		const picks = rows.filter(a => a !== done);
		if (!picks.length || !picks.every(a => isChoiceRef(a.ref))) return null;
		const sources: BoardChoiceSource[] = [];
		for (const row of picks) {
			const ref = row.ref as TcgAttachedRef;
			const at = findChoiceMon(snap, ref.iid);
			if (!at || !refCards(at.mon, ref)) return null;
			let src = sourceWithIid(sources, ref.iid);
			if (!src) {
				src = { iid: ref.iid, seat: at.seat, slot: at.slot, mon: at.mon, cards: [] };
				sources.push(src);
			}
			src.cards.push({ row, ref });
		}
		const key = `copy|${copy.ask}|${JSON.stringify(rows.map(a => [a.index, a.pick, a.ref || null]))}`;
		const picked = sources.length === 1 ? sources[0] :
			local?.key === key ? sourceWithIid(sources, local.iid) : null;
		return { kind: 'attached', key, ask: copy.ask, from: choiceFromOf(copy.from), sources, done, picked };
	}
	const slot = snap.pendingSlotPick as ({ ask?: string, from?: unknown } | undefined);
	if (slot?.ask && acts.some(a => a.type === 'pickSlot')) {
		const slots = acts.filter(a => a.type === 'pickSlot').map(a => a.slot);
		const key = `slot|${slot.ask}|${JSON.stringify([slot.from || null, slots])}`;
		return { kind: 'slot', key, ask: slot.ask, from: choiceFromOf(slot.from) };
	}
	return null;
}

export function choiceSourceFor(choice: BoardChoice | null, iid: string): BoardChoiceSource | null {
	if (choice?.kind !== 'attached' || !iid) return null;
	return sourceWithIid(choice.sources, iid);
}

export function choiceFromText(
	from: TcgChoiceFrom | undefined, monName: (iid: string) => string, cardName: (id: string) => string
): string {
	if (!from) return '';
	const mon = monName(from.iid);
	const cards = (from.cardIds || []).map(cardName).filter(Boolean);
	const what = cards.length > 1 && cards.every(c => c === cards[0]) ? `${cards.length}× ${cards[0]}` : cards.join(', ');
	if (what && mon) return `${what} from ${mon}`;
	if (mon) return `from ${mon}`;
	return what;
}

export interface ChoiceRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * `hard` boxes (the pokemon a picker belongs to) count for much more, so they only get covered when nothing else
 * fits
 */
export function pickClearSpot(
	cands: { x: number, y: number }[], w: number, h: number, avoid: ChoiceRect[], bounds: ChoiceRect,
	hard: ChoiceRect[] = [], pad = 6
): { x: number, y: number } {
	const area = (x: number, y: number, list: ChoiceRect[]) => {
		let n = 0;
		for (const r of list) {
			const ow = Math.min(r.right, x + w) - Math.max(r.left, x);
			const oh = Math.min(r.bottom, y + h) - Math.max(r.top, y);
			if (ow > 0 && oh > 0) n += ow * oh;
		}
		return n;
	};
	let best = { x: bounds.left + pad, y: bounds.top + pad };
	let bestScore = Infinity;
	for (const c of cands) {
		const x = Math.max(bounds.left + pad, Math.min(bounds.right - w - pad, c.x));
		const y = Math.max(bounds.top + pad, Math.min(bounds.bottom - h - pad, c.y));
		const score = area(x, y, hard) * 1000 + area(x, y, avoid);
		if (score < bestScore) {
			best = { x, y };
			bestScore = score;
		}
		if (score === 0) break;
	}
	return best;
}

function choiceOverlap(a: ChoiceRect, list: ChoiceRect[]): number {
	let n = 0;
	for (const r of list) {
		const w = Math.min(r.right, a.right) - Math.max(r.left, a.left);
		const h = Math.min(r.bottom, a.bottom) - Math.max(r.top, a.top);
		if (w > 0 && h > 0) n += w * h;
	}
	return n;
}

export function firstClearSpot(
	cands: { x: number, y: number }[], w: number, h: number, avoid: ChoiceRect[], bounds: ChoiceRect, pad = 6
): { x: number, y: number } | null {
	for (const c of cands) {
		const x = Math.max(bounds.left + pad, Math.min(bounds.right - w - pad, c.x));
		const y = Math.max(bounds.top + pad, Math.min(bounds.bottom - h - pad, c.y));
		if (x + w > bounds.right - pad + 0.5 || y + h > bounds.bottom - pad + 0.5) continue;
		if (!choiceOverlap({ left: x, top: y, right: x + w, bottom: y + h }, avoid)) return { x, y };
	}
	return null;
}

export interface ChoiceBarSize {
	size: { w: number, h: number };
	compact: { w: number, h: number };
	homeY: number;
	hudBottom: number | null;
}

export type PickerPlan =
	| { mode: 'anchored', x: number, y: number } |
	{ mode: 'strip', side: 'top' | 'bottom', x: number, y: number, w: number, h: number } |
	{ mode: 'panel', side: 'left' | 'right', x: number, y: number, w: number, h: number };

function choiceGap(halves: ChoiceRect[]): { top: number, bottom: number } | null {
	if (halves.length < 2) return null;
	const [a, b] = halves.slice().sort((x, y) => x.top - y.top);
	return b.top > a.bottom ? { top: a.bottom, bottom: b.top } : null;
}

/**
 * a strip or panel that covers `chrome` gets started below it instead. null if it covers none of it, or wouldn't
 * fit (a panel keeps at least `minH`)
 */
function sheetBelowChrome(
	s: PickerPlan, chrome: ChoiceRect[], bounds: ChoiceRect, minH: number, pad: number
): PickerPlan | null {
	if (s.mode === 'anchored') return null;
	const boxAt = (top: number) => ({
		left: s.x, top, right: s.x + s.w, bottom: s.mode === 'strip' ? top + s.h : bounds.bottom,
	});
	let top = s.y;
	for (let i = 0; i <= chrome.length; i++) {
		const box = boxAt(top);
		let below = -Infinity;
		for (const c of chrome) if (choiceOverlap(box, [c])) below = Math.max(below, c.bottom);
		if (below === -Infinity) break;
		top = below + pad;
	}
	if (top === s.y || choiceOverlap(boxAt(top), chrome)) return null;
	if (s.mode === 'strip') return top + s.h <= bounds.bottom ? { ...s, y: top } : null;
	return bounds.bottom - top >= minH ? { ...s, y: top, h: bounds.bottom - top } : null;
}

/**
 * wide screens try a picker next to `own`, in the gap between the halves, then level with it at either edge.
 * otherwise it's a sheet: a strip across the bottom/top or a panel down the right/left. first one that covers
 * nothing wins, else the one that covers least (`own` counts much more).
 * `chrome` (the opponent's plate, turn badge, timer) should stay visible too, but never wins over a pokemon on
 * offer. with `bar`, a layout that also leaves the bar a clear spot wins
 */
export function planChoicePicker(p: {
	bounds: ChoiceRect, own: ChoiceRect, others: ChoiceRect[], halves: ChoiceRect[],
	anchored: { w: number, h: number }, stripH: number, panelW: number, narrow: boolean,
	chrome?: ChoiceRect[], bar?: ChoiceBarSize,
}): PickerPlan {
	const { bounds, own, others, bar } = p;
	const chrome = p.chrome || [];
	const protect = [own, ...others];
	const W = bounds.right - bounds.left;
	const H = bounds.bottom - bounds.top;
	const pad = 6;
	const barFits = (box: ChoiceRect) =>
		!bar || planChoiceBar({ ...bar, bounds, avoid: [...protect, box], halves: p.halves, chrome }).clear;
	// clear of the pokemon and chrome but leaving the bar no clear spot, then clear of the pokemon only
	let crowdsBar: PickerPlan | null = null;
	let coversChrome: PickerPlan | null = null;
	if (!p.narrow) {
		const { w, h } = p.anchored;
		const gap = 8;
		const cx = (own.left + own.right) / 2 - w / 2;
		const cy = (own.top + own.bottom) / 2 - h / 2;
		const cands = [
			{ x: cx, y: own.top - h - gap },
			{ x: cx, y: own.bottom + gap },
			{ x: own.right + gap, y: cy },
			{ x: own.left - w - gap, y: cy },
			{ x: own.right + gap, y: own.top },
			{ x: own.left - w - gap, y: own.top },
		];
		const mid = choiceGap(p.halves);
		if (mid && mid.bottom - mid.top >= h + 2 * pad) {
			const y = (mid.top + mid.bottom) / 2 - h / 2;
			cands.push({ x: cx, y }, { x: bounds.left + W / 2 - w / 2, y });
			cands.push({ x: bounds.left + pad, y }, { x: bounds.right - w - pad, y });
		}
		cands.push({ x: bounds.right - w - gap, y: cy }, { x: bounds.left + gap, y: cy });
		for (const c of cands) {
			const spot = firstClearSpot([c], w, h, [...protect, ...chrome], bounds, pad);
			if (!spot) continue;
			if (barFits({ left: spot.x, top: spot.y, right: spot.x + w, bottom: spot.y + h })) {
				return { mode: 'anchored', ...spot };
			}
			if (!crowdsBar) crowdsBar = { mode: 'anchored', ...spot };
		}
		const near = chrome.length ? firstClearSpot(cands, w, h, protect, bounds, pad) : null;
		if (near) coversChrome = { mode: 'anchored', ...near };
	}
	const sheets: PickerPlan[] = [
		{ mode: 'strip', side: 'bottom', x: bounds.left, y: bounds.bottom - p.stripH, w: W, h: p.stripH },
		{ mode: 'strip', side: 'top', x: bounds.left, y: bounds.top, w: W, h: p.stripH },
		{ mode: 'panel', side: 'right', x: bounds.right - p.panelW, y: bounds.top, w: p.panelW, h: H },
		{ mode: 'panel', side: 'left', x: bounds.left, y: bounds.top, w: p.panelW, h: H },
	];
	for (const s of sheets.slice(1, 4)) {
		const below = sheetBelowChrome(s, chrome, bounds, p.stripH, pad);
		if (below) sheets.push(below);
	}
	// covers the fewest pokemon on offer (`own` much more), then the least chrome
	let best = sheets[0];
	let bestScore = Infinity;
	let bestChrome = Infinity;
	for (const s of sheets) {
		if (s.mode === 'anchored') continue;
		const box = { left: s.x, top: s.y, right: s.x + s.w, bottom: s.y + s.h };
		const score = choiceOverlap(box, [own]) * 1000 + choiceOverlap(box, others);
		const hidden = choiceOverlap(box, chrome);
		if (score < bestScore || (score === bestScore && hidden < bestChrome)) {
			best = s;
			bestScore = score;
			bestChrome = hidden;
		}
		if (score === 0 && hidden === 0) {
			if (barFits(box)) return s;
			if (!crowdsBar) crowdsBar = s;
		}
	}
	if (crowdsBar) return crowdsBar;
	// no sheet is clear of both, so a picker next to `own` that only covers chrome beats any sheet
	if (coversChrome && (bestScore > 0 || bestChrome > 0)) return coversChrome;
	return best;
}

/**
 * tries the gap between the halves, its usual spot (`homeY`), just below and above everything in `avoid`, under
 * the top bar and under `chrome`, each centered and at either side, then right beside each thing in `avoid`.
 * then all of that again in compact form. each spot is tried clear of `chrome` first. if nothing's clear, the
 * least covered spot at full size
 */
export function planChoiceBar(p: ChoiceBarSize & {
	bounds: ChoiceRect, avoid: ChoiceRect[], halves: ChoiceRect[], chrome?: ChoiceRect[],
}): { x: number, y: number, compact: boolean, clear: boolean } {
	const pad = 6;
	const W = p.bounds.right - p.bounds.left;
	const chrome = p.chrome || [];
	const mid = choiceGap(p.halves);
	const lowest = p.avoid.length ? Math.max(...p.avoid.map(r => r.bottom)) : null;
	const highest = p.avoid.length ? Math.min(...p.avoid.map(r => r.top)) : null;
	const spots = (w: number, h: number) => {
		const ys: number[] = [];
		if (mid) ys.push((mid.top + mid.bottom) / 2 - h / 2);
		ys.push(p.homeY);
		if (lowest != null) ys.push(lowest + pad);
		if (highest != null) ys.push(highest - h - pad);
		ys.push((p.hudBottom ?? p.bounds.top) + pad);
		if (chrome.length) ys.push(Math.max(...chrome.map(r => r.bottom)) + pad);
		const xs = [p.bounds.left + W / 2 - w / 2, p.bounds.left + pad, p.bounds.right - w - pad];
		const out: { x: number, y: number }[] = [];
		for (const y of ys) for (const x of xs) out.push({ x, y });
		// then right beside each thing in `avoid`, after all the spots above so they keep their order
		const beside: number[] = [];
		for (const r of p.avoid) beside.push(r.right + pad, r.left - w - pad);
		for (const y of ys) for (const x of beside) out.push({ x, y });
		return out;
	};
	const tiers = chrome.length ? [[...p.avoid, ...chrome], p.avoid] : [p.avoid];
	for (let i = 0; i < tiers.length; i++) {
		const clear = i === 0;
		const full = firstClearSpot(spots(p.size.w, p.size.h), p.size.w, p.size.h, tiers[i], p.bounds, pad);
		if (full) return { ...full, compact: false, clear };
		const small = firstClearSpot(spots(p.compact.w, p.compact.h), p.compact.w, p.compact.h, tiers[i], p.bounds, pad);
		if (small) return { ...small, compact: true, clear };
	}
	const spot = pickClearSpot(spots(p.size.w, p.size.h), p.size.w, p.size.h, p.avoid, p.bounds, [], pad);
	return { ...spot, compact: false, clear: false };
}

/**
 * Try centered spots before the sides, preferring full size before compact.
 * Avoid offered pokemon, then chrome, then hand, minimizing overlap with others.
 * Keep the bar centered as it grows.
 */
export function planPickBar(p: ChoiceBarSize & {
	bounds: ChoiceRect, avoid: ChoiceRect[], halves: ChoiceRect[], chrome: ChoiceRect[], soft: ChoiceRect[],
	hand?: ChoiceRect[],
}): { x: number, y: number, compact: boolean } {
	const pad = 6;
	const b = p.bounds;
	const hand = p.hand || [];
	const mid = choiceGap(p.halves);
	const mons = [...p.avoid, ...p.soft];
	const spots = (w: number, h: number) => {
		const ys: number[] = [];
		if (mid) ys.push((mid.top + mid.bottom) / 2 - h / 2);
		if (mons.length) {
			ys.push(Math.max(...mons.map(r => r.bottom)) + pad);
			ys.push(Math.min(...mons.map(r => r.top)) - h - pad);
		}
		ys.push(p.homeY, (p.hudBottom ?? b.top) + pad);
		if (p.chrome.length) ys.push(Math.max(...p.chrome.map(r => r.bottom)) + pad);
		if (p.avoid.length) {
			ys.push(Math.max(...p.avoid.map(r => r.bottom)) + pad);
			ys.push(Math.min(...p.avoid.map(r => r.top)) - h - pad);
		}
		const out: { x: number, y: number }[] = [];
		for (const x of [(b.left + b.right - w) / 2, b.left + pad, b.right - w - pad]) {
			for (const y of ys) out.push({ x, y });
		}
		return out;
	};
	// every spot in both forms, in order: spot 1 full, spot 1 compact, spot 2 full...
	const full = spots(p.size.w, p.size.h);
	const small = spots(p.compact.w, p.compact.h);
	const tries: { x: number, y: number, w: number, h: number, compact: boolean }[] = [];
	full.forEach((c, i) => {
		tries.push({ ...c, ...p.size, compact: false });
		tries.push({ ...small[i], ...p.compact, compact: true });
	});
	const placed = (t: typeof tries[0]) => {
		const x = Math.max(b.left + pad, Math.min(b.right - t.w - pad, t.x));
		const y = Math.max(b.top + pad, Math.min(b.bottom - t.h - pad, t.y));
		if (x + t.w > b.right - pad + 0.5 || y + t.h > b.bottom - pad + 0.5) return null;
		return { x, y, compact: t.compact, box: { left: x, top: y, right: x + t.w, bottom: y + t.h } };
	};
	const everything = [...p.avoid, ...p.chrome, ...hand, ...p.soft];
	for (const t of tries) {
		const at = placed(t);
		if (at && !choiceOverlap(at.box, everything)) return { x: at.x, y: at.y, compact: at.compact };
	}
	// nothing is clear of everything: keep clear of what's on offer (and the chrome, then the hand, while that can
	// be), covering least of the rest
	const steps: ChoiceRect[][][] = [
		[[...p.avoid, ...p.chrome, ...hand], p.soft],
		[[...p.avoid, ...p.chrome], [...hand, ...p.soft]],
		[p.avoid, [...p.chrome, ...hand, ...p.soft]],
	];
	for (const [hard, rest] of steps) {
		let best: { x: number, y: number, compact: boolean } | null = null;
		let least = Infinity;
		for (const t of tries) {
			const at = placed(t);
			if (!at || choiceOverlap(at.box, hard)) continue;
			const covered = choiceOverlap(at.box, rest);
			if (covered < least) {
				best = { x: at.x, y: at.y, compact: at.compact };
				least = covered;
			}
		}
		if (best) return best;
	}
	const spot = pickClearSpot(spots(p.compact.w, p.compact.h), p.compact.w, p.compact.h, p.avoid, b, [], pad);
	return { ...spot, compact: true };
}
