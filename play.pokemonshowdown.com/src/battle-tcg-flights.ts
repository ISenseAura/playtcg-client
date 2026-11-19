import {
	type TcgEvent,
	type TcgPlayerView,
	type TcgSlot,
	findMonView,
} from "./battle-tcg-types";
import { lookupAttackHit } from "./battle-tcg-attack-fx";

export type Preview = { cardId: string, image?: string, name?: string, handAt?: number };

export type HitStyle =
	| 'impact' | 'slash' | 'barrage' | 'beam' | 'flame' | 'torrent'
	| 'bolt' | 'zap' | 'bloom' | 'pulse' | 'quake' | 'veil' | 'shard'
	| 'sparkle' | 'roar' | 'whirl' | 'drain'
	| 'frost' | 'stream' | 'sting' | 'powder' | 'wave' | 'petal' | 'bite'
	| 'bubble' | 'sonic' | 'mud' | 'wrap' | 'note' | 'aura' | 'drill'
	| 'acid' | 'wisp' | 'meteor' | 'wing'
	| 'swift' | 'gold' | 'daze' | 'sand' | 'lick' | 'bone' | 'ink' | 'tri' | 'fist' | 'shade'
	| 'kick' | 'chop' | 'rage' | 'shell' | 'kiss' | 'gyro' | 'breath' | 'cannon' | 'fall' | 'iron'
	| 'boom' | 'web' | 'tail' | 'arrow' | 'sleep' | 'shield';

export type FxHit = {
	iid: string,
	amount?: number,
	kind: 'damage' | 'heal' | 'status' | 'counters' | 'prevented' | 'reduced' | 'moved',
	src?: string,
	label?: string,
	element?: string,
	status?: string,
	note?: string,
	counters?: number,
	fromMon?: string,
	fromIid?: string,
	hitStyle?: HitStyle,
	travel?: boolean,
};

export type FxBeat = {
	kind: string,
	tag?: string,
	iid?: string,
	targetIid?: string,
	fromIid?: string,
	seat?: number,
	amount?: number,
	n?: number,
	extra?: string,
	message?: string,
	cardId?: string,
	fromCardId?: string,
	src?: string,
	onto?: string,
	ontoId?: string,
	ids?: string[],
	labels?: string[],
	hits?: FxHit[],
	coins?: boolean[],
	tie?: boolean,
	element?: string,
	hitStyle?: HitStyle,
	travel?: boolean,
	contact?: boolean,
	announce?: boolean,
	targets?: string[],
	status?: string,
	slot?: TcgSlot,
	fromBench?: boolean,
	moveFrom?: FlightZoneKind,
	moveTo?: FlightZoneKind,
	pile?: 'discard',
	koDiscard?: boolean,
	perSeat?: { n: number, ids?: string[] }[],
	wholeMon?: boolean,
	action?: string,
};

export type FlightZoneKind = 'hand' | 'deck' | 'discard' | 'lost' | 'prizes' | 'zone' | 'mon';

export type AttackCtx = {
	iid: string,
	src: string,
	label: string,
	element: string,
	style?: HitStyle,
	travel?: boolean,
	contact?: boolean,
};

export type FlightZone = { zone: FlightZoneKind, seat: number, iid?: string, part?: 'attach' };

export type CardFlight = { from: FlightZone, to: FlightZone, cardId: string, delay: number, land?: 'energy' | 'tool' };

