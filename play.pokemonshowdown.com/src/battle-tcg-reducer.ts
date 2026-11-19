import {
	type TcgAction,
	type TcgEvent,
	type TcgPlayerView,
	type TcgPokemonView,
	type TcgSlot,
	type TcgSnapshot,
	cloneTcgSnapshot,
	energyPipsFromEvent,
	energyTypeFromCardId,
	findMonSlot,
	handAsIds,
	normalizeTcgEnergy,
	placeSlotOf,
	cardKind,
	energyCategory,
} from "./battle-tcg-types";
import {
	filterTcgEventsForViewer,
	scrubTcgSpectatorView,
} from "./battle-tcg-protocol";

type SearchDest = NonNullable<NonNullable<TcgSnapshot['pendingSearch']>['dest']>;
// the request event types `dest` as a string. the engine fills it from the search prompt, which uses these
const SEARCH_DESTS: SearchDest[] = [
	'hand', 'bench', 'top', 'deck', 'attach-active', 'discard', 'lost', 'replace-active',
];

export function setHand(p: TcgPlayerView, hand: string[] | { count: number }) {
	p.hand = hand;
}

export function removeHandIndex(p: TcgPlayerView, index: number) {
	const ids = handAsIds(p.hand);
	if (ids && index >= 0 && index < ids.length) {
		ids.splice(index, 1);
		setHand(p, ids);
		return;
	}
	if (!Array.isArray(p.hand) && p.hand && typeof p.hand.count === 'number' && p.hand.count > 0) {
		p.hand = { count: p.hand.count - 1 };
	}
}

export function bumpPile(pile: { count: number } | undefined, delta: number): { count: number } {
	return { count: Math.max(0, (pile?.count || 0) + delta) };
}

export function takeIds(list: string[] | undefined, ids: string[]): string[] {
	const left = (list || []).slice();
	for (const id of ids) {
		const at = left.indexOf(id);
		if (at >= 0) left.splice(at, 1);
	}
	return left;
}

export function removeHandIds(p: TcgPlayerView, ids: string[]) {
	const hand = handAsIds(p.hand);
	if (hand) {
		setHand(p, takeIds(hand, ids));
		return;
	}
	if (p.hand && !Array.isArray(p.hand) && typeof p.hand.count === 'number') p.hand = bumpPile(p.hand, -ids.length);
}

function isBasicEnergyId(id: string): boolean {
	return energyCategory(id) === 'basic';
}

export function partitionEnergyPips(cards: string[], pips: string[]): string[][] | null {
	if (pips.length === cards.length) return pips.map(p => [p]);
	const groups: string[][] = [];
	let i = 0;
	for (let c = 0; c < cards.length; c++) {
		const id = cards[c];
		if (isBasicEnergyId(id)) {
			if (i >= pips.length) return null;
			groups.push([pips[i]]);
			i++;
			continue;
		}
		const nextBasic = cards.slice(c + 1).find(isBasicEnergyId);
		const take: string[] = [];
		if (!nextBasic) {
			while (i < pips.length) take.push(pips[i++]);
		} else {
			const want = energyTypeFromCardId(nextBasic);
			while (i < pips.length && pips[i] === 'colorless') take.push(pips[i++]);
			if (i < pips.length && pips[i] !== want) return null;
		}
		if (!take.length) return null;
		groups.push(take);
	}
	if (i !== pips.length || groups.length !== cards.length) return null;
	return groups;
}

export function detachPlayedCards(mon: TcgPokemonView, ids: string[], atIndex?: number) {
	if (mon.energyCards?.length) {
		const cards = mon.energyCards.slice();
		const pips = (mon.energy || []).slice();
		const groups = partitionEnergyPips(cards, pips);
		let preferred = atIndex;
		for (const id of ids) {
			let at = -1;
			if (preferred != null && preferred >= 0 && preferred < cards.length && cards[preferred] === id) {
				at = preferred;
				preferred = undefined;
			} else {
				at = cards.indexOf(id);
			}
			if (at < 0) continue;
			cards.splice(at, 1);
			if (groups) groups.splice(at, 1);
		}
		mon.energyCards = cards;
		const flattenedGroups: string[] = [];
		if (groups) {
			for (const g of groups) {
				for (const item of g) flattenedGroups.push(item);
			}
		}
		mon.energy = groups ? flattenedGroups : cards.map(id => energyTypeFromCardId(id));
	}
	if (mon.tools?.length) mon.tools = takeIds(mon.tools, ids);
}

