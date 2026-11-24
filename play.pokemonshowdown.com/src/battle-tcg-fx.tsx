import preact from "../js/lib/preact";
import {
	type TcgEvent,
	type TcgPlayerView,
	type TcgSnapshot,
	energyPipsFromEvent,
	energyTypeFromCardId,
	findMonSlot,
	findMonView,
	placeSlotOf,
} from "./battle-tcg-types";
import {
	type FlightZoneKind,
	type FxBeat,
	type HitStyle,
	attachOrigin,
	attackElement,
	clusterSkip,
	drawCause,
	effectCause,
	energyElement,
	placedFromDeck,
	resolveHitStyle,
	spotlightPath,
	SPOTLIGHT_MS,
} from "./battle-tcg-flights";
import {
	type PkFx,
	actorIsYou,
	actorLabel,
	bySource,
	cardLabel,
	damageBreakdown,
	dealCount,
	dmgSrc,
	fromSource,
	monName,
	mulliganWords,
	pkClass,
	placeTalk,
	searchZoneText,
	setupRevealAt,
	sourceName,
	statusFxClass,
	statusWord,
	userName,
	whoName,
} from "./battle-tcg-log";

declare const PS: { prefs: { noanim?: boolean, tcgfxspeed?: string } };
declare const cardArt: (cardId: string, opts?: { large?: boolean, pocket?: boolean }) => string;

