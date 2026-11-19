import preact from "../js/lib/preact";
import { PS } from "./client-main";
import {
	boardChoiceOf, choiceFromText, choiceSourceFor, findChoiceMon, planChoiceBar, planChoicePicker,
	type BoardChoice, type BoardChoiceCard, type BoardChoiceLocal, type BoardChoiceSource, type ChoiceRect,
	type ChoiceBarSize,
} from "./battle-tcg-choice";
import {
	type TcgSlot, type TcgAction, type TcgEvent, type TcgPokemonView, type TcgPlayerView, type TcgSnapshot,
	findMonSlot, findMonView, cloneTcgSnapshot, normalizeTcgEnergy, energyTypeFromCardId, handAsIds,
} from "./battle-tcg-types";
import {
	handFan, reconcileHandOrder, orderHandFan, moveHandOrder, readHandOrder, writeHandOrder,
	handScrollToReveal, handWheelTarget, handEdgeFlags, HAND_STRIP_QUERY, type HandGone,
} from "./battle-tcg-hand";
import {
	applyBatchEvent,
} from "./battle-tcg-reducer";
import {
	type CardFlight, type FlightZone, cardFlights, attackHits, attackHitIndexes, hitFromEvent, resolveHitStyle,
	type FxBeat, aimedHit, visibleHit, attackElement, isHitEvent, skipEvent,
	type AttackCtx, type FxHit, type FlightZoneKind,
} from "./battle-tcg-flights";
import {
	cardLabel,
	statusWord, firstPlayerBanner, type KoGhost,
	FIRST_BANNER_BLOCKS, energySymbolUrl, noteTcgCardNames,
	actorIsYou, actorLabel, userName, dmgSrc, sourceName, type PkFx,
} from "./battle-tcg-log";
import {
	tcgReduceMotion, tcgFxScale, fxMs, fxDuration, fxFor, buildPkFx,
	FxOverlay, hasOpeningFlipEvents,
} from "./battle-tcg-fx";
import {
	isPocketCardId, paperTcgIoArt, scrydexArt,
	cardArt, cardBackArt,
	noArtCards, NoArtFace, CardBackFace, choiceArtFallback, pileCount,
	handIds, sameSlot, actionTouchesHand, samePairedPlays, actionTouchesSlot, actionTouchesSide, rowsStillOffered,
	foeHandChoice, foeHandRows, ownHandChoice, ownHandHint, slotPickHint,
	hasBoardTarget, type DropTarget, type DragSource, type DragState, dropVerb, actionsForDrop,
	canDropAnywhere, handCardId, whyCant,
	playChoiceCardId, playChoiceText, retreatPayOver,
	type HeldChoice, heldChoice, isHeldPickType, heldUndoFor, heldCount, heldGroups, heldPickLabel, heldCountText,
	heldOrbIndexes,
	whyMon, sameDrop, prizesLeft, scoredPoints, pip,
	type AttachBrowse, attachBrowseOf, attachedKindLabel,
	searchPromptState, searchDeckRows, promptHeading, isOwnCopyPromptRow, optionalAttackPair,
	copyPickCardId, describeAction, actionTargetKey, isMultiTargetGroup,
	moveTargetGroup, uniqueTargetActions, describeMoveTarget, retreatSignature, retreatChoice,
	deckLookPrompt, deckLookAction, menuActionsForSlot,
	stadiumClickAction, stadiumUseHint, type PrizeRailSlot, bindPrizeSlots,
	pendingPrizePicks, prizePromptWaits, TcgCardFace, TcgMon, TcgPoints, TcgPrizeRail,
	menuRows, psMoveType, type MenuRow, type Preview,
} from "./battle-tcg-cards";

export {
	isTcgBattleId, normalizeTcgEnergy,
	type TcgAction, type TcgEvent, type TcgPokemonView, type TcgPlayerView, type TcgSnapshot,
} from "./battle-tcg-types";
export {
	filterTcgEventsForViewer, spectatorReplayFrom, scrubTcgSpectatorView, tcgSeqGate,
	tcgDropSetupResync, tcgFreshEvents, createTcgResyncRetry, tcgInputWaitsOnBatch, tcgRefusalText,
} from "./battle-tcg-protocol";
export {
	chatEntryForEvent, chatHtmlForEntry, noteTcgMons, noteTcgCardNames, loadPaperNames,
	eventCardIds, unnamedCardIds, cardNamesOfEvents,
	tcgOpeningRules, tcgFormatTitle,
} from "./battle-tcg-log";
export {
	applyTcgEvents,
} from "./battle-tcg-reducer";
export {
	collectPrizeTakes,
} from "./battle-tcg-cards";

declare const loadTcgCardIndex: (() => Promise<any>) | undefined;
declare const tcgCardIndexStatus: (() => string) | undefined;

export function escapeSelector(str: string): string {
	if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(str);
	return str.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
}

export class TcgBoardErrorBoundary extends preact.Component<{
	onResync?: () => void,
	children?: any,
}, { error: Error | null }> {
	override state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, errorInfo: any) {
		if (typeof console !== 'undefined' && console.error) {
			console.error('TcgBoard error boundary caught:', error, errorInfo);
		}
	}

	reset = () => {
		this.setState({ error: null });
		this.props.onResync?.();
	};

	override render() {
		if (this.state.error) {
			return <div class="tcg-board-error" role="alert">
				<div class="tcg-board-error-content">
					<h3>A rendering error occurred in the TCG battle board.</h3>
					<p>You can resynchronize the game state with the server to continue playing.</p>
					<button type="button" class="button" onClick={this.reset}>
						Resync Game
					</button>
				</div>
			</div>;
		}
		return this.props.children;
	}
}

