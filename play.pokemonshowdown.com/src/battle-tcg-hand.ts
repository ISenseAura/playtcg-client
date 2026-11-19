import { handAsIds, type TcgPlayerView } from "./battle-tcg-types";

export function handFan(
	committed: string[] | null,
	viewHand: TcgPlayerView['hand'] | undefined
): { id: string, i: number, arrive: boolean }[] | null {
	const viewIds = handAsIds(viewHand ?? null);
	if (!committed) {
		return viewIds?.length ? viewIds.map(id => ({ id, i: -1, arrive: true })) : null;
	}
	if (!viewIds) return committed.map((id, i) => ({ id, i, arrive: false }));
	const pool = viewIds.slice();
	const kept: { id: string, i: number, arrive: boolean }[] = [];
	for (let i = 0; i < committed.length; i++) {
		const at = pool.indexOf(committed[i]);
		if (at < 0) continue;
		pool.splice(at, 1);
		kept.push({ id: committed[i], i, arrive: false });
	}
	const gained = pool.map(id => ({ id, i: -1, arrive: true }));
	const fan = kept.concat(gained);
	return fan.length ? fan : null;
}

export type HandGone = { id: string, pos: number, at: number };

export function reconcileHandOrder(
	prev: string[], hand: string[], gone: HandGone[] = []
): { order: string[], left: HandGone[] } {
	const want: { [id: string]: number } = Object.create(null);
	for (const id of hand) {
		want[id] = (want[id] || 0) + 1;
	}
	const order = prev.slice();
	const countOf = (list: string[], id: string) => {
		let n = 0;
		for (const item of list) if (item === id) n++;
		return n;
	};
	const left: HandGone[] = [];
	const sortedGone = gone.slice().sort((a, b) => b.pos - a.pos);
	for (const g of sortedGone) {
		if (order[g.pos] === g.id && countOf(order, g.id) > (want[g.id] || 0)) {
			order.splice(g.pos, 1);
		} else {
			left.push(g);
		}
	}
	for (let i = order.length - 1; i >= 0; i--) {
		if (countOf(order, order[i]) > (want[order[i]] || 0)) {
			order.splice(i, 1);
		}
	}
	const have: { [id: string]: number } = Object.create(null);
	for (const id of order) {
		have[id] = (have[id] || 0) + 1;
	}
	for (const id of hand) {
		if (have[id] > 0) have[id]--;
		else order.push(id);
	}
	return { order, left };
}

export function orderHandFan<T extends { id: string }>(fan: T[], order: string[]): T[] {
	const used = fan.map(() => false);
	const out: T[] = [];
	for (const id of order) {
		for (let j = 0; j < fan.length; j++) {
			if (used[j] || fan[j].id !== id) continue;
			used[j] = true;
			out.push(fan[j]);
			break;
		}
	}
	for (let j = 0; j < fan.length; j++) {
		if (!used[j]) out.push(fan[j]);
	}
	return out;
}

export function moveHandOrder(order: string[], from: number, to: number): string[] {
	if (from < 0 || from >= order.length) return order;
	const target = Math.max(0, Math.min(order.length - 1, to));
	if (from === target) return order;
	const next = order.slice();
	const [item] = next.splice(from, 1);
	next.splice(target, 0, item);
	return next;
}

export const HAND_ORDER_KEY = 'tcg-hand-order';

export function readHandOrder(game: string): string[] | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(`${HAND_ORDER_KEY}:${game}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function writeHandOrder(game: string, order: string[]) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(`${HAND_ORDER_KEY}:${game}`, JSON.stringify(order));
	} catch {}
}

/**
 * phone portrait and short landscape phones, wider layouts keep the fan. a landscape phone is often wider than
 * 640px but shorter than 520px
 */
export const HAND_STRIP_QUERY = '(max-width: 640px), (max-height: 520px) and (orientation: landscape)';

export function handEdgeFlags(
	scrollLeft: number, clientWidth: number, scrollWidth: number, pad = 6
): { left: boolean, right: boolean } {
	if (scrollWidth <= clientWidth + pad) return { left: false, right: false };
	return {
		left: scrollLeft > pad,
		right: scrollLeft + clientWidth < scrollWidth - pad,
	};
}

export function handScrollToReveal(left: number, right: number, viewLeft: number, viewRight: number, pad = 8): number {
	if (right > viewRight - pad) return right - (viewRight - pad);
	if (left < viewLeft + pad) return left - (viewLeft + pad);
	return 0;
}

export function handWheelTarget(
	deltaX: number,
	deltaY: number,
	scrollLeft: number,
	clientWidth: number,
	scrollWidth: number
): number | null {
	if (scrollWidth <= clientWidth) return null;
	if (Math.abs(deltaX) > Math.abs(deltaY)) return null;
	const maxScroll = scrollWidth - clientWidth;
	if (scrollLeft >= maxScroll && deltaY > 0) return null;
	if (scrollLeft <= 0 && deltaY < 0) return null;
	const next = scrollLeft + deltaY;
	return Math.max(0, Math.min(maxScroll, next));
}