export function cardFlights(fx: FxBeat | null | undefined): CardFlight[] {
	if (!fx) return [];
	if ((fx.kind === 'deal' || fx.kind === 'prizeSet') && fx.perSeat) {
		const out: CardFlight[] = [];
		fx.perSeat.forEach((side, s) => {
			const count = Math.max(0, Math.min(side.n || 0, 5));
			for (let k = 0; k < count; k++) {
				out.push({
					from: { zone: 'deck', seat: s },
					to: { zone: fx.kind === 'deal' ? 'hand' : 'prizes', seat: s },
					cardId: fx.kind === 'deal' ? side.ids?.[k] || '' : '',
					delay: k * 70,
				});
			}
		});
		return out;
	}
	const seat = fx.seat;
	if (seat !== 0 && seat !== 1) return [];
	const zone = (kind: FlightZoneKind | undefined, iid?: string, part?: 'attach'): FlightZone | null => {
		if (!kind) return null;
		if (kind === 'mon') return iid ? { zone: 'mon', seat, iid, ...(part ? { part } : {}) } : null;
		return { zone: kind, seat };
	};
	const many = (from: FlightZone | null, to: FlightZone | null, n: number, ids?: string[]): CardFlight[] => {
		if (!from || !to) return [];
		const count = Math.max(1, Math.min(n, 5));
		return Array.from({ length: count }, (_, i) => ({ from, to, cardId: ids?.[i] || '', delay: i * 70 }));
	};
	switch (fx.kind) {
	case 'draw': case 'drawEffect':
		return many(zone('deck'), zone('hand'), fx.n || 1, fx.ids);
	case 'find':
		if (fx.moveTo !== 'hand' || !fx.moveFrom) return [];
		return many(zone(fx.moveFrom, fx.fromIid, fx.wholeMon ? undefined : 'attach'), zone('hand'), fx.n || 1, fx.ids);
	case 'prizeTake':
		return many(zone('prizes'), zone('hand'), fx.n || 1, fx.ids);
	case 'discard': {
		if (fx.moveFrom !== 'mon') return many(zone(fx.moveFrom, fx.fromIid), zone(fx.moveTo), fx.n || 1, fx.ids);
		const out = many(zone('mon', fx.fromIid, 'attach'), zone(fx.moveTo), fx.n || 1, fx.ids);
		if (fx.koDiscard && out.length) out[0] = { ...out[0], from: { zone: 'mon', seat, iid: fx.fromIid } };
		return out;
	}
	case 'energy': case 'tool': {
		if (!fx.iid) return [];
		const from = fx.fromIid ? zone('mon', fx.fromIid, 'attach') : zone(fx.moveFrom || 'hand');
		const out = many(from, zone('mon', fx.iid, 'attach'), 1, fx.cardId ? [fx.cardId] : undefined);
		return out.map(fl => ({ ...fl, land: fx.kind as 'energy' | 'tool' }));
	}
	case 'place':
		if (!fx.iid || !fx.moveFrom) return [];
		return many(zone(fx.moveFrom), zone('mon', fx.iid), 1, fx.cardId ? [fx.cardId] : undefined);
	default:
		return [];
	}
}

export function attachOrigin(events: TcgEvent[], i: number): FlightZoneKind {
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) break;
		if (p.type === 'act') {
			const t = p.action?.type;
			if (t === 'attachZone') return 'zone';
			return 'hand';
		}
		if (p.type === 'fromDiscard') return 'discard';
		if (p.type === 'fromHand') return 'hand';
		if (p.type === 'find' && (p.dest === 'attach' || p.dest === 'attach-active')) {
			return p.from === 'prizes' ? 'prizes' : 'deck';
		}
		if (p.type === 'energy' || p.type === 'tool') continue;
		if (p.type === 'fromDeck') return 'deck';
	}
	return 'hand';
}

export function placedFromDeck(events: TcgEvent[], i: number, seat: unknown): boolean {
	for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
		const p = events[j];
		if (p?.type === 'find' && p.dest === 'bench' && p.seat === seat) return true;
		if (p?.type === 'act') break;
	}
	return false;
}

export function isHitEvent(t: string): boolean {
	return t === 'damage' || t === 'heal' || t === 'status' || t === 'noDamage' || t === 'prevent' || t === 'moveCounters';
}

export function weaknessNote(calc?: { steps?: { stage?: string, op?: string, value?: number }[] }): string {
	const out: string[] = [];
	for (const st of calc?.steps || []) {
		const v = Number(st.value) || 0;
		if (st.stage === 'weakness') out.push(st.op === 'multiply' ? `Weakness ×${v}` : `Weakness +${v}`);
		else if (st.stage === 'resistance') out.push(`Resistance −${Math.abs(v)}`);
	}
	return out.join(', ');
}

declare const statusWord: (s: string | null | undefined) => string;
declare const cardLabel: (id?: string) => string;

export function hitFromEvent(
	n: TcgEvent,
	ctx: { src: string, label: string, element: string, fromIid?: string, style?: HitStyle, travel?: boolean }
): FxHit | null {
	const base = { src: ctx.src, label: ctx.label, fromIid: ctx.fromIid, hitStyle: ctx.style, travel: ctx.travel };
	const counters = (amount: unknown) => Math.max(1, Math.round((Number(amount) || 0) / 10));
	const by = (p?: { source?: { name?: string } }) => p?.source?.name || '';
	if (n.type === 'damage') {
		if (n.counters) {
			return {
				...base, iid: String(n.iid || ''), amount: n.amount, kind: 'counters', counters: counters(n.amount),
				element: ctx.element || 'colorless',
			};
		}
		const note = weaknessNote(n.calc);
		return {
			...base, iid: String(n.iid || ''), amount: n.amount, kind: 'damage', element: ctx.element || 'colorless',
			...(note ? { note } : {}),
		};
	}
	if (n.type === 'heal') return { ...base, iid: String(n.iid || ''), amount: n.amount, kind: 'heal' };
	if (n.type === 'status') {
		const wordFn = typeof statusWord === 'function' ? statusWord : (s: any) => String(s || '');
		return {
			iid: String(n.iid || ''), kind: 'status', src: ctx.src,
			status: n.status == null ? '' : String(n.status).toLowerCase(),
			label: n.status ? wordFn(String(n.status)) : 'Recovered',
		};
	}
	if (n.type === 'noDamage') {
		const stopped = by(n.prevention);
		const prevented = n.outcome === 'prevented';
		return {
			...base, iid: String(n.iid || ''), amount: 0, kind: prevented ? 'prevented' : 'reduced',
			note: prevented ? (stopped ? `Prevented by ${stopped}` : 'Prevented') : 'No damage',
		};
	}
	if (n.type === 'prevent') {
		const wordFn = typeof statusWord === 'function' ? statusWord : (s: any) => String(s || '');
		const what = n.what === 'heal' ? 'Heal' :
			n.what === 'status' ? (n.status ? wordFn(String(n.status)) : 'Condition') :
			n.what === 'moveCounters' ? 'Move' : 'Effects';
		const stopped = by(n.prevention);
		return {
			...base, iid: String(n.iid || ''), kind: 'prevented', note: `${what} prevented${stopped ? ` by ${stopped}` : ''}`,
		};
	}
	if (n.type === 'moveCounters') {
		return {
			...base, iid: String(n.iid || ''), amount: n.amount, kind: 'moved', counters: counters(n.amount), fromMon: n.fromIid,
		};
	}
	return null;
}

