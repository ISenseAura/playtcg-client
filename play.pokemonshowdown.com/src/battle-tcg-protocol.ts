import {
	type TcgEvent,
	type TcgSnapshot,
	cloneTcgSnapshot,
} from "./battle-tcg-types";

/** archive players have the starting list, a public seat only keeps id and name */
function publicArchivePlayer(player: any) {
	if (!player || typeof player !== 'object') return player;
	const { deck: _deck, zoneTypes: _zoneTypes, ...rest } = player;
	return rest;
}

function snapshotSeatIsPrivate(player: any) {
	return !!player && (Array.isArray(player.deck) || 'zoneTypes' in player);
}

/**
 * spectator snapshots are public except a leaked starting list or `zoneTypes`. `deck: { count }` stays. doesn't
 * touch the caller's snapshot
 */
function detachPublicSnapshot(snap: TcgSnapshot): TcgSnapshot {
	const scrubbed = scrubTcgSpectatorView(snap);
	if (!scrubbed.players?.some(snapshotSeatIsPrivate)) return scrubbed;
	const base = scrubbed === snap ? cloneTcgSnapshot(snap) : scrubbed;
	base.players = base.players.map(player => {
		if (!snapshotSeatIsPrivate(player)) return player;
		const next: any = { ...player };
		if (Array.isArray(next.deck)) delete next.deck;
		delete next.zoneTypes;
		return next;
	}) as TcgSnapshot['players'];
	return base;
}

export function publicGameEnd(e: TcgEvent): TcgEvent {
	const out = { ...e };
	if (out.replay) {
		const replay: any = { ...out.replay, audience: 'public' };
		delete replay.seed;
		delete replay.manifest;
		if (Array.isArray(replay.players)) {
			replay.players = replay.players.map(publicArchivePlayer);
		}
		const spec = e.replay?.spectator;
		if (spec) {
			const snap = spec.snapshot ? detachPublicSnapshot(spec.snapshot) : spec.snapshot;
			replay.spectator = { ...spec, snapshot: snap, events: spec.events || [] };
			replay.snapshot = snap;
			replay.events = spec.events || [];
		} else if (replay.snapshot) {
			replay.snapshot = detachPublicSnapshot(replay.snapshot);
			replay.events = filterTcgEventsForViewer(replay.events, null) || [];
		}
		out.replay = replay;
	}
	return out;
}

export function filterTcgEventsForViewer(
	events: TcgEvent[] | undefined,
	you: 0 | 1 | null
): TcgEvent[] | undefined {
	if (!events?.length) return events;
	return events.map(e => {
		if (e.type === 'gameEnd') return publicGameEnd(e);
		if (e.type === 'find') {
			if (e.revealed) return e;
			if (you == null || e.seat !== you) {
				const { ids: _ids, ...rest } = e;
				return rest as TcgEvent;
			}
			return e;
		}
		if (e.type === 'request' && e.kind === 'search' && (e.ids || e.legal || e.seen)) {
			const waiting = Array.isArray(e.waiting) ? e.waiting : [];
			const chooser = waiting[0];
			if (you == null || chooser == null || you !== chooser) {
				const { ids: _ids, legal: _legal, seen: _seen, ...rest } = e;
				return rest as TcgEvent;
			}
		}
		if (e.type === 'act' && e.hiddenPick && you !== e.seat) {
			const { hiddenPick: _hidden, ...rest } = e;
			return { ...rest, action: { ...e.action, pick: '' } } as TcgEvent;
		}
		if (e.type === 'act' && e.hiddenPick) {
			const { hiddenPick: _hidden, ...rest } = e;
			return rest as TcgEvent;
		}
		if (e.type === 'act' && e.action?.type === 'searchPick' && you !== e.seat) {
			const pick = String(e.action.pick || '');
			const shown = !!pick && events.some(f =>
				f.type === 'find' && f.revealed && f.seat === e.seat &&
				Array.isArray(f.ids) && f.ids.includes(pick)
			);
			if (!shown) return { ...e, action: { ...e.action, pick: '' } };
		}
		if (e.type === 'draw' || e.type === 'prizeTake' || e.type === 'fromHand' || e.type === 'fromDeck') {
			if (you == null || e.seat !== you) {
				const { ids: _ids, ...rest } = e;
				return rest as TcgEvent;
			}
		}
		if ((e.type === 'toDeck' && e.from === 'hand' && !e.revealed) ||
			(e.type === 'toLost' && (e.from === 'hand' || e.from === 'deck'))) {
			if (you == null || e.seat !== you) {
				const { ids: _ids, ...rest } = e;
				return rest as TcgEvent;
			}
		}
		if (e.type === 'deal') {
			const out = { ...e };
			if (you !== 0) delete (out as { ids0?: string[] }).ids0;
			if (you !== 1) delete (out as { ids1?: string[] }).ids1;
			return out as TcgEvent;
		}
		return e;
	});
}