export class TcgBoard extends preact.Component<{
	snapshot: TcgSnapshot,
	viewpoint?: 0 | 1,
	events: TcgEvent[],
	playing?: boolean,
	resumeAt?: number,
	fxKey: number,
	halt?: number,
	fxSnapshot?: TcgSnapshot | null,
	waiting: boolean,
	notice?: string,
	noticeN?: number,
	ended?: boolean,
	aborted?: boolean,
	stopReason?: string,
	winnerName?: string | null,
	onAct: (action: TcgAction) => void,
	onEvent?: (ev: TcgEvent) => void,
	/** `halt` is the room's `halt` from when the batch started, so a beat from a replaced playback gets ignored */
	onFxDone?: (halt?: number) => boolean,
	paused?: boolean,
	onTogglePause?: () => void,
	onReplay?: () => void,
	onSkip?: () => void,
	animating?: boolean,
	showReplayControls?: boolean,
	replayDock?: any,
	/** each index was into the pile when it was taken (the server splices), not the original spot */
	prizeTakes?: [number[], number[]],
}> {
	override state = {
		selectedHand: null as number | null,
		energyPick: false,
		retreatPick: false,
		retreatSig: null as string | null,
		fx: null as FxBeat | null,
		pkFx: {} as { [iid: string]: PkFx },
		koGhost: null as KoGhost | null,
		koHide: {} as { [iid: string]: true },
		placeIn: null as { seat: number, slot: TcgSlot, mon: TcgPokemonView } | null,
		placeOut: null as { seat: number, slot: TcgSlot, mon: TcgPokemonView } | null,
		live: { hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {} } as {
			hand: { [cardId: string]: number },
			hp: { [iid: string]: number },
			energy: { [iid: string]: string[] },
			prizes: { [seat: number]: number },
			deck: { [seat: number]: number },
			handN: { [seat: number]: number },
			discardN: { [seat: number]: number },
			points: { [seat: number]: number },
			gained: { [seat: number]: string[] },
		},
		liveKey: -1,
		inspect: null as Preview | null,
		handStrip: typeof matchMedia === 'function' && matchMedia(HAND_STRIP_QUERY).matches,
		handSheet: false,
		promptPeek: false,
		menuSlot: null as TcgSlot | null,
		endTurnConfirm: false,
		attackMay: null as { yes: TcgAction, no: TcgAction, title: string, text: string } | null,
		trainerUse: null as null | { action: TcgAction, name: string },
		stadiumUse: null as null | { action: TcgAction, name: string },
		playChoice: null as null | { rows: TcgAction[], name: string },
		playField: null as null | { top: number, left: number, width: number, height: number },
		moveTargetPick: null as null | {
			title: string,
			kind: 'attack' | 'ability',
			actions: TcgAction[],
			cost?: string[],
			damage?: string,
		},
		prizePicked: [] as number[],
		prizeGoal: 0,
		prizePickBase: 0,
		prizeSel: [] as number[],
		menuWhy: '',
		firstSent: false,
		drag: null as DragState | null,
		refuse: null as { text: string, x: number, y: number } | null,
		payPicked: [] as number[],
		discardBrowse: null as null | 'me' | 'foe',
		attachBrowse: null as null | AttachBrowse,
		slotHint: '' as string,
		deckLook: null as { hand: number, picked: number[] } | null,
		/** a different prompt key means a different prompt, so clear it */
		boardPick: null as (BoardChoiceLocal & { sent?: string }) | null,
	};
	timer: number | null = null;
	tableEl: HTMLElement | null = null;
	dragMoved = false;
	holdConsumed = false;
	/** survives snapshot removal so the KO can still animate */
	monMemory: { [iid: string]: KoGhost } = {};
	freshOut: { [iid: string]: true } = {};
	/** a later snapshot can't bring these back */
	koFinished: { [iid: string]: true } = {};
	lastSnap: TcgSnapshot | null = null;
	faceDownSeen: { [iid: string]: true } = {};
	revealing: { [iid: string]: true } = {};
	/** the snapshot already has the new hand when the shuffle fx runs */
	handMemory: { [seat: number]: { ids: string[] | null, count: number } } = {};
	mounted = false;
	fxPending: TcgEvent[] = [];
	fxBusy = false;
	playedFlipKey = -1;

	stashHands(snap: TcgSnapshot | null | undefined) {
		if (!snap?.players) return;
		snap.players.forEach((p, seat) => {
			if (!p) return;
			this.handMemory[seat] = { ids: handIds(p.hand), count: pileCount(p.hand) };
		});
	}

	inferDrawnIds(seat: number, n: number): string[] | null {
		const prev = this.handMemory[seat]?.ids;
		const curr = handIds((this.props.fxSnapshot || this.props.snapshot).players[seat]?.hand);
		if (!curr?.length) return null;
		if (!prev?.length) return curr.slice(Math.max(0, curr.length - n));
		const left = curr.slice();
		for (const id of prev) {
			const ix = left.indexOf(id);
			if (ix >= 0) left.splice(ix, 1);
		}
		if (left.length) return left;
		return curr.slice(Math.max(0, curr.length - n));
	}

	override componentDidMount() {
		this.mounted = true;
		if (typeof loadTcgCardIndex !== 'undefined') {
			// energy labels come from the card index, so redraw once it loads
			const waited = typeof tcgCardIndexStatus === 'undefined' || tcgCardIndexStatus() !== 'ready';
			void loadTcgCardIndex().then(() => {
				if (waited && this.mounted) this.forceUpdate();
			});
		}
		this.stashHands(this.props.snapshot);
		// the room keeps the last batch's events after it ends. a board that mounts while nothing's playing (resize,
		// reconnect) shouldn't replay it on top of the result
		if (this.props.playing) this.playFx(this.props.events, this.props.resumeAt || 0);
		else this.playedFlipKey = this.props.fxKey;
		window.addEventListener('pointermove', this.onDragMove);
		window.addEventListener('pointerup', this.onDragEnd);
		window.addEventListener('pointercancel', this.onDragEnd);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('resize', this.onChoiceResize);
		this.bindHandStrip();
		if (this.props.notice) this.showRefuse(this.props.notice);
	}
	flipRects: { [iid: string]: { left: number, top: number, width: number, height: number, slot: string } } = {};
	lungeIid = '';
	monSlotKey(el: HTMLElement) {
		return `${el.getAttribute('data-drop-foe') || ''}:${el.getAttribute('data-drop-slot') || ''}`;
	}
	layoutBox(el: HTMLElement) {
		let left = 0;
		let top = 0;
		let node: HTMLElement | null = el;
		while (node && node !== this.tableEl) {
			left += node.offsetLeft;
			top += node.offsetTop;
			node = node.offsetParent as HTMLElement | null;
		}
		return { left, top, width: el.offsetWidth, height: el.offsetHeight };
	}
	override componentWillUpdate() {
		this.flipRects = {};
		const root = this.tableEl;
		if (!root || tcgReduceMotion()) return;
		root.querySelectorAll<HTMLElement>('.tcg-mon[data-iid]').forEach(el => {
			const iid = el.dataset.iid;
			if (iid) this.flipRects[iid] = { ...this.layoutBox(el), slot: this.monSlotKey(el) };
			if (iid) this.lastMonBox[iid] = el.getBoundingClientRect();
		});
	}
	flipMoved(instant = false) {
		const root = this.tableEl;
		const first = this.flipRects;
		this.flipRects = {};
		if (!root || typeof (root as any).animate !== 'function') return;
		if (instant) {
			root.querySelectorAll<HTMLElement>('.tcg-mon').forEach(el => {
				el.getAnimations?.().forEach(a => {
					if (a.id === 'tcg-flip' || a.id === 'tcg-lunge') a.cancel();
				});
				el.classList.remove('is-flipping');
			});
			return;
		}
		root.querySelectorAll<HTMLElement>('.tcg-mon[data-iid]').forEach(el => {
			const iid = el.dataset.iid;
			const was = iid && first[iid];
			if (!was) return;
			// an attack makes the half position:relative, which changes offsetParent so every card in it looks like it
			// jumped. only a real slot change should glide
			if (was.slot === this.monSlotKey(el)) return;
			if (/\bfx-(place|ko|reveal|lunge|hit)\b/.test(el.className)) return;
			const fx = this.state.fx;
			if (fx && /^(attack|ability|damage|heal|ko)$/.test(fx.kind || '')) {
				if (iid === fx.iid || iid === fx.targetIid || (fx.hits || []).some(h => h.iid === iid)) return;
			}
			if (iid && this.state.pkFx[iid]) return;
			const now = this.layoutBox(el);
			const dx = was.left - now.left;
			const dy = was.top - now.top;
			if (!now.width || !now.height) return;
			if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
			const sx = was.width && now.width ? was.width / now.width : 1;
			const sy = was.height && now.height ? was.height / now.height : 1;
			el.getAnimations?.().forEach(a => {
				if (a.id === 'tcg-flip') a.cancel();
			});
			el.classList.add('is-flipping');
			const anim = el.animate([
				{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, filter: 'drop-shadow(0 10px 10px rgba(0,0,0,0.35))' },
				{
					transform: `translate(${dx * 0.4}px, ${dy * 0.4}px) scale(${1 + (sx - 1) * 0.4}, ${1 + (sy - 1) * 0.4})`,
					filter: 'drop-shadow(0 14px 14px rgba(0,0,0,0.4))', offset: 0.5,
				},
				{ transform: 'translate(0, 0) scale(1, 1)', filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' },
			], { duration: fxMs(820), easing: 'cubic-bezier(.22,.72,.2,1)', fill: 'forwards' });
			anim.id = 'tcg-flip';
			const done = () => {
				anim.cancel();
				el.classList.remove('is-flipping');
			};
			anim.onfinish = done;
			anim.oncancel = () => el.classList.remove('is-flipping');
		});
	}
	haltJump = false;
	override componentDidUpdate(prev: this['props'], prevState: this['state']) {
		if (this.props.halt !== prev.halt) this.haltJump = true;
		this.flipMoved(this.haltJump);
		this.placeFirstBanner();
		this.placeHandBar();
		if (this.state.selectedHand != null && this.state.selectedHand !== prevState.selectedHand) this.revealSelectedHand();
		this.dropStaleChoices(prev);
		if (this.state.handSheet && !prevState.handSheet && this.handSheetClose) this.handSheetClose.focus();
		if (this.state.handSheet !== prevState.handSheet) this.lockPageScroll(this.state.handSheet);
		this.syncHandEdges();
		if ((this.props.noticeN || 0) !== (prev.noticeN || 0) && this.props.notice) {
			this.showRefuse(this.props.notice);
		}
		// server refused the pick, or a new snapshot asks the same choice (an answer always changes it). it wasn't
		// applied, so the picker works again
		const sentPick = this.state.boardPick;
		if (sentPick?.sent && ((this.props.noticeN || 0) !== (prev.noticeN || 0) || this.props.snapshot !== prev.snapshot)) {
			const now = this.boardChoice();
			if (now?.kind === 'attached' && now.key === sentPick.key) {
				this.setState({ boardPick: { key: sentPick.key, iid: sentPick.iid } });
			}
		}
		if (this.props.halt !== prev.halt) {
			this.clearFlights();
			this.attackCtx = null;
			this.fxPending = [];
			this.fxBusy = false;
			this.playedFlipKey = this.props.fxKey;
			if (this.timer != null) window.clearTimeout(this.timer);
			this.timer = null;
			this.clearFx();
			this.payQueue = [];
			this.paySending = false;
			this.endPrizeBatch();
			if (this.state.prizePicked.length || this.state.prizeGoal || this.state.prizePickBase || this.state.firstSent) {
				this.setState({ prizePicked: [], prizeGoal: 0, prizePickBase: 0, firstSent: false });
			}
		} else if (this.state.prizePicked.length || this.state.prizeGoal || this.state.prizePickBase) {
			// forget the picks once the choices are gone or the pile shrank, those indexes were into the old pile
			const live = this.acts();
			let any = false;
			for (const act of live) {
				if (act.type === 'takePrize') {
					any = true;
					break;
				}
			}
			const snap = this.props.snapshot;
			const you = snap.you;
			const me = you != null ? snap.players[you] : undefined;
			const pocket = !!(me?.energyZone || snap.format?.energyZone);
			const need = snap.format?.prizes || (pocket ? 3 : 6);
			const leftNow = me ? prizesLeft(me, need, snap.status) : 0;
			const acked = this.state.prizePickBase > 0 && leftNow < this.state.prizePickBase;
			if (!any || acked) this.setState({ prizePicked: [], prizeGoal: 0, prizePickBase: 0 });
		} else if (this.state.firstSent) {
			// between beats the board falls back to the pre-click actions. only the committed snapshot means the server
			// moved on
			const committed = this.props.snapshot.actions || [];
			let stillFirst = false;
			for (const act of committed) {
				if (act.type === 'chooseFirst') {
					stillFirst = true;
					break;
				}
			}
			if (!stillFirst) this.setState({ firstSent: false });
		}
		if (this.props.fxKey !== prev.fxKey) {
			this.stashHands(prev.fxSnapshot || prev.snapshot);
			this.playFx(this.props.events);
		} else if (
			this.props.snapshot !== prev.snapshot && this.props.snapshot === this.props.fxSnapshot
		) {
			this.boardSnap = null;
			this.foldedThrough = -1;
			this.foldedRequest = false;
			this.stashHands(this.props.snapshot);
		} else if (this.state.fx !== prevState.fx) {
			requestAnimationFrame(() => this.aimFlyers());
			if (prevState.fx?.kind === 'shuffleHand' && this.state.fx?.kind !== 'shuffleHand') {
				this.stashHands(this.props.snapshot);
			}
		} else if (this.props.snapshot !== prev.snapshot && this.state.fx?.kind !== 'shuffleHand') {
			this.stashHands(this.props.snapshot);
		}
		if (this.props.snapshot !== prev.snapshot) this.flushPayQueue();
		if (this.prizeBatchSlots.length &&
			(this.props.snapshot !== prev.snapshot || this.props.waiting !== prev.waiting || this.props.playing !== prev.playing)) {
			this.flushPrizeQueue();
		}
		if (this.state.prizeSel.length && !this.prizeBatchSlots.length &&
			this.props.snapshot.pendingPrize?.seat !== this.props.snapshot.you) {
			this.setState({ prizeSel: [] });
		}
	}
	override componentWillUnmount() {
		this.mounted = false;
		this.clearFlights();
		if (this.inboundRaf != null) cancelAnimationFrame(this.inboundRaf);
		this.fxPending = [];
		this.fxBusy = false;
		if (this.timer != null) window.clearTimeout(this.timer);
		this.stopRefuseTimer();
		window.removeEventListener('pointermove', this.onDragMove);
		window.removeEventListener('pointerup', this.onDragEnd);
		window.removeEventListener('pointercancel', this.onDragEnd);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('resize', this.onChoiceResize);
		this.handStripMedia?.removeEventListener('change', this.syncHandStrip);
		this.handStripMedia = null;
		this.lockPageScroll(false);
		this.stopChoiceLayout();
	}

	onKeyDown = (e: KeyboardEvent) => {
		if (e.key !== 'Escape') return;
		if (this.choiceBackable()) {
			this.choiceBack();
			return;
		}
		if (this.state.moveTargetPick) {
			this.setState({ moveTargetPick: null });
			return;
		}
		if (this.state.trainerUse) {
			this.setState({ trainerUse: null });
			return;
		}
		if (this.state.stadiumUse) {
			this.setState({ stadiumUse: null });
			return;
		}
		if (this.state.playChoice) {
			this.setState({ playChoice: null });
			return;
		}
		if (this.state.attachBrowse) {
			this.setState({ attachBrowse: null });
			return;
		}
		if (this.state.discardBrowse) {
			this.setState({ discardBrowse: null });
			return;
		}
		if (this.state.inspect) {
			this.closeInspect();
			return;
		}
		if (this.state.handSheet) {
			this.closeHandSheet();
		}
	};

	clearFx() {
		// the commit after the KO beat can be the first render without the pokemon, don't put the picture back
		Object.keys(this.freshOut).forEach(iid => { this.koFinished[iid] = true; });
		if (this.state.fx?.kind === 'ko' && this.state.fx.iid) this.koFinished[this.state.fx.iid] = true;
		this.freshOut = {};
		this.cancelLunges();
		this.boardSnap = null;
		this.liveNow = { hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {} };
		this.setState({ fx: null, pkFx: {}, koGhost: null, koHide: {}, placeIn: null, placeOut: null, live: this.liveNow });
	}

	cancelLunges() {
		this.lungeIid = '';
		const root = this.tableEl;
		if (!root) return;
		root.querySelectorAll<HTMLElement>('.tcg-mon').forEach(el => {
			if (typeof el.getAnimations !== 'function') return;
			el.getAnimations().forEach(a => {
				if (a.id === 'tcg-lunge' || a.id === 'tcg-flip') a.cancel();
			});
		});
	}

	/**
	 * each batch starts from an empty overlay. its snapshot already has what earlier batches animated, so the old
	 * overlay would apply damage (or remove a hand card) twice
	 */
	liveNow: TcgBoard['state']['live'] = {
		hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {},
	};
	static readonly NO_LIVE: TcgBoard['state']['live'] = {
		hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {},
	};
	/**
	 * snapshot after every beat that started. the committed one doesn't change till the batch ends, so the board
	 * reads this instead
	 */
	boardSnap: TcgSnapshot | null = null;
	foldedThrough = -1;
	foldedRequest = false;
	/** the payload already has the post-damage hp. without this the bar drops before the attack even starts */
	hpShown: { [iid: string]: number } | null = null;
	hpHoldKey = -1;
	syncHpHold() {
		const fxKind = this.state.fx?.kind;
		const combat = fxKind === 'attack' || fxKind === 'ability' || fxKind === 'damage' ||
			fxKind === 'heal' || fxKind === 'ko';
		if (!this.props.playing && !combat) {
			this.hpShown = null;
			this.hpHoldKey = -1;
			return;
		}
		if (!this.props.playing || this.hpHoldKey === this.props.fxKey) return;
		const events = this.props.events || [];
		const next: { [iid: string]: number } = {};
		let any = false;
		for (const ev of events) {
			if ((ev.type !== 'damage' && ev.type !== 'heal') || !ev.iid) continue;
			if (!(Number(ev.amount) || 0) && ev.hp == null) continue;
			const mem = this.monMemory[ev.iid];
			if (mem?.hp == null) continue;
			const target = ev.hp != null ? Number(ev.hp) : null;
			if (target != null && target === mem.hp) continue;
			if (next[ev.iid] == null) {
				next[ev.iid] = mem.hp;
				any = true;
			}
		}
		this.hpHoldKey = this.props.fxKey;
		this.hpShown = any ? next : null;
	}
	revealHeldHp(e?: TcgEvent | null) {
		if (!e || !this.hpShown || !e.iid) return;
		if (e.type !== 'damage' && e.type !== 'heal') return;
		if (this.hpShown[e.iid] == null) return;
		if (!(Number(e.amount) || 0) && e.hp == null) return;
		if (e.hp != null) {
			this.hpShown[e.iid] = Number(e.hp);
			return;
		}
		const amt = Number(e.amount) || 0;
		const cur = this.hpShown[e.iid];
		this.hpShown[e.iid] = e.type === 'heal' ? cur + amt : Math.max(0, cur - amt);
	}
	withHeldHp(mon: TcgPokemonView | null): TcgPokemonView | null {
		if (!mon || !this.hpShown) return mon;
		const hp = this.hpShown[mon.iid];
		if (hp == null || hp === mon.hp) return mon;
		return { ...mon, hp };
	}
	foldEvents(events: TcgEvent[], inclusiveIndex: number) {
		if (inclusiveIndex < 0) return;
		// first paint is already the post-batch board, applying the events again would double them
		if (this.props.snapshot === this.props.fxSnapshot) return;
		if (!this.boardSnap) {
			this.boardSnap = cloneTcgSnapshot(this.props.snapshot);
			this.foldedThrough = -1;
		}
		const board = this.boardSnap;
		const from = this.foldedThrough + 1;
		if (inclusiveIndex < from) return;
		for (let k = from; k <= inclusiveIndex && k < events.length; k++) {
			applyBatchEvent(board, events, k);
			if (events[k].type === 'request' && this.props.fxSnapshot?.actions) {
				board.actions = this.props.fxSnapshot.actions;
				this.foldedRequest = true;
			}
		}
		normalizeTcgEnergy(board);
		this.foldedThrough = Math.min(inclusiveIndex, events.length - 1);
	}
	applyLive(_fx: FxBeat, _you: number | null | undefined) {
		// pile counts, hp and the hand come from boardSnap. a second overlay would add them twice
		return TcgBoard.NO_LIVE;
	}

	noteRemovals(snap: TcgSnapshot) {
		if (this.lastSnap && this.lastSnap !== snap) {
			const prev = this.lastSnap;
			const knockedOut: { [iid: string]: true } = {};
			for (const ev of this.props.events || []) if (ev.type === 'ko' && ev.iid) knockedOut[ev.iid] = true;
			Object.keys(this.monMemory).forEach(iid => {
				if (findMonView(prev.players, iid) && !findMonView(snap.players, iid)) {
					if (knockedOut[iid] && !this.koFinished[iid]) this.freshOut[iid] = true;
				}
			});
			this.revealing = {};
			Object.keys(this.faceDownSeen).forEach(iid => {
				const now = findMonView(snap.players, iid);
				if (now && !now.faceDown) {
					this.revealing[iid] = true;
					delete this.faceDownSeen[iid];
				} else if (!now) {
					delete this.faceDownSeen[iid];
				}
			});
		}
		snap.players.forEach(p => {
			if (p?.active?.faceDown) this.faceDownSeen[p.active.iid] = true;
			(p?.bench || []).forEach(m => { if (m?.faceDown) this.faceDownSeen[m.iid] = true; });
		});
		this.lastSnap = snap;
	}

	rememberMons(snap: TcgSnapshot) {
		snap.players.forEach((p, seat) => {
			if (p.active) {
				this.monMemory[p.active.iid] = {
					iid: p.active.iid,
					cardId: p.active.cardId,
					name: p.active.name,
					image: p.active.image,
					hp: p.active.hp,
					maxHp: p.active.maxHp,
					seat,
					slot: 'active',
				};
			}
			(p.bench || []).forEach((m, i) => {
				if (!m) return;
				this.monMemory[m.iid] = {
					iid: m.iid,
					cardId: m.cardId,
					name: m.name,
					image: m.image,
					hp: m.hp,
					maxHp: m.maxHp,
					seat,
					slot: i,
				};
			});
		});
	}

	ghostForKo(fx: FxBeat, e: TcgEvent): KoGhost | null {
		if (!fx.iid) return null;
		const mem = this.monMemory[fx.iid];
		if (mem) return mem;
		const seat = fx.seat ?? e.seat ?? 0;
		const slot: TcgSlot = e.bench ? 0 : 'active';
		return {
			iid: fx.iid,
			cardId: fx.cardId || e.cardId || '',
			name: fx.extra || e.name || 'Pokémon',
			seat,
			slot,
		};
	}

	koHold(seat: number, slot: TcgSlot, liveIid?: string): TcgPokemonView | null {
		let held: TcgPokemonView | null = null;
		Object.keys(this.freshOut).forEach(iid => {
			if (held || this.koFinished[iid]) return;
			const mem = this.monMemory[iid];
			if (mem?.seat !== seat || !sameSlot(mem.slot, slot)) return;
			if (liveIid && liveIid === iid) return;
			held = {
				iid: mem.iid,
				cardId: mem.cardId,
				name: mem.name,
				image: mem.image,
				hp: mem.hp ?? 0,
				maxHp: mem.maxHp ?? mem.hp ?? 0,
				types: [], energy: [], energyCards: [], tools: [],
			};
		});
		return held;
	}
	slotOfIid(iid: string, foe: boolean, fallback: TcgSlot): TcgSlot {
		const view = this.boardSnap || this.props.snapshot;
		const home = findMonSlot(view.players, iid);
		if (!home) return fallback;
		const meIndex = (this.props.viewpoint === 0 || this.props.viewpoint === 1) ?
			this.props.viewpoint : (view.you === 1 ? 1 : 0);
		if ((home.seat !== meIndex) !== foe) return fallback;
		return home.slot;
	}

	displayMon(seat: number, slot: TcgSlot, live: TcgPokemonView | null): TcgPokemonView | null {
		const placed = this.state.placeIn;
		const displaced = this.state.placeOut;
		// a place beat can still show the pre-switch cards after the board moved, and clicking the cell would send the
		// wrong pokemon
		const overlayAgrees = (entry: { seat: number, slot: TcgSlot, mon: TcgPokemonView } | null) => {
			if (!entry) return false;
			const home = findMonSlot((this.boardSnap || this.props.snapshot).players, entry.mon.iid);
			if (!home) return true;
			return home.seat === entry.seat && sameSlot(home.slot, entry.slot);
		};
		if (overlayAgrees(placed) && placed!.seat === seat && sameSlot(placed!.slot, slot)) {
			return this.withHeldHp(placed!.mon);
		}
		if (overlayAgrees(displaced) && displaced!.seat === seat && sameSlot(displaced!.slot, slot)) {
			return this.withHeldHp(displaced!.mon);
		}
		// keep the real card through the KO. swapping in a copy made it vanish and pop back
		if (live && this.state.koHide[live.iid]) return null;
		if (live && live.iid === placed?.mon.iid && overlayAgrees(placed) &&
			!(placed.seat === seat && sameSlot(placed.slot, slot))) return null;
		if (live && live.iid === displaced?.mon.iid && overlayAgrees(displaced) &&
			!(displaced.seat === seat && sameSlot(displaced.slot, slot))) return null;
		// the snapshot already has the replacement. keep the KOd card here till its KO beat ends, so the attack and KO
		// have something to play on
		const knocked = this.koHold(seat, slot, live?.iid);
		if (knocked) return this.withHeldHp(knocked);
		if (live) return this.withHeldHp(live);
		const g = this.state.koGhost;
		if (g?.seat === seat && sameSlot(g.slot, slot)) {
			return this.withHeldHp({
				iid: g.iid,
				cardId: g.cardId,
				name: g.name,
				image: g.image,
				hp: g.hp ?? 0,
				maxHp: g.maxHp ?? g.hp ?? 0,
				types: [], energy: [], energyCards: [], tools: [],
			});
		}
		const fx = this.state.fx;
		let held: TcgPokemonView | null = null;
		Object.keys(this.monMemory).forEach(iid => {
			if (held) return;
			const mem = this.monMemory[iid];
			if (mem?.seat !== seat || !sameSlot(mem.slot, slot)) return;
			if (findMonView(this.props.snapshot.players, iid)) return;
			const knocking = (fx?.kind === 'ko' && fx.iid === iid) || !!this.freshOut[iid];
			if (!knocking) return;
			held = {
				iid: mem.iid,
				cardId: mem.cardId,
				name: mem.name,
				image: mem.image,
				hp: mem.hp ?? 0,
				maxHp: mem.maxHp ?? mem.hp ?? 0,
				types: [], energy: [], energyCards: [], tools: [],
			};
		});
		return this.withHeldHp(held);
	}

	flights: { el: HTMLElement, anim: Animation | null, marks?: HTMLElement[], giving?: HTMLElement | null }[] = [];
	/**
	 * cards still flying somewhere. the board already has them, so the destination hides them till they land. cards
	 * past the five that fly share the last flight's key
	 */
	inbound: { key: number, zone: FlightZoneKind, seat: number, cardId: string, iid?: string, part?: 'attach' }[] = [];
	inboundKey = 0;
	expected: { fx: FxBeat, keys: (number | null)[] }[] = [];
	expectFlights(fx: FxBeat) {
		if (this.expected.some(x => x.fx === fx) || tcgReduceMotion()) return;
		const plan = cardFlights(fx);
		const keys = plan.map(f => {
			const to = f.to;
			if (to.zone === 'prizes' || to.zone === 'zone') return null;
			const key = ++this.inboundKey;
			this.inbound.push({ key, zone: to.zone, seat: to.seat, cardId: f.cardId, iid: to.iid, part: to.part });
			return key;
		});
		const seats = fx.perSeat ? fx.perSeat.map((s, seat) => ({ seat, n: s.n || 0, ids: s.ids })) :
			[{ seat: plan[0]?.to.seat ?? -1, n: fx.n || fx.ids?.length || plan.length, ids: fx.ids }];
		seats.forEach(({ seat, n, ids }) => {
			const to = plan.filter(f => f.to.seat === seat);
			const last = plan.lastIndexOf(to[to.length - 1]);
			if (last < 0 || keys[last] == null) return;
			const at = to[to.length - 1].to;
			for (let k = to.length; k < n; k++) {
				this.inbound.push({ key: keys[last], zone: at.zone, seat, cardId: ids?.[k] || '', iid: at.iid, part: at.part });
			}
		});
		this.expected.push({ fx, keys });
		// never hold a card forever, whatever happens to the flight it shows after the longest possible time
		const keep = keys.filter((k): k is number => k != null);
		if (keep.length) window.setTimeout(() => keep.forEach(k => this.landInbound(k)), fxMs(620) + fxMs(700) + 2500);
	}
	landInbound(key: number | null | undefined) {
		if (key == null) return;
		const n = this.inbound.length;
		this.inbound = this.inbound.filter(x => x.key !== key);
		if (this.inbound.length === n || !this.tableEl) return;
		if (typeof requestAnimationFrame !== 'function') {
			this.forceUpdate();
		} else if (this.inboundRaf == null) {
			this.inboundRaf = requestAnimationFrame(() => {
				this.inboundRaf = null;
				if (this.tableEl) this.forceUpdate();
			});
		}
	}
	inboundRaf: number | null = null;
	withoutInbound(p: TcgPlayerView, seat: number): TcgPlayerView {
		const coming = this.inbound.filter(x => x.seat === seat &&
			(x.zone === 'discard' || x.zone === 'lost' || x.zone === 'deck'));
		if (!coming.length || !p) return p;
		const less = <T extends string[] | { count: number } | undefined>(pile: T): T => (!pile ? pile :
			Array.isArray(pile) ? pile.slice(0, -1) : { ...pile, count: Math.max(0, pile.count - 1) }) as T;
		const out = { ...p };
		for (const x of coming) {
			if (x.zone === 'discard') {
				const d = (out.discard || []).slice();
				const at = x.cardId ? d.lastIndexOf(x.cardId) : -1;
				if (d.length) d.splice(at >= 0 ? at : d.length - 1, 1);
				out.discard = d;
			} else if (x.zone === 'lost') {
				out.lostZone = less(out.lostZone);
			} else {
				out.deck = less(out.deck);
			}
		}
		return out;
	}
	handInbound(seat: number): { [cardId: string]: number } {
		const out: { [cardId: string]: number } = {};
		for (const x of this.inbound) if (x.zone === 'hand' && x.seat === seat) out[x.cardId] = (out[x.cardId] || 0) + 1;
		return out;
	}
	prizePile(seat: number): HTMLElement | null {
		const side = seat === this.viewSeat() ? 'me' : 'foe';
		return this.tableEl?.querySelector<HTMLElement>(`.tcg-prizes.${side}`) ||
			this.tableEl?.querySelector<HTMLElement>(`.tcg-half.${side} .tcg-points`) || null;
	}
	clearFlights() {
		for (const f of this.flights.slice()) {
			f.anim?.cancel();
			f.el.remove();
			for (const m of f.marks || []) m.classList.remove('is-incoming');
		}
		this.flights = [];
		this.tableEl?.querySelectorAll('.is-incoming, .is-landed, .is-giving').forEach(m => {
			m.classList.remove('is-incoming', 'is-landed', 'land-energy', 'land-tool', 'is-giving');
		});
		this.tableEl?.querySelectorAll<HTMLElement>('.tcg-mon').forEach(m => m.style.removeProperty('--fx-land'));
		this.inbound = [];
		this.expected = [];
	}
	lastMonBox: { [iid: string]: DOMRect } = {};
	monEl(iid?: string): HTMLElement | null {
		if (!iid || !this.tableEl) return null;
		const safe = escapeSelector(iid);
		return this.tableEl.querySelector<HTMLElement>(`.tcg-mon[data-iid="${safe}"]`);
	}
	viewSeat(): number {
		const v = this.props.viewpoint;
		if (v === 0 || v === 1) return v;
		return this.props.snapshot.you === 1 ? 1 : 0;
	}
	attachSpot(mon: Element, cardId?: string): { box: DOMRect, peek: HTMLElement | null } {
		const peeks = Array.from(mon.querySelectorAll<HTMLElement>('.tcg-attach-peek'))
			.filter(p => p.getBoundingClientRect().width > 0);
		const peek = cardId ? peeks.filter(p => p.dataset.card === cardId).pop() || null : null;
		const at = peek || peeks[peeks.length - 1];
		if (at) return { box: at.getBoundingClientRect(), peek };
		const m = mon.getBoundingClientRect();
		if (mon.closest('.tcg-bench')) {
			const bench = new DOMRect(m.left + m.width * 0.27, m.bottom - m.height * 0.29, m.width * 0.46, m.height * 0.46);
			return { box: bench, peek: null };
		}
		const strip = new DOMRect(m.left - m.width * 0.34, m.top + m.height * 0.06, m.width * 0.72, m.height * 0.88);
		return { box: strip, peek: null };
	}
	zoneBox(z: FlightZone, cardId?: string): DOMRect | null {
		const root = this.tableEl;
		if (!root) return null;
		const side = z.seat === this.viewSeat() ? 'me' : 'foe';
		const shown = (el: Element | null) => {
			if (!el) return null;
			const b = el.getBoundingClientRect();
			return b.width > 0 && b.height > 0 ? b : null;
		};
		const q = (sel: string) => shown(root.querySelector(sel));
		switch (z.zone) {
		case 'deck': return q(`.tcg-pile.deck.${side}`);
		case 'discard': return q(`.tcg-pile.discard.${side}`);
		case 'lost': return q(`.tcg-lost-zone.${side}`) || q(`.tcg-pile.discard.${side}`);
		case 'prizes': return q(`.tcg-prizes.${side}`) || q(`.tcg-half.${side} .tcg-points`) || q(`.tcg-pile.deck.${side}`);
		case 'zone': return (side === 'me' && q('.tcg-ezone')) || this.zoneBox({ zone: 'hand', seat: z.seat });
		case 'mon': {
			const monEl = this.monEl(z.iid);
			if (monEl && z.part === 'attach') return this.attachSpot(monEl, cardId).box;
			return shown(monEl) || (z.iid && this.lastMonBox[z.iid]) || q(`.tcg-active-spot.${side}`);
		}
		case 'hand': {
			if (side === 'foe') return q('.tcg-hand-foe') || q('.tcg-player.foe .tcg-hand-count') || q('.tcg-player.foe');
			const hand = shown(root.querySelector('.tcg-hand-mine'));
			const dock = shown(root.querySelector('.tcg-dock'));
			if (!hand || !dock) return hand || dock;
			return new DOMRect(hand.left, dock.top, hand.width, Math.min(dock.height, 60));
		}
		}
		return null;
	}
	launchFlights(fx: FxBeat, after = 0) {
		const root = this.tableEl;
		const target = (fx.kind === 'energy' || fx.kind === 'tool') ? this.monEl(fx.iid) : null;
		target?.style.removeProperty('--fx-land');
		const at = this.expected.findIndex(x => x.fx === fx);
		const keys = at >= 0 ? this.expected.splice(at, 1)[0].keys : [];
		const plan = !root || tcgReduceMotion() ? [] : cardFlights(fx);
		if (!root || !plan.length || typeof (root as any).animate !== 'function') {
			keys.forEach(k => this.landInbound(k));
			return;
		}
		const box = root.getBoundingClientRect();
		const ms = fxMs(620);
		plan.forEach((f, k) => {
			const fl = after ? { ...f, delay: f.delay + after } : f;
			if (!this.launchFlight(fl, box, ms, keys[k])) {
				this.landInbound(keys[k]);
				return;
			}
			if (fl.land && target) target.style.setProperty('--fx-land', `${Math.round(ms * 0.88 + fl.delay)}ms`);
		});
	}
	launchFlight(f: CardFlight, box: DOMRect, ms: number, inbound?: number | null): boolean {
		const root = this.tableEl;
		if (!root) return false;
		const a = this.zoneBox(f.from, f.cardId);
		const b = this.zoneBox(f.to, f.cardId);
		if (!a || !b) return false;
		// the mini card and pip are already on the pokemon (the board is the result). show them when the card lands, so
		// it's never there twice or early
		const marks: HTMLElement[] = [];
		const dest = f.land ? this.monEl(f.to.iid) : null;
		if (dest) {
			const peek = this.attachSpot(dest, f.cardId).peek;
			if (peek) marks.push(peek);
			const type = f.land === 'energy' ? energyTypeFromCardId(f.cardId) : '';
			const pipEl = type ? Array.from(dest.querySelectorAll<HTMLElement>(`.tcg-energy-row .tcg-pip.t-${type}`)).pop() : null;
			if (pipEl) marks.push(pipEl);
		}
		for (const m of marks) m.classList.add('is-incoming');
		const giving = f.from.zone === 'prizes' ? this.prizePile(f.from.seat) : null;
		giving?.classList.add('is-giving');
		const el = document.createElement('div');
		el.className = 'tcg-flight';
		el.setAttribute('aria-hidden', 'true');
		if (!f.cardId) {
			el.classList.add('back');
		} else if (noArtCards[f.cardId]) {
			el.classList.add('noart');
			const name = document.createElement('span');
			name.textContent = cardLabel(f.cardId);
			el.appendChild(name);
		} else {
			const img = document.createElement('img');
			img.src = cardArt(f.cardId);
			img.alt = '';
			img.draggable = false;
			img.onerror = () => {
				img.remove();
				el.classList.add('back');
			};
			el.appendChild(img);
		}
		root.appendChild(el);
		const w = el.offsetWidth || 48;
		const h = el.offsetHeight || 67;
		const x0 = a.left + a.width / 2 - box.left - w / 2;
		const y0 = a.top + a.height / 2 - box.top - h / 2;
		const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
		const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
		const s0 = Math.max(0.55, Math.min(1.3, a.width / w));
		const s1 = Math.max(0.45, Math.min(1.3, b.width / w));
		const lift = Math.min(36, Math.hypot(dx, dy) * 0.12);
		el.style.left = `${Math.round(x0)}px`;
		el.style.top = `${Math.round(y0)}px`;
		const mid = (s0 + s1) / 2 * 1.08;
		const anim = el.animate([
			{ transform: `translate(0, 0) scale(${s0})`, opacity: 0 },
			{ transform: `translate(${dx * 0.08}px, ${dy * 0.08 - lift * 0.3}px) scale(${s0 * 1.04})`, opacity: 1, offset: 0.12 },
			{ transform: `translate(${dx * 0.55}px, ${dy * 0.55 - lift}px) scale(${mid})`, opacity: 1, offset: 0.55 },
			{ transform: `translate(${dx}px, ${dy}px) scale(${s1})`, opacity: 1, offset: 0.88 },
			{ transform: `translate(${dx}px, ${dy}px) scale(${s1})`, opacity: 0 },
		], { duration: ms, delay: f.delay, easing: 'cubic-bezier(.22,.72,.2,1)', fill: 'both' });
		const entry = { el, anim, marks, giving };
		this.flights.push(entry);
		const done = (landed: boolean) => {
			el.remove();
			this.flights = this.flights.filter(x => x !== entry);
			if (giving && !this.flights.some(x => x.giving === giving)) giving.classList.remove('is-giving');
			for (const m of marks) {
				m.classList.remove('is-incoming');
				if (landed) this.landMark(m, f.land || 'energy');
			}
			this.landInbound(inbound);
		};
		anim.onfinish = () => done(true);
		anim.oncancel = () => done(false);
		return true;
	}
	landMark(m: HTMLElement, land: 'energy' | 'tool') {
		const cls = `land-${land}`;
		m.classList.add('is-landed', cls);
		m.addEventListener('animationend', () => m.classList.remove('is-landed', cls), { once: true });
	}
	aimFlyers() {
		const root = this.tableEl;
		if (!root) return;
		const s = root.getBoundingClientRect();
		const aim = (fly: HTMLElement, fallbackSel: string, fromHand: boolean) => {
			const iid = fly.getAttribute('data-target') || '';
			const safe = iid.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
			const target = (iid && root.querySelector(`.tcg-mon[data-iid="${safe}"]`)) as HTMLElement | null ||
				root.querySelector(fallbackSel);
			if (!target) {
				fly.classList.add('stay');
				return;
			}
			const t = target.getBoundingClientRect();
			const startX = fromHand ? (s.left + s.width / 2) : (s.left + s.width / 2);
			const startY = fromHand ? (s.top + s.height * 0.88) : (s.top + s.height / 2);
			const endX = t.left + t.width / 2;
			const endY = t.top + t.height / 2;
			fly.style.setProperty('--tx', `${Math.round(endX - startX)}px`);
			fly.style.setProperty('--ty', `${Math.round(endY - startY)}px`);
			fly.style.setProperty('--end-scale', String(Math.max(0.22, Math.min(0.55, t.width / 140))));
			fly.classList.add('go');
		};
		const monByIid = (iid: string) => {
			if (!iid) return null;
			const safe = iid.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
			return root.querySelector<HTMLElement>(`.tcg-mon[data-iid="${safe}"]`);
		};
		void aim;
		const atk = root.querySelector<HTMLElement>('.fx-atk-fly');
		if (atk) {
			const fromEl = monByIid(atk.getAttribute('data-from') || '');
			const toEl = monByIid(atk.getAttribute('data-target') || '') ||
				root.querySelector('.tcg-mon.fx-hit');
			if (!fromEl || !toEl) {
				atk.classList.add('stay');
			} else {
				const f = fromEl.getBoundingClientRect();
				const t = toEl.getBoundingClientRect();
				const startX = f.left + f.width / 2 - s.left;
				const startY = f.top + f.height / 2 - s.top;
				const dx = (t.left + t.width / 2 - s.left) - startX;
				const dy = (t.top + t.height / 2 - s.top) - startY;
				atk.style.left = `${Math.round(startX)}px`;
				atk.style.top = `${Math.round(startY)}px`;
				atk.style.setProperty('--tx', `${Math.round(dx)}px`);
				atk.style.setProperty('--ty', `${Math.round(dy)}px`);
				atk.style.setProperty('--rot', `${Math.atan2(dy, dx) * 180 / Math.PI}deg`);
				atk.style.setProperty('--span', `${Math.max(48, Math.hypot(dx, dy))}px`);
				atk.classList.add('go');
			}
		}
		this.aimContactLunge(monByIid);
	}

	aimContactLunge(monByIid: (iid: string) => HTMLElement | null) {
		const root = this.tableEl;
		if (!root || tcgReduceMotion()) return;
		const el = root.querySelector<HTMLElement>('.tcg-mon.fx-lunge.is-contact');
		if (!el) return;
		const fromIid = el.getAttribute('data-iid') || '';
		const toIid = el.getAttribute('data-lunge-to') || '';
		if (!fromIid || !toIid) return;
		if (this.lungeIid === fromIid && typeof el.getAnimations === 'function' &&
			el.getAnimations().some(a => a.id === 'tcg-lunge')) {
			return;
		}
		const toEl = monByIid(toIid);
		if (!toEl || toEl === el) return;
		if (typeof el.animate !== 'function') return;
		el.getAnimations?.().forEach(a => {
			if (a.id === 'tcg-lunge') a.cancel();
		});
		const f = el.getBoundingClientRect();
		const t = toEl.getBoundingClientRect();
		const fromCx = f.left + f.width / 2;
		const fromCy = f.top + f.height / 2;
		const toCx = t.left + t.width / 2;
		const toCy = t.top + t.height / 2;
		let dx = toCx - fromCx;
		let dy = toCy - fromCy;
		const dist = Math.hypot(dx, dy) || 1;
		const kiss = Math.min(f.height, t.height, f.width, t.width) * 0.42;
		const travel = Math.max(24, dist - kiss);
		dx *= travel / dist;
		dy *= travel / dist;
		const ax = Math.round((-dy / dist) * Math.min(28, dist * 0.12));
		const ay = Math.round((dx / dist) * Math.min(28, dist * 0.12));
		const dir = el.classList.contains('foe') ? 1 : -1;
		this.lungeIid = fromIid;
		const anim = el.animate([
			{ transform: 'translate(0px, 0px) rotate(0deg)', offset: 0 },
			{
				transform: `translate(${Math.round(dx * 0.7 + ax)}px, ${Math.round(dy * 0.55 + ay)}px) rotate(${dir * -7}deg)`,
				offset: 0.36,
			},
			{
				transform: `translate(${Math.round(dx)}px, ${Math.round(dy)}px) rotate(${dir * 4}deg)`,
				offset: 0.44,
			},
			{
				transform: `translate(${Math.round(dx)}px, ${Math.round(dy)}px) rotate(0deg)`,
				offset: 0.58,
			},
			{ transform: 'translate(0px, 0px) rotate(0deg)', offset: 1 },
		], {
			duration: fxMs(1180),
			easing: 'cubic-bezier(0.22, 0.7, 0.18, 1)',
			fill: 'forwards',
		});
		anim.id = 'tcg-lunge';
		const done = () => {
			if (this.lungeIid === fromIid) this.lungeIid = '';
			anim.cancel();
		};
		anim.onfinish = done;
		anim.oncancel = () => {
			if (this.lungeIid === fromIid) this.lungeIid = '';
		};
	}

	attackCtx: AttackCtx | null = null;
	hitBeat(h: FxHit, ctx: AttackCtx, fly: boolean): FxBeat {
		if (h.kind === 'status') {
			return {
				kind: 'status', iid: h.iid, status: h.status ?? '', src: h.src || ctx.src,
				extra: h.label || statusWord(h.status) || 'Recovered',
			};
		}
		const aimed = aimedHit(h, ctx.iid);
		return {
			kind: h.kind === 'heal' ? 'heal' : 'damage',
			iid: h.iid,
			fromIid: ctx.iid,
			amount: h.amount,
			src: h.src || ctx.src,
			extra: h.label || ctx.label,
			element: h.element || ctx.element,
			hitStyle: h.hitStyle || ctx.style,
			travel: fly && aimed && !!ctx.travel,
			contact: aimed && !!ctx.contact,
			hits: [h],
		};
	}
	effectBeat(h: FxHit, fx: FxBeat): FxBeat {
		if (h.kind === 'status') {
			return {
				kind: 'status', iid: h.iid, status: h.status ?? '', src: h.src,
				extra: h.label || statusWord(h.status) || 'Recovered', message: fx.message,
			};
		}
		return {
			kind: h.kind === 'heal' ? 'heal' : 'damage',
			iid: h.iid,
			amount: h.amount,
			src: h.src,
			extra: fx.extra || h.label,
			element: h.element || fx.element,
			message: fx.message,
			hits: [h],
		};
	}
	playFx(events: TcgEvent[], from = 0) {
		if (events?.length) this.haltJump = false;
		if (!events?.length || PS.prefs.noanim) {
			this.playedFlipKey = this.props.fxKey;
			if (!this.fxBusy) this.clearFx();
			return;
		}
		// a fast cpu can send the next action before this one finishes. keep playing the current beat, then the new
		// events
		if (this.fxBusy) {
			this.fxPending.push(...events);
			return;
		}
		this.fxBusy = true;
		try {
			this.runFx(events, true, from);
		} catch (err) {
			console.error(err);
			this.finishFx();
		}
	}

	/** if a step throws (a card that's gone), end the batch. the room is waiting on `onFxDone` and the commit it brings */
	later(fn: () => void, ms: number) {
		this.timer = window.setTimeout(() => {
			this.timer = null;
			try {
				fn();
			} catch (err) {
				console.error(err);
				if (this.timer != null) window.clearTimeout(this.timer);
				this.timer = null;
				this.finishFx();
			}
		}, ms);
	}

	finishFx() {
		if (this.fxPending.length) {
			const next = this.fxPending;
			this.fxPending = [];
			this.runFx(next, false);
			return;
		}
		this.boardSnap = null;
		this.foldedThrough = -1;
		this.foldedRequest = false;
		this.fxBusy = false;
		const more = this.props.onFxDone?.(this.fxHalt) ?? false;
		if (!more) this.clearFx();
		// after the parent commit, so Go First can't paint over the last coin frame
		this.playedFlipKey = this.props.fxKey;
	}

	fxHalt: number | undefined = undefined;
	runFx(events: TcgEvent[], fresh = true, from = 0) {
		if (this.timer != null) window.clearTimeout(this.timer);
		// new batch, new baseline: props.snapshot already has the previous batch. events that came in mid-beat keep the
		// board those beats built
		if (fresh) {
			this.fxHalt = this.props.halt;
			this.boardSnap = null;
			this.foldedRequest = false;
			this.liveNow = { hand: {}, hp: {}, energy: {}, prizes: {}, deck: {}, handN: {}, discardN: {}, points: {}, gained: {} };
		}
		this.foldedThrough = -1;
		const shown = this.props.fxSnapshot || this.props.snapshot;
		const players = shown.players;
		const you = shown.you;
		let i = Math.max(0, Math.min(from, events.length));
		const consumedHits: { [index: number]: 1 } = {};
		let fxTick = 0;
		const HIT_MS = fxMs(1100);
		// contact: attacker lunges into the target. travel: projectile css (~0.72s × --fx-t)
		const WINDUP_MS = fxMs(520);
		const WINDUP_TRAVEL_MS = fxMs(720);
		const BEAT_MS = fxMs(850);
		// matches tcg-move-banner-rise (0.71s × --fx-t)
		const NAME_MS = fxMs(710);

		const show = (fx: FxBeat, e?: TcgEvent, alsoFly: FxBeat[] = [], flyAfter = 0) => {
			if (e?.type === 'deal' && you != null) {
				const raw = (you === 0 ? e.ids0 : e.ids1);
				const ids = Array.isArray(raw) ? raw.filter(Boolean) : [];
				if (ids.length) fx = { ...fx, ids, seat: you };
			} else if (e && Array.isArray(e.ids) && e.ids.length &&
				(e.type === 'draw' || e.type === 'find' || e.type === 'prizeTake')) {
				fx = { ...fx, ids: (e.ids).filter(Boolean), seat: fx.seat ?? (e.seat!) };
			}
			fxTick++;
			this.revealHeldHp(e);
			let koGhost: KoGhost | null = null;
			let placeIn: TcgBoard['state']['placeIn'] = null;
			let placeOut: TcgBoard['state']['placeOut'] = null;
			const koHide = { ...this.state.koHide };
			const koStillQueued = (this.props.events || []).some(ev => ev.type === 'ko' && ev.iid && this.freshOut[ev.iid]);
			if (!koStillQueued && fx.kind !== 'ko' && fx.kind !== 'damage' && fx.kind !== 'attack' && fx.kind !== 'ability') {
				this.freshOut = {};
			}
			if (this.state.fx?.kind === 'ko' && this.state.fx.iid && fx.kind !== 'ko') {
				this.koFinished[this.state.fx.iid] = true;
				delete this.freshOut[this.state.fx.iid];
			}
			if (fx.kind === 'ko') {
				koGhost = e ? this.ghostForKo(fx, e) : (fx.iid ? this.monMemory[fx.iid] || null : null);
				if (koGhost && !fx.extra) fx.extra = koGhost.name;
				if (koGhost && (!fx.message || fx.message.includes('a Pokémon'))) {
					fx.message = `${koGhost.name} was Knocked Out`;
				}
			}
			if (fx.kind === 'place' && fx.iid) {
				const nextPlayers = this.props.fxSnapshot?.players || this.props.snapshot.players;
				const incoming = findMonView(nextPlayers, fx.iid) ||
					(fx.cardId ? {
						iid: fx.iid,
						cardId: fx.cardId,
						name: fx.extra || cardLabel(fx.cardId),
						hp: 0,
						maxHp: 0,
						image: this.monMemory[fx.iid]?.image,
						types: [], energy: [], energyCards: [], tools: [],
					} : null);
				const dest = findMonSlot(nextPlayers, fx.iid);
				const seat = dest?.seat ?? fx.seat ?? 0;
				const slot = dest?.slot ?? fx.slot ?? 'active';
				const fromOld = findMonSlot(this.props.snapshot.players, fx.iid);
				fx.fromBench = !!(fromOld && fromOld.slot !== 'active' && slot === 'active');
				if (incoming) placeIn = { seat, slot, mon: incoming };
				if (fx.fromBench && fromOld) {
					const leaving = this.props.snapshot.players[seat]?.active;
					if (leaving && leaving.iid !== incoming?.iid) {
						placeOut = { seat, slot: fromOld.slot, mon: leaving };
					}
				}
			}
			this.expectFlights(fx);
			for (const more of alsoFly) this.expectFlights(more);
			this.setState({
				fx, pkFx: buildPkFx(fx, fxTick), koGhost, koHide, placeIn, placeOut,
				live: this.applyLive(fx, you), liveKey: this.props.fxKey,
			}, () => {
				this.aimFlyers();
				this.launchFlights(fx);
				for (const more of alsoFly) this.launchFlights(more, flyAfter);
			});
		};

		const step = () => {
			while (i < events.length && (skipEvent(events, i) || consumedHits[i])) {
				this.props.onEvent?.(events[i]);
				// an attack's results land in playHit, when the hit connects
				if (!isHitEvent(events[i].type)) this.foldEvents(events, i);
				i++;
			}
			if (i >= events.length) {
				this.finishFx();
				return;
			}
			const e = events[i];
			this.props.onEvent?.(e);
			if (e.type === 'turn' || e.type === 'checkup' || e.type === 'trainer' || e.type === 'stadium' ||
				e.type === 'over' || e.type === 'attackFailed') this.attackCtx = null;
			let fx = fxFor(e, events, i, players, you, shown);

			if ((fx.kind === 'draw' || fx.kind === 'drawEffect') && e.type === 'draw') {
				if ((!fx.ids?.length) && actorIsYou(e.seat, you) && e.seat != null) {
					const inferred = this.inferDrawnIds(e.seat, e.n || fx.n || 1);
					if (inferred?.length) {
						fx = { ...fx, ids: inferred, labels: inferred.map(cardLabel), n: inferred.length };
					}
				}
			}

			// the opening flip often comes as coin + first, so fold the announce into the coin beat
			if (e.type === 'coin' || e.type === 'first') {
				const results: boolean[] = [];
				let j = i;
				if (e.type === 'coin') {
					results.push(!!e.heads);
					j = i + 1;
					while (j < events.length && events[j]?.type === 'coin') {
						this.props.onEvent?.(events[j]);
						results.push(!!events[j].heads);
						j++;
					}
				}
				let firstEv: TcgEvent | null = null;
				if (e.type === 'first') {
					firstEv = e;
					j = i + 1;
					// no coin event (older server): fake one so the opening flip still plays. seat 0 won = heads, same as the engine
					results.push(e.seat === 0);
				} else if (events[j]?.type === 'first') {
					this.props.onEvent?.(events[j]);
					firstEv = events[j];
					j++;
				}
				const headsN = results.filter(Boolean).length;
				const tailsN = results.length - headsN;
				const whoFirst = firstEv?.seat != null ?
					actorLabel(players, firstEv.seat, you) : '';
				const youWonFirst = firstEv ? actorIsYou(firstEv.seat, you) : false;
				const coinFx: FxBeat = {
					kind: 'coin',
					coins: results,
					n: results.length,
					seat: firstEv?.seat ?? e.seat,
					extra: firstEv ? 'First' :
					(results.length === 1 ?
						(results[0] ? 'Heads' : 'Tails') :
						`${results.length} flips`),
					message: firstEv ?
						(firstEv.chooses ?
							(youWonFirst ?
								'You won the coin flip and choose who goes first' :
								`${whoFirst} won the coin flip and chooses who goes first`) :
							(youWonFirst ?
								'You won the coin flip and go first' :
								`${whoFirst} won the coin flip and goes first`)) :
						(results.length === 1 ?
							(results[0] ? 'Heads!' : 'Tails!') :
							`${headsN} Heads, ${tailsN} Tails`),
				};
				this.foldEvents(events, j - 1);
				show(coinFx);
				const wait = (firstEv ? 2700 : 2200) + Math.max(0, results.length - 1) * 200;
				i = j;
				this.later(step, wait);
				return;
			}

			// the hand is about to be cleared, keep the cards on this beat so the shuffle can show them
			if (e.type === 'shuffle' && e.from === 'hand' && e.seat != null) {
				const mem = this.handMemory[e.seat];
				fx = {
					...fx,
					ids: mem?.ids || undefined,
					n: Math.max(mem?.count || 0, fx.n || 0, 3),
				};
			}

			// a discard before a place (setup, playing a pokemon) gets its own beat so the log lines stay separate
			const pileMove = (t?: string) => t === 'toDiscard' || t === 'toLost' || t === 'fromDiscard';
			if (pileMove(e.type)) {
				let j = i + 1;
				while (j < events.length && pileMove(events[j]?.type)) {
					this.props.onEvent?.(events[j]);
					j++;
				}
				const pileFx: FxBeat[] = [];
				for (let k = i; k < j; k++) pileFx.push(k === i ? fx : fxFor(events[k], events, k, players, you, shown));
				this.foldEvents(events, j - 1);
				const nxt = events[j];
				const ownBeat = nxt?.type === 'place' || nxt?.type === 'evolve';
				i = j;
				if (ownBeat) {
					this.forceUpdate();
					show(fx, e, pileFx.slice(1));
					this.later(step, BEAT_MS);
				} else {
					for (const p of pileFx) this.expectFlights(p);
					this.forceUpdate(() => {
						for (const p of pileFx) this.launchFlights(p);
					});
					this.later(step, 0);
				}
				return;
			}

			this.foldEvents(events, i);
			let advance = 1;
			const ridePile: FxBeat[] = [];
			if (e.type !== 'attack' && e.type !== 'ability') {
				let j = i + 1;
				while (j < events.length && pileMove(events[j]?.type)) {
					this.props.onEvent?.(events[j]);
					j++;
				}
				if (j > i + 1) this.foldEvents(events, j - 1);
				for (let k = i + 1; k < j; k++) ridePile.push(fxFor(events[k], events, k, players, you, shown));
				advance = j - i;
			}
			if (e.type === 'place') {
				const nxt = events[i + advance];
				const alreadyThere = nxt?.type === 'place' && nxt.seat === e.seat &&
					!!findMonSlot(this.boardSnap?.players, nxt.iid);
				if (alreadyThere) {
					this.props.onEvent?.(nxt);
					this.foldEvents(events, i + advance);
					advance += 1;
				}
			}

			if (e.type === 'attack' || e.type === 'ability') {
				const hits = attackHits(events, i, players);
				const hitAt = attackHitIndexes(events, i);
				if (!fx.extra) fx.extra = e.name || (e.type === 'ability' ? 'Ability' : 'Attack');
				if (!fx.message) fx.message = `${userName(e, players, events)} used ${fx.extra || ''}`;
				const atkElement = e.type === 'attack' ? attackElement(e, players) :
					(hits.find(h => h.element)?.element || 'psychic');
				const hitResolved = resolveHitStyle(fx.extra, atkElement);
				const windupMs = hitResolved.travel ? WINDUP_TRAVEL_MS : WINDUP_MS;
				const ctx: AttackCtx = {
					iid: e.iid || '', src: e.type === 'ability' ? 'ability' : 'attack', label: fx.extra || '',
					element: atkElement, style: hitResolved.style, travel: e.type === 'attack' && hitResolved.travel,
					contact: e.type === 'attack' && !hitResolved.travel,
				};
				this.attackCtx = ctx;
				const visible = hits.filter(visibleHit);
				const aimed = visible.filter(h => aimedHit(h, ctx.iid));
				// only aim at pokemon its own results name, never a legal target that wasn't picked or one a switch hasn't
				// brought in yet
				const firstTarget = aimed[0]?.iid || '';
				const firstAimed = aimed.length ? hits.indexOf(aimed[0]) : -1;
				const targets = e.type !== 'attack' ? [] : aimed.map(h => h.iid).filter((id, k, all) => all.indexOf(id) === k);
				const launch = () => {
					show({
						...fx,
						announce: false,
						hits: [],
						element: atkElement,
						hitStyle: hitResolved.style,
						travel: !!ctx.travel && !!firstTarget,
						targetIid: e.type === 'attack' && firstTarget || undefined,
						contact: !!ctx.contact && !!firstTarget,
						targets,
					});
					let hi = 0;
					const playHit = () => {
						if (hi >= hits.length) {
							i++;
							this.later(step, visible.length ? fxMs(280) : 0);
							return;
						}
						const at = hitAt[hi];
						const hitIndex = hi;
						const h = hits[hi++];
						if (at != null) {
							consumedHits[at] = 1;
							this.foldEvents(events, at);
						}
						if (!visibleHit(h)) {
							this.later(playHit, 0);
							return;
						}
						show(this.hitBeat(h, ctx, hitIndex !== firstAimed), at != null ? events[at] : undefined);
						this.later(playHit, HIT_MS);
					};
					this.later(playHit, windupMs);
				};
				show({
					...fx,
					hits: [],
					announce: true,
					element: atkElement,
					hitStyle: hitResolved.style,
				});
				this.later(launch, NAME_MS);
				return;
			}

			// came after a switch, discard, coin or choice, but it's still that attack's hit
			if (this.attackCtx && isHitEvent(e.type)) {
				const ctx = this.attackCtx;
				const h = hitFromEvent(e, { ...ctx, fromIid: ctx.iid });
				i += advance;
				if (!h || !visibleHit(h)) {
					this.later(step, 0);
					return;
				}
				show(this.hitBeat(h, ctx, true), e, ridePile);
				this.later(step, HIT_MS);
				return;
			}

			// no attack or ability behind it (checkup, trainer, tool, stadium): same mark as a hit, no lunge or projectile
			if (isHitEvent(e.type)) {
				const cause = e.type === 'damage' ? dmgSrc(events, i, players) :
					{ key: e.source?.kind || 'effect', label: sourceName(e.source) || '' };
				const h = hitFromEvent(e, { src: cause.key, label: cause.label, element: fx.element || '' });
				i += advance;
				if (!h || !visibleHit(h)) {
					this.later(step, 0);
					return;
				}
				show(this.effectBeat(h, fx), e, ridePile);
				this.later(step, Math.max(fxDuration(e), BEAT_MS));
				return;
			}

			if ((e.type === 'damage' || e.type === 'heal') && !(Number(e.amount) || 0)) {
				i += advance;
				this.later(step, 0);
				return;
			}

			show(fx, e, ridePile, e.type === 'ko' ? fxMs(700) : 0);
			let wait = Math.max(fx.kind === 'drawEffect' ? fxMs(1400) : fxDuration(e), BEAT_MS);
			if (e.type === 'request' && (e.kind === 'search' || e.kind === 'mulligan' || e.kind === 'mulliganDraw') &&
				actorIsYou((e.waiting?.[0]), you)) wait = 80;
			if (e.type === 'shuffle' && e.from !== 'hand') wait = fxMs(500);
			i += advance;
			this.later(step, wait);
		};
		// beats before `from` already played on the board this one replaced, apply them without replaying
		if (i > 0) this.foldEvents(events, i - 1);
		step();
	}

	openInspect = (inspect: Preview) => {
		this.setState({ inspect });
	};
	onCardHold = () => {
		this.holdConsumed = true;
		this.dragMoved = true;
		this.stripPress = null;
		if (this.state.drag) this.setState({ drag: null });
	};
	/**
	 * a touch release clicks whatever's under the finger. if the release opened a panel, that's its backdrop, which
	 * then closed it right away. the backdrops ignore that one click
	 */
	releaseClickUntil = 0;
	onInspectBackdrop = () => {
		if (performance.now() < this.releaseClickUntil) return;
		this.closeInspect();
	};
	onTrainerUseBackdrop = () => {
		if (performance.now() < this.releaseClickUntil) return;
		this.setState({ trainerUse: null, playChoice: null, stadiumUse: null });
	};
	openPlayChoice(rows: TcgAction[], hand: number) {
		this.stopRefuseTimer();
		this.setState({
			playChoice: { rows, name: cardLabel(handCardId(this.props.snapshot, hand)) || 'Trainer' },
			selectedHand: null, energyPick: false, retreatPick: false, menuSlot: null, refuse: null, drag: null, playField: null,
			stadiumUse: null,
		});
	}
	closeInspect = () => {
		if (this.state.inspect) this.setState({ inspect: null });
	};

	choose = (a: TcgAction) => {
		if (this.props.snapshot.you == null) return;
		if (this.props.aborted || this.props.snapshot.status === 'aborted') return;
		const snapNow = this.props.snapshot;
		// whose turn it is follows the beats on a held board, not the snapshot that hasn't committed yet
		const shownNow = this.boardSnap || snapNow;
		const offTurn = a.type === 'takePrize' || a.type === 'promote' || a.type === 'searchPick' ||
			a.type === 'searchDone' || a.type === 'discardPick' || a.type === 'payEnergy' ||
			a.type === 'confirmYes' || a.type === 'confirmNo' || a.type === 'pickSlot' ||
			a.type === 'unstagePick' || a.type === 'confirmPicks' ||
			// a choice the opponent's effect gives you (attach or discard energy from your hand) happens on their turn
			a.type === 'handEnergyPick' || a.type === 'discardEnergyPick';
		if (shownNow.status === 'playing' && shownNow.turn !== snapNow.you && !offTurn && !isOwnCopyPromptRow(snapNow, a)) {
			this.showRefuse('Wait for your turn');
			if (this.state.drag) this.setState({ drag: null });
			return;
		}
		if (this.props.waiting) {
			if (this.state.drag) this.setState({ drag: null });
			return;
		}
		if (heldChoice(this.offeredActs()) &&
			(isHeldPickType(a.type) || a.type === 'unstagePick' || a.type === 'confirmPicks')) {
			const sent: TcgAction = { ...a };
			delete sent.multi;
			delete sent.of;
			if (isHeldPickType(a.type)) sent.stage = true;
			this.stopRefuseTimer();
			this.setState({
				selectedHand: null, drag: null, menuSlot: null, refuse: null, slotHint: '', promptPeek: false,
			});
			this.props.onAct(sent);
			return;
		}
		let prizePicked = this.state.prizePicked;
		let prizeGoal = this.state.prizeGoal;
		let prizePickBase = this.state.prizePickBase;
		let firstSent = this.state.firstSent;
		if (a.type === 'chooseFirst') firstSent = true;
		if (a.type === 'takePrize') {
			const idx = Number(a.index);
			if (!prizePicked.some(p => p === idx)) prizePicked = prizePicked.concat(idx);
			if (!prizeGoal) {
				const pending = (this.boardSnap || this.props.snapshot).pendingPrize;
				prizeGoal = pending?.n || prizePicked.length;
			}
			if (!prizePickBase) {
				const seat = snapNow.you ?? 0;
				const who = snapNow.players[seat];
				const pocketNow = !!(who?.energyZone || snapNow.format?.energyZone);
				const needNow = snapNow.format?.prizes || (pocketNow ? 3 : 6);
				prizePickBase = who ? prizesLeft(who, needNow, snapNow.status) : 0;
			}
		}
		this.stopRefuseTimer();
		const sent: TcgAction = { ...a };
		delete sent.lookPile;
		delete sent.lookNote;
		delete sent.attacker;
		this.setState({
			selectedHand: null, energyPick: false, retreatPick: false, retreatSig: null, drag: null,
			menuSlot: null, endTurnConfirm: false, attackMay: null, trainerUse: null, stadiumUse: null, playChoice: null,
			prizePicked, prizeGoal, prizePickBase, firstSent,
			refuse: null, payPicked: [], discardBrowse: null, attachBrowse: null, moveTargetPick: null, playField: null,
			slotHint: '', deckLook: null, boardPick: null, promptPeek: false,
		});
		this.noteHandGone(a);
		this.props.onAct(sent);
	};

	renderHeldBar(held: HeldChoice, snap: TcgSnapshot, floating = false, atHand = false, title = '') {
		const finish = held.confirm || held.none;
		const count = <span class="tcg-held-count" aria-live="polite">{heldCountText(held)}</span>;
		return <div
			class={`tcg-held-bar${floating ? ' is-floating' : ''}${atHand ? ' at-hand' : ''}`}
			role="group" aria-label="Your selection" ref={atHand ? this.handBarRef : undefined}
		>
			{title ? <span class="tcg-held-head"><span class="tcg-held-title">{title}</span>{count}</span> : count}
			<div class="tcg-held-items">
				{heldGroups(held).map(g => {
					const label = heldPickLabel(g.of, snap);
					return <button
						type="button" key={`${g.of.type}-${label.text}-${g.n}`} class="button tcg-held-item"
						title={`Take back ${label.text}`} onClick={() => this.choose(g.undo)}
					>
						<span>{label.text}{g.n > 1 ? ` ×${g.n}` : ''}</span>
						<i class="fa fa-times tcg-held-x" aria-hidden></i>
					</button>;
				})}
			</div>
			<button
				type="button" class="button notifying tcg-held-confirm"
				disabled={!finish || !!this.props.waiting}
				onClick={() => finish && this.choose(finish)}
			>{held.confirm ? 'Confirm' : held.none ? 'Choose none' : 'Confirm'}</button>
		</div>;
	}

	refuseTimer: number | null = null;
	slotHintTimer: number | null = null;
	stopRefuseTimer() {
		if (this.refuseTimer != null) window.clearTimeout(this.refuseTimer);
		this.refuseTimer = null;
	}
	stopSlotHintTimer() {
		if (this.slotHintTimer != null) window.clearTimeout(this.slotHintTimer);
		this.slotHintTimer = null;
	}
	showRefuse(text: string, x?: number, y?: number) {
		if (!text) return;
		this.stopRefuseTimer();
		this.stopSlotHintTimer();
		const cx = x ?? (typeof window !== 'undefined' ? Math.round(window.innerWidth / 2) : 0);
		const cy = y ?? (typeof window !== 'undefined' ? Math.round(window.innerHeight / 3) : 0);
		this.setState({ refuse: { text, x: cx, y: cy }, slotHint: text });
		this.refuseTimer = window.setTimeout(() => {
			this.refuseTimer = null;
			this.setState({ refuse: null });
		}, 2400);
		this.slotHintTimer = window.setTimeout(() => {
			this.slotHintTimer = null;
			this.setState({ slotHint: '' });
		}, 2400);
	}

	handOrder: string[] | null = null;
	handOrderGame = '';
	handGone: HandGone[] = [];
	handShown: { id: string, i: number }[] = [];

	syncHandOrder(hand: string[], snap: TcgSnapshot): string[] {
		const game = `${snap.id || ''}:${snap.you ?? ''}`;
		if (this.handOrderGame !== game) {
			this.handOrderGame = game;
			this.handOrder = readHandOrder(game);
			this.handGone = [];
		}
		const now = Date.now();
		const { order, left } = reconcileHandOrder(this.handOrder || hand, hand, this.handGone.filter(g => now - g.at < 15000));
		this.handGone = left;
		if (order.join('\n') !== this.handOrder?.join('\n')) {
			this.handOrder = order;
			writeHandOrder(game, order);
		}
		return order;
	}

	moveHand(from: number, to: number): boolean {
		const order = this.handOrder;
		if (!order || from === to || to < 0 || to >= order.length) return false;
		this.handOrder = moveHandOrder(order, from, to);
		writeHandOrder(this.handOrderGame, this.handOrder);
		this.forceUpdate();
		return true;
	}

	noteHandGone(a: TcgAction) {
		if (a.type === 'discardPick' && (foeHandChoice(this.actsSnap()) || this.props.snapshot.discardRequest?.fromFoe)) return;
		const at = Date.now();
		const shown = this.handShown;
		for (const i of [a.hand, a.pair]) {
			if (typeof i !== 'number') continue;
			for (let pos = 0; pos < shown.length; pos++) {
				if (shown[pos].i !== i) continue;
				this.handGone.push({ id: shown[pos].id, pos, at });
				break;
			}
		}
	}

	handEl(): HTMLElement | null {
		return this.tableEl?.querySelector('.tcg-hand-mine') as HTMLElement | null;
	}

	pointInHand(x: number, y: number): boolean {
		const hand = this.handEl();
		const dock = this.tableEl?.querySelector('.tcg-dock') as HTMLElement | null;
		if (!hand || !dock) return false;
		const r = hand.getBoundingClientRect();
		const d = dock.getBoundingClientRect();
		return x >= r.left && x <= r.right && y >= d.top && y <= d.bottom;
	}

	handDropIndex(x: number, dragged: number): number {
		const cards = Array.from(this.handEl()?.querySelectorAll<HTMLElement>(':scope > .tcg-card') || []);
		let to = 0;
		cards.forEach((c, j) => {
			if (j === dragged) return;
			const r = c.getBoundingClientRect();
			if (r.left + r.width / 2 < x) to++;
		});
		return to;
	}

	edgeScrollHand(x: number, y: number) {
		const hand = this.handEl();
		if (!hand || hand.scrollWidth <= hand.clientWidth) return;
		const r = hand.getBoundingClientRect();
		if (y < r.top - 24 || y > r.bottom + 24) return;
		const edge = Math.min(48, r.width / 4);
		if (x < r.left + edge) hand.scrollLeft -= 14;
		else if (x > r.right - edge) hand.scrollLeft += 14;
	}

	onHandKey = (ev: KeyboardEvent) => {
		if (!ev.shiftKey || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
		const hand = ev.currentTarget as HTMLElement | null;
		const card = (ev.target as HTMLElement | null)?.closest?.('.tcg-card');
		if (!hand || !card) return;
		const cards = Array.from(hand.querySelectorAll(':scope > .tcg-card'));
		const from = cards.indexOf(card);
		if (from < 0) return;
		ev.preventDefault();
		const to = from + (ev.key === 'ArrowLeft' ? -1 : 1);
		if (!this.moveHand(from, to)) return;
		requestAnimationFrame(() => {
			(hand.querySelectorAll(':scope > .tcg-card')[to] as HTMLElement | undefined)?.focus();
		});
	};

	moveInspected(by: -1 | 1) {
		const at = this.state.inspect?.handAt;
		if (at == null || !this.moveHand(at, at + by)) return;
		this.setState({ inspect: { ...this.state.inspect!, handAt: at + by } });
	}

	private offeredActs(): TcgAction[] {
		if (this.props.snapshot.you == null) return [];
		// the new choices exist from the request beat
		if (this.foldedRequest && this.boardSnap) return this.boardSnap.actions || [];
		// before that, a batch on the held board has used up the old ones (your own action's batch plays there too)
		if (this.props.playing && this.props.fxSnapshot && this.props.snapshot !== this.props.fxSnapshot) return [];
		return this.props.snapshot.actions || [];
	}

	private actsSnap(): TcgSnapshot {
		return this.foldedRequest && this.boardSnap ? this.boardSnap : this.props.snapshot;
	}

	acts(): TcgAction[] {
		const rows = this.offeredActs();
		return foeHandChoice(this.actsSnap()) ? rows.filter(a => a.type !== 'discardPick') : rows;
	}

	foeHandActs(): TcgAction[] {
		return foeHandChoice(this.actsSnap()) ? this.offeredActs().filter(a => a.type === 'discardPick') : [];
	}

	handIdsNow(): string[] | null {
		const snap = this.foldedRequest && this.boardSnap ? this.boardSnap : this.props.snapshot;
		return snap.you == null ? null : handIds(snap.players[snap.you]?.hand);
	}

	dropHits(acts: TcgAction[], drag: DragSource, drop: DropTarget): TcgAction[] {
		return samePairedPlays(actionsForDrop(acts, drag, drop), drag.hand, this.handIdsNow());
	}

	zoneActs(): TcgAction[] {
		return this.acts().filter(a => a.type === 'attachZone');
	}

	stripPress: { i: number, cardId: string, x: number, y: number, lastX: number, moved: boolean } | null = null;
	handStripMedia: MediaQueryList | null = null;
	handSheetClose: HTMLButtonElement | null = null;
	sheetDragY: number | null = null;
	bindHandStrip() {
		if (typeof window.matchMedia !== 'function') return;
		this.handStripMedia = window.matchMedia(HAND_STRIP_QUERY);
		this.syncHandStrip();
		this.handStripMedia.addEventListener('change', this.syncHandStrip);
	}
	syncHandStrip = () => {
		const on = !!this.handStripMedia && this.handStripMedia.matches;
		if (on === this.state.handStrip) {
			this.syncHandEdges();
			return;
		}
		this.setState({ handStrip: on, handSheet: on ? this.state.handSheet : false });
	};
	lockPageScroll(on: boolean) {
		const body = typeof document !== 'undefined' ? document.body : null;
		if (body) body.classList.toggle('tcg-hand-sheet-open', on);
	}
	syncHandEdges = () => {
		const hand = this.handEl();
		if (!hand) return;
		const edges = handEdgeFlags(hand.scrollLeft, hand.clientWidth, hand.scrollWidth);
		hand.classList.toggle('has-more-left', edges.left);
		hand.classList.toggle('has-more-right', edges.right);
	};
	onHandScroll = () => {
		this.syncHandEdges();
	};
	openHandSheet = () => {
		if (!this.state.handStrip) return;
		this.setState({ handSheet: true });
	};
	closeHandSheet = () => {
		if (this.state.handSheet) this.setState({ handSheet: false });
	};
	onSheetHandleDown = (ev: PointerEvent) => {
		this.sheetDragY = ev.clientY;
	};
	onSheetHandleUp = (ev: PointerEvent) => {
		const start = this.sheetDragY;
		this.sheetDragY = null;
		if (start != null && ev.clientY - start > 48) this.closeHandSheet();
	};
	beginHandDrag = (
		i: number, cardId: string,
		e: { clientX: number, clientY: number, preventDefault?: () => void, pointerId?: number, target?: EventTarget | null },
		originX = e.clientX, originY = e.clientY
	) => {
		e.preventDefault?.();
		this.dragMoved = false;
		this.holdConsumed = false;
		const active = Math.hypot(e.clientX - originX, e.clientY - originY) > 8;
		this.setState({
			selectedHand: null,
			energyPick: false,
			retreatPick: false,
			drag: {
				source: 'hand', hand: i, cardId,
				name: cardId, image: cardArt(cardId, { large: true }),
				x: e.clientX, y: e.clientY,
				originX, originY,
				active, over: null, hint: '',
			},
		});
		const cap = e.target as HTMLElement | null;
		if (e.pointerId != null) cap?.setPointerCapture?.(e.pointerId);
	};
	startHandDrag = (i: number, cardId: string, e: PointerEvent) => {
		if (this.props.snapshot.you == null) return;
		if (e.button != null && e.button !== 0) return;
		if (this.state.handStrip && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
			this.stripPress = { i, cardId, x: e.clientX, y: e.clientY, lastX: e.clientX, moved: false };
			return;
		}
		this.beginHandDrag(i, cardId, e);
	};

	startZoneDrag = (e: PointerEvent) => {
		if (e.button != null && e.button !== 0) return;
		const hits = this.zoneActs();
		if (!hits.length) {
			const text = whyCant(this.props.snapshot, { zone: true }, this.props.waiting);
			if (text) this.showRefuse(text, e.clientX, e.clientY);
			return;
		}
		e.preventDefault();
		this.dragMoved = false;
		const zone = this.props.snapshot.players[this.props.snapshot.you ?? 0]?.energyZone;
		this.setState({
			selectedHand: null,
			energyPick: false,
			retreatPick: false,
			drag: {
				source: 'zone',
				cardId: zone?.type || 'energy',
				name: `${zone?.type || 'Energy'} Energy`,
				x: e.clientX, y: e.clientY,
				originX: e.clientX, originY: e.clientY,
				active: false, over: null, hint: 'Drag onto a Pokémon',
			},
		});
	};

	playFieldBox(): { top: number, left: number, width: number, height: number } | null {
		const table = this.tableEl;
		const host = (table?.querySelector('.tcg-arena') as HTMLElement | null) || table;
		if (!host) return null;
		const spots = host.querySelectorAll('.tcg-active-spot');
		if (!spots.length) return null;
		const origin = host.getBoundingClientRect();
		let top = Infinity;
		let left = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		spots.forEach(node => {
			const r = (node as HTMLElement).getBoundingClientRect();
			if (r.width < 2 || r.height < 2) return;
			top = Math.min(top, r.top);
			left = Math.min(left, r.left);
			right = Math.max(right, r.right);
			bottom = Math.max(bottom, r.bottom);
		});
		if (!isFinite(top)) return null;
		const pad = Math.max(6, Math.min(14, origin.width * 0.012));
		let boxLeft = left - origin.left - pad;
		let boxTop = top - origin.top - pad;
		let boxWidth = right - left + pad * 2;
		let boxHeight = bottom - top + pad * 2;
		const edge = 4;
		if (boxLeft < edge) {
			boxWidth -= edge - boxLeft;
			boxLeft = edge;
		}
		if (boxTop < edge) {
			boxHeight -= edge - boxTop;
			boxTop = edge;
		}
		if (boxLeft + boxWidth > origin.width - edge) boxWidth = origin.width - edge - boxLeft;
		if (boxTop + boxHeight > origin.height - edge) boxHeight = origin.height - edge - boxTop;
		return {
			top: boxTop,
			left: boxLeft,
			width: Math.max(48, boxWidth),
			height: Math.max(48, boxHeight),
		};
	}

	pointInActiveField(x: number, y: number): boolean {
		const box = this.playFieldBox();
		const host = (this.tableEl?.querySelector('.tcg-arena') as HTMLElement | null) || this.tableEl;
		if (!box || !host) return false;
		const origin = host.getBoundingClientRect();
		const left = origin.left + box.left;
		const top = origin.top + box.top;
		return x >= left && x <= left + box.width && y >= top && y <= top + box.height;
	}

	hitDrop(x: number, y: number): DropTarget | null {
		const el = document.elementFromPoint(x, y) as HTMLElement | null;
		if (!el) return null;
		const mon = el.closest('.tcg-mon');
		let slotHit: DropTarget | null = null;
		if (mon) {
			const slotRaw = mon.getAttribute('data-drop-slot');
			if (slotRaw != null) {
				const cell: TcgSlot = slotRaw === 'active' ? 'active' : Number(slotRaw);
				const foe = mon.getAttribute('data-drop-foe') === '1';
				const iid = mon.getAttribute('data-iid') || '';
				slotHit = {
					kind: 'slot',
					slot: iid ? this.slotOfIid(iid, foe, cell) : cell,
					foe,
					empty: mon.getAttribute('data-drop-empty') === '1',
				};
			}
		}
		if (el.closest('[data-drop="stadium"]')) return { kind: 'stadium' };
		if (el.closest('[data-drop="discard"]')) return { kind: 'discard' };
		if (this.pointInActiveField(x, y)) {
			const drag = this.state.drag;
			if (slotHit && drag && actionsForDrop(this.acts(), drag, slotHit).length) return slotHit;
			return { kind: 'play' };
		}
		return slotHit;
	}

	onDragMove = (e: PointerEvent) => {
		const press = this.stripPress;
		if (press) {
			const dx = e.clientX - press.x;
			const dy = e.clientY - press.y;
			if (!this.state.handSheet && dy < -12 && Math.abs(dy) >= Math.abs(dx)) {
				const held = press;
				this.stripPress = null;
				this.beginHandDrag(held.i, held.cardId, e, held.x, held.y);
				return;
			}
			if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy)) {
				press.moved = true;
				const hand = this.handEl();
				if (hand) hand.scrollLeft += press.lastX - e.clientX;
			} else if (Math.hypot(dx, dy) > 10) {
				press.moved = true;
			}
			press.lastX = e.clientX;
			return;
		}
		const drag = this.state.drag;
		if (!drag) return;
		const dx = e.clientX - drag.originX;
		const dy = e.clientY - drag.originY;
		const active = drag.active || Math.hypot(dx, dy) > 8;
		if (active) {
			this.dragMoved = true;
			this.holdConsumed = false;
		}
		const over = active ? this.hitDrop(e.clientX, e.clientY) : null;
		let hint = drag.hint;
		let refuse = this.state.refuse;
		const inHand = active && drag.source === 'hand' && !(over && this.dropHits(this.acts(), drag, over).length) &&
			this.pointInHand(e.clientX, e.clientY);
		if (active && drag.source === 'hand') this.edgeScrollHand(e.clientX, e.clientY);
		if (inHand) {
			hint = 'Drop to reorder';
			refuse = null;
		} else if (active && over) {
			const hits = this.dropHits(this.acts(), drag, over);
			hint = hits.length ? dropVerb(hits[0]) : '';
			const text = hits.length ? '' : whyCant(this.props.snapshot, {
				hand: drag.hand, drop: over, source: drag.source, zone: drag.source === 'zone',
			}, this.props.waiting);
			refuse = text ? { text, x: e.clientX, y: e.clientY } : null;
		} else if (active) {
			const mine = drag.hand != null ? this.acts().filter(a => actionTouchesHand(a, drag.hand!)) : [];
			const trainerField = mine.some(a => a.type === 'playTrainer' && !hasBoardTarget(a));
			hint = drag.source === 'zone' ? 'Drop on a Pokémon' :
				trainerField ? 'Drop on the Active field' : 'Drop on a valid target';
			const idle = drag.source === 'hand' && drag.hand != null &&
				!this.acts().some(a => actionTouchesHand(a, drag.hand!));
			const text = idle ? whyCant(this.props.snapshot, { hand: drag.hand }, this.props.waiting) : '';
			refuse = text ? { text, x: e.clientX, y: e.clientY } : null;
		}
		if (active) this.stopRefuseTimer();
		if (
			active === drag.active &&
			e.clientX === drag.x && e.clientY === drag.y &&
			sameDrop(over, drag.over) && hint === drag.hint &&
			(refuse?.text || '') === (this.state.refuse?.text || '')
		) return;
		this.setState({
			drag: { ...drag, x: e.clientX, y: e.clientY, active, over, hint },
			playField: active ? this.playFieldBox() : null,
			refuse,
		});
	};

	revealSelectedHand() {
		const hand = this.tableEl?.querySelector('.tcg-hand-mine') as HTMLElement | null;
		const card = hand?.querySelector('.tcg-card-selected') as HTMLElement | null;
		if (!hand || !card || hand.scrollWidth <= hand.clientWidth) return;
		const view = hand.getBoundingClientRect();
		const at = card.getBoundingClientRect();
		const by = handScrollToReveal(at.left, at.right, view.left, view.right);
		if (by) hand.scrollLeft += by;
	}

	onHandWheel = (ev: WheelEvent) => {
		const hand = ev.currentTarget as HTMLElement | null;
		if (!hand) return;
		const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? hand.clientWidth : 1;
		const next = handWheelTarget(ev.deltaX * unit, ev.deltaY * unit, hand.scrollLeft, hand.clientWidth, hand.scrollWidth);
		if (next == null) return;
		ev.preventDefault();
		hand.scrollLeft = next;
	};

	onDragEnd = (e: PointerEvent) => {
		const press = this.stripPress;
		if (press) {
			this.stripPress = null;
			if (!press.moved && e.type !== 'pointercancel') {
				this.releaseClickUntil = performance.now() + 450;
				this.clickHand(press.i, e);
			}
			return;
		}
		const drag = this.state.drag;
		if (this.holdConsumed) {
			this.holdConsumed = false;
			this.releaseClickUntil = performance.now() + 450;
			if (drag) this.setState({ drag: null, playField: null, refuse: null });
			return;
		}
		if (!drag) return;
		if (e.type === 'pointercancel') {
			this.setState({ drag: null, playField: null, refuse: null });
			return;
		}
		const over = drag.active ? this.hitDrop(e.clientX, e.clientY) : null;
		const hits = over ? this.dropHits(this.acts(), drag, over) : [];
		const toHand = drag.active && drag.source === 'hand' && !hits.length && this.pointInHand(e.clientX, e.clientY);
		if (toHand && drag.hand != null) {
			const from = this.handShown.findIndex(h => h.i === drag.hand);
			this.setState({ drag: null, playField: null, refuse: null });
			if (from >= 0) this.moveHand(from, this.handDropIndex(e.clientX, from));
			return;
		}
		if (drag.active && hits.length === 1) {
			this.choose(hits[0]);
			return;
		}
		if (drag.active && hits.length > 1) {
			if (drag.hand != null && this.openDeckLook(drag.hand)) return;
			if (drag.hand != null) {
				this.openPlayChoice(hits, drag.hand);
				return;
			}
			this.setState({ drag: null, playField: null });
			return;
		}
		if (!drag.active && drag.source === 'hand' && drag.hand != null) {
			this.setState({ drag: null, playField: null });
			this.releaseClickUntil = performance.now() + 450;
			this.clickHand(drag.hand, e);
			return;
		}
		if (!drag.active && drag.source === 'zone') {
			this.setState({ drag: null, playField: null });
			this.clickEnergy(e);
			return;
		}
		const text = whyCant(this.props.snapshot, {
			hand: drag.hand,
			drop: over,
			source: drag.source,
			zone: drag.source === 'zone',
		}, this.props.waiting);
		this.setState({ drag: null, playField: null, inspect: null, refuse: null });
		if (text) this.showRefuse(text, e.clientX, e.clientY);
	};

	clickHand = (i: number, ev?: { clientX: number, clientY: number }) => {
		const hits = samePairedPlays(this.acts().filter(a => actionTouchesHand(a, i)), i, this.handIdsNow());
		if (this.openDeckLook(i)) return;
		const needsTarget = hits.some(a => hasBoardTarget(a));
		const free = hits.filter(a => !hasBoardTarget(a));
		if (!needsTarget && free.length === 1 && free[0].type === 'playTrainer') {
			const id = handCardId(this.props.snapshot, i);
			this.stopRefuseTimer();
			this.setState({
				trainerUse: { action: free[0], name: cardLabel(id) || 'Trainer' },
				stadiumUse: null,
				selectedHand: null,
				energyPick: false,
				retreatPick: false,
				menuSlot: null,
				refuse: null,
				drag: null,
				playField: null,
				deckLook: null,
			});
			return;
		}
		if (hits.length === 1 && !hasBoardTarget(hits[0])) {
			this.choose(hits[0]);
			return;
		}
		// several plays of one kind with no target: nothing tells them apart, so selecting the card would go nowhere.
		// different kinds (active or bench in setup) go by where it's dropped
		if (!needsTarget && free.length > 1 && free.every(a => a.type === free[0].type)) {
			this.openPlayChoice(free, i);
			return;
		}
		if (!hits.length) {
			const id = handCardId(this.props.snapshot, i);
			const stadium = id ? this.acts().find(a => a.type === 'useStadium' && a.pick === id) : undefined;
			if (stadium) {
				this.choose(stadium);
				return;
			}
			const text = whyCant(this.props.snapshot, { hand: i }, this.props.waiting);
			if (text && ev) this.showRefuse(text, ev.clientX, ev.clientY);
			return;
		}
		this.stopRefuseTimer();
		const next = this.state.selectedHand === i ? null : i;
		this.setState({
			selectedHand: next,
			energyPick: false,
			retreatPick: false,
			menuSlot: null,
			refuse: null,
			deckLook: null,
			handSheet: next != null && needsTarget && this.state.handSheet ? false : this.state.handSheet,
		});
	};

	clickStadium = (ev?: { clientX: number, clientY: number }, cardId?: string) => {
		const acts = this.acts();
		const selected = this.state.selectedHand;
		let chosen: TcgAction | null = null;
		if (selected != null) {
			const id = handCardId(this.props.snapshot, selected);
			const hit = id ? acts.find(a => a.type === 'useStadium' && a.pick === id) : undefined;
			if (hit) chosen = hit;
		}
		if (!chosen) chosen = stadiumClickAction(acts);
		if (chosen) {
			const snap = this.props.snapshot;
			const you = snap.you ?? 0;
			const played = cardId || snap.players[you]?.stadium || snap.players[you === 0 ? 1 : 0]?.stadium || '';
			this.stopRefuseTimer();
			this.releaseClickUntil = performance.now() + 450;
			this.setState({
				stadiumUse: { action: chosen, name: played ? cardLabel(played) : 'Stadium' },
				trainerUse: null,
				playChoice: null,
				selectedHand: null,
				energyPick: false,
				retreatPick: false,
				menuSlot: null,
				refuse: null,
				drag: null,
				playField: null,
				deckLook: null,
			});
			return;
		}
		const text = stadiumUseHint(acts);
		if (text && ev) this.showRefuse(text, ev.clientX, ev.clientY);
	};

	openDeckLook(hand: number): boolean {
		const prompt = deckLookPrompt(this.acts(), hand);
		if (!prompt) return false;
		this.stopRefuseTimer();
		this.setState({
			deckLook: { hand, picked: [] },
			selectedHand: null,
			drag: null,
			energyPick: false,
			retreatPick: false,
			retreatSig: null,
			menuSlot: null,
			refuse: null,
		});
		return true;
	}

	toggleDeckLook = (index: number) => {
		const cur = this.state.deckLook;
		if (!cur) return;
		const prompt = deckLookPrompt(this.acts(), cur.hand);
		if (!prompt || index < 0 || index >= prompt.pile.length) return;
		const has = cur.picked.includes(index);
		if (!has && cur.picked.length >= prompt.need) return;
		const picked = has ? cur.picked.filter(i => i !== index) : cur.picked.concat(index);
		this.setState({ deckLook: { hand: cur.hand, picked } });
	};

	confirmDeckLook = () => {
		const cur = this.state.deckLook;
		if (!cur) return;
		const prompt = deckLookPrompt(this.acts(), cur.hand);
		if (cur.picked.length !== prompt?.need) return;
		const action = deckLookAction(prompt.actions, cur.picked);
		if (!action) return;
		this.choose(action);
	};

	menuActs(slot: TcgSlot): TcgAction[] {
		return menuActionsForSlot(this.acts(), slot, this.iidAt(slot, false));
	}

	boardChoice(): BoardChoice | null {
		return boardChoiceOf(this.props.snapshot, this.state.boardPick);
	}

	monViewAt(slot: TcgSlot, foe: boolean): TcgPokemonView | null {
		const snap = this.boardSnap || this.props.snapshot;
		const you = snap.you ?? (this.props.viewpoint === 1 ? 1 : 0);
		const p = snap.players[foe ? 1 - you : you];
		return (slot === 'active' ? p?.active : p?.bench?.[Number(slot)]) || null;
	}

	dropStaleChoices(prev: this['props']) {
		const snap = this.props.snapshot;
		if (snap.actions === prev.snapshot.actions && snap.you === prev.snapshot.you &&
			this.props.playing === prev.playing) return;
		if (this.props.playing && snap.you === prev.snapshot.you) return;
		const st = this.state;
		const offered = this.offeredActs();
		const stale = (rows: (TcgAction | null | undefined)[]) =>
			snap.you !== prev.snapshot.you || !rowsStillOffered(rows, offered);
		const drop: Partial<this['state']> = {};
		if (st.moveTargetPick && stale(st.moveTargetPick.actions)) drop.moveTargetPick = null;
		if (st.attackMay && stale([st.attackMay.yes, st.attackMay.no])) drop.attackMay = null;
		if (st.trainerUse && stale([st.trainerUse.action])) drop.trainerUse = null;
		if (st.stadiumUse && stale([st.stadiumUse.action])) drop.stadiumUse = null;
		if (Object.keys(drop).length) this.setState(drop);
	}

	iidAt(slot: TcgSlot, foe: boolean): string {
		const snap = this.props.snapshot;
		const seat = foe ? (snap.you === 0 ? 1 : 0) : (snap.you ?? 0);
		const p = snap.players[seat];
		const mon = slot === 'active' ? p?.active : p?.bench?.[Number(slot)];
		return mon?.iid || '';
	}

	/** a slot pick only names a slot, `pendingSlotPick.side` says whose pokemon it is */
	slotPickSide(foe: boolean): boolean {
		const side = this.props.snapshot.pendingSlotPick?.side;
		return !side || (side === 'foe') === foe;
	}

	choiceMonProps(
		mon: TcgPokemonView | null, slot: TcgSlot, foe: boolean
	): { selected?: true, keyPick?: true, choiceFrom?: true } {
		const choice = this.boardChoice();
		if (!mon) return {};
		const heldPick = this.targetFocus() && this.heldSlotPicked(slot, foe);
		if (!choice) return heldPick ? { selected: true } : {};
		const out: { selected?: true, keyPick?: true, choiceFrom?: true } = {};
		if (heldPick) out.selected = true;
		if (choice.from?.iid === mon.iid) out.choiceFrom = true;
		if (choice.kind === 'attached') {
			if (!choiceSourceFor(choice, mon.iid)) return out;
			out.keyPick = true;
			if (choice.picked?.iid === mon.iid) out.selected = true;
			return out;
		}
		if (this.focusOk(slot, foe) ?? this.slotLegal(slot, foe)) out.keyPick = true;
		return out;
	}

	/**
	 * a pick sent under an earlier prompt doesn't count. the next prompt of the same effect (giacomo's next pokemon)
	 * can offer the same pick
	 */
	choiceSent(choice: BoardChoice | null): string {
		const pick = this.state.boardPick;
		return pick?.sent && pick.key === choice?.key ? pick.sent : '';
	}

	clickChoiceSource(choice: BoardChoice & { kind: 'attached' }, iid: string, ev?: MouseEvent) {
		if (this.props.waiting || this.choiceSent(choice)) return;
		const src = choiceSourceFor(choice, iid);
		if (!src) {
			this.showRefuse('Choose one of the highlighted Pokémon.', ev?.clientX, ev?.clientY);
			return;
		}
		this.stopRefuseTimer();
		this.choiceFocusPicker = true;
		this.setState({ boardPick: { key: choice.key, iid: src.iid }, refuse: null, menuSlot: null, selectedHand: null });
	}

	pickChoiceCard = (card: BoardChoiceCard) => {
		const choice = this.boardChoice();
		if (choice?.kind !== 'attached' || this.props.waiting || this.choiceSent(choice)) return;
		const row = choice.picked?.cards.find(c => c.row.pick === card.row.pick)?.row;
		if (!row) return;
		const iid = choice.picked!.iid;
		this.choose(row);
		this.setState({ boardPick: { key: choice.key, iid, sent: String(row.pick) } });
	};

	choiceBackable(): boolean {
		const choice = this.boardChoice();
		return !!choice && choice.kind === 'attached' && choice.sources.length > 1 && !!choice.picked &&
			!this.choiceSent(choice) && !this.props.waiting;
	}

	choiceBack = () => {
		if (!this.choiceBackable()) return;
		const iid = this.state.boardPick?.iid || '';
		this.setState({ boardPick: null });
		const base = (this as unknown as { base?: HTMLElement }).base;
		if (base?.querySelector) {
			queueMicrotask(() => base.querySelector<HTMLElement>(`.tcg-mon[data-iid="${escapeSelector(iid)}"]`)?.focus({
				preventScroll: true,
			}));
		}
	};

	retreatTarget(slot: TcgSlot, foe: boolean): TcgAction | null {
		if (foe || typeof slot !== 'number') return null;
		const acts = this.acts();
		const sig = this.state.retreatSig;
		const probe = acts.find(a => a.type === 'retreat' && (sig == null || retreatSignature(a) === sig));
		const choice = probe ? retreatChoice(acts, probe, slot) : null;
		return choice && choice !== 'pick' ? choice : null;
	}

	promoteTarget(slot: TcgSlot, foe: boolean): TcgAction | null {
		if (foe || typeof slot !== 'number') return null;
		const promo = this.acts().filter(a => a.type === 'promote' && a.bench === slot);
		return promo.length === 1 && !this.menuActs(slot).some(a => a.type === 'ability') ? promo[0] : null;
	}

	pickSlotTarget(slot: TcgSlot, foe: boolean): TcgAction | null {
		if (foe && !this.props.snapshot.pendingSlotPick) return null;
		const pick = this.slotPickSide(foe) ? this.acts().filter(a => a.type === 'pickSlot' && actionTouchesSlot(a, slot)) : [];
		return pick.length === 1 ? pick[0] : null;
	}

	targetRow(slot: TcgSlot, foe: boolean): TcgAction | null {
		if (this.state.retreatPick) return this.retreatTarget(slot, foe);
		return this.promoteTarget(slot, foe) || this.pickSlotTarget(slot, foe);
	}

	targetOpen(): boolean {
		if (this.focusBlocked()) return false;
		const st = this.state;
		if (st.selectedHand != null || st.energyPick || st.drag?.active) return false;
		if (st.retreatPick) return true;
		return this.acts().some(a => a.type === 'pickSlot' || a.type === 'promote');
	}

	focusBlocked(): boolean {
		const snap = this.props.snapshot;
		const st = this.state;
		if (snap.you == null || this.props.ended || this.props.aborted || snap.status === 'aborted') return true;
		if (st.moveTargetPick || st.attackMay || st.trainerUse || st.stadiumUse || st.endTurnConfirm || st.playChoice ||
			st.deckLook || st.discardBrowse || st.attachBrowse || st.playField) return true;
		const open = this.actsSnap();
		return !!(open.pendingSearch || open.pendingConfirm || open.pendingDiscardEnergy || open.pendingRetreatPay ||
			open.pendingPrize || open.pendingCopyAttack || open.pendingMulligan != null || open.pendingMulliganDraw ||
			open.pendingFirst != null || foeHandChoice(open));
	}

	handSlotRows(slot: TcgSlot, foe: boolean): { hits: TcgAction[], legacy: TcgAction[], drop: DropTarget } {
		const selectedHand = this.state.selectedHand!;
		const snap = this.props.snapshot;
		const side = snap.players[foe ? (snap.you === 0 ? 1 : 0) : (snap.you ?? 0)];
		const empty = !(slot === 'active' ? side?.active : side?.bench?.[Number(slot)]);
		const drop: DropTarget = { kind: 'slot', slot, foe, empty };
		const acts = this.acts();
		const hits = actionsForDrop(acts, { source: 'hand', hand: selectedHand }, drop);
		const legacy = acts.filter(a => actionTouchesHand(a, selectedHand) && actionTouchesSide(a, slot, foe));
		return { hits, legacy, drop };
	}

	handSlotAccepts(slot: TcgSlot, foe: boolean): boolean {
		const { hits, legacy } = this.handSlotRows(slot, foe);
		return hits.length > 0 || legacy.length === 1;
	}

	handDestFocus(): boolean {
		const sel = this.state.selectedHand;
		if (sel == null || this.state.drag?.active || this.state.energyPick || this.focusBlocked()) return false;
		const snap = this.props.snapshot;
		const spots = snap.format?.benchSize || Math.max(...snap.players.map(p => p?.bench?.length || 0), 3);
		for (const foe of [false, true]) {
			if (this.handSlotAccepts('active', foe)) return true;
			for (let i = 0; i < spots; i++) if (this.handSlotAccepts(i, foe)) return true;
		}
		return false;
	}

	handChoiceFocus(): boolean {
		if (this.focusBlocked() || this.state.drag?.active) return false;
		const acts = this.acts();
		return acts.length > 0 && !!ownHandChoice(this.actsSnap(), acts);
	}

	focusOk(slot: TcgSlot, foe: boolean): boolean | null {
		const board = this.targetOk(slot, foe);
		if (board != null) return board;
		return this.handDestFocus() ? this.handSlotAccepts(slot, foe) : null;
	}

	targetFocus(): boolean {
		if (!this.targetOpen()) return false;
		const snap = this.props.snapshot;
		const you = snap.you ?? 0;
		for (const foe of [false, true]) {
			const p = snap.players[foe ? 1 - you : you];
			if (!p) continue;
			if (p.active && this.targetRow('active', foe)) return true;
			const bench = p.bench || [];
			for (let i = 0; i < bench.length; i++) if (bench[i] && this.targetRow(i, foe)) return true;
		}
		return false;
	}

	targetOk(slot: TcgSlot, foe: boolean): boolean | null {
		return this.targetFocus() ? !!this.targetRow(slot, foe) : null;
	}

	heldSlotPicked(slot: TcgSlot, foe: boolean): boolean {
		const row = this.pickSlotTarget(slot, foe);
		return !!row && heldCount(heldChoice(this.offeredActs()), row) > 0;
	}

	slotActionable(slot: TcgSlot, foe = false): boolean {
		const choice = this.boardChoice();
		if (choice?.kind === 'attached') return !!choiceSourceFor(choice, this.iidAt(slot, foe));
		const answers = this.focusOk(slot, foe);
		if (answers != null) return answers;
		if (foe) return this.slotLegal(slot, true);
		if (this.menuActs(slot).length) return true;
		return this.slotLegal(slot, false);
	}

	clickSlot = (slot: TcgSlot, foe = false, ev?: MouseEvent) => {
		if (this.state.drag?.active) return;
		const host = ((ev?.target || ev?.currentTarget) as HTMLElement | null)?.closest?.('.tcg-mon');
		const iid = host?.getAttribute('data-iid') || '';
		if (iid) slot = this.slotOfIid(iid, foe, slot);
		if (this.props.snapshot.you == null) {
			const view = this.boardSnap || this.props.snapshot;
			const meIndex = this.props.viewpoint === 0 || this.props.viewpoint === 1 ? this.props.viewpoint : 0;
			const seen = (iid && findMonView(view.players, iid)) ||
				(() => {
					const side = view.players[foe ? 1 - meIndex : meIndex];
					return slot === 'active' ? side?.active : side?.bench?.[Number(slot)];
				})();
			if (seen) this.openInspect({ cardId: seen.cardId, image: seen.image, name: seen.name });
			return;
		}
		const boardPrompt = this.boardChoice();
		if (boardPrompt?.kind === 'attached') {
			this.clickChoiceSource(boardPrompt, iid || this.iidAt(slot, foe), ev);
			return;
		}
		const snap = this.props.snapshot;
		const at = (text: string) => {
			if (text) this.showRefuse(text, ev?.clientX, ev?.clientY);
		};
		const { selectedHand, energyPick, retreatPick, menuSlot } = this.state;
		if (selectedHand != null) {
			const { hits, legacy, drop } = this.handSlotRows(slot, foe);
			if (hits.length === 1) return this.choose(hits[0]);
			if (legacy.length === 1) return this.choose(legacy[0]);
			// `whyCant` is empty for a drop with matches, so several matches would say nothing
			if (hits.length > 1) return this.openPlayChoice(hits, selectedHand);
			at(whyCant(snap, { hand: selectedHand, drop }, this.props.waiting));
			return;
		}
		if (!foe && energyPick) {
			const hits = this.zoneActs().filter(a => actionTouchesSlot(a, slot));
			if (hits.length === 1) return this.choose(hits[0]);
			at(whyCant(snap, { zone: true, drop: { kind: 'slot', slot, foe, empty: false }, source: 'zone' }, this.props.waiting));
			return;
		}
		if (retreatPick) {
			const choice = this.retreatTarget(slot, foe);
			if (choice) return this.choose(choice);
			at(foe || slot === 'active' ? 'Choose a Benched Pokémon to switch in.' : "This Pokémon can't retreat there.");
			return;
		}
		const promo = this.promoteTarget(slot, foe);
		if (promo) return this.choose(promo);
		const pick = this.pickSlotTarget(slot, foe);
		if (pick) return this.choose(pick);
		if (boardPrompt?.kind === 'slot') {
			at('Choose one of the highlighted Pokémon.');
			return;
		}
		if (foe) {
			const mon = this.monViewAt(slot, true);
			if (mon) this.openInspect({ cardId: mon.cardId, image: mon.image, name: mon.name });
			return;
		}
		const menu = this.menuActs(slot);
		const myTurnNow = snap.status === 'playing' && snap.turn === snap.you && !this.props.waiting;
		const rows = myTurnNow ? menuRows(snap, slot, menu, !!PS.prefs.tcghideillegal) : [];
		if (menu.length || rows.length) {
			this.stopRefuseTimer();
			this.stopSlotHintTimer();
			this.setState({
				menuSlot: menuSlot === slot ? null : slot,
				menuWhy: '',
				selectedHand: null,
				energyPick: false,
				refuse: null,
				slotHint: '',
			});
			return;
		}
		this.setState({ menuSlot: null });
		const why = whyCant(snap, { slot }, this.props.waiting) || whyMon(snap, slot) ||
			"This Pokémon has no actions available right now.";
		at(why);
	};

	pickMenuAction = (a: TcgAction) => {
		const menu = this.state.menuSlot != null ? this.menuActs(this.state.menuSlot) : this.acts();
		if ((a.type === 'attack' || a.type === 'ability') && isMultiTargetGroup(menu, a)) {
			const group = moveTargetGroup(menu, a);
			const snap = this.props.snapshot;
			const me = snap.players[snap.you ?? 0];
			const title = describeAction(a, snap, { moveOnly: true });
			const monAtk = a.type === 'attack' ? me?.active?.attacks?.[a.index as number] : null;
			const cost = (a.cost as string[] | undefined) || monAtk?.cost;
			const damage = (a.damage as string | undefined) || monAtk?.damage;
			this.setState({
				moveTargetPick: {
					title,
					kind: a.type,
					actions: group,
					cost,
					damage,
				},
				menuSlot: null,
				selectedHand: null,
				energyPick: false,
				retreatPick: false,
			});
			return;
		}
		if (a.type === 'attack') {
			const pair = optionalAttackPair(menu, a.index);
			if (pair) {
				const text = pair.yes.text || pair.no.text || 'Use this attack\'s extra effect?';
				this.setState({
					attackMay: { yes: pair.yes, no: pair.no, title: pair.yes.name || 'Attack', text },
					menuSlot: null,
				});
				return;
			}
		}
		if (a.type === 'retreat') {
			const choice = retreatChoice(this.acts(), a);
			if (choice && choice !== 'pick') return this.choose(choice);
			if (choice === 'pick') {
				this.setState({
					retreatPick: true, retreatSig: retreatSignature(a),
					menuSlot: null, selectedHand: null, energyPick: false,
				});
			}
			return;
		}
		this.choose(a);
	};

	pickMoveTarget = (a: TcgAction) => {
		const pick = this.state.moveTargetPick;
		if (!pick) return;
		const sameTarget = pick.actions.filter(x => actionTargetKey(x) === actionTargetKey(a));
		const pool = sameTarget.length ? sameTarget : [a];
		if (a.type === 'attack') {
			const pair = optionalAttackPair(pool, a.index);
			if (pair) {
				const text = pair.yes.text || pair.no.text || 'Use this attack\'s extra effect?';
				this.setState({
					attackMay: { yes: pair.yes, no: pair.no, title: pair.yes.name || pick.title || 'Attack', text },
					moveTargetPick: null,
				});
				return;
			}
		}
		this.setState({ moveTargetPick: null });
		this.choose(pool[0] || a);
	};

	clickEnergy = (ev?: { clientX: number, clientY: number }) => {
		const hits = this.zoneActs();
		if (!hits.length) {
			const text = whyCant(this.props.snapshot, { zone: true }, this.props.waiting);
			if (text && ev) this.showRefuse(text, ev.clientX, ev.clientY);
			return;
		}
		if (hits.length === 1) {
			this.choose(hits[0]);
			return;
		}
		this.setState({ energyPick: true, selectedHand: null, retreatPick: false, menuSlot: null });
	};

	slotDropMeta(slot: TcgSlot, foe: boolean, empty: boolean): { dropOk: boolean, dropHot: boolean, dropLabel: string } {
		const drag = this.state.drag;
		if (!drag?.active) {
			return { dropOk: this.focusOk(slot, foe) ?? this.slotLegal(slot, foe), dropHot: false, dropLabel: '' };
		}
		const drop: DropTarget = { kind: 'slot', slot, foe, empty };
		const hits = actionsForDrop(this.acts(), drag, drop);
		const hot = sameDrop(drag.over, drop);
		return {
			dropOk: hits.length > 0,
			dropHot: hot && hits.length > 0,
			dropLabel: hits.length ? dropVerb(hits[0]) : '',
		};
	}

	slotLegal(slot: TcgSlot, foe = false): boolean {
		const acts = this.acts();
		const { selectedHand, energyPick, retreatPick, drag } = this.state;
		if (drag?.active) {
			const empty = true;
			return canDropAnywhere(acts, drag, { kind: 'slot', slot, foe, empty }) ||
				canDropAnywhere(acts, drag, { kind: 'slot', slot, foe, empty: false });
		}
		if (selectedHand != null) {
			const forEmpty = actionsForDrop(acts, { source: 'hand', hand: selectedHand }, {
				kind: 'slot', slot, foe, empty: true,
			});
			const forOcc = actionsForDrop(acts, { source: 'hand', hand: selectedHand }, {
				kind: 'slot', slot, foe, empty: false,
			});
			if (forEmpty.length || forOcc.length) return true;
			return acts.some(a => actionTouchesHand(a, selectedHand) && actionTouchesSide(a, slot, foe));
		}
		if (!foe && (energyPick || !retreatPick) && this.zoneActs().some(a => actionTouchesSlot(a, slot))) {
			return true;
		}
		if (retreatPick) {
			const sig = this.state.retreatSig;
			return typeof slot === 'number' && acts.some(a =>
				a.type === 'retreat' && a.bench === slot && (sig == null || retreatSignature(a) === sig)
			);
		}
		if (acts.some(a => a.type === 'promote' && typeof slot === 'number' && a.bench === slot)) return true;
		if (this.slotPickSide(foe) && acts.some(a => a.type === 'pickSlot' && actionTouchesSlot(a, slot))) return true;
		return false;
	}

	clearSel = () => {
		this.payQueue = [];
		this.paySending = false;
		this.setState({
			selectedHand: null, energyPick: false, retreatPick: false, retreatSig: null, drag: null, inspect: null,
			menuSlot: null, endTurnConfirm: false, attackMay: null, trainerUse: null, stadiumUse: null, moveTargetPick: null,
			payPicked: [], discardBrowse: null, attachBrowse: null, playField: null, slotHint: '',
		});
	};

	/** highest index first, so lower ones don't shift when the server splices energy */
	payQueue: number[] = [];
	paySending = false;

	togglePayEnergy = (index: number, need: number, pays: TcgAction[]) => {
		if (this.payQueue.length || this.paySending) return;
		this.setState((prev: TcgBoard['state']) => {
			const cur = prev.payPicked;
			const at = cur.indexOf(index);
			if (at >= 0) return { payPicked: cur.filter(i => i !== index) };
			if (cur.length >= need) return null;
			const next = cur.concat(index);
			if (need === 1) {
				queueMicrotask(() => this.confirmPayEnergy(pays, next));
			}
			return { payPicked: need === 1 ? [] : next };
		});
	};

	confirmPayEnergy = (pays: TcgAction[], pickedOverride?: number[]) => {
		if (this.payQueue.length || this.paySending) return;
		const need = this.props.snapshot.pendingRetreatPay?.need ?? 0;
		const picked = pickedOverride || this.state.payPicked;
		if (!need || picked.length !== need) return;
		const indexes = picked.slice().sort((a, b) => b - a);
		const first = pays.find(p => p.index === indexes[0]);
		if (!first) return;
		this.paySending = true;
		this.payQueue = indexes.slice(1);
		this.stopRefuseTimer();
		this.stopSlotHintTimer();
		this.setState({
			selectedHand: null, energyPick: false, retreatPick: false, drag: null,
			menuSlot: null, endTurnConfirm: false, attackMay: null, trainerUse: null, stadiumUse: null,
			refuse: null, payPicked: [], discardBrowse: null, attachBrowse: null, moveTargetPick: null, playField: null,
			slotHint: '',
		});
		this.props.onAct(first);
	};

	prizeCtx: { slots: PrizeRailSlot[], offered: TcgAction[], goal: number } = { slots: [], offered: [], goal: 0 };
	prizeQueue: number[] = [];
	prizeBatchSlots: number[] = [];

	pickPrize = (slot: number) => {
		if (this.prizeBatchSlots.length || this.props.waiting) return;
		const { slots, offered, goal } = this.prizeCtx;
		const at = slots.find(s => s.slot === slot);
		const act = at?.serverIndex != null ? offered.find(a => Number(a.index) === at.serverIndex) : undefined;
		if (!act) return;
		const need = Math.min(goal, slots.filter(s => !s.taken).length);
		if (need < 1) return;
		const sel = this.state.prizeSel;
		let next: number[];
		if (sel.includes(slot)) next = sel.filter(s => s !== slot);
		else if (need === 1) next = [slot];
		else next = sel.length < need ? sel.concat(slot) : sel;
		this.setState({ prizeSel: next });
	};

	confirmPrizes = () => {
		if (this.prizeBatchSlots.length || this.props.waiting) return;
		const { slots, goal } = this.prizeCtx;
		const need = Math.min(goal, slots.filter(s => !s.taken).length);
		const sel = this.state.prizeSel;
		if (need < 1 || sel.length !== need) return;
		this.prizeQueue = sel.slice().sort((a, b) => b - a);
		this.prizeBatchSlots = slots.filter(s => !s.taken).map(s => s.slot);
		this.setState({ promptPeek: false });
		this.flushPrizeQueue();
	};

	flushPrizeQueue = () => {
		if (!this.prizeBatchSlots.length) return;
		if (!this.prizeQueue.length) {
			const owed = this.props.snapshot.pendingPrize;
			if (!this.props.waiting && owed?.seat !== this.props.snapshot.you) this.endPrizeBatch();
			return;
		}
		if (this.props.waiting || this.props.playing) return;
		const { slots } = this.prizeCtx;
		const slot = this.prizeQueue[0];
		const at = slots.find(s => s.slot === slot);
		const act = at?.serverIndex != null ?
			this.acts().find(a => a.type === 'takePrize' && Number(a.index) === at.serverIndex) : undefined;
		if (!act) {
			const owed = this.props.snapshot.pendingPrize;
			if (owed?.seat !== this.props.snapshot.you) this.endPrizeBatch();
			return;
		}
		this.prizeQueue = this.prizeQueue.slice(1);
		this.choose(act);
	};

	endPrizeBatch() {
		this.prizeQueue = [];
		this.prizeBatchSlots = [];
		if (this.state.prizeSel.length) this.setState({ prizeSel: [] });
	}

	flushPayQueue = () => {
		const acts = this.acts();
		const pays = acts.filter(a => a.type === 'payEnergy');
		if (retreatPayOver(acts, this.props.snapshot.status)) {
			this.payQueue = [];
			this.paySending = false;
			return;
		}
		if (!pays.length) return;
		if (!this.payQueue.length) {
			this.paySending = false;
			return;
		}
		const nextIdx = this.payQueue[0];
		const act = pays.find(p => Number(p.index) === nextIdx);
		if (!act) {
			this.payQueue = [];
			this.paySending = false;
			return;
		}
		this.payQueue = this.payQueue.slice(1);
		this.props.onAct(act);
	};

	openDiscardBrowse = (side: 'me' | 'foe', ev?: MouseEvent) => {
		if (this.state.drag?.active) return;
		ev?.stopPropagation();
		const snap = this.props.snapshot;
		const me = snap.players[snap.you ?? 0];
		const foe = snap.players[snap.you === 0 ? 1 : 0];
		const pile = side === 'me' ? me?.discard : foe?.discard;
		if (!pile?.length) {
			this.showRefuse('The discard pile is empty.', ev?.clientX, ev?.clientY);
			return;
		}
		this.setState({ discardBrowse: side, attachBrowse: null, menuSlot: null, inspect: null });
	};

	/**
	 * from the `trainer` event in the batch that opened the choice. later steps don't have that event, so keep it
	 * while the choice lasts
	 */
	choiceSource = '';
	noteChoiceSource(choice: BoardChoice | null) {
		if (!choice) {
			this.choiceSource = '';
			return;
		}
		const you = this.props.snapshot.you;
		const events = this.props.events || [];
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i];
			if (e.type === 'trainer' && e.seat === you && e.cardId) {
				this.choiceSource = String(e.cardId);
				return;
			}
		}
	}

	choiceSpot(seat: number, slot: TcgSlot): string {
		const side = seat === this.props.snapshot.you ? 'Your' : "Opponent's";
		return `${side} ${slot === 'active' ? 'Active' : `Bench ${Number(slot) + 1}`}`;
	}

	choiceBarEl: HTMLElement | null = null;
	choicePickerEl: HTMLElement | null = null;
	choicePickerIid = '';
	choiceFocusPicker = false;
	onChoiceResize = () => {
		this.placeChoiceUi();
		this.placeHandBar();
		this.placeFirstBanner();
		this.syncHandEdges();
	};
	firstBannerEl: HTMLElement | null = null;
	firstBannerRef = (el: unknown) => {
		this.firstBannerEl = el as HTMLElement | null;
		this.placeFirstBanner();
	};
	/**
	 * the setup "who goes first" banner goes in the gap between the active spots, somewhere it covers nothing. short
	 * and narrow boards barely have a gap, so it steps sideways, then up or down, till it's clear
	 */
	placeFirstBanner() {
		const b = this.firstBannerEl;
		const table = this.tableEl;
		if (!b?.isConnected || !table) return;
		b.style.left = '';
		b.style.top = '';
		const foeSpot = table.querySelector('.tcg-active-spot.foe');
		const meSpot = table.querySelector('.tcg-active-spot.me');
		const foe = foeSpot?.querySelector('.tcg-mon') || foeSpot;
		const me = meSpot?.querySelector('.tcg-mon') || meSpot;
		if (!foe || !me) return;
		const t = table.getBoundingClientRect();
		const f = foe.getBoundingClientRect();
		const m = me.getBoundingClientRect();
		const upper = f.top < m.top ? f : m;
		const lower = upper === f ? m : f;
		const w = b.offsetWidth;
		const h = b.offsetHeight;
		const blocks = Array.from(table.querySelectorAll(FIRST_BANNER_BLOCKS))
			.map(el => el.getBoundingClientRect())
			.filter(r => r.width > 0 && r.height > 0);
		const clear = (cx: number, cy: number) => {
			const l = cx - w / 2, r = cx + w / 2, tp = cy - h / 2, bt = cy + h / 2;
			if (l < t.left + 4 || r > t.right - 4 || tp < t.top + 4 || bt > t.bottom - 4) return false;
			return blocks.every(q => Math.min(r, q.right) - Math.max(l, q.left) <= 1 ||
				Math.min(bt, q.bottom) - Math.max(tp, q.top) <= 1);
		};
		const cx0 = (upper.left + upper.right) / 2;
		const cy0 = (upper.bottom + lower.top) / 2;
		const step = 6;
		for (let dy = 0; dy <= 30; dy++) {
			const cy = cy0 + (dy % 2 ? 1 : -1) * Math.ceil(dy / 2) * step;
			for (let dx = 0; dx <= 2 * Math.ceil(t.width / step); dx++) {
				const cx = cx0 + (dx % 2 ? 1 : -1) * Math.ceil(dx / 2) * step;
				if (!clear(cx, cy)) continue;
				b.style.left = `${Math.round(cx - t.left)}px`;
				b.style.top = `${Math.round(cy - t.top)}px`;
				return;
			}
		}
		b.style.left = `${Math.round(cx0 - t.left)}px`;
		b.style.top = `${Math.round(cy0 - t.top)}px`;
	}
	handBarEl: HTMLElement | null = null;
	handBarRef = (el: unknown) => {
		this.handBarEl = el as HTMLElement | null;
		this.placeHandBar();
	};
	placeHandBar() {
		const el = this.handBarEl;
		const table = el?.isConnected ? el.closest<HTMLElement>('.tcg-table') : null;
		const dock = table?.querySelector<HTMLElement>('.tcg-dock');
		if (!el || !table || !dock) return;
		const t = table.getBoundingClientRect();
		const d = dock.getBoundingClientRect();
		if (!d.height || !t.height) return;
		const want = Math.round(t.bottom - d.top + 6);
		const most = Math.max(4, Math.round(t.height - el.offsetHeight - 4));
		el.style.bottom = `${Math.max(4, Math.min(want, most))}px`;
	}
	choiceBarRef = (el: unknown) => {
		this.choiceBarEl = el as HTMLElement | null;
		this.placeChoiceUi();
	};

	/**
	 * the board can still be settling when the bar or picker renders (pokemon move a bit after mount), so place them
	 * again after any size change
	 */
	choiceObserver: ResizeObserver | null = null;
	choiceObserved: Element[] = [];
	choiceFrame = 0;
	scheduleChoicePlace = () => {
		if (this.choiceFrame || typeof requestAnimationFrame === 'undefined') return;
		this.choiceFrame = requestAnimationFrame(() => {
			this.choiceFrame = 0;
			this.placeChoiceUi();
		});
	};
	observeChoiceLayout(els: (Element | null | undefined)[]) {
		if (typeof ResizeObserver === 'undefined') return;
		const list = els.filter((e): e is Element => !!e);
		// observing reports once. only observe again when the set changes, or each report would loop
		if (list.length === this.choiceObserved.length && list.every((e, i) => e === this.choiceObserved[i])) return;
		if (!this.choiceObserver) this.choiceObserver = new ResizeObserver(this.scheduleChoicePlace);
		this.choiceObserver.disconnect();
		for (const e of list) this.choiceObserver.observe(e);
		this.choiceObserved = list;
	}
	stopChoiceLayout() {
		this.choiceObserver?.disconnect();
		this.choiceObserved = [];
		if (this.choiceFrame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.choiceFrame);
		this.choiceFrame = 0;
	}

	placeChoiceUi() {
		if (typeof window === 'undefined') return;
		const picker = this.choicePickerEl?.isConnected ? this.choicePickerEl : null;
		const bar = this.choiceBarEl?.isConnected ? this.choiceBarEl : null;
		if (!picker && !bar) {
			this.stopChoiceLayout();
			return;
		}
		if (picker) this.placeChoicePicker(picker, this.choicePickerIid, bar);
		if (bar) this.placeChoiceBar(bar, picker);
		const table = (picker || bar)!.closest('.tcg-table');
		this.observeChoiceLayout([
			// Array.from, not a spread: the build turns a NodeList spread into concat, which keeps the list itself
			table, ...(table ? Array.from(table.querySelectorAll('.tcg-half')) : []),
			picker && (this.monEl(this.choicePickerIid) ||
				table?.querySelector(`.tcg-mon[data-iid="${escapeSelector(this.choicePickerIid)}"]`)),
			picker, bar,
		]);
		if (picker && this.choiceFocusPicker) {
			this.choiceFocusPicker = false;
			picker.querySelector<HTMLElement>('.tcg-choice-card')?.focus({ preventScroll: true });
		}
	}

	choiceRel(r: DOMRect, t: DOMRect): ChoiceRect {
		return { left: r.left - t.left, top: r.top - t.top, right: r.right - t.left, bottom: r.bottom - t.top };
	}

	/**
	 * the timer and the phone's Board/Chat toggle are drawn over the table from outside, so they paint above
	 * anything in it (the table is its own stacking context)
	 */
	choiceChrome(table: HTMLElement, t: DOMRect): ChoiceRect[] {
		const els: Element[] = [];
		table.querySelectorAll('.tcg-hud-top .tcg-player.foe, .tcg-hud-top .tcg-turn-badge').forEach(e => els.push(e));
		table.parentElement?.querySelectorAll(':scope > .tcg-chrome.live > *').forEach(e => els.push(e));
		table.closest('.tcg-mobile-board')?.parentElement?.querySelectorAll(':scope > .tcg-view-toggle')
			.forEach(e => els.push(e));
		const out: ChoiceRect[] = [];
		for (const e of els) {
			const r = e.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) out.push(this.choiceRel(r, t));
		}
		return out;
	}

	measureChoiceBar(el: HTMLElement, table: HTMLElement, t: DOMRect): ChoiceBarSize {
		el.classList.remove('is-placed', 'is-compact');
		el.style.left = '';
		el.style.top = '';
		el.style.width = '';
		const home = el.getBoundingClientRect();
		el.classList.add('is-compact');
		const small = el.getBoundingClientRect();
		el.classList.remove('is-compact');
		const hud = table.querySelector('.tcg-hud-top')?.getBoundingClientRect();
		return {
			size: { w: home.width, h: home.height }, compact: { w: small.width, h: small.height },
			homeY: home.top - t.top, hudBottom: hud ? hud.bottom - t.top : null,
		};
	}

	/** keep the measured width. moved off center it would wrap to the space beside it and outgrow the spot */
	placeChoiceBar(el: HTMLElement, picker: HTMLElement | null) {
		const table = el.closest<HTMLElement>('.tcg-table');
		if (!table) return;
		const t = table.getBoundingClientRect();
		const measured = this.measureChoiceBar(el, table, t);
		const avoid: ChoiceRect[] = [];
		table.querySelectorAll<HTMLElement>('.tcg-mon.legal, .tcg-mon.selected, .tcg-mon.choice-from')
			.forEach(m => avoid.push(this.choiceRel(m.getBoundingClientRect(), t)));
		if (picker) avoid.push(this.choiceRel(picker.getBoundingClientRect(), t));
		const halves: ChoiceRect[] = [];
		table.querySelectorAll<HTMLElement>('.tcg-half')
			.forEach(h => halves.push(this.choiceRel(h.getBoundingClientRect(), t)));
		const plan = planChoiceBar({
			...measured, bounds: { left: 0, top: 0, right: t.width, bottom: t.height }, avoid, halves,
			chrome: this.choiceChrome(table, t),
		});
		if (plan.compact) el.classList.add('is-compact');
		el.style.left = `${plan.x}px`;
		el.style.top = `${plan.y}px`;
		el.style.width = `${(plan.compact ? measured.compact : measured.size).w}px`;
		el.classList.add('is-placed');
	}

	placeChoicePicker(el: HTMLElement | null, iid: string, bar: HTMLElement | null = null) {
		if (!el || typeof window === 'undefined' || !el.getBoundingClientRect) return;
		const table = el.closest<HTMLElement>('.tcg-table');
		const mon = this.monEl(iid) || table?.querySelector<HTMLElement>(`.tcg-mon[data-iid="${escapeSelector(iid)}"]`);
		if (!table || !mon) return;
		const t = table.getBoundingClientRect();
		const forms = ['is-anchored', 'is-sheet', 'is-strip', 'is-panel', 'is-top', 'is-bottom', 'is-left', 'is-right'];
		const reset = () => {
			el.classList.remove(...forms);
			el.style.left = '';
			el.style.top = '';
			el.style.width = '';
			el.style.height = '';
		};
		reset();
		const natural = el.getBoundingClientRect();
		el.classList.add('is-sheet', 'is-strip');
		el.style.width = `${t.width}px`;
		const stripH = el.getBoundingClientRect().height;
		el.classList.replace('is-strip', 'is-panel');
		el.style.width = '';
		el.style.height = `${t.height}px`;
		const panelW = el.getBoundingClientRect().width;
		reset();
		const others: ChoiceRect[] = [];
		table.querySelectorAll<HTMLElement>('.tcg-mon.legal, .tcg-mon.choice-from').forEach(x => {
			if (x !== mon) others.push(this.choiceRel(x.getBoundingClientRect(), t));
		});
		const halves: ChoiceRect[] = [];
		table.querySelectorAll<HTMLElement>('.tcg-half')
			.forEach(h => halves.push(this.choiceRel(h.getBoundingClientRect(), t)));
		const plan = planChoicePicker({
			bounds: { left: 0, top: 0, right: t.width, bottom: t.height },
			own: this.choiceRel(mon.getBoundingClientRect(), t), others, halves,
			anchored: { w: natural.width, h: natural.height }, stripH, panelW, narrow: window.innerWidth <= 640,
			chrome: this.choiceChrome(table, t), bar: bar ? this.measureChoiceBar(bar, table, t) : undefined,
		});
		el.style.left = `${plan.x}px`;
		el.style.top = `${plan.y}px`;
		if (plan.mode === 'anchored') {
			el.classList.add('is-anchored');
			el.style.width = `${natural.width}px`;
			return;
		}
		el.classList.add('is-sheet', plan.mode === 'strip' ? 'is-strip' : 'is-panel', `is-${plan.side}`);
		el.style.width = `${plan.w}px`;
		el.style.height = `${plan.h}px`;
	}

	renderBoardChoice(choice: BoardChoice) {
		const snap = this.props.snapshot;
		const sending = !!this.props.waiting || !!this.choiceSent(choice);
		const nameOfMon = (iid: string) => findChoiceMon(snap, iid)?.mon.name || '';
		const context = choiceFromText(choice.from, nameOfMon, cardLabel);
		const picked = choice.kind === 'attached' ? choice.picked : null;
		let sub = context;
		if (choice.kind === 'attached' && !picked) {
			const tools = choice.sources.every(s => s.cards.every(c => c.ref.zone === 'tool'));
			sub = `Choose a highlighted Pokémon, then its ${tools ? 'Tool' : 'Energy'}.`;
		}
		const src = this.choiceSource;
		return <div class={`tcg-choice${sending ? ' is-sending' : ''}`}>
			{choice.kind === 'attached' && picked && this.renderChoicePicker(choice, picked, sending)}
			<div class="tcg-choice-bar ps-popup" ref={this.choiceBarRef}>
				{src && <img class="tcg-choice-source" src={cardArt(src)} alt="" title={cardLabel(src)} draggable={false} />}
				<div class="tcg-choice-text" role="status" aria-live="polite">
					{src && <em>{cardLabel(src)}</em>}
					<strong>{choice.ask}</strong>
					{sub && <span>{sub}</span>}
				</div>
				{choice.kind === 'attached' && choice.done &&
					<button type="button" class="button" disabled={sending} onClick={() => this.choose(choice.done!)}>Done</button>}
			</div>
		</div>;
	}

	renderChoicePicker(choice: BoardChoice & { kind: 'attached' }, src: BoardChoiceSource, sending: boolean) {
		const back = this.choiceBackable();
		return <div
			class="tcg-choice-picker ps-popup" role="group" aria-label={`Cards on ${src.mon.name}`}
			ref={el => {
				this.choicePickerEl = el as HTMLElement | null;
				this.choicePickerIid = src.iid;
				this.placeChoiceUi();
			}}
		>
			<div class="tcg-choice-picker-head">
				<strong>{src.mon.name}</strong>
				<span>{this.choiceSpot(src.seat, src.slot)}</span>
				{back && <button type="button" class="button" onClick={this.choiceBack}>Back</button>}
			</div>
			<div class="tcg-choice-cards">
				{src.cards.map(card => {
					const name = cardLabel(card.ref.cardId);
					const copies = card.ref.at.length;
					const sent = this.choiceSent(choice) === String(card.row.pick);
					return <button
						type="button" key={String(card.row.pick)}
						class={`tcg-choice-card${sent ? ' is-sent' : ''}`}
						disabled={sending}
						aria-label={copies > 1 ? `${name}, ${copies} copies` : name}
						onClick={() => this.pickChoiceCard(card)}
					>
						<img
							class="tcg-choice-card-art" src={cardArt(card.ref.cardId) || cardBackArt()} alt=""
							draggable={false} data-card={card.ref.cardId}
							ref={el => {
								const img = el as HTMLImageElement | null;
								if (img) img.onerror = () => choiceArtFallback(img);
							}}
						/>
						<span class="tcg-choice-card-name">{name}</span>
						{copies > 1 && <span class="tcg-choice-card-count">×{copies}</span>}
					</button>;
				})}
			</div>
		</div>;
	}

	openAttachBrowse = (mon: TcgPokemonView) => {
		if (this.state.drag?.active) return;
		const browse = attachBrowseOf(mon);
		if (!browse.cards.length && !browse.stages.length) return;
		this.setState({
			attachBrowse: browse,
			discardBrowse: null, menuSlot: null, inspect: null,
		});
	};

	override render() {
		const snap = this.props.snapshot;
		// the painted snapshot already has this beat. an older folded board would hide the cards the player can click
		// while the animation is up
		if (this.boardSnap && snap === this.props.fxSnapshot) {
			this.boardSnap = null;
			this.foldedThrough = -1;
			this.foldedRequest = false;
		}
		this.noteRemovals(snap);
		// already shown face up on an earlier beat, don't flip them again at commit
		if (this.boardSnap) {
			this.boardSnap.players.forEach(p => {
				const mons = [p?.active, ...(p?.bench || [])];
				mons.forEach(m => { if (m && !m.faceDown) delete this.faceDownSeen[m.iid]; });
			});
		}
		const meIndex: 0 | 1 = (this.props.viewpoint === 0 || this.props.viewpoint === 1) ?
			this.props.viewpoint : (snap.you === 1 ? 1 : 0);
		const foeIndex: 0 | 1 = meIndex === 0 ? 1 : 0;
		// choices still come from the committed snapshot till the request
		const view = this.boardSnap || snap;
		// grab the pre-hit hp before rememberMons overwrites it
		this.syncHpHold();
		this.rememberMons(view);
		noteTcgCardNames(snap);
		if (view !== snap) noteTcgCardNames(view);
		const me = this.withoutInbound(view.players[meIndex], meIndex);
		const foe = this.withoutInbound(view.players[foeIndex], foeIndex);
		if (!me || !foe) {
			return <div class="tcg-table"><div class="tcg-felt"></div><p class="tcg-waiting">Waiting for TCG snapshot…</p></div>;
		}
		const benchSize = snap.format?.benchSize || Math.max(me.bench.length, foe.bench.length, 3);
		// the fan keeps pre-batch indexes so a click still matches the server hand. once the request beat is folded in,
		// the actions match the board as it is now, so use its indexes
		const handBase = this.foldedRequest && this.boardSnap ? this.boardSnap : snap;
		const fanned = snap.you != null ?
			handFan(handIds(handBase.players[meIndex]?.hand), me.hand) : null;
		const viewIds = snap.you != null && meIndex === snap.you ? handAsIds(me.hand) : null;
		const myHand = fanned && viewIds ? orderHandFan(fanned, this.syncHandOrder(viewIds, snap)) : fanned;
		this.handShown = myHand ? myHand.map(({ id, i }) => ({ id, i })) : [];
		const meComing = this.handInbound(meIndex);
		const meHandComingN = Object.values(meComing).reduce((a, b) => a + b, 0);
		const foeHandComing = Object.values(this.handInbound(foeIndex)).reduce((a, b) => a + b, 0);
		const handHidden: { [fan: number]: true } = {};
		if (myHand && meHandComingN) {
			const left = { ...meComing };
			for (let k = myHand.length - 1; k >= 0; k--) {
				if (!myHand[k].arrive) continue;
				const id = left[myHand[k].id] ? myHand[k].id : left[''] ? '' : null;
				if (id == null) continue;
				left[id]--;
				handHidden[k] = true;
			}
		}
		const shuffleFx = this.state.fx?.kind === 'shuffleHand' ? this.state.fx : null;
		const shufflingMine = !!(shuffleFx?.seat === meIndex);
		const shufflingFoe = !!(shuffleFx && shuffleFx.seat !== meIndex);
		const shuffleHandIds = shufflingMine ? (shuffleFx?.ids || null) : null;
		const shuffleHandCount = shufflingMine ?
			Math.max(shuffleHandIds?.length || 0, shuffleFx?.n || 0, 3) :
			0;
		const allActs = this.acts();
		const firstPending = this.state.firstSent ? [] : allActs.filter(a => a.type === 'chooseFirst');
		const fxNow = this.state.fx;
		// hide Go First till the coin overlay is gone. don't use `waiting`, a |request| can flip it off while earlier
		// beats still play
		const holdFirstPrompt = fxNow?.kind === 'coin' || fxNow?.kind === 'first' ||
			(hasOpeningFlipEvents(this.props.events) && this.playedFlipKey !== this.props.fxKey);
		const choosingFirst = firstPending.length > 0 || holdFirstPrompt;
		const firstBanner = firstPlayerBanner(view, snap.you, holdFirstPrompt);
		const ahead = view !== snap;
		const turnSeat = typeof view.turn === 'number' ? view.turn : null;
		const turnOwner = turnSeat != null ? view.players[turnSeat] : null;
		const yourTurn = snap.you != null && !this.props.ended && !this.props.waiting && allActs.length > 0;
		// a choice made on the opponent's turn (energy for their Pleasing Present, a prize, a promotion) is still their
		// turn, so the badge says "<name>'s turn"
		const isMyTurnSeat = snap.you != null && snap.you === meIndex && (
			ahead ? (view.status === 'playing' && turnSeat === snap.you) :
			view.status === 'playing' ?
				(turnSeat === snap.you && (allActs.length > 0 || !this.props.waiting)) :
				allActs.length > 0
		);
		const replaying = !!this.props.ended && view.status !== 'over';
		const displayTurn = view.turnNumber || 1;
		const turnWho = this.props.ended && !replaying ? '' :
			choosingFirst && view.status === 'setup' ? 'Coin flip' :
			view.status === 'setup' ? 'Setup phase' :
			isMyTurnSeat ? 'Your turn' :
			turnOwner ? `${turnOwner.name}'s turn` : '';
		const pocket = !!(me.energyZone || snap.format?.energyZone);
		const need = snap.format?.prizes || (pocket ? 3 : 6);
		const inspect = this.state.inspect;
		const inspectSrc = inspect ?
			(inspect.image ? inspect.image.replace('_SM.webp', '.webp') : cardArt(inspect.cardId, { large: true })) : '';

		const padBench = (list: TcgPokemonView[]) => {
			const out: (TcgPokemonView | null)[] = list.slice();
			while (out.length < benchSize) out.push(null);
			return out;
		};

		const endTurn = allActs.find(a => a.type === 'endTurn');
		const startBattle = allActs.find(a => a.type === 'setupDone');
		const confirms = allActs.filter(a => a.type === 'confirmYes' || a.type === 'confirmNo');
		const firsts = holdFirstPrompt ? [] : firstPending;
		const searches = allActs.filter(a => a.type === 'searchPick' || a.type === 'searchDone');
		const discards = allActs.filter(a => a.type === 'discardPick');
		const pays = allActs.filter(a => a.type === 'payEnergy');
		const energyDiscards = allActs.filter(a => a.type === 'discardEnergyPick');
		const held = heldChoice(this.offeredActs());
		const holding = (type: string) => !!held && held.type === type;
		const paying = this.state.payPicked.length || this.payQueue.length || this.paySending;
		if (paying && retreatPayOver(allActs, view.status)) {
			queueMicrotask(() => {
				this.payQueue = [];
				this.paySending = false;
				if (this.state.payPicked.length) this.setState({ payPicked: [] });
			});
		}
		const prizeActs = allActs.filter(a => a.type === 'takePrize');
		const picked = this.state.prizePicked;
		const myPrizesLeft = prizesLeft(me, need, view.status);
		const pendingPicks = pendingPrizePicks(this.state.prizePickBase, myPrizesLeft, picked);
		const prizeGoal = this.state.prizeGoal || view.pendingPrize?.n || 0;
		// close on the click that finishes the set, not when the server catches up
		const prizeDone = prizeGoal > 0 && picked.length >= prizeGoal;
		const prizes = prizeDone ? [] : prizeActs.filter(a => !pendingPicks.includes(Number(a.index)));
		// Take Prize comes on the attack payload, leave the prompt alone till the attack and KO animations finish
		const prizeHeld = prizePromptWaits(!!this.props.playing, this.props.events, this.state.fx?.kind);
		const prizesOffered = prizeHeld ? [] : prizes;
		const prizeSlots = bindPrizeSlots(need, myPrizesLeft,
			this.props.prizeTakes?.[meIndex] || [], pendingPicks);
		this.prizeCtx = { slots: prizeSlots, offered: prizesOffered, goal: prizeGoal };
		const prizeSending = this.prizeBatchSlots.length > 0;
		const prizeSel = this.state.prizeSel;
		const prizeNeed = prizeSending ? prizeSel.length : Math.min(prizeGoal, prizeSlots.filter(s => !s.taken).length);
		const prizeHead = {
			title: prizeNeed > 1 ? `Take ${prizeNeed} Prize cards` : 'Take a Prize card',
			sub: `Choose ${prizeNeed > 1 ? prizeNeed : 'one'}, here or on your prize row, then Done`,
		};
		const prizeNote = prizeNeed > 1 ? `Picked ${prizeSel.length} of ${prizeNeed}.` :
			'Prize cards are face down, so any one is a fair pick.';
		const mulliganDraws = allActs.filter(a => a.type === 'mulliganDraw');
		const mulligans = allActs.filter(a => a.type === 'mulliganBench' || a.type === 'mulliganDone');
		const useStadium = allActs.find(a => a.type === 'useStadium');
		const selectedHand = this.state.selectedHand;
		const selectedHandActs = selectedHand != null ?
			allActs.filter(a => actionTouchesHand(a, selectedHand)) : [];
		const selectedHandNeedTarget = selectedHandActs.filter(a => hasBoardTarget(a));
		const orphanActs = allActs.filter(a => {
			if (['attack', 'ability', 'endTurn', 'setupDone', 'setupReturn', 'attachZone', 'retreat',
				'confirmYes', 'confirmNo', 'chooseFirst', 'searchPick', 'searchDone',
				'discardPick', 'payEnergy', 'discardEnergyPick', 'takePrize', 'mulliganBench', 'mulliganDone', 'mulliganDraw',
				'unstagePick', 'confirmPicks', 'handEnergyPick',
				'useStadium', 'playBasic', 'setActive', 'setBench', 'evolve', 'attachEnergy',
				'attachTool', 'playTrainer', 'playStadium', 'promote', 'pickSlot'].includes(a.type)) return false;
			return true;
		});

		const drag = this.state.drag;
		const dragging = !!drag?.active;
		const playDropHits = drag?.active ?
			actionsForDrop(allActs, drag, { kind: 'play' }) :
			(selectedHand != null ? actionsForDrop(allActs, { source: 'hand', hand: selectedHand }, { kind: 'play' }) : []);
		const selectedCard = selectedHand != null ? handCardId(snap, selectedHand) : '';
		const stadiumDropHits = drag?.active ?
			actionsForDrop(allActs, drag, { kind: 'stadium' }) :
			(selectedHand != null ?
				actionsForDrop(allActs, { source: 'hand', hand: selectedHand, cardId: selectedCard }, { kind: 'stadium' }) : []);
		const discardDropHits = drag?.active ?
			actionsForDrop(allActs, drag, { kind: 'discard' }) :
			(selectedHand != null ? actionsForDrop(allActs, { source: 'hand', hand: selectedHand }, { kind: 'discard' }) : []);
		const playHot = dragging && drag.over?.kind === 'play' && playDropHits.length > 0;
		const stadiumHot = dragging && drag.over?.kind === 'stadium' && stadiumDropHits.length > 0;
		const discardHot = dragging && drag.over?.kind === 'discard' && discardDropHits.length > 0;

		const aborted = !!this.props.aborted || snap.status === 'aborted';
		const seated = snap.you != null && !this.props.ended && !aborted;
		const boardChoice = seated ? this.boardChoice() : null;
		const openPick = this.state.boardPick;
		if (openPick && (boardChoice?.kind !== 'attached' || boardChoice.key !== openPick.key)) {
			queueMicrotask(() => {
				const now = this.state.boardPick;
				const current = this.boardChoice();
				if (now && (current?.kind !== 'attached' || current.key !== now.key)) this.setState({ boardPick: null });
			});
		}
		this.noteChoiceSource(boardChoice);
		let hint = (dragging && drag.hint) || '';
		const choicePanelOpen = !!snap.pendingCopyAttack && allActs.some(a => a.type === 'attack' || a.type === 'ability');
		if (!this.props.ended && !aborted && seated && !hint && !choicePanelOpen) {
			const prizeLeft = prizeDone ? 0 : (view.pendingPrize ? view.pendingPrize.n - picked.length : 0);
			const ownHint = ownHandHint(view, allActs, held);
			const lines = [
				view.pendingConfirm?.text || '',
				this.state.energyPick ? 'Choose a Pokémon for Energy' : '',
				this.state.retreatPick ? 'Choose a Benched Pokémon to switch in' : '',
				this.state.menuSlot != null ? 'Choose an action' : '',
				selectedHand != null && selectedHandNeedTarget.length ?
					`Drag or tap a Pokémon for ${describeAction(selectedHandNeedTarget[0], snap)}` : '',
				selectedHand != null ? 'Drag onto a Pokémon, or the Active field for a Trainer' : '',
				view.pendingSearch ? 'Choose a card from the search' : '',
				ownHint ?
					(view.pendingDiscard && !view.pendingDiscard.fromFoe && view.pendingDiscard.ask ?
						`${view.pendingDiscard.ask} ` : '') + ownHint : '',
				view.pendingRetreatPay ?
					`Select ${view.pendingRetreatPay.need} Energy to discard for retreat` : '',
				this.state.slotHint || '',
				slotPickHint(view, allActs),
				view.pendingPromote != null && view.pendingPromote === snap.you ?
					'Choose a Benched Pokémon to promote' : '',
				prizeSending ? 'Taking your Prize cards' : '',
				prizesOffered.length && !prizeSending && prizeNeed > 1 ?
					`Choose ${prizeNeed} Prize cards (${prizeSel.length} of ${prizeNeed} picked)` : '',
				prizesOffered.length && view.pendingPrize ?
					`Take ${Math.max(1, prizeLeft)} Prize card${prizeLeft === 1 ? '' : 's'}` : '',
				prizesOffered.length ? 'Take a Prize card' : '',
				discards.length ? 'Drag a card to Discard' : '',
				firstPending.length && !holdFirstPrompt ? 'Choose who goes first' : '',
				view.pendingMulliganDraw?.seat === snap.you ?
					`You may draw up to ${view.pendingMulliganDraw.max}. Drawing none is allowed` : '',
				snap.status === 'setup' && view.pendingMulligan == null && !view.pendingMulliganDraw &&
				!(firstPending.length && !holdFirstPrompt) ?
					(allActs.some(a => a.type === 'setupReturn') ?
						'Drag Basics to Active / Bench, tap one to take it back, then Ready' :
						'Drag Basics to Active / Bench, then Ready') : '',
				snap.attackAgain && yourTurn ? 'Tap your Active Pokémon to attack again, or end your turn' : '',
				yourTurn ? 'Drag cards to play, or tap your Pokémon to attack' : '',
			];
			hint = lines.find(line => line) || '';
		}
		const handHeld = held?.type === 'discardPick' && !foeHandChoice(this.actsSnap()) ? held : null;
		const hintInBar = !!handHeld && !dragging;
		const handChoice = seated ? ownHandChoice(this.actsSnap(), allActs) : null;
		const handStop = handChoice && !handHeld ? allActs.find(a => a.type === 'searchDone') : undefined;

		const foeHoldsTurn = view.status === 'setup' ?
			me.setup === 'done' && (foe.setup !== 'done' ||
				(view.pendingMulligan != null && view.pendingMulligan !== snap.you) ||
				(view.pendingMulliganDraw != null && view.pendingMulliganDraw.seat !== snap.you)) :
			turnSeat != null && !isMyTurnSeat;
		const waitingOpp = !this.props.ended && !aborted && snap.you != null && !allActs.length && foeHoldsTurn &&
			(this.props.waiting || !yourTurn);
		const st = this.state;
		let winName = (this.props.winnerName != null && this.props.winnerName !== '') ?
			this.props.winnerName :
			(snap.winner != null ? snap.players[snap.winner]?.name : null);
		if (st.fx?.kind === 'over') {
			if (st.fx.tie) winName = null;
			else {
				const fromFx = (/^(.+?)\s+wins?\.?$/i.exec(String(st.fx.extra || '')))?.[1];
				if (fromFx && !/^draw$/i.test(fromFx)) winName = fromFx;
			}
		}
		// same node from the ending beat through the result, so the fade-in doesn't replay
		const showWinBanner = !aborted && (st.fx?.kind === 'over' || (!!this.props.ended && !st.fx && !replaying));
		const stopText = this.props.stopReason || snap.winReason || 'The game stopped because a card effect failed.';

		const fxSpeed = PS.prefs.tcgfxspeed || 'normal';
		const focusLive = seated && !st.fx && !this.props.waiting && !replaying;
		const tableClass = [
			'tcg-table', pocket ? 'pocket' : 'live',
			yourTurn || isMyTurnSeat ? 'tcg-your-turn' : '',
			dragging ? 'is-dragging' : '',
			this.state.handStrip ? 'tcg-hand-strip' : '',
			this.state.handSheet ? 'is-hand-sheet' : '',
			boardChoice && !st.fx ? 'is-choosing' : '',
			showWinBanner ? 'has-win-banner' : '',
			focusLive && (this.targetFocus() || this.handDestFocus()) ? 'is-targeting' : '',
			focusLive && this.handChoiceFocus() ? 'is-hand-choice' : '',
			st.fx ? `kind-${st.fx.kind}` : '',
			`fx-${fxSpeed}`,
		].filter(Boolean).join(' ');
		const monFx = (mon: TcgPokemonView | null) => mon ? ({
			pkFx: st.pkFx[mon.iid] || null,
			incoming: this.inbound.some(x => x.zone === 'mon' && !x.part && x.iid === mon.iid),
			landing: this.inbound.filter(x => x.zone === 'mon' && x.part === 'attach' && x.iid === mon.iid).length,
		}) : {};
		const foeActive = this.displayMon(foeIndex, 'active', foe.active);
		const meActive = this.displayMon(meIndex, 'active', me.active);

		const stadiumId = foe.stadium || me.stadium || '';
		const stadiumPair = foe.stadiumIds || me.stadiumIds;
		const stadiumCards = stadiumId && stadiumPair && stadiumPair.length > 1 ? stadiumPair : stadiumId ? [stadiumId] : [];
		const canAttach = allActs.some(a => a.type === 'attachZone');
		const zone = me.energyZone;

		return <div
			class={tableClass}
			style={{ '--fx-t': String(tcgFxScale() || 1) } as any}
			ref={el => { this.tableEl = el as HTMLElement | null; }}
			onContextMenu={ev => ev.preventDefault()}
		>
			<div class="tcg-felt"></div>
			{firstBanner && <div class="tcg-first-banner" role="status" aria-live="polite" ref={this.firstBannerRef}>
				{firstBanner}
			</div>}
			{waitingOpp && !(st.fx && (st.fx.kind === 'turn' || st.fx.kind === 'search' || st.fx.kind === 'mulligan')) &&
				<div class="tcg-wait-banner" aria-live="polite">
					<em>Waiting</em>
					<strong>for opponent</strong>
				</div>}
			{aborted && !replaying &&
				<div class="tcg-win-banner stopped" aria-live="polite">
					<em>Match stopped</em>
					<strong>{stopText}</strong>
				</div>}
			{showWinBanner &&
				<div class={`tcg-win-banner${winName ? '' : ' tie'}`} aria-live="polite">
					{winName ?
						<em>{winName} won!</em> :
						<em>The battle ended in a draw.</em>}
				</div>}
			{inspect && <div class="tcg-inspect" onClick={this.onInspectBackdrop} role="dialog" aria-label="Card inspection">
				<div class="tcg-inspect-card" onClick={ev => ev.stopPropagation()}>
					{inspect.cardId && !inspect.image && noArtCards[inspect.cardId] ?
						<span class="tcg-inspect-noart">
							<NoArtFace cardId={inspect.cardId} label={inspect.name || cardLabel(inspect.cardId)} />
						</span> :
						inspectSrc ? <img src={inspectSrc} alt={inspect.name || inspect.cardId} /> : null}
					{inspect.handAt != null && myHand && myHand.length > 1 && <div class="tcg-inspect-move">
						<button
							type="button" class="button" disabled={inspect.handAt <= 0}
							onClick={() => this.moveInspected(-1)}
						><i class="fa fa-arrow-left" aria-hidden></i> Move left</button>
						<button
							type="button" class="button" disabled={inspect.handAt >= myHand.length - 1}
							onClick={() => this.moveInspected(1)}
						>Move right <i class="fa fa-arrow-right" aria-hidden></i></button>
					</div>}
					<button type="button" class="button tcg-inspect-close" onClick={this.closeInspect}>Close</button>				</div>
			</div>}

			<header class="tcg-hud-top">
				<div class="tcg-player foe">
					<span class="tcg-avatar foe" aria-hidden="true">{(foe.name || '?').slice(0, 1).toUpperCase()}</span>
					<div class="tcg-player-meta">
						<span class="tcg-name">{foe.name}</span>
						<span class="tcg-player-tags">
							<span
								class="tcg-hand-count" title={`${pileCount(foe.hand)} in hand`}
								aria-label={`${pileCount(foe.hand)} cards in hand`}
							>{pileCount(foe.hand)}</span>
						</span>
					</div>
				</div>
				<div class={`tcg-turn-badge${yourTurn || isMyTurnSeat ? ' yours' : ''}${
					this.props.ended && !replaying ? ' over' : ''
				}${!isMyTurnSeat && turnSeat != null ? ' foe' : ''}`}
				>
					<span class="tcg-turn-num">
						{aborted && !replaying ? 'Stopped' :
						this.props.ended && !replaying ? 'End' :
						view.status === 'setup' ? (choosingFirst ? 'Coin' : 'Setup') : `Turn ${displayTurn}`}
					</span>
					{turnWho && <span class="tcg-turn-who">{turnWho}</span>}
				</div>
				<div class="tcg-hud-tools" />
			</header>

			<div class="tcg-dock-foe" title={`${pileCount(foe.hand)} in hand`}>
				<div class={`tcg-hand tcg-hand-foe${shufflingFoe ? ' is-shuffling' : ''}`}>
					{(shufflingFoe ?
						Array.from({ length: Math.max(shuffleFx?.n || pileCount(foe.hand), 3) }, (_, i) => i) :
						Array.from({ length: pileCount(foe.hand) }, (_, i) => i)
					).map(i => {
						const count = shufflingFoe ?
							Math.max(shuffleFx?.n || pileCount(foe.hand), 3) :
							Math.max(1, pileCount(foe.hand));
						const foeCardId = (!shufflingFoe && Array.isArray(foe.hand)) ? foe.hand[i] : undefined;
						return <TcgCardFace
							key={`fh${i}`} back={!foeCardId} cardId={foeCardId} size="sm"
							fanIndex={i} fanCount={count}
							incoming={!shufflingFoe && i >= pileCount(foe.hand) - foeHandComing}
							onInspect={foeCardId ? this.openInspect : undefined}
						/>;
					})}
				</div>
			</div>

			<div class={`tcg-arena${pocket ? ' is-pocket' : ' is-live'}`}>
				<section class="tcg-half foe">
					<div class="tcg-side left">
						{(pileCount(foe.lostZone) > 0 || !pocket) &&
							<div
								class={`tcg-lost-zone foe${pileCount(foe.lostZone) > 0 ? ' has-cards' : ''}`}
								title={`Opponent Lost Zone: ${pileCount(foe.lostZone)}`}
							>
								<div class="tcg-lost-zone-inner">
									<strong class="tcg-lost-zone-count">{pileCount(foe.lostZone)}</strong>
									<em class="tcg-lost-zone-label">Lost Zone</em>
								</div>
							</div>}
						{!pocket ?
							<TcgPrizeRail
								remaining={prizesLeft(foe, need, view.status)} max={need} foe
								takes={(this.props.prizeTakes?.[foeIndex]) || []}
							/> :
							<TcgPoints scored={scoredPoints(foe, need, view.status)} need={need} pocket />}
					</div>
					<div class="tcg-field">
						<div class="tcg-zone tcg-bench foe">
							{padBench(foe.bench).map((mon, i) => {
								const shown = this.displayMon(foeIndex, i, mon);
								const ghost = !mon && !!shown;
								return <TcgMon
									key={`fb${i}`} mon={shown} slot={i} foe size="sm"
									reveal={!!shown && !!this.revealing[shown.iid]}
									legal={!ghost && this.slotActionable(i, true)}
									{...(ghost ? {} : this.choiceMonProps(shown, i, true))}
									{...this.slotDropMeta(i, true, !mon)}
									{...monFx(shown)}
									onClick={ghost ? undefined : (ev: MouseEvent) => this.clickSlot(i, true, ev)}
									onInspect={this.openInspect}
									onAttachBrowse={this.openAttachBrowse}
								/>;
							})}
						</div>
						<div class="tcg-zone tcg-active-spot foe">
							<TcgMon
								mon={foeActive} slot="active" activeSpot foe size="lg"
								reveal={!!foeActive && !!this.revealing[foeActive.iid]}
								legal={!foe.active && foeActive ? false : this.slotActionable('active', true)}
								{...(!foe.active && foeActive ? {} : this.choiceMonProps(foeActive, 'active', true))}
								{...this.slotDropMeta('active', true, !foe.active)}
								{...monFx(foeActive)}
								onClick={!foe.active && foeActive ? undefined : (ev: MouseEvent) => this.clickSlot('active', true, ev)}
								onInspect={this.openInspect}
								onAttachBrowse={this.openAttachBrowse}
							/>
						</div>
					</div>
					<div class="tcg-side right">
						<div class="tcg-pile deck foe" title={`Opponent deck: ${pileCount(foe.deck)}`}>
							<div class="tcg-pile-stack">
								<span></span><span></span>
								<div class="tcg-card tcg-card-sm tcg-card-back">
									<span class="tcg-card-inner"><CardBackFace /></span>
								</div>
							</div>
							<strong class="tcg-pile-count">{pileCount(foe.deck)}</strong>
							<em class="tcg-pile-label">Deck</em>
						</div>
						<div
							class="tcg-pile discard foe"
							title="View the opponent's discard pile"
							role="button"
							onClick={(ev: MouseEvent) => this.openDiscardBrowse('foe', ev)}
						>
							<div class="tcg-pile-stack">
								<span></span><span></span>
								{foe.discard?.length ?
									<TcgCardFace
										cardId={foe.discard[foe.discard.length - 1]} size="sm" onInspect={this.openInspect}
									/> :
									<div class="tcg-card tcg-card-sm tcg-card-back">
										<span class="tcg-card-inner"><CardBackFace /></span>
									</div>}
							</div>
							<strong class="tcg-pile-count">{foe.discard?.length || 0}</strong>
							<em class="tcg-pile-label">Discard</em>
						</div>
					</div>
				</section>

				<div
					class={`tcg-stadium-row side-left${stadiumDropHits.length ? ' drop-ok' : ''}${stadiumHot ? ' drop-hot' : ''}`}
				>
					<div
						class={`tcg-stadium${stadiumCards.length > 1 ? ' paired' : ''}${useStadium ? ' usable' : ''}` +
							`${stadiumDropHits.length ? ' drop-ok' : ''}${stadiumHot ? ' drop-hot' : ''}`}
						data-drop="stadium"
					>
						{stadiumCards.length ?
							stadiumCards.map(id => <TcgCardFace
								key={id}
								cardId={id} name={cardLabel(id)} size="sm"
								onClick={useStadium ? (ev: { clientX: number, clientY: number }) => this.clickStadium(ev, id) : undefined}
								onInspect={this.openInspect}
							/>) :
							<div class="tcg-stadium-empty"><span>Stadium</span></div>}
					</div>
					{stadiumHot &&
						<em class="tcg-drop-tag">{dropVerb(stadiumDropHits[0])}</em>}
				</div>
				{dragging && playDropHits.length > 0 && this.state.playField &&
					<div
						class={`tcg-play-field drop-ok${playHot ? ' drop-hot' : ''}`}
						style={{
							top: `${this.state.playField.top}px`,
							left: `${this.state.playField.left}px`,
							width: `${this.state.playField.width}px`,
							height: `${this.state.playField.height}px`,
						}}
					>
						<em class="tcg-play-label">Play</em>
					</div>}

				<section class="tcg-half me">
					<div class="tcg-side left">
						{(pileCount(me.lostZone) > 0 || !pocket) &&
							<div
								class={`tcg-lost-zone me${pileCount(me.lostZone) > 0 ? ' has-cards' : ''}`}
								title={`Lost Zone: ${pileCount(me.lostZone)}`}
							>
								<div class="tcg-lost-zone-inner">
									<strong class="tcg-lost-zone-count">{pileCount(me.lostZone)}</strong>
									<em class="tcg-lost-zone-label">Lost Zone</em>
								</div>
							</div>}
						{!pocket ?
							<TcgPrizeRail
								remaining={myPrizesLeft} max={need}
								takes={(this.props.prizeTakes?.[meIndex]) || []}
								picked={pendingPicks}
								selected={prizeSel}
								takeActs={prizeSending ? [] : prizesOffered}
								onTake={a => {
									const at = prizeSlots.find(s => s.serverIndex === Number(a.index));
									if (at) this.pickPrize(at.slot);
								}}
							/> :
							<>
								<TcgPoints scored={scoredPoints(me, need, view.status)} need={need} pocket />
								{(zone || pocket) && <button
									type="button"
									class={`tcg-ezone ${canAttach ? 'ready' : 'off'} ${this.state.energyPick ? 'pick' : ''} ${
										drag?.source === 'zone' && dragging ? 'dragging' : ''
									}`}
									onPointerDown={(ev: any) => this.startZoneDrag(ev)}
									title={canAttach ? 'Drag onto a Pokémon to attach' : ''}
								>
									<span class="tcg-ezone-now">
										<img src={energySymbolUrl(zone?.type)} alt="" draggable={false} />
									</span>
									{zone?.next && <span class="tcg-ezone-next">
										<img src={energySymbolUrl(zone.next)} alt="" draggable={false} />
									</span>}
								</button>}
							</>}
					</div>
					<div class="tcg-field">
						<div class="tcg-zone tcg-active-spot me">
							<TcgMon
								mon={meActive} slot="active" activeSpot size="lg"
								reveal={!!meActive && !!this.revealing[meActive.iid]}
								legal={!me.active && meActive ? false : this.slotActionable('active')}
								{...this.slotDropMeta('active', false, !me.active)}
								{...monFx(meActive)}
								selected={this.state.menuSlot === 'active'}
								{...(!me.active && meActive ? {} : this.choiceMonProps(meActive, 'active', false))}
								onClick={!me.active && meActive ? undefined : (ev: MouseEvent) => this.clickSlot('active', false, ev)}
								onInspect={this.openInspect}
								onAttachBrowse={this.openAttachBrowse}
							/>
						</div>
						<div class="tcg-zone tcg-bench me">
							{padBench(me.bench).map((mon, i) => {
								const shown = this.displayMon(meIndex, i, mon);
								const ghost = !mon && !!shown;
								return <TcgMon
									key={`mb${i}`} mon={shown} slot={i} size="sm"
									reveal={!!shown && !!this.revealing[shown.iid]}
									legal={!ghost && this.slotActionable(i)}
									{...this.slotDropMeta(i, false, !mon)}
									{...monFx(shown)}
									selected={!ghost && this.state.menuSlot === i}
									{...(ghost ? {} : this.choiceMonProps(shown, i, false))}
									onClick={ghost ? undefined : (ev: MouseEvent) => this.clickSlot(i, false, ev)}
									onInspect={this.openInspect}
									onAttachBrowse={this.openAttachBrowse}
								/>;
							})}
						</div>
					</div>
					<div class="tcg-side right">
						<div class="tcg-pile deck me" title={`Deck: ${pileCount(me.deck)}`}>
							<div class="tcg-pile-stack">
								<span></span><span></span>
								<div class="tcg-card tcg-card-sm tcg-card-back">
									<span class="tcg-card-inner"><CardBackFace /></span>
								</div>
							</div>
							<strong class="tcg-pile-count">{pileCount(me.deck)}</strong>
							<em class="tcg-pile-label">Deck</em>
						</div>
						<div
							class={`tcg-pile discard me${discardDropHits.length ? ' drop-ok' : ''}${discardHot ? ' drop-hot' : ''}`}
							title="View your discard pile"
							data-drop="discard"
							role="button"
							onClick={(ev: MouseEvent) => {
								if (discardDropHits.length && this.state.selectedHand != null) return;
								this.openDiscardBrowse('me', ev);
							}}
						>
							<div class="tcg-pile-stack">
								<span></span><span></span>
								{me.discard?.length ?
									<TcgCardFace
										cardId={me.discard[me.discard.length - 1]} size="sm" onInspect={this.openInspect}
									/> :
									<div class="tcg-card tcg-card-sm tcg-card-back">
										<span class="tcg-card-inner"><CardBackFace /></span>
									</div>}
							</div>
							<strong class="tcg-pile-count">{me.discard?.length || 0}</strong>
							<em class="tcg-pile-label">Discard</em>
							{discardHot && <em class="tcg-drop-tag">Discard</em>}
						</div>
					</div>
				</section>
			</div>

			<div class={`tcg-dock${this.props.replayDock ? ' tcg-dock-replay' : ''}`}>
				{this.props.replayDock}
				{this.state.handStrip && myHand && <button
					type="button" class="button tcg-hand-inspect" onClick={this.openHandSheet}
					aria-label={`Inspect hand, ${pileCount(me.hand)} cards`}
				>
					<i class="fa fa-clone tcg-hand-inspect-icon" aria-hidden></i>
					<span>Inspect hand</span>
					<strong>{pileCount(me.hand)}</strong>
				</button>}
				<div
					class={`tcg-hand tcg-hand-mine${shufflingMine ? ' is-shuffling' : ''}`}
					onWheel={this.onHandWheel}
					onScroll={this.onHandScroll}
					onKeyDown={this.onHandKey}
					style={{
						'--card-count': String(myHand ? myHand.length : (shufflingMine ? shuffleHandCount : pileCount(me.hand))),
					} as any}
				>
					{shufflingMine ? (
						shuffleHandIds?.length ?
							shuffleHandIds.map((id, i) =>
								<TcgCardFace
									key={`sh-${id}-${i}`} cardId={id} size="md"
									pocket={pocket}
									fanIndex={i} fanCount={shuffleHandIds.length}
								/>
							) :
							Array.from({ length: shuffleHandCount }, (_, i) =>
								<TcgCardFace
									key={`shb${i}`} back size="md"
									fanIndex={i} fanCount={shuffleHandCount}
								/>
							)
					) : myHand ? myHand.map(({ id, i, arrive }, fan) => {
						const playable = i >= 0 && allActs.some(a => actionTouchesHand(a, i));
						// key by "nth copy of this card", not index, so playing one card lets the rest glide instead of remounting
						let nth = 0;
						for (let j = 0; j < fan; j++) if (myHand[j].id === id) nth++;
						return <TcgCardFace
							key={`${id}#${nth}`} cardId={id} size="md"
							pocket={pocket}
							arrive={arrive}
							incoming={!!handHidden[fan]}
							selected={i >= 0 && (this.state.selectedHand === i ||
								(held?.type === 'discardPick' && !foeHandChoice(this.actsSnap()) &&
									!!heldUndoFor(held, { type: 'discardPick', hand: i })))}
							playable={playable}
							dragging={i >= 0 && drag?.source === 'hand' && drag.hand === i && dragging}
							fanIndex={fan} fanCount={myHand.length}
							onPointerDown={i >= 0 ? (ev: any) => this.startHandDrag(i, id, ev) : undefined}
							onHold={this.onCardHold}
							onInspect={(p: Preview) => this.openInspect({ ...p, handAt: fan })}
						/>;
					}) : Array.from({ length: pileCount(me.hand) }, (_, i) =>
						<TcgCardFace key={i} back size="md" incoming={i >= pileCount(me.hand) - meHandComingN} />
					)}
				</div>
				<div class="tcg-player me dock">
					<div class="tcg-player-meta">
						<span class="tcg-player-tags">
							<span
								class="tcg-hand-count" title={`${pileCount(me.hand)} in hand`}
								aria-label={`${pileCount(me.hand)} cards in hand`}
							>{pileCount(me.hand)}</span>
						</span>
					</div>
					<span class="tcg-avatar me" aria-hidden="true">{(me.name || '?').slice(0, 1).toUpperCase()}</span>
				</div>
			</div>
			{this.state.handStrip && this.state.handSheet && myHand && <div
				class="tcg-hand-sheet" role="dialog" aria-modal="true" aria-label="Your hand"
			>
				<button type="button" class="tcg-hand-sheet-backdrop" aria-label="Close hand" onClick={this.closeHandSheet}></button>
				<div class="tcg-hand-sheet-panel ps-popup">
					<div
						class="tcg-hand-sheet-handle" aria-hidden="true"
						onPointerDown={this.onSheetHandleDown} onPointerUp={this.onSheetHandleUp}
					></div>
					<header class="tcg-hand-sheet-bar">
						<h2>Your hand</h2>
						<span>{pileCount(me.hand)}</span>
						<button
							type="button" class="button tcg-hand-sheet-close" aria-label="Close"
							onClick={this.closeHandSheet}
							ref={el => { this.handSheetClose = el as HTMLButtonElement | null; }}
						><i class="fa fa-times" aria-hidden></i></button>
					</header>
					<div class="tcg-hand-sheet-grid">
						{myHand.map(({ id, i, arrive }, fan) => {
							const playable = i >= 0 && allActs.some(a => actionTouchesHand(a, i));
							let nth = 0;
							for (let j = 0; j < fan; j++) if (myHand[j].id === id) nth++;
							return <TcgCardFace
								key={`sheet-${id}#${nth}`} cardId={id} size="md"
								pocket={pocket}
								arrive={arrive}
								selected={i >= 0 && (this.state.selectedHand === i ||
									(held?.type === 'discardPick' && !foeHandChoice(this.actsSnap()) &&
										!!heldUndoFor(held, { type: 'discardPick', hand: i })))}
								playable={playable}
								onPointerDown={i >= 0 ? (ev: any) => this.startHandDrag(i, id, ev) : undefined}
								onHold={this.onCardHold}
								onInspect={(p: any) => this.openInspect({ ...p, handAt: fan })}
							/>;
						})}
					</div>
				</div>
			</div>}

			{boardChoice && !st.fx && seated ?
				this.renderBoardChoice(boardChoice) :
				hint && PS.prefs.tcghints && !hintInBar ? <div class="tcg-float-hint">{hint}</div> : null}

			{this.props.ended && this.props.showReplayControls !== false && <div class="tcg-replay-controls">
				<button type="button" class="button" onClick={this.props.onTogglePause}>
					<i class={`fa fa-${this.props.paused ? 'play' : 'pause'}`} aria-hidden></i> {this.props.paused ? 'Play' : 'Pause'}
				</button>
				<button type="button" class="button" onClick={this.props.onReplay}>
					<i class="fa fa-undo" aria-hidden></i> Replay
				</button>
				<button type="button" class="button" onClick={this.props.onSkip}>
					<i class="fa fa-fast-forward" aria-hidden></i> Skip to end
				</button>
			</div>}
			{snap.you != null && <div class="tcg-live-controls">
				{this.props.animating && !this.props.ended && this.props.onSkip && <button
					type="button" class="button tcg-skip-fx" onClick={this.props.onSkip}
					title="Finish the animations now and show the current board"
				>
					Skip animations <i class="fa fa-forward" aria-hidden></i>
				</button>}
				{(this.state.selectedHand != null || this.state.energyPick || this.state.retreatPick ||
					this.state.menuSlot != null || this.state.moveTargetPick != null) &&
					<button type="button" class="button tcg-cancel" onClick={this.clearSel}>Cancel</button>}
				{orphanActs.map((a, i) =>
					<button type="button" key={`o${i}`} class="button tcg-atk" onClick={() => this.choose(a)}>
						{describeAction(a, snap)}
					</button>
				)}
				{handStop && <button
					type="button" class="button notifying tcg-hand-stop" disabled={!!this.props.waiting}
					onClick={() => this.choose(handStop)}
				>
					{handChoice === 'energy' ? 'Done' : 'Choose none'}
				</button>}
				{startBattle && <button type="button" class="button notifying tcg-start" onClick={() => this.choose(startBattle)}>
					<strong>Ready</strong>
				</button>}
				{endTurn && <button
					type="button" class="button notifying tcg-endturn" onClick={() => {
						const busy = allActs.some(a =>
							a.type === 'attack' || a.type === 'ability' || a.type === 'attachZone' ||
							a.type === 'playBasic' || a.type === 'playTrainer' || a.type === 'playStadium' ||
							a.type === 'evolve' || a.type === 'attachEnergy' || a.type === 'attachTool' ||
							a.type === 'retreat' || a.type === 'useStadium'
						);
						if (busy && !PS.prefs.tcgskipendturn) this.setState({ endTurnConfirm: true, menuSlot: null });
						else this.choose(endTurn);
					}}
				>
					<strong>End Turn</strong>
				</button>}
			</div>}

			{this.state.menuSlot != null && (() => {
				const slot = this.state.menuSlot;
				const menu = this.menuActs(slot);
				const mon = slot === 'active' ? me.active : me.bench[Number(slot)];
				const rows = menuRows(snap, slot, menu, !!PS.prefs.tcghideillegal);
				const moves = rows.filter(r => r.kind !== 'other');
				const others = rows.filter(r => r.kind === 'other');
				const press = (r: MenuRow) => {
					if (r.action) this.pickMenuAction(r.action);
					else this.setState({ menuWhy: `${r.label}: ${r.why}` });
				};
				const tip = (r: MenuRow) => (r.action ? undefined : `${r.label}: ${r.why}`);
				return <div class="tcg-action-menu" onClick={this.clearSel}>
					<div class={`tcg-action-sheet ps-popup ${slot === 'active' ? 'active' : 'bench'}`} onClick={ev => ev.stopPropagation()}>
						<header>
							<strong>{mon?.name || 'Pokémon'}</strong>
							<button type="button" class="button tcg-cancel" aria-label="Close" onClick={this.clearSel}>
								<i class="fa fa-times" aria-hidden></i>
							</button>
						</header>
						{moves.length > 0 && <div class="movemenu tcg-movemenu">
							{moves.map(r => {
								const multi = !!r.action && isMultiTargetGroup(menu, r.action);
								return <button
									type="button" key={r.key}
									class={[
										'movebutton', 'tcg-atk', r.kind === 'ability' ? 'ability' : '',
										psMoveType(r.type) ? `type-${psMoveType(r.type)}` : '',
										multi ? 'needs-target' : '', r.action ? '' : 'disabled',
									].filter(Boolean).join(' ')}
									aria-disabled={r.action ? undefined : true}
									title={tip(r) || (multi ? `${r.label}: choose a target next` : undefined)}
									onClick={() => press(r)}
								>
									<span class="tcg-move-name">{r.label}</span>
									{r.sub && <small class="tcg-atk-sub">{r.sub}</small>}
									<small class="type">
										{r.kind === 'ability' ? 'Ability' : (r.cost || []).map((t, j) => pip(t, j))}
									</small>
									<small class="pp">{r.damage || ''}</small>
								</button>;
							})}
						</div>}
						{others.length > 0 && <p class="buttonbar tcg-menu-others">
							{others.map(r => <button
								type="button" key={r.key} class={`button${r.action ? '' : ' disabled'}`}
								aria-disabled={r.action ? undefined : true} title={tip(r)}
								onClick={() => press(r)}
							>
								{r.label}
							</button>)}
						</p>}
						{this.state.menuWhy && <p class="tcg-menu-why" role="status">{this.state.menuWhy}</p>}
					</div>
				</div>;
			})()}

			{this.state.moveTargetPick && (() => {
				const pick = this.state.moveTargetPick;
				const targets = uniqueTargetActions(pick.actions);
				const close = () => this.setState({ moveTargetPick: null });
				return <div class="tcg-prompt kind-target-pick">
					<div class="tcg-prompt-veil" onClick={close}></div>
					<div class="tcg-prompt-panel ps-popup">
						<div class="tcg-prompt-banner">
							<strong>{pick.title}</strong>
							<span>Choose one of {targets.length} targets</span>
							<button type="button" class="button tcg-cancel" aria-label="Close" onClick={close}>
								<i class="fa fa-times" aria-hidden></i>
							</button>
						</div>
						<div class="tcg-target-move">
							<div class="tcg-target-move-head">
								<span class={`tcg-atk-kind ${pick.kind === 'ability' ? 'ability' : ''}`}>
									{pick.kind === 'ability' ? 'Ability' : 'Attack'}
								</span>
								<strong class="tcg-target-move-name">{pick.title}</strong>
								{(pick.cost?.length || pick.damage) &&
									<span class="tcg-target-meta">
										{!!pick.cost?.length &&
											<span class="tcg-atk-cost">{pick.cost.map((t, j) => pip(t, j))}</span>}
										{pick.damage && <span class="tcg-atk-dmg">{pick.damage}</span>}
									</span>}
							</div>
						</div>
						<div class="tcg-prompt-select">
							<div class="tcg-action-list tcg-target-list">
								{targets.map((a, i) => {
									const t = describeMoveTarget(a, snap);
									const spot = t.slot ?
										(t.foe ? `Opponent's ${t.slot}` : `Your ${t.slot}`) :
										(t.foe ? "Opponent's Pokémon" : 'Your Pokémon');
									return <button
										type="button"
										key={`${actionTargetKey(a)}-${i}`}
										class={`button tcg-atk tcg-target-row${pick.kind === 'ability' ? ' ability' : ''}${t.foe ? ' foe' : ' me'}`}
										onClick={() => this.pickMoveTarget(a)}
									>
										<span class={`tcg-target-slot ${t.foe ? 'foe' : 'me'}`}>{spot}</span>
										<span class="tcg-atk-name">{t.name}</span>
									</button>;
								})}
							</div>
							<button type="button" class="button" onClick={close}>Cancel</button>
						</div>
					</div>
				</div>;
			})()}

			{(() => {
				const look = this.state.deckLook;
				const prompt = look ? deckLookPrompt(allActs, look.hand) : null;
				const blocked = !!(searches.length || discards.length || pays.length || prizeActs.length ||
					mulligans.length || confirms.length || firstPending.length);
				if (look && (!prompt || blocked)) {
					queueMicrotask(() => {
						if (this.state.deckLook) this.setState({ deckLook: null });
					});
					return null;
				}
				if (!prompt || !look || snap.you == null) return null;
				const ready = look.picked.length === prompt.need;
				const titleId = Array.isArray(me?.hand) ? me.hand[look.hand] : '';
				return <div class="tcg-prompt kind-look">
					<div class="tcg-prompt-veil"></div>
					<div class="tcg-prompt-panel ps-popup">
						<div class="tcg-prompt-banner">
							<strong>{cardLabel(titleId) || 'Look at your deck'}</strong>
							<span>{prompt.note} Selected {look.picked.length} / {prompt.need}</span>
						</div>
						<div class="tcg-prompt-select">
							<div class="tcg-prompt-rail">
								{prompt.pile.map((id, index) =>
									<div
										key={`${index}-${id}`}
										class={`tcg-prompt-card${look.picked.includes(index) ? ' is-picked' : ''}`}
									>
										<TcgCardFace
											cardId={id} size="md"
											onClick={() => this.toggleDeckLook(index)}
											onInspect={this.openInspect}
										/>
										<em>{cardLabel(id)}</em>
									</div>
								)}
							</div>
							<div class="tcg-prompt-acts">
								<button type="button" class="button notifying" disabled={!ready} onClick={this.confirmDeckLook}>
									Confirm
								</button>
								<button type="button" class="button" onClick={() => this.setState({ deckLook: null })}>Cancel</button>
							</div>
						</div>
					</div>
				</div>;
			})()}

			{this.state.playChoice && (() => {
				const { rows, name } = this.state.playChoice;
				const cards = rows.filter(a => playChoiceCardId(a));
				const plain = rows.filter(a => !playChoiceCardId(a));
				const sameName = (id: string) => cards.filter(a => cardLabel(playChoiceCardId(a)!) === cardLabel(id)).length > 1;
				return <div class="tcg-prompt kind-trainer-use kind-play-choice">
					<div class="tcg-prompt-veil" onClick={this.onTrainerUseBackdrop}></div>
					<div class="tcg-prompt-panel ps-popup">
						<div class="tcg-prompt-banner">
							<strong>{name}</strong>
							<span>Choose one</span>
						</div>
						<div class="tcg-prompt-dialog">
							{cards.length > 0 && <div class="tcg-prompt-rail is-copy">
								{cards.map((a, i) => {
									const id = playChoiceCardId(a)!;
									return <div key={`${id}-${i}`} class="tcg-prompt-card is-legal" title={`${cardLabel(id)} (${id})`}>
										<TcgCardFace cardId={id} size="md" onClick={() => this.choose(a)} onInspect={this.openInspect} />
										<em>{cardLabel(id)}{sameName(id) && <span class="tcg-prompt-print">{id}</span>}</em>
									</div>;
								})}
							</div>}
							{plain.length > 0 && <div class="tcg-prompt-acts wide">
								{plain.map((a, i) =>
									<button type="button" key={`${a.pick}-${i}`} class="button notifying" onClick={() => this.choose(a)}>
										{playChoiceText(a, this.props.snapshot)}
									</button>
								)}
							</div>}
							<div class="tcg-prompt-acts">
								<button type="button" class="button" onClick={() => this.setState({ playChoice: null })}>Cancel</button>
							</div>
						</div>
					</div>
				</div>;
			})()}

			{this.state.stadiumUse && <div class="tcg-prompt kind-trainer-use kind-stadium-use">
				<div class="tcg-prompt-veil" onClick={this.onTrainerUseBackdrop}></div>
				<div class="tcg-prompt-panel ps-popup">
					<div class="tcg-prompt-banner">
						<strong>{this.state.stadiumUse.name}</strong>
						<span>Stadium</span>
					</div>
					<div class="tcg-prompt-dialog">
						<p>Use this card?</p>
						<div class="tcg-prompt-acts">
							<button type="button" class="button notifying" onClick={() => this.choose(this.state.stadiumUse!.action)}>Use</button>
							<button type="button" class="button" onClick={() => this.setState({ stadiumUse: null })}>Cancel</button>
						</div>
					</div>
				</div>
			</div>}

			{this.state.trainerUse && <div class="tcg-prompt kind-trainer-use">
				<div class="tcg-prompt-veil" onClick={this.onTrainerUseBackdrop}></div>
				<div class="tcg-prompt-panel ps-popup">
					<div class="tcg-prompt-banner">
						<strong>{this.state.trainerUse.name}</strong>
						<span>Trainer</span>
					</div>
					<div class="tcg-prompt-dialog">
						<p>Use this card?</p>
						<div class="tcg-prompt-acts">
							<button type="button" class="button notifying" onClick={() => this.choose(this.state.trainerUse!.action)}>Use</button>
							<button type="button" class="button" onClick={() => this.setState({ trainerUse: null })}>Cancel</button>
						</div>
					</div>
				</div>
			</div>}

			{(() => {
				const searchPicks = searches.filter(a => a.type === 'searchPick');
				const searchDone = searches.find(a => a.type === 'searchDone');
				const searchState = searchPromptState(snap.pendingSearch, view.pendingSearch);
				const mulliganPlaces = mulligans.filter(a => a.type === 'mulliganBench');
				const mulliganKeep = mulligans.find(a => a.type === 'mulliganDone');
				const yes = confirms.find(a => a.type === 'confirmYes');
				const no = confirms.find(a => a.type === 'confirmNo');
				const goFirst = firsts.find(a => a.goFirst);
				const goSecond = firsts.find(a => !a.goFirst);
				const may = this.state.attackMay;
				const copies = snap.pendingCopyAttack && boardChoice?.kind !== 'attached' ?
					allActs.filter(a => a.type === 'attack' || a.type === 'ability') : [];
				const foeHand = foeHandChoice(this.actsSnap());
				const foeHandPicks = this.foeHandActs();
				const kind =
					may ? 'may' :
					this.state.endTurnConfirm && endTurn ? 'endTurn' :
					confirms.length ? 'confirm' :
					firsts.length ? 'first' :
					copies.length ? 'copy' :
					foeHand && (foeHandPicks.length || searchDone || holding('discardPick')) ? 'foeHand' :
					searchPicks.length || (searchDone && !handChoice) || holding('searchPick') ? 'search' :
					energyDiscards.length || holding('discardEnergyPick') ? 'energyDiscard' :
					pays.length || holding('payEnergy') ? 'pay' :
					mulliganDraws.length ? 'mulliganDraw' :
					mulligans.length ? 'mulligan' :
					prizesOffered.length && !prizeSending ? 'prize' : '';
				if (!kind || snap.you == null) {
					if (st.promptPeek) queueMicrotask(() => this.setState({ promptPeek: false }));
					return null;
				}
				const head = kind === 'may' && may ? { title: may.title } :
					kind === 'prize' ? prizeHead :
					promptHeading(kind === 'foeHand' ? this.actsSnap() : snap, kind, searchState);
				const peekable = kind !== 'may' && kind !== 'endTurn';
				const peeking = peekable && st.promptPeek;
				return <><div class={`tcg-prompt kind-${kind}${peeking ? ' is-peeking' : ''}`}>
					<div class="tcg-prompt-veil"></div>
					<div class="tcg-prompt-panel ps-popup" aria-hidden={peeking || undefined}>
						<div class="tcg-prompt-banner">
							<strong>{head.title}</strong>
							{head.sub && <span>{head.sub}</span>}
						</div>

						{kind === 'may' && may && <div class="tcg-prompt-dialog">
							<p>{may.text}</p>
							<div class="tcg-prompt-acts">
								<button type="button" class="button notifying" onClick={() => this.choose(may.yes)}>Yes</button>
								<button type="button" class="button" onClick={() => this.choose(may.no)}>No</button>
								<button type="button" class="button" onClick={() => this.setState({ attackMay: null })}>Cancel</button>
							</div>
						</div>}

						{kind === 'confirm' && <div class="tcg-prompt-dialog">
							{snap.pendingConfirm?.text && <p>{snap.pendingConfirm.text}</p>}
							<div class="tcg-prompt-acts">
								{yes && <button type="button" class="button notifying" onClick={() => this.choose(yes)}>Yes</button>}
								{no && <button type="button" class="button" onClick={() => this.choose(no)}>No</button>}
							</div>
						</div>}

						{kind === 'endTurn' && endTurn && <div class="tcg-prompt-dialog">
							<p>You still have actions available. End turn anyway?</p>
							<div class="tcg-prompt-acts">
								<button type="button" class="button notifying" onClick={() => this.choose(endTurn)}>End Turn</button>
								<button type="button" class="button" onClick={() => this.setState({ endTurnConfirm: false })}>Cancel</button>
							</div>
						</div>}

						{kind === 'first' && <div class="tcg-prompt-dialog">
							<div class="tcg-prompt-acts wide">
								{goFirst && <button type="button" class="button notifying" onClick={() => this.choose(goFirst)}>Go First</button>}
								{goSecond && <button type="button" class="button" onClick={() => this.choose(goSecond)}>Go Second</button>}
							</div>
						</div>}

						{kind === 'copy' && (() => {
							const cardRows = copies.filter(a => copyPickCardId(a));
							const plainRows = copies.filter(a => !copyPickCardId(a));
							// the engine names the card, our own name list might not be loaded yet
							const nameOf = (a: TcgAction) => a.label || cardLabel(copyPickCardId(a)!);
							const sameName = (a: TcgAction) => cardRows.filter(x => nameOf(x) === nameOf(a)).length > 1;
							return <div class="tcg-prompt-dialog">
								{cardRows.length > 0 && <div class="tcg-prompt-rail is-copy">
									{cardRows.map((a, i) => {
										const id = copyPickCardId(a)!;
										return <div key={`${a.index}-${id}-${i}`} class="tcg-prompt-card is-legal" title={`${nameOf(a)} (${id})`}>
											<TcgCardFace
												cardId={id} size="md"
												onClick={() => this.choose(a)}
												onInspect={this.openInspect}
											/>
											<em>{nameOf(a)}{sameName(a) && <span class="tcg-prompt-print">{id}</span>}</em>
										</div>;
									})}
								</div>}
								{plainRows.length > 0 && <div class="tcg-prompt-acts wide">
									{plainRows.map((a, i) =>
										<button
											type="button" key={`${a.type}-${a.index}-${a.pick}-${i}`} class="button notifying"
											onClick={() => this.choose(a)}
										>
											{describeAction(a, snap)}
										</button>
									)}
								</div>}
							</div>;
						})()}

						{kind === 'foeHand' && foeHand && <div class="tcg-prompt-select">
							<div class="tcg-prompt-rail">
								{foeHandRows(foeHand.ids, foeHandPicks).map((row, i) => {
									const undo = heldUndoFor(held, { type: 'discardPick', hand: i });
									const click = undo || row.action;
									return <div
										key={`${i}-${row.id}`}
										class={`tcg-prompt-card${undo ? ' is-picked' : row.action ? ' is-legal' : ' is-illegal'}`}
									>
										<TcgCardFace
											cardId={row.id} size="md"
											onClick={click ? () => this.choose(click) : undefined}
											onInspect={this.openInspect}
										/>
										<em>{cardLabel(row.id)}</em>
									</div>;
								})}
							</div>
							{searchDone && !held && <button type="button" class="button" onClick={() => this.choose(searchDone)}>Done</button>}
						</div>}

						{kind === 'search' && <div class="tcg-prompt-select">
							<div class={`tcg-prompt-rail${searchState?.ids?.length && !searchState?.seen?.length ? ' is-deck' : ''}`}>
								{(() => {
									const rows = searchDeckRows(searchState, searchPicks);
									const shownHeld: { [id: string]: number } = Object.create(null);
									if (rows) return rows.map((row, i) => {
										const pick = { type: 'searchPick', pick: row.id };
										const marked = shownHeld[row.id] || 0;
										const undo = marked < heldCount(held, pick) ? heldUndoFor(held, pick) : undefined;
										if (undo) shownHeld[row.id] = marked + 1;
										const action = undo || (row.legal ? searchPicks.find(a => a.pick === row.id) : undefined);
										return <div
											key={`${i}-${row.id}`}
											class={`tcg-prompt-card${undo ? ' is-picked' : row.legal ? ' is-legal' : ' is-illegal'}`}
										>
											<TcgCardFace
												cardId={row.id} size="md"
												onClick={action ? () => this.choose(action) : undefined}
												onInspect={this.openInspect}
											/>
											<em>{cardLabel(row.id)}</em>
										</div>;
									});
									if (searchPicks.length) return searchPicks.map((a, i) =>
										<div key={`${a.pick}-${i}`} class="tcg-prompt-card is-legal">
											<TcgCardFace
												cardId={a.pick} size="md"
												onClick={() => this.choose(a)}
												onInspect={this.openInspect}
											/>
											<em>{cardLabel(a.pick)}</em>
										</div>
									);
									return held?.picked ? null : <p class="tcg-prompt-note">No matching cards</p>;
								})()}
							</div>
							{searchDone && !held && <button type="button" class="button" onClick={() => this.choose(searchDone)}>Done</button>}
						</div>}

						{kind === 'energyDiscard' && <div class="tcg-prompt-select">
							<p class="tcg-prompt-note">
								{held ?
									`Choose ${snap.pendingDiscardEnergy?.need ?? 1} Energy, then Confirm.` :
									`Choose ${snap.pendingDiscardEnergy?.need ?? 1} Energy. Each choice discards one card.`}
							</p>
							<div class="tcg-prompt-energy">
								{heldOrbIndexes(energyDiscards, held).map(idx => {
									const row = energyDiscards.find(a => Number(a.index) === idx);
									const undo = heldUndoFor(held, { type: 'discardEnergyPick', index: idx });
									const click = undo || row;
									const cardId = snap.pendingDiscardEnergy?.cardIds?.[idx] || '';
									return <button
										type="button" key={`${idx}-${cardId}`}
										class={`button tcg-prompt-orb${undo ? ' is-picked' : ''}`}
										title={cardId ? cardLabel(cardId) : 'Energy'}
										aria-pressed={held ? !!undo : undefined}
										onClick={() => click && this.choose(click)}
									>
										<span class="tcg-prompt-orb-label">{cardId ? cardLabel(cardId) : 'Energy'}</span>
									</button>;
								})}
							</div>
						</div>}

						{kind === 'pay' && held && <div class="tcg-prompt-select">
							<p class="tcg-prompt-note">
								{`Select ${held.max} Energy attached to your Active Pokémon, then Confirm`}
							</p>
							<div class="tcg-prompt-energy">
								{heldOrbIndexes(pays, held).map(idx => {
									const row = pays.find(a => Number(a.index) === idx);
									const undo = heldUndoFor(held, { type: 'payEnergy', index: idx });
									const click = undo || row;
									const t = me.active?.energy?.[idx] || 'colorless';
									const cardId = me.active?.energyCards?.[idx] || '';
									return <button
										type="button" key={`${idx}-${cardId}`}
										class={`button tcg-prompt-orb${undo ? ' is-picked' : ''}${click ? '' : ' is-dim'}`}
										title={cardId ? `${cardLabel(cardId)} (${t})` : t}
										aria-pressed={!!undo}
										disabled={!click}
										onClick={() => click && this.choose(click)}
									>
										<img class="tcg-prompt-orb-icon" src={energySymbolUrl(t)} alt="" draggable={false} />
										<span class="tcg-prompt-orb-label">{cardId ? cardLabel(cardId) : t}</span>
									</button>;
								})}
							</div>
						</div>}

						{kind === 'pay' && !held && <div class="tcg-prompt-select">
							<p class="tcg-prompt-note">
								{this.payQueue.length || this.paySending ?
									'Discarding Energy…' :
									`Select ${snap.pendingRetreatPay?.need ?? 1} Energy attached to your Active Pokémon`}
								{!(this.payQueue.length || this.paySending) && !!this.state.payPicked.length &&
									` (${this.state.payPicked.length} of ${snap.pendingRetreatPay?.need ?? 1} selected)`}
							</p>
							<div class="tcg-prompt-energy">
								{pays.map((a, i) => {
									const idx = Number(a.index);
									const t = me.active?.energy?.[idx] || 'colorless';
									const cardId = me.active?.energyCards?.[idx] || '';
									const isPicked = this.state.payPicked.some(p => p === idx);
									const payNeed = snap.pendingRetreatPay?.need ?? 1;
									const busy = !!(this.payQueue.length || this.paySending);
									const full = !isPicked && this.state.payPicked.length >= payNeed;
									return <button
										type="button" key={i}
										class={`button tcg-prompt-orb${isPicked ? ' is-picked' : ''}${full || busy ? ' is-dim' : ''}`}
										title={cardId ? `${cardLabel(cardId)} (${t})` : t}
										disabled={full || busy}
										onClick={() => this.togglePayEnergy(idx, payNeed, pays)}
									>
										<img class="tcg-prompt-orb-icon" src={energySymbolUrl(t)} alt="" draggable={false} />
										<span class="tcg-prompt-orb-label">{cardId ? cardLabel(cardId) : t}</span>
									</button>;
								})}
							</div>
							<div class="tcg-prompt-acts">
								<button
									type="button" class="button notifying"
									disabled={!!(this.payQueue.length || this.paySending) ||
										this.state.payPicked.length !== (snap.pendingRetreatPay?.need ?? 0)}
									onClick={() => this.confirmPayEnergy(pays)}
								>Confirm</button>
								<button
									type="button" class="button"
									disabled={!!(this.payQueue.length || this.paySending)}
									onClick={() => this.setState({ payPicked: [] })}
								>Clear</button>
							</div>
						</div>}

						{kind === 'mulliganDraw' && <div class="tcg-prompt-dialog">
							<p>
								You may draw up to {view.pendingMulliganDraw?.max ?? mulliganDraws.length - 1} cards.
								Drawing none is allowed.
							</p>
							<div class="tcg-prompt-acts">
								{mulliganDraws.map((a, i) =>
									<button
										type="button" key={i}
										class={a.n ? 'button notifying' : 'button'}
										onClick={() => this.choose(a)}
									>
										{a.n ? `Draw ${a.n}` : 'Draw none'}
									</button>
								)}
							</div>
						</div>}

						{kind === 'mulligan' && <div class="tcg-prompt-select">
							<div class="tcg-prompt-rail">
								{mulliganPlaces.map((a, i) =>
									<div key={i} class="tcg-prompt-card">
										<TcgCardFace
											cardId={Array.isArray(me.hand) ? me.hand[a.hand] : ''}
											size="md"
											onClick={() => this.choose(a)}
											onInspect={this.openInspect}
										/>
										<em>Bench</em>
									</div>
								)}
							</div>
							{mulliganKeep && <button type="button" class="button notifying" onClick={() => this.choose(mulliganKeep)}>
								Keep Hand
							</button>}
						</div>}

						{kind === 'prize' && <div class="tcg-prompt-dialog">
							<p>{prizeNote}</p>
							<div class="tcg-prompt-acts">
								{prizeSlots.filter(s =>
									!s.taken && s.serverIndex != null && prizesOffered.some(a => Number(a.index) === s.serverIndex)
								).map(s => {
									const on = prizeSel.includes(s.slot);
									return <button
										type="button" key={s.slot}
										class={`button tcg-prize-pick${on ? ' is-picked' : ''}`}
										aria-pressed={on}
										disabled={!!this.props.waiting}
										onClick={() => this.pickPrize(s.slot)}
									>
										{on && <i class="fa fa-check" aria-hidden></i>} Prize {s.slot + 1}
									</button>;
								})}
							</div>
							<p class="buttonbar tcg-prize-done">
								<button
									type="button" class="button notifying"
									disabled={prizeSel.length !== prizeNeed || !!this.props.waiting}
									onClick={this.confirmPrizes}
								>
									<strong>Done</strong>
								</button>
							</p>
						</div>}

						{held && (kind === 'search' || kind === 'foeHand' || kind === 'energyDiscard' || kind === 'pay') &&
							this.renderHeldBar(held, snap)}
					</div>
				</div>
				{peekable && <button
					type="button" class={`button${peeking ? ' notifying' : ''} tcg-prompt-toggle${peeking ? ' is-peeking' : ''}`}
					onClick={() => this.setState({ promptPeek: !peeking })}
					title={peeking ? 'Show the choice again' : 'Hide this choice to look at the board; it stays open'}
				>
					{peeking ?
						<><i class="fa fa-arrow-up" aria-hidden></i> Back to {head.title}</> :
						<><i class="fa fa-eye" aria-hidden></i> View board</>}
				</button>}</>;
			})()}

			{held?.type === 'pickSlot' && this.renderHeldBar(held, snap, true)}
			{handHeld && this.renderHeldBar(handHeld, snap, true, true, PS.prefs.tcghints ? hint : '')}

			{dragging && drag && <div
				class="tcg-drag-ghost"
				style={{ left: `${drag.x}px`, top: `${drag.y}px` }}
			>
				{drag.source === 'zone' ?
					<span class="tcg-drag-orb">
						<img src={energySymbolUrl(String(drag.cardId || 'colorless'))} alt="" draggable={false} />
					</span> :
					(drag.cardId ?
						<img
							src={drag.image || cardArt(drag.cardId)}
							alt={drag.name || ''}
							draggable={false}
							onError={(ev: any) => {
								const img = ev?.currentTarget as HTMLImageElement | null;
								if (!img || !drag.cardId) return;
								const step = Number(img.dataset.fallback || '0');
								if (isPocketCardId(drag.cardId)) {
									if (step < 1) {
										img.dataset.fallback = '1';
										img.src = cardArt(drag.cardId, { pocket: true, large: true });
									}
									return;
								}
								if (step < 1) {
									img.dataset.fallback = '1';
									img.src = paperTcgIoArt(drag.cardId, true);
									return;
								}
								if (step < 2) {
									img.dataset.fallback = '2';
									img.src = scrydexArt(drag.cardId, true);
								}
							}}
						/> :
						<CardBackFace />)}
				{drag.hint && <em>{drag.hint}</em>}
			</div>}
			{this.state.discardBrowse && (() => {
				const side = this.state.discardBrowse;
				const pile = (side === 'me' ? me.discard : foe.discard) || [];
				const title = side === 'me' ? 'Your discard pile' : 'Opponent discard pile';
				return <div class="tcg-prompt kind-discard-browse">
					<div class="tcg-prompt-veil" onClick={() => this.setState({ discardBrowse: null })}></div>
					<div class="tcg-prompt-panel ps-popup">
						<div class="tcg-prompt-banner">
							<strong>{title}</strong>
							<span>{pile.length} card{pile.length === 1 ? '' : 's'}</span>
							<button
								type="button" class="button tcg-cancel" aria-label="Close"
								onClick={() => this.setState({ discardBrowse: null })}
							><i class="fa fa-times" aria-hidden></i></button>
						</div>
						<div class="tcg-prompt-select">
							<div class="tcg-prompt-rail">
								{pile.length ? [...pile].reverse().map((id, i) =>
									<div key={`${id}-${i}`} class="tcg-prompt-card">
										<TcgCardFace cardId={id} size="md" onInspect={this.openInspect} />
										<em>{cardLabel(id)}</em>
									</div>
								) : <p class="tcg-prompt-note">Empty</p>}
							</div>
							<button
								type="button" class="button"
								onClick={() => this.setState({ discardBrowse: null })}
							>Close</button>
						</div>
					</div>
				</div>;
			})()}
			{this.state.attachBrowse && (() => {
				const browse = this.state.attachBrowse;
				const close = () => this.setState({ attachBrowse: null });
				return <div class="tcg-prompt kind-attach-browse">
					<div class="tcg-prompt-veil" onClick={close}></div>
					<div class="tcg-prompt-panel ps-popup">
						<div class="tcg-prompt-banner">
							<strong>{browse.title}</strong>
							<span>{[
								browse.cards.length || !browse.stages.length ? `${browse.cards.length} attached` : '',
								browse.stages.length ? `${browse.stages.length} previous stage${browse.stages.length === 1 ? '' : 's'}` : '',
							].filter(Boolean).join(' · ')}</span>
							<button type="button" class="button tcg-cancel" aria-label="Close" onClick={close}>
								<i class="fa fa-times" aria-hidden></i>
							</button>
						</div>
						<div class={`tcg-prompt-select${browse.stages.length ? ' has-stages' : ''}`}>
							{browse.stages.length > 0 && <>
								<h4 class="tcg-attach-heading">Previous Evolution stages <small>oldest first, not attached</small></h4>
								<div class="tcg-prompt-rail is-stages">
									{browse.stages.map((id, i) =>
										<div key={`stage-${id}-${i}`} class="tcg-prompt-card kind-stage" data-stage={i}>
											<TcgCardFace cardId={id} size="md" onInspect={this.openInspect} />
											<em>
												<span class="tcg-attach-tag kind-stage">Previous</span>
												{cardLabel(id)}
											</em>
										</div>
									)}
								</div>
							</>}
							{browse.cards.length > 0 && browse.stages.length > 0 &&
								<h4 class="tcg-attach-heading">Attached cards</h4>}
							{browse.cards.length > 0 && <div class="tcg-prompt-rail">
								{browse.cards.map((c, i) =>
									<div key={`${c.kind}-${c.cardId}-${i}`} class={`tcg-prompt-card kind-${c.kind}`}>
										<TcgCardFace cardId={c.cardId} size="md" onInspect={this.openInspect} />
										<em>
											<span class={`tcg-attach-tag kind-${c.kind}`}>{attachedKindLabel(c.kind)}</span>
											{cardLabel(c.cardId)}
										</em>
									</div>
								)}
							</div>}
							<button type="button" class="button" onClick={close}>Close</button>
						</div>
					</div>
				</div>;
			})()}
			{this.state.refuse && <div
				class="tcg-refuse"
				style={{ left: `${this.state.refuse.x}px`, top: `${this.state.refuse.y}px` }}
				role="status"
			>{this.state.refuse.text}</div>}
			<FxOverlay
				key={st.fx ? `${st.fx.kind}-${st.fx.iid || ''}-${st.fx.amount || ''}-${Object.values(st.pkFx)[0]?.tick || 0}` : 'fx'}
				fx={st.fx} you={snap.you} viewpoint={meIndex}
				names={snap.players.map(p => p?.name || '')}
			/>
		</div>;
	}
}

if (typeof window !== 'undefined') {
	(window as any).TcgBoard = TcgBoard;
}