export function stubMon(e: TcgEvent): TcgPokemonView {
	const hp = e.hp != null ? Number(e.hp) : 0;
	return {
		iid: String(e.iid || ''),
		cardId: e.cardId || '',
		name: e.name || e.cardId || 'Pokémon',
		hp,
		maxHp: e.maxHp != null ? Number(e.maxHp) : hp,
		types: Array.isArray(e.types) ? e.types : [],
		energy: [],
		energyCards: [],
		tools: [],
		faceDown: !!e.faceDown,
	};
}

export function applyPlace(p: TcgPlayerView, slot: TcgSlot, mon: TcgPokemonView) {
	if (slot === 'active') {
		if (p.active?.iid === mon.iid) return;
	} else {
		const at = Number(slot);
		if (Number.isFinite(at) && at >= 0 && p.bench?.[at]?.iid === mon.iid) return;
	}
	const fromBench = (p.bench || []).findIndex(m => m?.iid === mon.iid);
	const wasActive = p.active?.iid === mon.iid;
	const oldActive = p.active && p.active.iid !== mon.iid ? p.active : null;
	dropMonByIid(p, mon.iid);
	if (slot === 'active') {
		p.active = mon;
		if (oldActive) {
			if (fromBench >= 0) p.bench.splice(fromBench, 0, oldActive);
			else p.bench.push(oldActive);
		}
		return;
	}
	const i = Number(slot);
	if (!Number.isFinite(i) || i < 0) {
		p.bench.push(mon);
		return;
	}
	if (wasActive && i < p.bench.length && p.bench[i]) {
		p.active = p.bench[i];
		p.bench[i] = mon;
		return;
	}
	if (i >= p.bench.length) p.bench.push(mon);
	else p.bench.splice(i, 0, mon);
}

export function dropMonByIid(p: TcgPlayerView, iid: string) {
	if (p.active?.iid === iid) p.active = null;
	const next: TcgPokemonView[] = [];
	for (const mon of p.bench || []) {
		if (mon && mon.iid !== iid) next.push(mon);
	}
	p.bench = next;
}

export function clearPending(snap: TcgSnapshot) {
	delete snap.pendingSearch;
	delete snap.pendingDiscard;
	delete snap.pendingRetreatPay;
	delete snap.pendingDiscardEnergy;
	delete snap.pendingConfirm;
	delete snap.pendingCopyAttack;
	delete snap.pendingSlotPick;
	delete snap.pendingHandEnergy;
	delete snap.pendingPromote;
	delete snap.pendingFirst;
	delete snap.pendingMulligan;
	delete snap.pendingMulliganDraw;
	delete snap.pendingPrize;
	delete snap.energyDetachIndex;
}

export function laterCoversDiscard(events: TcgEvent[], index: number, ids: string[], iid?: string): boolean {
	const want: { [id: string]: 1 } = Object.create(null);
	for (const id of ids) if (id) want[id] = 1;
	const listed = !!ids.filter(Boolean).length;
	if (!listed && !iid) return false;
	for (let j = index + 1; j < events.length; j++) {
		const n = events[j];
		if (!n || n.type === 'request' || n.type === 'turn') break;
		if (n.type !== 'toDiscard' && !(n.type === 'toLost' && n.from === 'play')) continue;
		if (iid && n.iid === iid) return true;
		const got = Array.isArray(n.ids) ? n.ids : [];
		if (got.some(id => want[id])) return true;
	}
	return false;
}

export function laterReturnsToHand(events: TcgEvent[], index: number, id: string): boolean {
	for (let j = index + 1; j < events.length; j++) {
		const n = events[j];
		if (!n || n.type === 'request' || n.type === 'turn') break;
		if (n.type !== 'find' || !n.revealed || n.dest || n.from || n.iid) continue;
		if (Array.isArray(n.ids) && n.ids.includes(id)) return true;
	}
	return false;
}