export function spectatorReplayFrom(data: any): {
	snapshot: TcgSnapshot, events: TcgEvent[], winnerName: string | null,
} | null {
	if (!data || typeof data !== 'object') return null;
	let replay = data.replay;
	let result = data.result;
	if (data.type === 'gameEnd') {
		const clean = publicGameEnd(data);
		replay = clean.replay;
		result = clean.replay?.result || data.result;
	}
	const players = Array.isArray(data.players) ? data.players : [];
	const hosted = data.audience === 'host' || data.seed != null ||
		players.some((p: { deck?: unknown }) => Array.isArray(p?.deck));
	if (data.type !== 'gameEnd' && !hosted) return null;
	const spec = (replay || data).spectator;
	if (!spec?.snapshot) return null;
	const seat = result?.winner;
	const winnerName = seat == null ? null : (spec.snapshot.players?.[seat]?.name || null);
	// a gameEnd was already copied by publicGameEnd, a raw host file wasn't. its spectator snapshot is still the
	// caller's object, so detach it before playback stores it
	const snapshot = data.type === 'gameEnd' ? spec.snapshot : detachPublicSnapshot(spec.snapshot);
	return {
		snapshot,
		events: Array.isArray(spec.events) ? spec.events : [],
		winnerName,
	};
}

export function scrubTcgSpectatorView(snap: TcgSnapshot): TcgSnapshot {
	if (snap.you != null) return snap;
	const out = cloneTcgSnapshot(snap);
	out.actions = [];
	delete out.pendingSearch;
	delete out.pendingDiscard;
	delete out.pendingRetreatPay;
	delete out.pendingDiscardEnergy;
	delete out.pendingConfirm;
	delete out.pendingSlotPick;
	delete out.pendingCopyAttack;
	delete out.pendingHandEnergy;
	for (const p of out.players) {
		if (!p) continue;
		if (Array.isArray(p.hand)) p.hand = { count: p.hand.length };
	}
	return out;
}

export function tcgSeqGap(seen: number, events: TcgEvent[] | undefined): boolean {
	if (!events?.length) return false;
	let cursor = seen;
	for (const e of events) {
		if (typeof e.seq !== 'number') continue;
		if (cursor === 0 && e.seq > 0) {
			cursor = e.seq;
			continue;
		}
		if (e.seq <= cursor) continue;
		if (e.seq !== cursor + 1) return true;
		cursor = e.seq;
	}
	return false;
}

export const TCG_RESYNC_RETRY_MS = 5000;

export interface TcgSeqState {
	seen: number;
	pendingAt: number | null;
}

export function tcgSeqStep(
	state: TcgSeqState,
	data: { events?: TcgEvent[], seq?: number, snapshot?: unknown, resync?: boolean },
	now = Date.now()
): { drop: boolean, request: boolean, seen: number, pendingAt: number | null } {
	if (data.resync && data.snapshot) {
		const resyncSeq = typeof data.seq === 'number' ? data.seq : state.seen;
		if (resyncSeq < state.seen) {
			return {
				drop: true,
				request: false,
				seen: state.seen,
				pendingAt: state.pendingAt,
			};
		}
		return {
			drop: false,
			request: false,
			seen: resyncSeq,
			pendingAt: null,
		};
	}

	let maxSeq = state.seen;
	for (const e of data.events || []) {
		if (typeof e.seq === 'number' && e.seq > maxSeq) maxSeq = e.seq;
	}
	if (typeof data.seq === 'number' && data.seq > maxSeq) maxSeq = data.seq;

	if (tcgSeqGap(state.seen, data.events)) {
		const fresh = state.pendingAt == null || (now - state.pendingAt >= TCG_RESYNC_RETRY_MS);
		return {
			drop: true,
			request: fresh,
			seen: state.seen,
			pendingAt: fresh ? now : state.pendingAt,
		};
	}
	return {
		drop: false,
		request: false,
		seen: maxSeq,
		pendingAt: null,
	};
}

export interface TcgSeqRoom {
	tcgSeqSeen: number;
	tcgResyncAt: number | null;
	tcgSnapshot?: { status?: string } | null;
	tcgReplayMode?: boolean;
	tcgEnded?: boolean;
	requestTcgResync?: () => void;
	tcgResyncDone?: () => void;
	sendDirect?: (cmd: string) => void;
}

export function tcgDropSetupResync(
	board: { you?: number | null, status?: string } | null | undefined,
	playing: boolean,
	requested: boolean,
	data: { kind?: string, snapshot?: { status?: string, you?: number | null }, events?: TcgEvent[] }
): boolean {
	if (data?.snapshot?.status !== 'setup') return false;
	if (data.events && data.events.length > 0) return false;
	if (requested) return false;
	if (!playing) return false;
	if (board == null || (board.you == null && data.snapshot.you != null)) return false;
	return true;
}