export function tcgReduceMotion(): boolean {
	if (PS.prefs.noanim) return true;
	try {
		return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

export function tcgFxScale(): number {
	if (PS.prefs.noanim) return 0;
	const s = PS.prefs.tcgfxspeed;
	if (s === 'slow') return 2.4;
	if (s === 'fast') return 0.7;
	return 1.9;
}

export function fxMs(n: number): number {
	return Math.max(50, Math.round(n * (tcgFxScale() || 1)));
}

export function hasOpeningFlipEvents(events?: TcgEvent[] | null) {
	if (!events) return false;
	for (const ev of events) {
		const t = ev.type;
		if (t === 'coin' || t === 'first') return true;
	}
	return false;
}

/** the searched deck can be the opponent's (Sandy Fear-GX), so any seat's shuffle counts */
export function searchDoneShuffles(events: TcgEvent[], i: number): boolean {
	for (let j = i + 1; j < events.length; j++) {
		const x = events[j];
		if (x.type === 'act' || x.type === 'request') return false;
		if (x.type === 'shuffle') return true;
	}
	return false;
}

export function fxDuration(e: TcgEvent): number {
	if (!e) return fxMs(850);
	const shownRequest = e.kind === 'search' || e.kind === 'mulligan' || e.kind === 'mulliganDraw';
	if (e.type === 'request' && shownRequest) return fxMs(900);
	if (e.type === 'act' && e.action?.type === 'searchDone') return fxMs(1200);
	if (e.type === 'act' && e.action?.type === 'discardPick') return fxMs(1200);
	const t = e.type;
	if (t === 'request' || t === 'act') return 0;
	if (t === 'checkup') return fxMs(700);
	if (t === 'start') return fxMs(900);
	if (t === 'turn') return fxMs(500);
	if (t === 'first') return fxMs(2400);
	if (t === 'coin') return fxMs(2200);
	if (t === 'attack' || t === 'ability') return fxMs(1200);
	if (t === 'damage' || t === 'heal') return fxMs(1100);
	if (t === 'ko') return fxMs(1600);
	if (t === 'over') return fxMs(2800);
	if (t === 'prize' || t === 'prizeTake') return fxMs(900);
	if (t === 'points') return fxMs(1400);
	if (t === 'find' || t === 'reveal') return fxMs(1400);
	if (t === 'draw') return fxMs(850);
	if (t === 'deal') return fxMs(1400);
	if (t === 'shuffleHand') return fxMs(1200);
	if (t === 'shuffle') return fxMs(e.from === 'hand' ? 1200 : 500);
	if (t === 'toDiscard' || t === 'toLost') return 0;
	if (t === 'trainer' || t === 'stadium' || t === 'stadiumEnd') return fxMs(SPOTLIGHT_MS);
	if (t === 'energy' || t === 'tool') return fxMs(1200);
	if (t === 'place') return fxMs(1100);
	if (t === 'evolve') return fxMs(1400);
	if (t === 'discard') return fxMs(900);
	return fxMs(900);
}

export function fxFor(
	e: TcgEvent,
	events: TcgEvent[],
	i: number,
	players?: TcgPlayerView[],
	you?: number | null,
	snap?: TcgSnapshot | null
): FxBeat {
	if (!e) return { kind: '' };
	const who = (seat?: number) => actorLabel(players, seat, you);
	const yours = (seat?: number) => actorIsYou(seat, you);
	/** When a Trainer or Stadium is played, its beat is the card flying through the middle of the board (`spotlightPath`). */
	const flight = (fx: FxBeat): FxBeat => {
		const path = spotlightPath(events, i);
		return path ?
			{ ...fx, spotlight: true, seat: path.seat, cardId: path.cardId, moveFrom: path.from, moveTo: path.to } :
			fx;
	};
	if (e.type === 'request' && e.kind === 'discardEnergy') return { kind: '' };
	if (e.type === 'act' && e.action?.type === 'discardEnergyPick') return { kind: '' };
	if (e.type === 'act' && e.action?.type === 'playVunion') return { kind: '' };
	if (e.type === 'request' && e.kind === 'search') {
		const seat = (e.waiting?.[0] != null) ? e.waiting[0] : 0;
		const zone = searchZoneText(snap, seat, yours(seat), e.zone);
		const cause = effectCause(events, i, players);
		return {
			kind: 'search', seat, n: 5,
			...(e.zone === 'discard' ? { pile: 'discard' as const } : {}),
			action: 'Search',
			extra: cause?.name || '',
			cardId: cause?.cardId || '',
			message: yours(seat) ? `Searching ${zone}` : `${who(seat)} is searching ${zone}`,
		};
	}
	if (e.type === 'act' && e.action?.type === 'mulliganDraw') {
		const n = Number(e.action.n) || 0;
		const cards = n === 1 ? 'card' : 'cards';
		const message = n === 0 ?
			`${who(e.seat)} draws no cards for the mulligan` :
			`${who(e.seat)} draws ${n} ${cards} for the mulligan`;
		return {
			kind: 'draw', seat: e.seat, n: Math.max(n, 1),
			extra: 'Mulligan',
			message,
		};
	}
	if (e.type === 'request' && e.kind === 'mulliganDraw') {
		const seat = (e.waiting?.[0] != null) ? e.waiting[0] : 0;
		const max = Number(e.max) || 0;
		return {
			kind: 'mulligan', seat, n: max,
			extra: `Up to ${max}`,
			message: yours(seat) ? `You may draw up to ${max}, or none` : `${who(seat)} may draw up to ${max}, or none`,
		};
	}
	if (e.type === 'request' && e.kind === 'mulligan') {
		const seat = (e.waiting?.[0] != null) ? e.waiting[0] : 0;
		const other = seat === 0 ? 1 : 0;
		return {
			kind: 'mulligan', seat, n: 7,
			extra: `${who(other)} took a mulligan`,
			message: yours(seat) ?
				`${who(other)} took a mulligan, so you may bench Basics from your extra cards` :
				`${who(other)} took a mulligan, so ${who(seat)} may bench extra Basics`,
		};
	}
	if (e.type === 'act' && e.action?.type === 'searchDone') {
		// the same row ends an "up to" hand discard and a discard pile search, no deck got shuffled
		if (!searchDoneShuffles(events, i)) return { kind: '' };
		const cause = effectCause(events, i, players);
		return {
			kind: 'searchDone', seat: e.seat,
			action: 'Shuffle',
			extra: cause?.name || '',
			cardId: cause?.cardId || '',
			message: 'Shuffled the deck',
		};
	}
	if (e.type === 'reveal') {
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		const names = ids.map(cardLabel);
		const found = names.length ? names.join(', ') : 'no cards';
		const what = e.hand ? `their hand: ${found}` : found;
		const mulligan = Number(e.mulligan) || 0;
		const cause = effectCause(events, i, players);
		const shown = mulligan ? 'Revealed for a mulligan' :
			e.hand ? (names.length ? 'Revealed the hand' : 'Revealed no cards') :
			(names.length === 1 ? `Revealed ${names[0]}` : `Revealed ${names.length} cards`);
		return {
			kind: 'reveal', seat: e.seat, n: ids.length,
			action: 'Reveal',
			extra: cause?.name || (mulligan ? 'Mulligan' : ''),
			cardId: cause?.cardId || '',
			ids, labels: names,
			message: `${who(e.seat)} ${mulligan ? `${mulliganWords(mulligan)} and revealed` : 'revealed'} ${what}`,
			tag: shown,
		};
	}
	if (e.type === 'find') {
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		const names = ids.map(cardLabel);
		const found = names.length ? names.join(', ') : `${ids.length || 1} card(s)`;
		const dest = String(e.dest || 'hand');
		const where =
			dest === 'top' ? 'on top of the deck' :
			dest === 'bench' ? 'onto the Bench' :
			dest === 'deck' ? 'into the deck' :
			dest === 'discard' ? 'into the discard pile' :
			dest === 'lost' ? 'into the Lost Zone' :
			dest === 'attach-active' ? 'onto the Active Pokémon' :
			dest === 'attach' ? 'to be attached' :
			dest === 'replace-active' ? 'into the Active Spot' :
			'into the hand';
		const left = events[i - 1]?.type === 'leavePlay' && events[i - 1].seat === e.seat && events[i - 1].to === 'hand' ?
			events[i - 1] : null;
		const findFrom: FlightZoneKind | undefined = e.iid || left ? 'mon' : e.from === 'prizes' ? 'prizes' :
			e.from === 'deck' ? 'deck' : undefined;
		const cause = effectCause(events, i, players);
		const foundLine = names.length === 1 ? `Found ${names[0]}` :
			(ids.length || 1) === 1 ? 'Found a card' : `Found ${ids.length} cards`;
		return {
			kind: 'find', seat: e.seat, n: ids.length || 1,
			action: 'Find',
			tag: dest === 'hand' ? foundLine : `${foundLine} ${where}`,
			moveFrom: dest === 'hand' ? findFrom : undefined, moveTo: dest === 'hand' ? 'hand' : undefined,
			fromIid: e.iid || left?.iid || undefined,
			...(left ? { wholeMon: true } : {}),
			extra: cause?.name || '',
			cardId: cause?.cardId || '',
			ids, labels: names,
			message: yours(e.seat) ?
				`You put ${found} ${where}` :
				`${who(e.seat)} put ${found} ${where}`,
		};
	}
	if (e.type === 'act' && e.action?.type === 'discardPick') {
		return {
			kind: 'discard', seat: e.seat, n: 1,
			extra: 'Discarded a card',
			message: yours(e.seat) ? 'You discarded a card' : `${who(e.seat)} discarded a card`,
		};
	}
	if (e.type === 'place') {
		const reveal = setupRevealAt(events, i);
		const talk = placeTalk(e, players, reveal);
		const slot = placeSlotOf(e);
		const srcKind = e.source?.kind || '';
		const moveFrom: FlightZoneKind | undefined = reveal ? undefined : !srcKind || srcKind === 'play' ? 'hand' :
			placedFromDeck(events, i, e.seat) ? 'deck' : undefined;
		return {
			kind: 'place', iid: e.iid || '', seat: e.seat, slot,
			extra: talk.extra, tag: talk.tag,
			cardId: e.cardId || '',
			message: talk.text,
			moveFrom,
		};
	}
	if (e.type === 'damage') {
		const src = dmgSrc(events, i, players);
		let element = energyElement(e.element || e.energyType || e.attackType || e.dmgType);
		if (!element && src.key === 'attack') {
			for (let j = i - 1; j >= 0; j--) {
				const p = events[j];
				if (!p) break;
				const t = String(p.type || '');
				if (t === 'attack') {
					element = attackElement(p, players);
					break;
				}
				if (clusterSkip(t) && t !== 'damage' && t !== 'heal' && t !== 'status') continue;
				if (t !== 'damage' && t !== 'heal' && t !== 'status') break;
			}
		}
		return {
			kind: 'damage', iid: e.iid || '', seat: e.seat, amount: e.amount,
			extra: src.label, src: src.key,
			element: element || undefined,
			message: `${monName(players, e.iid)} took ${e.counters ? `${Math.max(1, Math.round((Number(e.amount) || 0) / 10))} damage counters` : `${e.amount} damage`}${damageBreakdown(e)}${fromSource(e)}`,
		};
	}
	if (e.type === 'draw') {
		const n = e.n || (Array.isArray(e.ids) ? e.ids.length : 1) || 1;
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		const cause = drawCause(events, i, players);
		const drawLabel = n === 1 ? 'Drew a card' : `Drew ${n} cards`;
		const whoDrew = yours(e.seat) ?
			(n === 1 ? 'You drew a card' : `You drew ${n} cards`) :
			(n === 1 ? `${who(e.seat)} drew a card` : `${who(e.seat)} drew ${n} cards`);
		if (cause) {
			return {
				kind: 'drawEffect',
				seat: e.seat,
				n,
				action: 'Draw',
				ids: ids.length ? ids : undefined,
				labels: ids.length ? ids.map(cardLabel) : undefined,
				cardId: cause.cardId || '',
				src: cause.kind,
				extra: cause.name,
				message: drawLabel,
				moveFrom: 'deck', moveTo: 'hand',
			};
		}
		return {
			kind: 'draw', seat: e.seat, n,
			ids: ids.length ? ids : undefined,
			extra: drawLabel,
			message: whoDrew,
		};
	}
	if (e.type === 'shuffle') {
		if (e.from === 'hand') {
			return {
				kind: 'shuffleHand', seat: e.seat, n: 5,
				extra: 'Shuffled hand into the deck',
				message: yours(e.seat) ?
					'You shuffled your hand into the deck' :
					`${who(e.seat)} shuffled their hand into the deck`,
			};
		}
		return {
			kind: 'shuffle', seat: e.seat,
			extra: 'Shuffled their deck',
			message: yours(e.seat) ? 'You shuffled your deck' : `${who(e.seat)} shuffled their deck`,
		};
	}
	if (e.type === 'shuffleHand') {
		return {
			kind: 'shuffleHand', seat: e.seat, n: e.n || 5,
			extra: 'Shuffled hand into the deck',
			message: yours(e.seat) ?
				'You shuffled your hand into the deck' :
				`${who(e.seat)} shuffled their hand into the deck`,
		};
	}
	if (e.type === 'deal') {
		const dealt = dealCount(e);
		const line = `Each player drew ${dealt} cards`;
		const counts = Array.isArray(e.counts) ? e.counts.map(Number) : [dealt, dealt];
		return {
			kind: 'deal', n: dealt,
			extra: line,
			message: line,
			perSeat: [0, 1].map(s => ({ n: counts[s] || 0, ids: (s === 0 ? e.ids0 : e.ids1) })),
		};
	}
	if (e.type === 'prizeSet') {
		const counts = Array.isArray(e.counts) ? e.counts.map(Number) : [];
		return { kind: 'prizeSet', perSeat: [0, 1].map(s => ({ n: counts[s] || 0 })), extra: 'Prize cards set aside' };
	}
	if (e.type === 'turn') {
		return {
			kind: 'turn', seat: e.seat, n: Number(e.number) || 0,
			extra: `Turn ${e.number}: ${whoName(players, e.seat)}`,
			message: yours(e.seat) ? 'Your turn' : `${whoName(players, e.seat)}'s turn`,
		};
	}
	if (e.type === 'prize' || e.type === 'prizeTake') {
		const n = e.n || 1;
		const multi = e.type === 'prize' && n > 1;
		const ids = e.type === 'prizeTake' && Array.isArray(e.ids) ? (e.ids).filter(Boolean) : [];
		return {
			kind: e.type, seat: e.seat, n,
			...(ids.length ? { ids } : {}),
			extra: multi ? `Took ${n} Prize cards` : 'Took a Prize card',
			message: yours(e.seat) ?
				(multi ? `You took ${n} Prize cards` : 'You took a Prize card') :
				(multi ? `${who(e.seat)} took ${n} Prize cards` : `${who(e.seat)} took a Prize card`),
		};
	}
	if (e.type === 'points') {
		const n = e.n || 1;
		return {
			kind: 'points', seat: e.seat, n, amount: e.total,
			extra: `+${n}`,
			message: yours(e.seat) ?
				`You scored ${n} point${n === 1 ? '' : 's'}` :
				`${who(e.seat)} scored ${n} point${n === 1 ? '' : 's'}`,
		};
	}
	if (e.type === 'evolve') {
		let evoSeat = e.seat;
		if (evoSeat == null && e.iid) {
			const playersList = players || [];
			for (let s = 0; s < playersList.length; s++) {
				const p = playersList[s];
				if (p.active?.iid === e.iid || (p.bench || []).some(m => m?.iid === e.iid)) {
					evoSeat = s;
					break;
				}
			}
		}
		const into = cardLabel(e.cardId);
		return {
			kind: 'evolve',
			iid: e.iid || '',
			seat: evoSeat,
			extra: into,
			cardId: e.cardId || '',
			fromCardId: e.fromCardId || '',
			message: e.devolved ?
				`${cardLabel(e.fromCardId)} devolved into ${into}` :
				e.fromCardId ?
					`${cardLabel(e.fromCardId)} evolved into ${into}` :
					`Evolved into ${into}`,
		};
	}
	if (e.type === 'energy' || e.type === 'tool') {
		const mon = findMonView(players, e.iid);
		const label = cardLabel(e.cardId);
		const energyType = e.type === 'energy' ?
			(energyPipsFromEvent(e)[0] || energyTypeFromCardId(e.cardId) || '') : '';
		const onSeat = e.seat ?? findMonSlot(players, e.iid)?.seat ?? e.source?.seat;
		return {
			kind: e.type, iid: e.iid || '', seat: onSeat,
			fromIid: e.from || undefined, moveFrom: e.from ? 'mon' : attachOrigin(events, i),
			extra: label, onto: mon?.name || 'a Pokémon',
			ontoId: mon?.cardId || '', cardId: e.cardId || '',
			element: energyType || undefined,
			message: (yours(e.seat) ?
				`You attached ${label} to ${mon?.name || 'a Pokémon'}` :
				`${who(e.seat)} attached ${label} to ${mon?.name || 'a Pokémon'}`) + fromSource(e),
		};
	}
	if (e.type === 'trainer') {
		const label = cardLabel(e.cardId);
		const errata = e.errata ? ' (official errata)' : '';
		return flight({
			kind: 'trainer', seat: e.seat, extra: label, cardId: e.cardId || '',
			message: (yours(e.seat) ? `You played ${label}` : `${who(e.seat)} played ${label}`) + errata,
		});
	}
	if (e.type === 'gameEnd' || e.type === 'hp') return { kind: '' };
	if (e.type === 'stadium') {
		const label = cardLabel(e.cardId);
		return flight({
			kind: 'stadium', seat: e.seat, extra: label, cardId: e.cardId || '',
			message: yours(e.seat) ? `You played ${label}` : `${who(e.seat)} played ${label}`,
		});
	}
	if (e.type === 'ko') {
		const memName = monName(players, e.iid);
		return {
			kind: 'ko', iid: e.iid || '', seat: e.seat,
			extra: memName !== 'a Pokémon' ? memName : '',
			message: `${memName} was Knocked Out${bySource(e)}`,
		};
	}
	if (e.type === 'heal') {
		return {
			kind: 'heal', iid: e.iid || '', seat: e.seat, amount: e.amount,
			extra: e.amount ? `+${e.amount}` : 'Healed',
			message: e.requested != null && Number(e.requested) > Number(e.amount || 0) ?
				`${monName(players, e.iid)} healed ${e.amount || 0} of ${e.requested} damage${fromSource(e)}` :
				`${monName(players, e.iid)} healed ${e.amount || 0} damage${fromSource(e)}`,
		};
	}
	if (e.type === 'moveCounters') {
		const counters = Math.max(1, Math.round((Number(e.amount) || 0) / 10));
		return {
			kind: 'status', iid: e.iid || '',
			extra: e.swap ? 'Counters switched' : `${counters} counter${counters === 1 ? '' : 's'} moved`,
			message: (e.swap ?
				`${monName(players, e.fromIid)} and ${monName(players, e.iid)} switched damage counters` :
				`${monName(players, e.fromIid)} moved ${counters} damage counter${counters === 1 ? '' : 's'} to ${monName(players, e.iid)}`) + fromSource(e),
		};
	}
	if (e.type === 'noDamage') {
		const stopped = bySource({ source: e.prevention?.source });
		const tried = fromSource(e);
		const breakdown = damageBreakdown(e);
		return {
			kind: 'status', iid: e.iid || '', extra: 'No damage',
			message: e.outcome === 'prevented' ?
				`The damage to ${monName(players, e.iid)}${tried} was prevented${stopped}${breakdown}` :
				`${monName(players, e.iid)} took no damage${breakdown}${tried}`,
		};
	}
	if (e.type === 'prevent') {
		if (e.what === 'moveCounters') {
			const src = e.prevention?.source;
			const by = src?.kind === 'ability' && src.cardId && src.name ?
				` by ${cardLabel(src.cardId)}'s ${src.name}` : bySource({ source: src });
			return {
				kind: 'status', iid: e.iid || '', extra: 'Prevented',
				message: `The damage counters on ${monName(players, e.iid)}${fromSource(e)} couldn't be moved${by}`,
			};
		}
		const what = e.what === 'heal' ?
			(e.amount != null ? `heal of ${e.amount}` : 'heal') :
			e.what === 'status' ? (e.status ? statusWord(e.status) : 'Special Condition') :
			"attack's effects";
		const verb = e.what === 'attackEffects' ? 'were' : 'was';
		return {
			kind: 'status', iid: e.iid || '', extra: 'Prevented',
			message: `The ${what} on ${monName(players, e.iid)}${fromSource(e)} ${verb} prevented${bySource({ source: e.prevention?.source })}`,
		};
	}
	if (e.type === 'attack') {
		return {
			kind: 'attack', iid: e.iid || '', seat: e.seat,
			extra: e.name || 'Attack',
			message: `${userName(e, players, events)} used ${e.name || 'an attack'}`,
		};
	}
	if (e.type === 'ability') {
		return {
			kind: 'ability', iid: e.iid || '', seat: e.seat,
			extra: e.name || 'Ability',
			message: `${userName(e, players, events)} used ${e.name || 'an Ability'}`,
		};
	}
	let seat = e.seat;
	if (seat == null && e.iid) {
		const playersList = players || [];
		for (let s = 0; s < playersList.length; s++) {
			const p = playersList[s];
			if (p.active?.iid === e.iid || (p.bench || []).some(m => m?.iid === e.iid)) {
				seat = s;
				break;
			}
		}
	}
	if (e.type === 'over') {
		const tie = !!(e.tie || (e.winner == null && !e.winnerName && !e.reason));
		const winName = e.winnerName ||
			(e.winner != null ? whoName(players, e.winner) : '') ||
			'';
		const reason = e.reason || (tie ? 'Draw' : (winName ? `${winName} won` : 'Battle ended'));
		return {
			kind: 'over',
			seat: e.winner ?? seat,
			extra: reason,
			message: reason,
			tie,
		};
	}
	if (e.type === 'attackFailed') {
		const why = e.reason === 'confusion' ? 'Confused' : e.reason === 'baby' ? 'Baby rule' : 'Tails';
		return {
			kind: 'attackFailed', iid: e.iid || '', extra: why,
			message: `${e.name || 'The attack'} failed (${why})`,
		};
	}
	if (e.type === 'checkup') {
		return { kind: 'checkup', extra: 'Pokémon Checkup', message: 'Pokémon Checkup' };
	}
	if (e.type === 'suddenDeath') {
		return {
			kind: 'suddenDeath', extra: 'Tiebreaker',
			message: 'Sudden death. The board is reset and a new game begins.',
		};
	}
	if (e.type === 'toDeck') {
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		const named = ids.length ? ids.map(cardLabel).join(', ') : '';
		const fromHand = e.from === 'hand';
		return {
			kind: 'discard',
			seat: e.seat,
			extra: named || 'To the deck',
			message: (fromHand ?
				`${who(e.seat)} put ${named || 'a card'} into the deck` :
				`${who(e.seat)} shuffled ${named || 'a card'} into the deck`) + fromSource(e),
		};
	}
	if (e.type === 'toDiscard' || e.type === 'fromDiscard' || e.type === 'toLost') {
		const ids = Array.isArray(e.ids) ? e.ids.filter(Boolean) : [];
		const named = ids.length ? ids.map(cardLabel).join(', ') : '';
		const took = e.type === 'fromDiscard';
		const next = events[i + 1]?.type;
		const usedNext = took && (next === 'energy' || next === 'tool' || next === 'place' || next === 'toDeck');
		const from: FlightZoneKind | undefined = took ? (usedNext ? undefined : 'discard') :
			e.iid || e.from === 'play' ? 'mon' : e.from === 'hand' ? 'hand' : e.from === 'deck' ? 'deck' : undefined;
		const koDiscard = !took && !!e.iid && events.slice(Math.max(0, i - 3), i).some(p => p.type === 'ko' && p.iid === e.iid);
		return flight({
			kind: 'discard',
			seat: e.seat,
			n: ids.length || 1,
			ids: ids.length ? ids : undefined,
			moveFrom: from,
			...(koDiscard ? { koDiscard } : {}),
			moveTo: took ? 'hand' : e.type === 'toLost' ? 'lost' : 'discard',
			fromIid: e.iid || undefined,
			extra: named || (took ? 'From the discard pile' : e.type === 'toLost' ? 'Lost Zone' : 'Discarded'),
			message: (took ?
				`${who(e.seat)} took ${named || 'a card'} from the discard pile` :
				e.type === 'toLost' ?
					`${who(e.seat)} put a card in the Lost Zone` :
					`${who(e.seat)} discarded ${named || 'a card'}`) + fromSource(e),
		});
	}
	return flight({
		kind: e.type,
		iid: e.iid || '',
		targetIid: e.targetIid || '',
		seat,
		amount: e.type === 'points' && e.total != null ? e.total : e.amount,
		n: e.n,
		extra: e.type === 'coin' ? (e.heads ? 'Heads' : 'Tails') :
		e.type === 'turn' ? `Turn ${e.number}: ${whoName(players, e.seat)}` :
		e.type === 'first' ? (e.chooses ?
			`${whoName(players, e.seat)} chooses who goes first` :
			`${whoName(players, e.seat)} goes first`) :
		e.type === 'status' ? (e.status ? statusWord(e.status) : 'Recovered') :
		e.type === 'stadiumEnd' ? 'No longer in play' :
		(e.name || e.status || e.reason || ''),
		message: e.type === 'coin' ? ((sourceName(e.source) ? `${sourceName(e.source)}: ` : '') +
			(e.heads ? 'Heads!' : 'Tails!')) :
		e.type === 'first' ? (e.chooses ?
			`${who(e.seat)} chooses who goes first` :
			`${who(e.seat)} goes first`) :
		e.type === 'status' ? (e.status ?
			`${monName(players, e.iid)} is ${statusWord(e.status)}${fromSource(e)}` :
			`${monName(players, e.iid)} recovered${fromSource(e)}`) :
		e.type === 'stadiumEnd' ? `${cardLabel(e.cardId)} is no longer in play${fromSource(e)}` :
		undefined,
		cardId: e.cardId || '',
		coins: e.type === 'coin' ? [!!e.heads] : undefined,
		status: e.type === 'status' ? (e.status == null ? '' : String(e.status).toLowerCase()) : undefined,
	});
}

export function buildPkFx(fx: FxBeat, tick = 0): { [iid: string]: PkFx } {
	const out: { [iid: string]: PkFx } = {};
	const put = (
		iid: string | undefined, cls: string, dataFx?: string, element?: string, status?: string,
		move?: { tag: string, name: string }, energyType?: string, hitStyle?: HitStyle
	) => {
		if (!iid) return;
		out[iid] = {
			cls, dataFx, tick, element, status,
			moveTag: move?.tag, moveName: move?.name,
			energyType, hitStyle,
		};
	};
	if (fx.kind === 'status' && fx.iid) {
		put(fx.iid, `fx-status ${statusFxClass(fx.status)}`, undefined, undefined, fx.status ?? '');
	} else if (fx.iid) {
		let dataFx = '';
		let element = (fx.kind === 'attack' || fx.kind === 'ability') ? undefined : (fx.element || undefined);
		let energyType: string | undefined;
		let hitStyle = fx.hitStyle;
		if (fx.kind === 'damage' && fx.amount) {
			dataFx = `-${fx.amount}`;
			element = element || fx.element || 'colorless';
			hitStyle = hitStyle || resolveHitStyle(fx.extra, element).style;
		}
		if (fx.kind === 'heal' && fx.amount) dataFx = `+${fx.amount}`;
		if (fx.kind === 'energy') {
			const type = energyElement(fx.element) || energyTypeFromCardId(fx.cardId) || 'colorless';
			element = type;
			energyType = type;
		}
		if (fx.kind === 'ko') dataFx = 'KO';
		const move = fx.announce ? {
			tag: fx.kind === 'ability' ? 'Ability' : 'Attack',
			name: fx.extra || (fx.kind === 'ability' ? 'Ability' : 'Attack'),
		} : undefined;
		put(
			fx.iid,
			`${pkClass(fx)}${fx.src ? ` src-${fx.src}` : ''}${
				!fx.announce && (fx.kind === 'attack' || fx.kind === 'ability') && hitStyle ? ` hit-${hitStyle}` : ''
			}`,
			dataFx || undefined,
			element,
			undefined,
			move,
			energyType,
			hitStyle
		);
	}
	for (const h of fx.hits || []) {
		if (!h?.iid) continue;
		const n = h.counters || 0;
		const countersText = `${n} counter${n === 1 ? '' : 's'}`;
		const dataFx = h.kind === 'damage' && h.amount ? `-${h.amount}` :
			h.kind === 'heal' && h.amount ? `+${h.amount}` :
			h.kind === 'counters' ? countersText :
			h.kind === 'moved' ? `+${countersText}` :
			h.kind === 'reduced' || (h.kind === 'prevented' && h.amount === 0) ? '0' :
			h.kind === 'prevented' ? 'Prevented' : undefined;
		const src = h.src || fx.src;
		const cls = h.kind === 'heal' ? 'fx-heal' :
			h.kind === 'status' ? `fx-status ${statusFxClass(h.status)}` :
			h.kind === 'counters' || h.kind === 'moved' ? 'fx-hit fx-counters' :
			h.kind === 'prevented' ? 'fx-prevented' :
			h.kind === 'reduced' ? 'fx-prevented fx-reduced' : 'fx-hit';
		const struck = h.kind === 'damage' || h.kind === 'counters';
		const el = struck ? (h.element || fx.element || 'colorless') : undefined;
		put(
			h.iid,
			`${cls}${src ? ` src-${src}` : ''}`,
			dataFx,
			el,
			h.kind === 'status' ? (h.status ?? '') : undefined,
			undefined,
			undefined,
			struck ? (h.hitStyle || fx.hitStyle || resolveHitStyle(h.label || fx.extra, el).style) : undefined
		);
		if (h.note && out[h.iid]) out[h.iid].note = h.note;
		if (h.kind === 'moved' && h.fromMon && !out[h.fromMon]) {
			out[h.fromMon] = { cls: 'fx-moved-from', dataFx: `−${countersText}`, tick };
		}
	}
	if ((fx.kind === 'attack' || fx.kind === 'ability') && !fx.announce) {
		for (const t of fx.targets || []) {
			if (t && t !== fx.iid && !out[t]) out[t] = { cls: 'fx-target', tick };
		}
	}
	if (fx.kind === 'attack' && fx.contact && fx.targetIid && fx.iid && out[fx.iid]) {
		out[fx.iid].cls += ' is-contact';
		(out[fx.iid] as any).contact = true;
		out[fx.iid].targetIid = fx.targetIid;
	}
	if (fx.contact && fx.kind === 'damage' && fx.fromIid && fx.fromIid !== fx.iid && !out[fx.fromIid]) {
		out[fx.fromIid] = {
			cls: `fx-lunge is-contact${fx.hitStyle ? ` hit-${fx.hitStyle}` : ''}`,
			tick,
			contact: true,
			targetIid: fx.iid,
			hitStyle: fx.hitStyle,
			moveTag: 'Attack',
			moveName: fx.extra,
		};
	}
	return out;
}

export function StatusBurst(props: { kind: string }) {
	const kind = props.kind || 'cured';
	const n = kind === 'asleep' ? 3 : kind === 'cured' ? 4 : 6;
	return <div class={`tcg-sfx sfx-${kind}`} aria-hidden="true">
		{Array.from({ length: n }, (_, i) => <i key={i} style={{ '--i': String(i) } as any} />)}
	</div>;
}

export function hitStyleParts(style: HitStyle) {
	if (style === 'slash') {
		return [
			<i class="claw c1" key="c1" />, <i class="claw c2" key="c2" />, <i class="claw c3" key="c3" />,
		];
	}
	if (style === 'barrage') {
		return [1, 2, 3, 4, 5, 6].map(n => <i class={`peck pk${n}`} key={n} />);
	}
	if (style === 'beam') {
		return [
			<i class="beam" key="beam" />, <i class="core" key="core" />,
			<i class="spark sp1" key="sp1" />, <i class="spark sp2" key="sp2" />,
			<i class="spark sp3" key="sp3" />,
		];
	}
	if (style === 'flame') {
		return [
			<i class="tongue t1" key="t1" />, <i class="tongue t2" key="t2" />,
			<i class="tongue t3" key="t3" />, <i class="tongue t4" key="t4" />,
			<i class="ember e1" key="e1" />, <i class="ember e2" key="e2" />,
			<i class="ember e3" key="e3" />, <i class="ember e4" key="e4" />,
		];
	}
	if (style === 'torrent') {
		return [
			<i class="jet" key="jet" />, <i class="wake" key="wake" />,
			<i class="droplet d1" key="d1" />, <i class="droplet d2" key="d2" />,
			<i class="droplet d3" key="d3" />, <i class="droplet d4" key="d4" />,
		];
	}
	if (style === 'bolt') {
		return [
			<i class="lightning l1" key="l1" />, <i class="lightning l2" key="l2" />,
			<i class="arc a1" key="a1" />, <i class="arc a2" key="a2" />,
			<i class="spark sp1" key="sp1" />, <i class="spark sp2" key="sp2" />,
		];
	}
	if (style === 'zap') {
		return [
			<i class="needle n1" key="n1" />, <i class="needle n2" key="n2" />,
			<i class="needle n3" key="n3" />, <i class="spark sp1" key="sp1" />,
		];
	}
	if (style === 'bloom') {
		return [
			<i class="whip w1" key="w1" />, <i class="whip w2" key="w2" />,
			<i class="thorn th1" key="th1" />, <i class="thorn th2" key="th2" />,
			<i class="petal pt1" key="pt1" />, <i class="petal pt2" key="pt2" />,
		];
	}
	if (style === 'pulse') {
		return [
			<i class="ring r1" key="r1" />, <i class="ring r2" key="r2" />,
			<i class="orb" key="orb" />, <i class="mote m1" key="m1" />,
			<i class="mote m2" key="m2" />,
		];
	}
	if (style === 'quake') {
		return [
			<i class="fault f1" key="f1" />, <i class="fault f2" key="f2" />,
			<i class="rock r1" key="r1" />, <i class="rock r2" key="r2" />,
			<i class="rock r3" key="r3" />, <i class="dust" key="dust" />,
		];
	}
	if (style === 'veil') {
		return [
			<i class="shadow sh1" key="sh1" />, <i class="shadow sh2" key="sh2" />,
			<i class="wisp ws1" key="ws1" />, <i class="wisp ws2" key="ws2" />,
			<i class="eye" key="eye" />,
		];
	}
	if (style === 'shard') {
		return [
			<i class="spike sp1" key="sp1" />, <i class="spike sp2" key="sp2" />,
			<i class="spike sp3" key="sp3" />, <i class="glint g1" key="g1" />,
			<i class="glint g2" key="g2" />,
		];
	}
	if (style === 'sparkle') {
		return [
			<i class="star st1" key="st1" />, <i class="star st2" key="st2" />,
			<i class="star st3" key="st3" />, <i class="glitter g1" key="g1" />,
			<i class="glitter g2" key="g2" />, <i class="glitter g3" key="g3" />,
		];
	}
	if (style === 'roar') {
		return [
			<i class="ring r1" key="r1" />, <i class="ring r2" key="r2" />,
			<i class="ring r3" key="r3" />, <i class="fang f1" key="f1" />,
			<i class="fang f2" key="f2" />,
		];
	}
	if (style === 'whirl') {
		return [
			<i class="gust gu1" key="gu1" />, <i class="gust gu2" key="gu2" />,
			<i class="spiral" key="spiral" />, <i class="feather ft1" key="ft1" />,
			<i class="feather ft2" key="ft2" />,
		];
	}
	if (style === 'drain') {
		return [
			<i class="siphon s1" key="s1" />, <i class="siphon s2" key="s2" />,
			<i class="siphon s3" key="s3" />, <i class="seed" key="seed" />,
			<i class="glow" key="glow" />,
		];
	}
	if (style === 'frost') {
		return [
			<i class="flurry fl1" key="fl1" />, <i class="flurry fl2" key="fl2" />,
			<i class="crystal cr1" key="cr1" />, <i class="crystal cr2" key="cr2" />,
			<i class="crystal cr3" key="cr3" />, <i class="rime" key="rime" />,
		];
	}
	if (style === 'stream') {
		return [
			<i class="plume pl1" key="pl1" />, <i class="plume pl2" key="pl2" />,
			<i class="flare fl1" key="fl1" />, <i class="flare fl2" key="fl2" />,
			<i class="cinder ci1" key="ci1" />, <i class="cinder ci2" key="ci2" />,
		];
	}
	if (style === 'sting') {
		return [
			<i class="needle ne1" key="ne1" />, <i class="needle ne2" key="ne2" />,
			<i class="venom vn1" key="vn1" />, <i class="venom vn2" key="vn2" />,
			<i class="drip" key="drip" />,
		];
	}
	if (style === 'powder') {
		return [
			<i class="cloud cl1" key="cl1" />, <i class="cloud cl2" key="cl2" />,
			<i class="spore sp1" key="sp1" />, <i class="spore sp2" key="sp2" />,
			<i class="spore sp3" key="sp3" />, <i class="spore sp4" key="sp4" />,
		];
	}
	if (style === 'wave') {
		return [
			<i class="crest cr1" key="cr1" />, <i class="crest cr2" key="cr2" />,
			<i class="spray sp1" key="sp1" />, <i class="spray sp2" key="sp2" />,
			<i class="foam" key="foam" />,
		];
	}
	if (style === 'petal') {
		return [
			<i class="leaf lf1" key="lf1" />, <i class="leaf lf2" key="lf2" />,
			<i class="leaf lf3" key="lf3" />, <i class="blossom bl1" key="bl1" />,
			<i class="blossom bl2" key="bl2" />, <i class="swirl" key="swirl" />,
		];
	}
	if (style === 'bite') {
		return [
			<i class="jaw upper" key="ju" />, <i class="jaw lower" key="jl" />,
			<i class="tooth t1" key="t1" />, <i class="tooth t2" key="t2" />,
			<i class="crunch" key="cr" />,
		];
	}
	if (style === 'bubble') {
		return [
			<i class="sphere s1" key="s1" />, <i class="sphere s2" key="s2" />,
			<i class="sphere s3" key="s3" />, <i class="pop p1" key="p1" />,
			<i class="pop p2" key="p2" />,
		];
	}
	if (style === 'sonic') {
		return [
			<i class="wave wv1" key="wv1" />, <i class="wave wv2" key="wv2" />,
			<i class="wave wv3" key="wv3" />, <i class="echo ec1" key="ec1" />,
			<i class="echo ec2" key="ec2" />,
		];
	}
	if (style === 'mud') {
		return [
			<i class="glob gl1" key="gl1" />, <i class="glob gl2" key="gl2" />,
			<i class="splat sp1" key="sp1" />, <i class="splat sp2" key="sp2" />,
			<i class="mire" key="mire" />,
		];
	}
	if (style === 'wrap') {
		return [
			<i class="coil co1" key="co1" />, <i class="coil co2" key="co2" />,
			<i class="vine vn1" key="vn1" />, <i class="vine vn2" key="vn2" />,
			<i class="constrict" key="cs" />,
		];
	}
	if (style === 'note') {
		return [
			<i class="quaver q1" key="q1" />, <i class="quaver q2" key="q2" />,
			<i class="beam bm1" key="bm1" />, <i class="clef" key="clef" />,
			<i class="chime" key="chime" />,
		];
	}
	if (style === 'aura') {
		return [
			<i class="halo ha1" key="ha1" />, <i class="halo ha2" key="ha2" />,
			<i class="flare fl1" key="fl1" />, <i class="flare fl2" key="fl2" />,
			<i class="pulse" key="pulse" />,
		];
	}
	if (style === 'drill') {
		return [
			<i class="screw sc1" key="sc1" />, <i class="screw sc2" key="sc2" />,
			<i class="spiral sp1" key="sp1" />, <i class="bore" key="bore" />,
			<i class="spark spk" key="spk" />,
		];
	}
	if (style === 'acid') {
		return [
			<i class="ooze oz1" key="oz1" />, <i class="ooze oz2" key="oz2" />,
			<i class="corrode cr1" key="cr1" />, <i class="smoke sm1" key="sm1" />,
			<i class="fume" key="fume" />,
		];
	}
	if (style === 'wisp') {
		return [
			<i class="ghost gh1" key="gh1" />, <i class="ghost gh2" key="gh2" />,
			<i class="spirit sp1" key="sp1" />, <i class="haze hz1" key="hz1" />,
			<i class="chill" key="chill" />,
		];
	}
	if (style === 'meteor') {
		return [
			<i class="crag cr1" key="cr1" />, <i class="crag cr2" key="cr2" />,
			<i class="boulder bo1" key="bo1" />, <i class="streak st1" key="st1" />,
			<i class="crater" key="crater" />,
		];
	}
	if (style === 'wing') {
		return [
			<i class="pinion pn1" key="pn1" />, <i class="pinion pn2" key="pn2" />,
			<i class="quill ql1" key="ql1" />, <i class="down dw1" key="dw1" />,
			<i class="slash" key="slash" />,
		];
	}
	if (style === 'swift') {
		return [
			<i class="glint gl1" key="gl1" />, <i class="glint gl2" key="gl2" />,
			<i class="glint gl3" key="gl3" />, <i class="dart dt1" key="dt1" />,
			<i class="dart dt2" key="dt2" />,
		];
	}
	if (style === 'gold') {
		return [
			<i class="coin cn1" key="cn1" />, <i class="coin cn2" key="cn2" />,
			<i class="coin cn3" key="cn3" />, <i class="glimmer gm1" key="gm1" />,
			<i class="shine" key="shine" />,
		];
	}
	if (style === 'daze') {
		return [
			<i class="ring rg1" key="rg1" />, <i class="ring rg2" key="rg2" />,
			<i class="disc dc1" key="dc1" />, <i class="twirl tw1" key="tw1" />,
			<i class="swirl" key="swirl" />,
		];
	}
	if (style === 'sand') {
		return [
			<i class="grit gr1" key="gr1" />, <i class="grit gr2" key="gr2" />,
			<i class="grit gr3" key="gr3" />, <i class="dune dn1" key="dn1" />,
			<i class="tempest" key="tempest" />,
		];
	}
	if (style === 'lick') {
		return [
			<i class="tongue tg1" key="tg1" />, <i class="tongue tg2" key="tg2" />,
			<i class="saliva sl1" key="sl1" />, <i class="swipe" key="swipe" />,
		];
	}
	if (style === 'bone') {
		return [
			<i class="club cl1" key="cl1" />, <i class="club cl2" key="cl2" />,
			<i class="shaft sh1" key="sh1" />, <i class="strike" key="strike" />,
		];
	}
	if (style === 'ink') {
		return [
			<i class="blot bl1" key="bl1" />, <i class="blot bl2" key="bl2" />,
			<i class="spray sp1" key="sp1" />, <i class="murk" key="murk" />,
		];
	}
	if (style === 'tri') {
		return [
			<i class="flame" key="flame" />, <i class="ice" key="ice" />,
			<i class="spark" key="spark" />, <i class="trinity" key="trinity" />,
		];
	}
	if (style === 'fist') {
		return [
			<i class="knuckle kn1" key="kn1" />, <i class="knuckle kn2" key="kn2" />,
			<i class="punch pu1" key="pu1" />, <i class="slam" key="slam" />,
		];
	}
	if (style === 'shade') {
		return [
			<i class="gloom gl1" key="gl1" />, <i class="gloom gl2" key="gl2" />,
			<i class="pall" key="pall" />, <i class="murk" key="murk" />,
		];
	}
	if (style === 'kick') {
		return [
			<i class="heel he1" key="he1" />, <i class="heel he2" key="he2" />,
			<i class="boot bo1" key="bo1" />, <i class="stomp" key="stomp" />,
		];
	}
	if (style === 'chop') {
		return [
			<i class="edge ed1" key="ed1" />, <i class="edge ed2" key="ed2" />,
			<i class="blade bl1" key="bl1" />, <i class="cleave" key="cleave" />,
		];
	}
	if (style === 'rage') {
		return [
			<i class="frenzy fr1" key="fr1" />, <i class="frenzy fr2" key="fr2" />,
			<i class="fume fu1" key="fu1" />, <i class="roar" key="roar" />,
		];
	}
	if (style === 'shell') {
		return [
			<i class="carapace ca1" key="ca1" />, <i class="carapace ca2" key="ca2" />,
			<i class="shield sh1" key="sh1" />, <i class="bash" key="bash" />,
		];
	}
	if (style === 'kiss') {
		return [
			<i class="heart ht1" key="ht1" />, <i class="heart ht2" key="ht2" />,
			<i class="heart ht3" key="ht3" />, <i class="charm" key="charm" />,
		];
	}
	if (style === 'gyro') {
		return [
			<i class="top tp1" key="tp1" />, <i class="top tp2" key="tp2" />,
			<i class="rotor ro1" key="ro1" />, <i class="whirl" key="whirl" />,
		];
	}
	if (style === 'breath') {
		return [
			<i class="gale ga1" key="ga1" />, <i class="gale ga2" key="ga2" />,
			<i class="vapor va1" key="va1" />, <i class="blast" key="blast" />,
		];
	}
	if (style === 'cannon') {
		return [
			<i class="barrel ba1" key="ba1" />, <i class="barrel ba2" key="ba2" />,
			<i class="slug sl1" key="sl1" />, <i class="shot" key="shot" />,
		];
	}
	if (style === 'fall') {
		return [
			<i class="cascade ca1" key="ca1" />, <i class="cascade ca2" key="ca2" />,
			<i class="debris de1" key="de1" />, <i class="slide" key="slide" />,
		];
	}
	if (style === 'iron') {
		return [
			<i class="anvil an1" key="an1" />, <i class="anvil an2" key="an2" />,
			<i class="plate pl1" key="pl1" />, <i class="forge" key="forge" />,
		];
	}
	if (style === 'boom') {
		return [
			<i class="flash fl1" key="fl1" />, <i class="flash fl2" key="fl2" />,
			<i class="shrapnel sh1" key="sh1" />, <i class="blast" key="blast" />,
		];
	}
	if (style === 'web') {
		return [
			<i class="strand st1" key="st1" />, <i class="strand st2" key="st2" />,
			<i class="mesh me1" key="me1" />, <i class="snare" key="snare" />,
		];
	}
	if (style === 'tail') {
		return [
			<i class="lash ls1" key="ls1" />, <i class="lash ls2" key="ls2" />,
			<i class="sweep sw1" key="sw1" />, <i class="strike" key="strike" />,
		];
	}
	if (style === 'arrow') {
		return [
			<i class="fletching fl1" key="fl1" />, <i class="fletching fl2" key="fl2" />,
			<i class="shaft sh1" key="sh1" />, <i class="pierce" key="pierce" />,
		];
	}
	if (style === 'sleep') {
		return [
			<i class="drowse dr1" key="dr1" />, <i class="drowse dr2" key="dr2" />,
			<i class="slumber sl1" key="sl1" />, <i class="yawn" key="yawn" />,
		];
	}
	if (style === 'shield') {
		return [
			<i class="barrier ba1" key="ba1" />, <i class="barrier ba2" key="ba2" />,
			<i class="aegis ae1" key="ae1" />, <i class="guard" key="guard" />,
		];
	}
	return [
		<i class="burst b1" key="b1" />, <i class="burst b2" key="b2" />,
		<i class="shock" key="shock" />, <i class="dust d1" key="d1" />,
		<i class="dust d2" key="d2" />,
	];
}

export function TypeHit(props: { type: string, style?: HitStyle, tick?: number }) {
	const style = props.style || 'impact';
	const type = props.type || 'colorless';
	return <div
		class={`type-hit hit-${style} t-${type}`}
		data-tick={props.tick ?? 0}
		aria-hidden="true"
	>{hitStyleParts(style)}</div>;
}

export function AtkFlyer(props: {
	fromIid: string, targetIid: string, style: HitStyle, element?: string,
}) {
	const style = props.style || 'impact';
	const type = props.element || 'colorless';
	const beamish = style === 'beam' || style === 'shard' || style === 'roar' ||
		style === 'torrent' || style === 'frost' || style === 'stream';
	return <div
		class={`fx-atk-fly hit-${style} t-${type}${beamish ? ' is-beam' : ''}`}
		data-from={props.fromIid}
		data-target={props.targetIid}
		aria-hidden="true"
	>
		<i class="proj"></i>
		<i class="trail"></i>
		{beamish ? <>
			<i class="sheath"></i><i class="core"></i><i class="grain"></i>
			<i class="mote m1"></i><i class="mote m2"></i><i class="mote m3"></i>
		</> : null}
		{style === 'zap' ? <><i class="arc a2"></i><i class="arc a3"></i></> : null}
		{style === 'bolt' ? <><i class="fork f2"></i><i class="fork f3"></i><i class="glow"></i></> : null}
		{style === 'veil' ? <>
			<i class="core"></i><i class="wisp w1"></i><i class="wisp w2"></i><i class="wisp w3"></i>
		</> : null}
		{style === 'flame' ? <><i class="ember e1"></i><i class="ember e2"></i></> : null}
		{style === 'bloom' ? <><i class="lash"></i><i class="leaf"></i></> : null}
		{style === 'pulse' ? <>
			<i class="disc d1"></i><i class="disc d2"></i><i class="disc d3"></i><i class="spark"></i>
		</> : null}
		{style === 'sparkle' ? <><i class="star s1"></i><i class="star s2"></i><i class="star s3"></i></> : null}
		{style === 'whirl' ? <><i class="gust g1"></i><i class="gust g2"></i></> : null}
		{style === 'barrage' ? <><i class="peck p1"></i><i class="peck p2"></i></> : null}
		{style === 'drain' ? <><i class="wisp w1"></i><i class="wisp w2"></i></> : null}
		{style === 'sting' ? <i class="barb"></i> : null}
		{style === 'powder' ? <>
			<i class="cloud"></i><i class="spore s1"></i><i class="spore s2"></i><i class="spore s3"></i>
		</> : null}
		{style === 'wave' ? <>
			<i class="foam"></i><i class="grain"></i><i class="bubble b1"></i><i class="bubble b2"></i>
		</> : null}
		{style === 'petal' ? <><i class="petal p1"></i><i class="petal p2"></i><i class="petal p3"></i></> : null}
		{style === 'bubble' ? <><i class="bub b1"></i><i class="bub b2"></i><i class="bub b3"></i></> : null}
		{style === 'sonic' ? <>
			<i class="wave w1"></i><i class="wave w2"></i><i class="wave w3"></i>
			<i class="note n1"></i><i class="note n2"></i>
		</> : null}
		{style === 'mud' ? <><i class="grit"></i></> : null}
		{style === 'wrap' ? <><i class="coil c1"></i><i class="coil c2"></i></> : null}
		{style === 'note' ? <><i class="note n1"></i><i class="note n2"></i></> : null}
		{style === 'aura' ? <><i class="ring"></i><i class="grain"></i></> : null}
		{style === 'drill' ? <><i class="spin"></i></> : null}
		{style === 'acid' ? <><i class="drip"></i></> : null}
		{style === 'wisp' ? <><i class="flame"></i><i class="ember"></i></> : null}
		{style === 'meteor' ? <><i class="rock r1"></i><i class="rock r2"></i></> : null}
		{style === 'wing' ? <><i class="feather f1"></i><i class="feather f2"></i></> : null}
		{style === 'swift' ? <>
			<i class="star s1"></i><i class="star s2"></i><i class="star s3"></i>
			<i class="star s4"></i><i class="star s5"></i><i class="mote"></i>
		</> : null}
		{style === 'gold' ? <><i class="coin c1"></i><i class="coin c2"></i><i class="coin c3"></i></> : null}
		{style === 'daze' ? <><i class="disc d1"></i><i class="spiral"></i><i class="spark"></i></> : null}
		{style === 'sand' ? <>
			<i class="cloud"></i><i class="swirl"></i><i class="grit g1"></i><i class="grit g2"></i><i class="grain"></i>
		</> : null}
		{style === 'lick' ? <><i class="tongue"></i><i class="groove"></i><i class="drip"></i></> : null}
		{style === 'bone' ? <><i class="bone"></i><i class="chip"></i></> : null}
		{style === 'ink' ? <>
			<i class="blot"></i><i class="tendril t1"></i><i class="tendril t2"></i><i class="drip"></i><i class="grain"></i>
		</> : null}
		{style === 'tri' ? <><i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i></> : null}
		{style === 'fist' ? <><i class="knuckle"></i><i class="streak sk1"></i><i class="streak sk2"></i></> : null}
		{style === 'shade' ? <><i class="sil"></i><i class="haze"></i><i class="wisp w1"></i><i class="wisp w2"></i></> : null}
		{style === 'kiss' ? <><i class="heart h1"></i><i class="heart h2"></i><i class="heart h3"></i></> : null}
		{style === 'breath' ? <><i class="ball"></i><i class="ember e1"></i><i class="ember e2"></i></> : null}
		{style === 'cannon' ? <><i class="spike sp1"></i><i class="spike sp2"></i><i class="spike sp3"></i></> : null}
		{style === 'boom' ? <>
			<i class="burst"></i><i class="rock r1"></i><i class="rock r2"></i><i class="spark"></i>
		</> : null}
		{style === 'web' ? <i class="net"></i> : null}
		{style === 'arrow' ? <i class="shaft"></i> : null}
		{style === 'sleep' ? <><i class="zed z1"></i><i class="zed z2"></i><i class="zed z3"></i></> : null}
	</div>;
}

export function FxCaption(props: { tag: string, title?: string }) {
	const slug = String(props.tag || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
	return <div class={`fx-caption k-${slug}`}>
		<b>{props.tag}</b>
		{props.title ? <span>{props.title}</span> : null}
	</div>;
}

export function BoardMsg(props: { tag: string, text: string, yours?: boolean, tone?: string }) {
	const slug = String(props.tag || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
	const tone = props.tone || slug;
	return <div class={`fx-board-msg k-${tone}${props.yours ? ' yours' : ' foe'}`}>
		<b>{props.tag}</b>
		<span>{props.text}</span>
	</div>;
}

export function fanCards(n: number) {
	const c = Math.min(Math.max(n || 5, 3), 7);
	const mid = (c - 1) / 2;
	return Array.from({ length: c }, (_, i) =>
		<span class="fx-mini-card back fan" style={{ '--t': String(i - mid) } as any}></span>
	);
}

export function MiniArt(props: { cardId?: string, name?: string }) {
	const src = props.cardId && typeof cardArt === 'function' ? cardArt(props.cardId) : '';
	if (!src) return <span class="fx-mini-card back"></span>;
	return <img src={src} alt={props.name || ''} draggable={false} />;
}

export class FxOverlay extends preact.Component<{
	fx: FxBeat | null,
	you?: number | null,
	viewpoint?: 0 | 1,
	names?: string[],
}> {
	override render() {
		const fx = this.props.fx;
		if (!fx?.kind) return null;
		const layoutSeat = this.props.viewpoint != null ? this.props.viewpoint :
			(this.props.you != null ? this.props.you : 0);
		const seat = fx.seat === layoutSeat ? 'fx-p1' : 'fx-p2';
		const yours = actorIsYou(fx.seat, this.props.you);
		const art = fx.cardId ? <MiniArt cardId={fx.cardId} name={fx.extra} /> : null;
		const k = fx.kind;
		const pendingMsg = (tag: string, fallback: string, tone?: string) =>
			<BoardMsg tag={tag} text={fx.message || fallback} yours={yours} tone={tone} />;
		const cap = (tag: string, title?: string) => <FxCaption tag={tag} title={title} />;
		const wrap = (kind: string, body: any, src?: string) => (
			<div class={`fx-layer kind-${kind}${src ? ` src-${src}` : ''}${yours ? ' yours' : ' foe'}`}>
				{body}
			</div>
		);

		if (fx.spotlight) {
			// with reduced motion nothing flies, so the card is shown still in the middle for the beat instead
			if (!fx.cardId || !tcgReduceMotion()) return null;
			return wrap(k === 'trainer' ? 'trainer' : 'stadium', <div class="fx-play-card reveal">
				{art}<div class="fx-play-name">{cardLabel(fx.cardId)}</div>
			</div>);
		}

		if (k === 'coin') {
			const coins = (fx.coins?.length) ? fx.coins :
				[fx.extra === 'Heads' || fx.extra === 'HEADS'];
			const shown = coins.slice(0, 8);
			const headsN = shown.filter(Boolean).length;
			const tailsN = shown.length - headsN;
			const forFirst = fx.extra === 'First';
			const side = forFirst ? (shown[0] ? 'HEADS' : 'TAILS') :
				shown.length === 1 ?
					(shown[0] ? 'HEADS' : 'TAILS') :
					`${headsN}H ${tailsN}T`;
			const result = fx.message || (shown.length === 1 ?
				(shown[0] ? 'Heads!' : 'Tails!') :
				`${headsN} Heads, ${tailsN} Tails`);
			const lifeMs = (forFirst ? 2700 : 2200) + Math.max(0, shown.length - 1) * 200;
			return wrap('coin', <>
				{cap(forFirst ? 'FIRST' : 'COIN', side)}
				<div
					class={`fx-coin-row n-${shown.length}`}
					style={{ animationDuration: `${lifeMs}ms` }}
				>
					{shown.map((heads, idx) => (
						<div
							class="fx-coin-scene"
							key={`coin-${idx}-${heads ? 'h' : 't'}`}
							style={{ '--coin-delay': `${idx * 0.16}s` } as any}
						>
							<div class={`fx-coin-3d ${heads ? 'land-heads' : 'land-tails'}`}>
								<div class="fx-coin-face front">
									<span>H</span>
									<em>HEADS</em>
								</div>
								<div class="fx-coin-face back">
									<span>T</span>
									<em>TAILS</em>
								</div>
							</div>
						</div>
					))}
				</div>
				<div class="fx-coin-result" style={{ animationDuration: `${lifeMs}ms` }}>{result}</div>
			</>);
		}
		const actorName = (fx.seat === 0 || fx.seat === 1) ?
			(this.props.names?.[fx.seat] || `Player ${fx.seat + 1}`) : '';
		const actionRail = (action: string, caption: string, backs = 0) => {
			const ids = (fx.ids?.length) ? fx.ids : [];
			const faces = ids.length > 0;
			const count = Math.min(faces ? ids.length : backs, 8);
			const effect = fx.extra || '';
			return <div class={`fx-draw-rail ${seat}${yours ? ' yours' : ' foe'}`}>
				<div class="fx-draw-source">
					{fx.cardId ?
						<span class="fx-draw-source-art"><MiniArt cardId={fx.cardId} name={effect || action} /></span> :
						(!faces && backs > 0 ?
							<span class="fx-draw-source-art back"><span class="fx-mini-card back"></span></span> :
							null)}
					<div class="fx-draw-source-meta">
						<b>{action}</b>
						{effect ? <em>{effect}</em> : null}
						{actorName ? <span class="fx-draw-who">{actorName}</span> : null}
					</div>
				</div>
				{count > 0 ? <div class="fx-draw-stack">
					{Array.from({ length: count }, (_, i) =>
						faces ?
							<span class="fx-draw-card face" style={{ '--i': String(i) } as any} key={i}>
								<MiniArt cardId={ids[i]} name={(fx.labels?.[i]) || ''} />
							</span> :
							<span class="fx-draw-card back" style={{ '--i': String(i) } as any} key={i}>
								<span class="fx-mini-card back"></span>
							</span>
					)}
				</div> : null}
				{caption ? <div class="fx-draw-caption">{caption}</div> : null}
			</div>;
		};
		if (k === 'drawEffect') {
			const n = Math.max(fx.n || 0, fx.ids?.length || 0, 1);
			const faces = !!fx.ids?.length;
			const caption = fx.message || (n === 1 ? 'Drew a card' : `Drew ${n} cards`);
			return wrap('drawEffect', actionRail(fx.action || 'Draw', caption, faces ? 0 : Math.min(n, 8)));
		}
		if (k === 'draw' || k === 'deal') {
			const marks = k === 'deal' ?
				<><span class="fx-move-mark fx-p1"></span><span class="fx-move-mark fx-p2"></span></> :
				<span class={`fx-move-mark ${seat}`}></span>;
			return wrap('draw', marks);
		}
		if (k === 'shuffleHand') {
			return wrap('shuffleHand', <></>);
		}
		if (k === 'shuffle') {
			return wrap('shuffle', cap('SHUFFLE', 'Deck'));
		}
		if (k === 'search' && fx.pile === 'discard') {
			const mark = <i class={`fx-search-pile ${seat}`}></i>;
			return wrap('search', yours ?
				<>{mark}{actionRail(fx.action || 'Search', fx.message || 'Searching your discard pile', 0)}</> :
				<>{mark}{pendingMsg('SEARCH', 'Opponent is searching their discard pile', 'search')}</>, 'discard');
		}
		if (k === 'search') {
			if (!yours) {
				return wrap('search', <>
					{pendingMsg('SEARCH', 'Opponent is searching for a card', 'search')}
					<div class={`fx-search-fan ${seat}`}>{fanCards(5)}</div>
					<div class={`fx-search-glow ${seat}`}></div>
				</>);
			}
			const backs = Math.min(fx.n || 5, 5);
			return wrap('search', actionRail(fx.action || 'Search', fx.message || 'Searching the deck', backs));
		}
		if (k === 'searchDone') {
			return wrap('search', actionRail(fx.action || 'Shuffle', fx.message || 'Shuffled the deck', 0));
		}
		if (k === 'mulligan') {
			return wrap('mulligan', <>
				{pendingMsg('MULLIGAN', 'Took a mulligan', 'mulligan')}
				<div class={`fx-search-fan ${seat}`}>{fanCards(7)}</div>
			</>);
		}
		if (k === 'reveal' || k === 'find') {
			const action = fx.action || (k === 'reveal' ? 'Reveal' : 'Find');
			const caption = fx.tag || fx.message || action;
			const hidden = k === 'find' && !fx.ids?.length ? 1 : 0;
			return wrap(k, actionRail(action, caption, hidden));
		}
		if (k === 'discard') {
			return wrap('discard', <span class={`fx-move-mark ${seat}`}></span>);
		}
		if (k === 'prize' || k === 'prizeTake') {
			return wrap('prize', <span class={`fx-move-mark ${seat}`}></span>);
		}
		if (k === 'energy' || k === 'tool') {
			const enName = fx.extra || (k === 'tool' ? 'Pokémon Tool' : 'Energy');
			return wrap(k, cap(k === 'tool' ? 'TOOL' : 'ENERGY', enName));
		}
		if (k === 'place') {
			return wrap('place', cap(fx.tag || (fx.fromBench ? 'SWITCH' : 'INTO PLAY'), fx.extra));
		}
		if (k === 'evolve') {
			const fromArt = fx.fromCardId ? <MiniArt cardId={fx.fromCardId} /> : null;
			const toArt = art || <span class="fx-mini-card face"></span>;
			return wrap('evolve', <>
				<div class="fx-evolve-stage">
					<span class="fx-evolve-flash"></span>
					<span class="fx-evolve-ring r1"></span>
					<span class="fx-evolve-ring r2"></span>
					<span class="fx-evolve-spark s1"></span>
					<span class="fx-evolve-spark s2"></span>
					<span class="fx-evolve-spark s3"></span>
					<span class="fx-evolve-spark s4"></span>
					<span class="fx-evolve-spark s5"></span>
					<span class="fx-evolve-spark s6"></span>
					<div class="fx-evolve-morph">
						{fromArt ?
							<span class="fx-evolve-from">{fromArt}</span> :
							<span class="fx-evolve-from fx-mini-card face"></span>}
						<span class="fx-evolve-to">{toArt}</span>
					</div>
					{fx.extra ? <div class="fx-evolve-name">{fx.extra}</div> : null}
				</div>
			</>);
		}
		if (k === 'attack' || k === 'ability') {
			if (fx.travel && fx.iid && fx.targetIid && fx.hitStyle) {
				return wrap(k, <AtkFlyer
					fromIid={fx.hitStyle === 'drain' ? fx.targetIid : fx.iid}
					targetIid={fx.hitStyle === 'drain' ? fx.iid : fx.targetIid}
					style={fx.hitStyle}
					element={fx.element}
				/>);
			}
			return null;
		}
		if (k === 'turn') {
			const name = (this.props.names || [])[fx.seat ?? -1] || 'Opponent';
			const whose = yours ? 'Your turn' : `${name}'s turn`;
			const first = fx.n === 1;
			return wrap(`turn${first ? ' first-turn' : ''}`, cap(first ? 'FIRST TURN' : `TURN ${fx.n || ''}`.trim(), whose));
		}
		if (k === 'first') return wrap('first', cap('FIRST', fx.extra));
		if (k === 'over') {
			return null;
		}
		if (k === 'points') return wrap('points', <div class="fx-points-burst">+{fx.n || 1}</div>);
		if (k === 'status') return wrap('status', cap('STATUS', fx.extra ? String(fx.extra) : 'Recovered'));
		if (k === 'attackFailed') return wrap('status', cap('FAILED', fx.extra || 'Attack'));
		if (k === 'suddenDeath') return wrap('status', cap('SUDDEN DEATH', fx.extra || 'Tiebreaker'));
		if (k === 'checkup') return wrap('checkup', cap('CHECKUP', 'Pokémon Checkup'));
		if (k === 'discard') return wrap('discard', cap('DISCARD', fx.extra || 'Discard'));
		if (k === 'ko') {
			return null;
		}
		if (k === 'heal') {
			return wrap('heal', <div class="fx-heal-aura"></div>);
		}
		if (k === 'damage') {
			if (fx.travel && fx.fromIid && fx.iid && fx.hitStyle) {
				return wrap('damage', <AtkFlyer
					fromIid={fx.hitStyle === 'drain' ? fx.iid : fx.fromIid}
					targetIid={fx.hitStyle === 'drain' ? fx.fromIid : fx.iid}
					style={fx.hitStyle}
					element={fx.element}
				/>);
			}
			return null;
		}
		return null;
	}
}