export function applyBatchEvent(snap: TcgSnapshot, events: TcgEvent[], index: number) {
	const e = events[index];
	if (!e) return;
	if (e.type === 'ko' && e.iid) {
		const found = findMonSlot(snap.players || [], e.iid);
		const cards = found ?
			[found.mon.cardId, ...(found.mon.energyCards || []), ...(found.mon.tools || [])].filter(Boolean) :
			[];
		const seat = e.seat!;
		applyTcgEvent(snap, e);
		if (cards.length && !laterCoversDiscard(events, index, cards, e.iid)) {
			const p = snap.players[seat];
			if (p) {
				if (!p.discard) p.discard = [];
				for (const id of cards) p.discard.push(id);
			}
		}
		return;
	}
	if (e.type === 'trainer' && e.cardId && !laterCoversDiscard(events, index, [e.cardId]) &&
		!laterReturnsToHand(events, index, e.cardId)) {
		applyTcgEvent(snap, e);
		const p = snap.players[e.seat!];
		if (p) {
			if (!p.discard) p.discard = [];
			p.discard.push(e.cardId);
		}
		return;
	}
	applyTcgEvent(snap, e);
}

export function applyTcgEvents(
	base: TcgSnapshot,
	events: TcgEvent[] | undefined,
	actions?: TcgAction[]
): TcgSnapshot {
	let snap = cloneTcgSnapshot(base);
	if (snap.you == null) snap = scrubTcgSpectatorView(snap);
	const list = filterTcgEventsForViewer(events, snap.you) || [];
	const seen = typeof snap.appliedSeq === 'number' ? snap.appliedSeq : -1;
	let maxSeq = seen;
	for (let i = 0; i < list.length; i++) {
		const ev = list[i];
		if (ev && typeof ev.seq === 'number' && ev.seq <= seen) continue;
		applyBatchEvent(snap, list, i);
		if (ev && typeof ev.seq === 'number' && ev.seq > maxSeq) maxSeq = ev.seq;
	}
	if (maxSeq >= 0) snap.appliedSeq = maxSeq;
	if (actions !== undefined) snap.actions = actions;
	else if (snap.you == null) snap.actions = [];
	normalizeTcgEnergy(snap);
	return snap;
}