export function visibleHit(h: FxHit): boolean {
	return !((h.kind === 'damage' || h.kind === 'heal') && !(h.amount || 0));
}

export function aimedHit(h: FxHit, attacker?: string): boolean {
	return h.iid !== attacker && h.kind !== 'heal' && h.kind !== 'moved' && h.kind !== 'status' && visibleHit(h);
}

export function clusterSkip(t: string): boolean {
	return t === 'request' || t === 'act' || t === 'coin' || isHitEvent(t);
}

export function afterKind(events: TcgEvent[], i: number, kind: string): boolean {
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) return false;
		const t = String(p.type || '');
		if (t === kind) return true;
		if (t === 'coin') return false;
		if (clusterSkip(t)) continue;
		return false;
	}
	return false;
}

export function energyElement(raw?: string): string {
	const t = String(raw || '').toLowerCase();
	if (t === 'electric' || t === 'lightning') return 'lightning';
	if (t === 'steel' || t === 'metal') return 'metal';
	if (t === 'dark' || t === 'darkness') return 'darkness';
	if (t === 'normal' || t === 'colorless') return 'colorless';
	if ([
		'grass', 'fire', 'water', 'psychic', 'fighting', 'fairy', 'dragon',
	].includes(t)) return t;
	return '';
}

export function attackElement(e: TcgEvent, players?: TcgPlayerView[]): string {
	const fromEvent = energyElement(e.element || e.energyType || e.attackType || e.dmgType);
	if (fromEvent) return fromEvent;
	const mon = findMonView(players, e.iid);
	const fromMon = energyElement(mon?.types?.[0]);
	if (fromMon) return fromMon;
	const named = (mon as any)?.attacks?.find((a: any) => a.name && e.name && a.name === e.name);
	const paid = named?.cost?.map(energyElement).find((c: string) => c && c !== 'colorless');
	return paid || 'colorless';
}

export const HIT_TRAVEL: { [k in HitStyle]?: boolean } = {
	beam: true, flame: true, torrent: true, bolt: true, zap: true, bloom: true, pulse: true,
	veil: true, sparkle: true, roar: true, whirl: true, drain: true, shard: true,
	frost: true, stream: true, sting: true, powder: true, wave: true, petal: true,
	bubble: true, sonic: true, mud: true, note: true, aura: true,
	acid: true, wisp: true, meteor: true,
	swift: true, gold: true, daze: true, sand: true, bone: true, ink: true,
	tri: true, shade: true, kiss: true, breath: true, cannon: true,
	boom: true, web: true, arrow: true, sleep: true,
};

export const HIT_TYPE_DEFAULT: { [type: string]: HitStyle } = {
	fire: 'flame', water: 'torrent', lightning: 'bolt', grass: 'bloom',
	psychic: 'pulse', fighting: 'quake', darkness: 'veil', metal: 'shard',
	fairy: 'sparkle', dragon: 'roar', colorless: 'impact',
};

export function resolveHitStyle(name?: string, element?: string): { style: HitStyle, travel: boolean } {
	const mapped = typeof lookupAttackHit === 'function' ? lookupAttackHit(String(name || '')) : undefined;
	if (mapped) return { style: mapped as HitStyle, travel: !!HIT_TRAVEL[mapped as HitStyle] };
	const el = energyElement(element) || String(element || '').toLowerCase() || 'colorless';
	const style = HIT_TYPE_DEFAULT[el] || 'impact';
	return { style, travel: !!HIT_TRAVEL[style] };
}