export function tcgSeqGate(
	room: TcgSeqRoom,
	data: { events?: TcgEvent[], seq?: number, snapshot?: unknown, resync?: boolean },
	skipFx = false,
	now = Date.now()
): { drop: boolean, seqAfter: number } {
	let maxSeq = room.tcgSeqSeen;
	for (const e of data.events || []) {
		if (typeof e.seq === 'number' && e.seq > maxSeq) maxSeq = e.seq;
	}
	if (typeof data.seq === 'number' && data.seq > maxSeq) maxSeq = data.seq;

	if (skipFx || room.tcgReplayMode) {
		return { drop: false, seqAfter: maxSeq };
	}

	const wasPending = room.tcgResyncAt != null;
	const step = tcgSeqStep(
		{ seen: room.tcgSeqSeen, pendingAt: room.tcgResyncAt },
		data,
		now
	);
	room.tcgResyncAt = step.pendingAt;

	if (step.drop) {
		if (step.request && !room.tcgEnded) {
			if (typeof room.requestTcgResync === 'function') {
				room.requestTcgResync();
			} else if (typeof room.sendDirect === 'function') {
				room.sendDirect('/tcgresync');
			}
		}
		return { drop: true, seqAfter: room.tcgSeqSeen };
	}

	if (wasPending && room.tcgResyncAt == null) {
		if (typeof room.tcgResyncDone === 'function') {
			room.tcgResyncDone();
		}
	}

	return { drop: false, seqAfter: step.seen };
}

export const TCG_RESYNC_MAX_TRIES = 3;

export interface TcgResyncTimers {
	set?: (fn: () => void, ms: number) => any;
	clear?: (timer: any) => void;
	window?: {
		setTimeout: (cb: () => void, ms: number) => any,
		clearTimeout: (id: any) => void,
	};
	now?: () => number;
}

export function createTcgResyncRetry(opts: {
	send: () => void,
	pending: () => boolean,
	alive: () => boolean,
	intervalMs?: number,
	maxTries?: number,
	timers?: TcgResyncTimers,
}) {
	const interval = opts.intervalMs ?? TCG_RESYNC_RETRY_MS;
	const max = opts.maxTries ?? TCG_RESYNC_MAX_TRIES;
	const timers = opts.timers;
	const setTimer: (fn: () => void, ms: number) => any = (
		timers && typeof timers.set === 'function' ?
			timers.set.bind(timers) :
			(timers?.window?.setTimeout ?
				timers.window.setTimeout.bind(timers.window) :
				(typeof window !== 'undefined' && window.setTimeout ?
					window.setTimeout.bind(window) :
					setTimeout))
	);
	const clearTimer: (id: any) => void = (
		timers && typeof timers.clear === 'function' ?
			timers.clear.bind(timers) :
			(timers?.window?.clearTimeout ?
				timers.window.clearTimeout.bind(timers.window) :
				(typeof window !== 'undefined' && window.clearTimeout ?
					window.clearTimeout.bind(window) :
					clearTimeout))
	);

	let currentTimer: any = null;
	let tries = 0;
	let generation = 0;

	const cancel = () => {
		if (currentTimer != null) {
			clearTimer(currentTimer);
			currentTimer = null;
		}
		tries = 0;
		generation++;
	};

	const onTimer = (gen: number) => {
		if (gen !== generation) return;
		if (currentTimer == null) return;
		currentTimer = null;
		if (!opts.alive() || !opts.pending()) {
			cancel();
			return;
		}
		tries++;
		opts.send();
		if (tries < max) {
			currentTimer = setTimer(() => onTimer(gen), interval);
		} else {
			currentTimer = null;
		}
	};

	const request = () => {
		if (!opts.alive()) return;
		if (currentTimer != null) return;
		tries = 1;
		generation++;
		const gen = generation;
		opts.send();
		if (tries < max) {
			currentTimer = setTimer(() => onTimer(gen), interval);
		}
	};

	const running = () => currentTimer != null;

	return {
		request,
		cancel,
		running,
		trigger: request,
		clear: cancel,
		triesLeft: () => Math.max(0, max - tries),
		active: running,
	};
}

/**
 * the engine gives a reason when it has one ("Patrat's Watchful Eye: damage counters can't be moved."). a
 * refusal without one still says so
 */
export function tcgRefusalText(message: string): string {
	const reason = String(message || '').replace(/^\s*\[Invalid choice\]\s*/i, '').trim();
	if (!reason || /^that play isn't legal\.?$/i.test(reason)) return "That can't be done right now.";
	return reason;
}

export function tcgFreshEvents(
	room: { tcgSeqSeen: number },
	events: TcgEvent[] | undefined,
	skipFx: boolean
) {
	if (!events?.length) return events;
	if (skipFx) return events;
	const seen = room.tcgSeqSeen;
	return events.filter(e => typeof e.seq !== 'number' || e.seq > seen);
}

export function tcgBatchActor(events: TcgEvent[] | undefined): number | null {
	if (!events?.length) return null;
	for (const e of events) {
		if (e.type === 'act' && typeof e.seat === 'number') return e.seat;
	}
	return null;
}

export function tcgInputWaitsOnBatch(
	events: TcgEvent[] | undefined,
	you: number | null | undefined
): boolean {
	if (you == null) return true;
	if (tcgBatchActor(events) !== you) return true;
	return !!events?.some(e => e.type === 'turn' && e.seat === you);
}