export function applyTcgEvent(snap: TcgSnapshot, e: TcgEvent) {
	const players = snap.players || [];
	if (!e) return;
	if (e.type === 'damage' || e.type === 'heal') {
		if (e.iid != null && e.hp != null) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				const hp = Number(e.hp);
				found.mon.hp = hp;
				if (e.maxHp != null) found.mon.maxHp = Number(e.maxHp);
				else if (hp > (found.mon.maxHp || 0)) found.mon.maxHp = hp;
				if (e.amount != null) {
					found.mon.lastDelta = e.type === 'damage' ? -Number(e.amount) : Number(e.amount);
				}
			}
		}
	} else if (e.type === 'status') {
		if (e.iid != null) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				const s = e.status == null || e.status === '' ? null : String(e.status).toLowerCase();
				if (e.poisoned != null || e.burned != null) {
					found.mon.status = s;
					(found.mon as any).poisoned = !!e.poisoned || s === 'poisoned';
					(found.mon as any).burned = !!e.burned || s === 'burned';
				} else if (s === 'poisoned') {
					(found.mon as any).poisoned = true;
				} else if (s === 'burned') {
					(found.mon as any).burned = true;
				} else if (s == null) {
					found.mon.status = null;
					(found.mon as any).poisoned = false;
					(found.mon as any).burned = false;
				} else {
					found.mon.status = s;
				}
			}
		}
	} else if (e.type === 'energy') {
		const src = e.from && e.cardId ? findMonSlot(players, e.from) : null;
		if (src) detachPlayedCards(src.mon, [e.cardId!]);
		if (e.iid) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				if (e.cardId) {
					found.mon.energyCards = [...(found.mon.energyCards || []), e.cardId];
				}
				found.mon.energy = [...(found.mon.energy || []), ...energyPipsFromEvent(e)];
				if (e.hp != null) found.mon.hp = Number(e.hp);
				if (e.maxHp != null) found.mon.maxHp = Number(e.maxHp);
			}
		}
	} else if (e.type === 'tool') {
		const src = e.from && e.cardId ? findMonSlot(players, e.from) : null;
		if (src) detachPlayedCards(src.mon, [e.cardId!]);
		if (e.iid) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				found.mon.tools = [...(found.mon.tools || []), e.cardId || 'tool'];
				if (e.hp != null) found.mon.hp = Number(e.hp);
				if (e.maxHp != null) found.mon.maxHp = Number(e.maxHp);
			}
		}
	} else if (e.type === 'hp') {
		if (e.iid) {
			const found = findMonSlot(players, e.iid);
			if (found) {
				if (e.hp != null) found.mon.hp = Number(e.hp);
				if (e.maxHp != null) found.mon.maxHp = Number(e.maxHp);
			}
		}
	} else if (e.type === 'moveCounters') {
		const dest = e.iid ? findMonSlot(players, e.iid) : null;
		const src = e.fromIid ? findMonSlot(players, e.fromIid) : null;
		if (dest) {
			if (e.hp != null) dest.mon.hp = Number(e.hp);
			if (e.maxHp != null) dest.mon.maxHp = Number(e.maxHp);
			if (e.amount != null) dest.mon.lastDelta = -Number(e.amount);
		}
		if (src && src !== dest) {
			if (e.fromHp != null) src.mon.hp = Number(e.fromHp);
			if (e.fromMaxHp != null) src.mon.maxHp = Number(e.fromMaxHp);
			if (e.amount != null) src.mon.lastDelta = Number(e.amount);
		}
	} else if (e.type === 'fromHand') {
		const p = players[e.seat!];
		if (p) {
			const ids = e.ids;
			const hand = handAsIds(p.hand);
			if (hand && ids?.length) {
				for (const id of ids) {
					const at = hand.indexOf(id);
					if (at >= 0) hand.splice(at, 1);
				}
				setHand(p, hand);
			} else if (!Array.isArray(p.hand) && p.hand) {
				p.hand = bumpPile(p.hand as { count: number }, -(Number(e.n) || ids?.length || 1));
			}
		}
	} else if (e.type === 'fromDeck') {
		const p = players[e.seat!];
		if (p) p.deck = bumpPile(p.deck, -(Number(e.n) || (e.ids)?.length || 0));
	} else if (e.type === 'prizeCount') {
		const p = players[e.seat!];
		if (p) p.prizes = { count: Number(e.n) || 0 };
	} else if (e.type === 'draw' || e.type === 'find') {
		const seat = e.seat!;
		const p = players[seat];
		if (p) {
			const ids = e.ids;
			const findDest = e.type === 'find' ? String(e.dest || 'hand') : 'hand';
			const toHand = e.type === 'draw' || findDest === 'hand';
			if (e.type === 'find' && e.iid && ids?.length) {
				const found = findMonSlot(players, e.iid);
				if (found) detachPlayedCards(found.mon, ids, snap.energyDetachIndex);
				delete snap.energyDetachIndex;
			}
			if (toHand) {
				if (ids?.length && Array.isArray(p.hand)) {
					setHand(p, p.hand.concat(ids));
				} else if (ids?.length && p.hand) {
					p.hand = bumpPile(p.hand as { count: number }, ids.length);
				} else if (!Array.isArray(p.hand) && p.hand) {
					const n = e.type === 'draw' ? (Number(e.n) || 0) : Math.max(1, ids?.length || Number(e.n) || 1);
					if (n) p.hand = bumpPile(p.hand as { count: number }, n);
				}
			}
			if (e.type === 'draw' && e.n) p.deck = bumpPile(p.deck, -(Number(e.n) || 0));
			if (e.type === 'find' && e.from === 'deck') p.deck = bumpPile(p.deck, -(ids?.length || 1));
			if (e.type === 'find' && e.from === 'prizes') p.prizes = bumpPile(p.prizes as any, -(ids?.length || 1));
		}
	} else if (e.type === 'deal') {
		const counts = e.counts;
		for (let seat = 0; seat < 2; seat++) {
			const p = players[seat];
			if (!p) continue;
			const ids = (seat === 0 ? e.ids0 : e.ids1);
			const n = ids ? ids.length : (counts?.[seat]) || 0;
			if (ids?.length) setHand(p, ids.slice());
			else p.hand = { count: n };
			if (n) p.deck = bumpPile(p.deck, -n);
		}
	} else if (e.type === 'suddenDeath') {
		const decks = e.deck as [number, number] | undefined;
		const prizes = e.prizes as [number, number] | undefined;
		snap.status = 'setup';
		snap.turn = 0;
		snap.turnNumber = 0;
		snap.firstPlayer = 0;
		snap.suddenDeath = true;
		snap.winner = null;
		snap.winReason = '';
		clearPending(snap);
		delete snap.effectsActive;
		for (let seat = 0; seat < 2; seat++) {
			const p = players[seat];
			if (!p) continue;
			p.active = null;
			p.bench = [];
			p.hand = Array.isArray(p.hand) ? [] : { count: 0 };
			p.discard = [];
			p.lostZone = { count: 0 };
			p.prizes = { count: seat === snap.you ? Number(prizes?.[seat]) || 0 : 0 };
			p.deck = { count: Number(decks?.[seat]) || 0 };
			p.stadium = null;
			delete p.stadiumIds;
			p.setup = 'active';
			p.points = 0;
			delete p.energyZone;
			p.attachedEnergyThisTurn = false;
			(p as any).playedSupporterThisTurn = false;
			(p as any).playedStadiumThisTurn = false;
			(p as any).retreatedThisTurn = false;
		}
	} else if (e.type === 'setupEnd') {
		// still setup: a mulligan bench choice can come before turn 1, `turn` starts play
		const counts = e.counts;
		for (let seat = 0; seat < 2; seat++) {
			const p = players[seat];
			if (!p) continue;
			p.setup = 'done';
			if (counts) p.prizes = { count: Number(counts[seat]) || 0 };
		}
	} else if (e.type === 'prizeSet') {
		const counts = e.counts;
		for (let seat = 0; seat < 2; seat++) {
			const p = players[seat];
			if (!p) continue;
			const n = (counts?.[seat]) || 0;
			p.prizes = { count: n };
			if (n) p.deck = bumpPile(p.deck, -n);
		}
	} else if (e.type === 'energyZone') {
		const p = players[e.seat!];
		if (p) {
			const ready = !!e.ready;
			p.energyZone = {
				type: String(e.energyType || e.zone || 'grass'),
				...(ready && e.next ? { next: e.next } : {}),
				ready,
			};
		}
	} else if (e.type === 'place') {
		const p = players[e.seat!];
		if (p) {
			const existing = findMonSlot(players, e.iid)?.mon;
			const hide = !existing && snap.status === 'setup' && p.setup !== 'done' &&
				(snap.you == null || e.seat !== snap.you);
			const mon = existing || (hide ?
				stubMon({ ...e, faceDown: true, name: 'Pokémon', cardId: '', hp: 0, maxHp: 0 }) :
				stubMon(e));
			if (existing) {
				if (e.cardId && e.cardId !== existing.cardId) {
					existing.cardId = e.cardId;
					delete (existing as any).image;
				}
				if (e.cardId) existing.faceDown = false;
				if (e.hp != null) existing.hp = Number(e.hp);
				if (e.maxHp != null) existing.maxHp = Number(e.maxHp);
				if (e.name) existing.name = e.name;
			}
			applyPlace(p, placeSlotOf(e), mon);
			if (e.source?.kind === 'retreat') (p as any).retreatedThisTurn = true;
			if (p.setup && p.setup !== 'done' && !p.active) p.setup = 'active';
			else if (p.setup === 'active') p.setup = 'bench';
		}
	} else if (e.type === 'evolve') {
		const found = findMonSlot(players, e.iid);
		if (found) {
			const cardChanged = !!(e.cardId && e.cardId !== found.mon.cardId);
			if (cardChanged) delete (found.mon as any).image;
			found.mon.cardId = e.cardId || found.mon.cardId;
			if (e.name) found.mon.name = e.name;
			if (e.hp != null) found.mon.hp = Number(e.hp);
			if (e.maxHp != null) found.mon.maxHp = Number(e.maxHp);
			// the printed face only lives on the in-play mon. live battles usually don't get a new snapshot on evolve, so
			// these fields have to come on the event
			if (Array.isArray(e.attacks)) found.mon.attacks = e.attacks as TcgPokemonView['attacks'];
			else if (cardChanged) found.mon.attacks = [];
			if (Array.isArray(e.abilities)) found.mon.abilities = e.abilities as TcgPokemonView['abilities'];
			else if (cardChanged) found.mon.abilities = [];
			if (Array.isArray(e.types)) found.mon.types = e.types;
			else if (cardChanged) found.mon.types = [];
			if (Array.isArray(e.previousStages)) found.mon.previousStages = (e.previousStages as string[]).slice();
			const owner = players[found.seat];
			if (owner && e.slot != null) applyPlace(owner, placeSlotOf(e), found.mon);
		}
		if (e.fromHand && e.cardId) {
			const owner = players[e.seat!];
			if (owner) removeHandIds(owner, [e.cardId]);
		}
	} else if (e.type === 'ko') {
		const p = players[e.seat!];
		if (p && e.iid) dropMonByIid(p, e.iid);
	} else if (e.type === 'leavePlay') {
		const p = players[e.seat!];
		if (p && e.iid) dropMonByIid(p, e.iid);
	} else if (e.type === 'shuffle') {
		const p = players[e.seat!];
		if (p) {
			if (e.from === 'hand') setHand(p, Array.isArray(p.hand) ? [] : { count: 0 });
			if (e.deck != null) p.deck = { count: Number(e.deck) };
		}
	} else if (e.type === 'toDiscard') {
		const p = players[e.seat!];
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		if (p && ids.length) {
			if (e.from === 'hand') removeHandIds(p, ids);
			if (e.from === 'deck') p.deck = bumpPile(p.deck, -ids.length);
			if (e.iid) {
				const found = findMonSlot(players, e.iid);
				if (found) detachPlayedCards(found.mon, ids, snap.energyDetachIndex);
				delete snap.energyDetachIndex;
			}
			if (!p.discard) p.discard = [];
			for (const id of ids) p.discard.push(id);
		}
	} else if (e.type === 'fromDiscard') {
		const p = players[e.seat!];
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		if (p && ids.length && Array.isArray(p.discard)) {
			for (const id of ids) {
				const at = p.discard.indexOf(id);
				if (at >= 0) p.discard.splice(at, 1);
			}
		}
	} else if (e.type === 'toDeck') {
		const p = players[e.seat!];
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		const n = ids.length || Number(e.n) || 0;
		if (p && n) {
			if (e.from === 'hand') {
				if (ids.length) removeHandIds(p, ids);
				else if (!Array.isArray(p.hand) && p.hand) p.hand = bumpPile(p.hand as { count: number }, -n);
			}
			if (e.from === 'play' && e.iid && ids.length) {
				const found = findMonSlot(players, e.iid);
				if (found && !ids.includes(found.mon.cardId)) detachPlayedCards(found.mon, ids);
				else dropMonByIid(p, e.iid);
			}
			p.deck = bumpPile(p.deck, n);
		}
	} else if (e.type === 'toLost') {
		const p = players[e.seat!];
		const n = Number(e.n) || 0;
		if (p) p.lostZone = bumpPile(p.lostZone, n);
		if (p && e.from === 'hand') {
			const lostIds = Array.isArray(e.ids) ? e.ids : [];
			if (lostIds.length) removeHandIds(p, lostIds);
			else if (!Array.isArray(p.hand) && p.hand) p.hand = bumpPile(p.hand as { count: number }, -n);
		}
		if (p && e.from === 'deck') p.deck = bumpPile(p.deck, -n);
		if (e.iid && Array.isArray(e.ids) && e.ids.length) {
			const found = findMonSlot(players, e.iid);
			if (found) detachPlayedCards(found.mon, e.ids, snap.energyDetachIndex);
			delete snap.energyDetachIndex;
		}
	} else if (e.type === 'trainer') {
		const p = players[e.seat!];
		if (p && e.cardId && cardKind(e.cardId).supporter) (p as any).playedSupporterThisTurn = true;
	} else if (e.type === 'stadium') {
		const seat = e.seat!;
		for (let s = 0; s < players.length; s++) {
			const p = players[s];
			if (!p) continue;
			p.stadium = e.cardId || null;
			const ids = e.ids;
			if (ids && ids.length > 1) p.stadiumIds = ids.slice();
			else delete p.stadiumIds;
			if (s === seat) (p as any).playedStadiumThisTurn = true;
		}
	} else if (e.type === 'stadiumEnd') {
		for (const p of players) {
			if (!p) continue;
			p.stadium = null;
			delete p.stadiumIds;
		}
	} else if (e.type === 'prize') {
		snap.pendingPrize = { seat: e.seat!, n: Number(e.n) || 1 };
	} else if (e.type === 'prizeTake') {
		const p = players[e.seat!];
		if (p?.prizes) p.prizes = bumpPile(p.prizes as any, -1);
		if (p && e.ids?.length) {
			const hand = handAsIds(p.hand) || [];
			setHand(p, hand.concat(e.ids));
		} else if (p && !Array.isArray(p.hand) && p.hand) {
			p.hand = bumpPile(p.hand as { count: number }, 1);
		}
		if (snap.pendingPrize && snap.pendingPrize.seat === e.seat) {
			snap.pendingPrize = { ...snap.pendingPrize, n: Math.max(0, snap.pendingPrize.n - 1) };
			if (snap.pendingPrize.n <= 0) delete snap.pendingPrize;
		}
	} else if (e.type === 'points') {
		const p = players[e.seat!];
		if (p && e.total != null) {
			p.points = Number(e.total);
			if (snap.format?.energyZone && snap.format.prizes != null) {
				p.prizes = { count: Math.max(0, Number(snap.format.prizes) - Number(e.total)) };
			}
		}
	} else if (e.type === 'field') {
		const effects = Array.isArray(e.effects) ?
			e.effects.filter((row: { summary?: string }) => row?.summary) : [];
		if (effects.length) snap.effectsActive = effects;
		else delete snap.effectsActive;
	} else if (e.type === 'turn') {
		if (e.seat != null) snap.turn = e.seat;
		if (e.number != null) snap.turnNumber = Number(e.number);
		if (snap.status === 'setup') snap.status = 'playing';
		const starting = e.seat != null ? players[e.seat] : null;
		for (const p of players) {
			if (!p) continue;
			p.setup = 'done';
			if (!starting || p === starting) {
				p.attachedEnergyThisTurn = false;
				(p as any).playedSupporterThisTurn = false;
				(p as any).playedStadiumThisTurn = false;
				(p as any).retreatedThisTurn = false;
			}
			if (p.active) p.active.faceDown = false;
			const bench = p.bench || [];
			for (const mon of bench) {
				if (mon) mon.faceDown = false;
			}
		}
	} else if (e.type === 'first') {
		if (e.chooses) snap.pendingFirst = e.seat!;
		else {
			delete snap.pendingFirst;
			snap.firstPlayer = e.seat as 0 | 1;
		}
	} else if (e.type === 'act') {
		const seat = e.seat!;
		const p = players[seat];
		const action = e.action;
		if (p && action) {
			const handTypes = [
				'setActive', 'setBench', 'playBasic', 'evolve', 'attachEnergy', 'attachTool',
				'playTrainer', 'playStadium', 'mulliganBench',
			];
			if (handTypes.includes(action.type) && typeof action.hand === 'number') {
				removeHandIndex(p, action.hand);
			}
			if (action.type === 'setupDone') p.setup = 'done';
			if (action.type === 'chooseFirst') {
				snap.firstPlayer = action.goFirst ? seat as 0 | 1 : (seat === 0 ? 1 : 0);
				delete snap.pendingFirst;
			}
			if (action.type === 'attachEnergy' || action.type === 'attachZone') p.attachedEnergyThisTurn = true;
			if ((action.type === 'discardEnergyPick' || action.type === 'payEnergy') && typeof action.index === 'number') {
				snap.energyDetachIndex = action.index;
			}
			if (action.type === 'playStadium') (p as any).playedStadiumThisTurn = true;
			if (action.type === 'discardPick' && typeof action.hand === 'number') {
				// after a refresh only the snapshot's `pendingDiscard` says whose hand this is
				const req = snap.discardRequest || snap.pendingDiscard;
				const owner = req?.fromFoe ? players[seat === 0 ? 1 : 0] : p;
				if (owner && !req?.to) removeHandIndex(owner, action.hand);
			}
		}
	} else if (e.type === 'request') {
		clearPending(snap);
		if (e.attackAgain) snap.attackAgain = e.attackAgain as { iid: string };
		else delete snap.attackAgain;
		const kind = String(e.kind || '');
		if (kind === 'discard') snap.discardRequest = { fromFoe: !!e.fromFoe, to: e.to as string | undefined };
		else delete snap.discardRequest;
		const waiting = Array.isArray(e.waiting) ? e.waiting : [];
		const forYou = snap.you != null && waiting.some((seat: number) => seat === snap.you);
		if (forYou && kind === 'search') {
			const seen = Array.isArray(e.seen) ? e.seen.filter(Boolean) : [];
			const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
			const legal = Array.isArray(e.legal) ? e.legal.filter(Boolean) : undefined;
			snap.pendingSearch = {
				kind: e.searchKind, left: e.left, upTo: e.upTo, zone: e.zone, dest: SEARCH_DESTS.find(d => d === e.dest),
				...(seen.length ? { seen } : {}),
				...(ids.length ? { ids } : {}),
				...(legal ? { legal } : {}),
			};
		} else if (forYou && kind === 'discard' && e.need != null) {
			snap.pendingDiscard = { need: Number(e.need) };
			if (e.to) snap.pendingDiscard.to = e.to;
			if (typeof e.ask === 'string' && e.ask) snap.pendingDiscard.ask = e.ask;
			if (e.fromFoe) {
				snap.pendingDiscard.fromFoe = true;
				snap.pendingDiscard.cardIds = Array.isArray(e.ids) ? e.ids.slice() : [];
			}
		} else if (forYou && kind === 'retreatPay' && e.need != null) {
			snap.pendingRetreatPay = { need: Number(e.need) };
		} else if (forYou && kind === 'discardEnergy' && e.iid) {
			const found = findMonSlot(players, String(e.iid));
			snap.pendingDiscardEnergy = {
				need: Number(e.need) || 0,
				iid: String(e.iid),
				cardIds: found?.mon.energyCards ? found.mon.energyCards.slice() : [],
			};
		} else if (forYou && kind === 'handEnergy' && (e.phase === 'card' || e.phase === 'pokemon')) {
			snap.pendingHandEnergy = { phase: e.phase };
		} else if (forYou && kind === 'confirm') {
			snap.pendingConfirm = { title: e.title, text: e.text };
		} else if (forYou && kind === 'copy') {
			snap.pendingCopyAttack = {
				title: e.title || 'Make a choice',
				text: e.text || 'Pick one.',
				...(typeof e.ask === 'string' ? { ask: e.ask } : {}),
				...(e.from ? { from: e.from } : {}),
			};
		} else if (kind === 'promote' || kind === 'switch') {
			snap.pendingPromote = e.promote != null ? Number(e.promote) : e.waiting?.[0];
		} else if (kind === 'first') {
			snap.pendingFirst = e.waiting?.[0];
		} else if (kind === 'mulligan') {
			snap.pendingMulligan = e.waiting?.[0];
		} else if (kind === 'mulliganDraw') {
			snap.pendingMulliganDraw = { seat: Number(e.waiting?.[0]) || 0, max: Number(e.max) || 0 };
		} else if (kind === 'prize') {
			snap.pendingPrize = {
				seat: e.prizeSeat != null ? Number(e.prizeSeat) : Number(e.waiting?.[0] || 0),
				n: Number(e.n) || 1,
			};
			if (e.promote != null) snap.pendingPromote = Number(e.promote);
		} else if (forYou && kind === 'slot') {
			snap.pendingSlotPick = {
				left: Number(e.left) || 1,
				hint: e.title || '',
				side: (e.text || 'mine') as 'mine' | 'foe',
				...(typeof e.ask === 'string' ? { ask: e.ask } : {}),
				...(e.from ? { from: e.from } : {}),
			};
		}
		if (kind === 'over') snap.status = 'over';
		if (kind === 'aborted') snap.status = 'aborted';
		if (kind === 'setup') snap.status = 'setup';
		if (kind === 'turn' && snap.status === 'setup') snap.status = 'playing';
	} else if (e.type === 'gameEnd') {
		snap.status = 'over';
		const result = e.result || e.replay?.result;
		if (result) {
			if (result.winner !== undefined) snap.winner = result.winner;
			if (result.reason) snap.winReason = result.reason;
		}
	} else if (e.type === 'over') {
		snap.status = 'over';
		if (e.winner !== undefined) snap.winner = e.winner;
		if (e.reason) snap.winReason = e.reason;
		clearPending(snap);
	}
}