export function attackHits(events: TcgEvent[], i: number, players?: TcgPlayerView[]): FxHit[] {
	const start = events[i];
	if (!start || (start.type !== 'attack' && start.type !== 'ability')) return [];
	const src = start.type === 'ability' ? 'ability' : 'attack';
	const label = start.name || (src === 'ability' ? 'Ability' : 'Attack');
	const element = src === 'attack' ? attackElement(start, players) :
		(energyElement(start.element) || '');
	const resolved = resolveHitStyle(label, element || 'psychic');
	const ctx = { src, label, element, fromIid: start.iid, style: resolved.style, travel: resolved.travel };
	const hits: FxHit[] = [];
	for (let j = i + 1; j < events.length; j++) {
		const n = events[j];
		if (!n) break;
		const t = String(n.type || '');
		if (t === 'request' || t === 'act') continue;
		if (t === 'coin' || !isHitEvent(t)) break;
		const h = hitFromEvent(n, ctx);
		if (h) hits.push(h);
	}
	return hits;
}

export function attackHitIndexes(events: TcgEvent[], i: number): number[] {
	const out: number[] = [];
	for (let j = i + 1; j < events.length; j++) {
		const t = events[j]?.type;
		if (t === 'request' || t === 'act') continue;
		if (t === 'coin') break;
		if (isHitEvent(String(t || ''))) out.push(j);
		else break;
	}
	return out;
}

export function effectCause(
	events: TcgEvent[],
	i: number,
	players?: TcgPlayerView[]
): { kind: string, name: string, cardId?: string } | null {
	const e = events[i];
	if (!e) return null;
	const labelFn = typeof cardLabel === 'function' ? cardLabel : (id?: string) => id || 'a card';
	if (e.source?.kind && e.source.kind !== 'turn' && e.source.kind !== 'play' && e.source.kind !== 'checkup') {
		const name = e.source.name || (e.source.cardId ? labelFn(e.source.cardId) : '');
		if (name) return { kind: e.source.kind, name, cardId: e.source.cardId };
	}
	for (let j = i - 1; j >= 0; j--) {
		const p = events[j];
		if (!p) return null;
		const t = String(p.type || '');
		if (t === 'request' || t === 'act' || t === 'coin') continue;
		if (t === 'draw' || t === 'find' || t === 'reveal') continue;
		if (t === 'damage' || t === 'heal' || t === 'status' || t === 'ko' || t === 'place') continue;
		if (t === 'shuffle' || t === 'toDiscard' || t === 'toLost' || t === 'fromDiscard') continue;
		if (t === 'turn' || t === 'deal' || t === 'checkup' || t === 'first' || t === 'start' || t === 'over') {
			return null;
		}
		if (t === 'trainer' || t === 'stadium') {
			return { kind: t, name: labelFn(p.cardId), cardId: p.cardId || undefined };
		}
		if (t === 'attack' || t === 'ability') {
			const mon = findMonView(players, p.iid);
			return {
				kind: t,
				name: p.name || (t === 'ability' ? 'Ability' : 'Attack'),
				cardId: mon?.cardId || undefined,
			};
		}
		if (t === 'energy' || t === 'tool') {
			return { kind: t, name: labelFn(p.cardId), cardId: p.cardId || undefined };
		}
		return null;
	}
	return null;
}

export function drawCause(
	events: TcgEvent[],
	i: number,
	players?: TcgPlayerView[]
): { kind: string, name: string, cardId?: string } | null {
	if (events[i]?.type !== 'draw') return null;
	return effectCause(events, i, players);
}

export function pickedFromDiscard(events: readonly TcgEvent[], i: number): boolean {
	const e = events[i];
	const next = events[i + 1];
	if (e?.type !== 'find' || e.from || e.iid || (e.dest && e.dest !== 'hand')) return false;
	if (next?.type !== 'fromDiscard' || next.seat !== e.seat) return false;
	const ids = (x: TcgEvent) => (Array.isArray(x.ids) ? x.ids.filter(Boolean) : []).join('|');
	return !!ids(e) && ids(e) === ids(next);
}

export function skipEvent(events: TcgEvent[], i: number): boolean {
	const e = events[i];
	if (!e) return true;
	if (e.type === 'fromHand' || e.type === 'gameEnd' || e.type === 'field' || e.type === 'hp' ||
		e.type === 'energyZone') return true;
	if (pickedFromDiscard(events, i)) return true;
	if (e.type === 'prize') return true;
	const shown = e.kind === 'search' || e.kind === 'mulligan' || e.kind === 'mulliganDraw';
	if (e.type === 'request') return !shown;
	if (e.type === 'act') {
		const t = e.action?.type;
		return t !== 'chooseFirst' && t !== 'discardPick' && t !== 'searchDone' && t !== 'mulliganDraw';
	}
	return false;
}
