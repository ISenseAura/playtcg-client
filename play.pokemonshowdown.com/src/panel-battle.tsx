/**
 * Battle panel
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license AGPLv3
 */

import preact from "../js/lib/preact";
import {
	PS, PSRoom, type RoomOptions, type RoomID, Config, type BattlePanelLayout,
} from "./client-main";
import { PSIcon, PSPanelWrapper, PSRoomPanel } from "./panels";
import { ChatLog, ChatRoom, ChatTextEntry, ChatUserList } from "./panel-chat";
import { FormatDropdown } from "./panel-mainmenu";
import { Battle, type Pokemon, type ServerPokemon } from "./battle";
import { BattleScene } from "./battle-animations";
import { Dex, TL, toID, type ID } from "./battle-dex";
import {
	BattleChoiceBuilder, type BattleRequestActivePokemon, type BattleRequestSideInfo,
	type BattleRequest, type BattleMoveRequest, type BattleSwitchRequest, type BattleTeamRequest,
} from "./battle-choices";
import { BattleTextParser, type Args } from "./battle-text-parser";
import { ModifiableValue } from "./battle-tooltips";
import { Net } from "./client-connection";
import { getTcgCard, loadTcgCardIndex, tcgCardIndexStatus } from "./battle-tcg-deck";
import { BattleLog } from "./battle-log";
import {
	TcgBoard, TcgBoardErrorBoundary, isTcgBattleId, chatEntryForEvent, chatHtmlForEntry, noteTcgMons, noteTcgCardNames,
	loadPaperNames, eventCardIds, unnamedCardIds, cardNamesOfEvents,
	tcgOpeningRules, tcgFormatTitle,
	applyTcgEvents,
	filterTcgEventsForViewer, spectatorReplayFrom, normalizeTcgEnergy, scrubTcgSpectatorView, collectPrizeTakes,
	tcgSeqGate, tcgDropSetupResync, tcgFreshEvents, createTcgResyncRetry, tcgInputWaitsOnBatch, tcgRefusalText,
	type TcgAction, type TcgEvent, type TcgPokemonView, type TcgSnapshot,
} from "./battle-tcg";

type BattleDesc = {
	id: RoomID,
	minElo?: number | string,
	p1?: string,
	p2?: string,
	p3?: string,
	p4?: string,
};
export class BattlesRoom extends PSRoom {
	override readonly classType = 'battles';
	/** null means still loading */
	format = '';
	filters = '';
	battles: BattleDesc[] | null = null;
	constructor(options: RoomOptions) {
		super(options);
		this.refresh();
		// If graphics preference is set to use BW sprites
		if (PS.prefs.bwgfx) {
			Dex.loadSpriteData('bw');
		}
	}
	setFormat(format: string) {
		if (format === this.format) return this.refresh();
		this.battles = null;
		this.format = format;
		this.update(null);
		this.refresh();
	}
	refresh() {
		PS.send(`/cmd roomlist ${toID(this.format)}, ${this.filters}`);
	}
}

class BattlesPanel extends PSRoomPanel<BattlesRoom> {
	static readonly id = 'battles';
	static readonly routes = ['battles'];
	static readonly Model = BattlesRoom;
	static readonly location = 'right';
	static readonly icon = <i class="fa fa-caret-square-o-right" aria-hidden></i>;
	static readonly title = 'Battles';
	static getTitle() {
		return TL`Battles`;
	}
	refresh = () => {
		this.props.room.refresh();
	};
	changeFormat = (e: Event) => {
		const value = (e.target as HTMLButtonElement).value;
		this.props.room.setFormat(value);
	};
	applyFilters = (e: Event) => {
		e.preventDefault();
		const minElo = this.base?.querySelector<HTMLInputElement>(`select[name=elofilter]`)?.value;
		const searchPrefix = this.base?.querySelector<HTMLInputElement>(`input[name=prefixsearch]`)?.value;
		this.props.room.filters = `${minElo || ''},${searchPrefix || ''}`;
		this.refresh();
	};
	renderBattleLink(battle: BattleDesc) {
		const format = battle.id.split('-')[1];
		const minEloMessage = typeof battle.minElo === 'number' ? TL`rated ${battle.minElo}` : battle.minElo;
		const players = TL`${battle.p1} vs. ${battle.p2}`;
		return <div key={battle.id}><a href={`/${battle.id}`} class="blocklink">
			{minEloMessage && <small style="float:right">({minEloMessage})</small>}
			<small>[{format}]</small><br />
			<em>{players}</em>
		</a></div>;
	}
	override render() {
		const room = this.props.room;
		return <PSPanelWrapper room={room}><div class="pad">
			<button class="button" style="float:right;font-size:10pt;margin-top:3px" name="closeRoom">
				<i class="fa fa-times" aria-hidden></i> {TL`[Close]`}
			</button>
			<div class="roomlist">
				<p>
					<button class="button" name="refresh" onClick={this.refresh}>
						<i class="fa fa-refresh" aria-hidden></i> {TL`[Refresh]`}
					</button> {}
					<span
						style={Dex.getPokemonIcon('meloetta-pirouette') + ';display:inline-block;vertical-align:middle'} class="picon"
						title={TL`Meloetta is PS's mascot! The Pirouette forme is Fighting-type, and represents our battles.`}
					></span>
				</p>

				<p>
					<label class="label">{TL.label(TL`Format`)}</label>
					<FormatDropdown onChange={this.changeFormat} placeholder={TL`(All formats)`} />
				</p>
				<label class="label">
					{TL.label(TL`Minimum Elo`)}<select name="elofilter" class="select" onChange={this.applyFilters}>
						<option value="none">{TL`None`}</option><option value="1100">1100</option><option value="1300">1300</option>
						<option value="1500">1500</option><option value="1700">1700</option><option value="1900">1900</option>
					</select>
				</label>

				<form class="search" onSubmit={this.applyFilters}>
					<p>
						<input type="text" name="prefixsearch" class="textbox" placeholder={TL`Username prefix`} autocomplete="off" />
						<button type="submit" class="button">{TL`[Search]`}</button>
					</p>
				</form>
				<div class="list">{!room.battles ? (
					<p>{TL`Loading...`}</p>
				) : !room.battles.length ? (
					<p>{TL`No battles are going on`}</p>
				) : (<>
					<p>{room.battles.length === 1 ? (
						TL`${1} battle`
					) : (
						TL`${room.battles.length === 100 ? '100+' : room.battles.length} battles`
					)}</p>
					{room.battles.map(battle => this.renderBattleLink(battle))}
				</>
				)}</div>
			</div>
		</div></PSPanelWrapper>;
	}
}

function sameTcgEvents(a: TcgEvent[] | undefined, b: TcgEvent[] | undefined): boolean {
	if (!a?.length || !b?.length || a.length !== b.length) return false;
	return a.every((ev, i) => ev.seq === b[i].seq && ev.type === b[i].type);
}
function tcgHasOpeningFlip(events?: TcgEvent[]) {
	return !!events?.some(e => e.type === 'coin' || e.type === 'first');
}
function tcgHasChooseFirst(item: { actions?: TcgAction[], snapshot?: TcgSnapshot }) {
	const acts = item.actions || item.snapshot?.actions;
	return !!acts?.some(a => a.type === 'chooseFirst');
}
function requestMarksTcgRoom(body: string | undefined): boolean {
	if (!body) return false;
	let data: unknown;
	try {
		data = JSON.parse(body);
	} catch (err) {
		if (err instanceof SyntaxError) return false;
		throw err;
	}
	return !!data && typeof data === 'object' && !Array.isArray(data) &&
		(data as { tcg?: unknown }).tcg === true;
}

const TCG_CHAT_LINES = ['c', 'c:', 'chat', 'j', 'J', 'l', 'L', 'n', 'N', 'rated'];
const TCG_ROOM_LINES = ['raw', 'html', 'inactive', 'inactiveoff', 'bigerror'];

export function isTcgChatLine(type: string, started: boolean) {
	return TCG_CHAT_LINES.includes(type) || (started && TCG_ROOM_LINES.includes(type));
}

export function tcgReplayChatFrom(raw: unknown): { after: number, args: Args }[] {
	if (!Array.isArray(raw)) return [];
	const out: { after: number, args: Args }[] = [];
	for (const row of raw) {
		if (!row || typeof row !== 'object') continue;
		const { after, line } = row as { after?: unknown, line?: unknown };
		if (typeof after !== 'number' || !Number.isFinite(after) || after < 0) continue;
		if (typeof line !== 'string' || !line.startsWith('|')) continue;
		const args = BattleTextParser.parseLine(line);
		if (!args?.[0] || !isTcgChatLine(args[0], true)) continue;
		out.push({ after, args });
	}
	return out.map((row, i) => ({ row, i })).sort((a, b) => a.row.after - b.row.after || a.i - b.i).map(x => x.row);
}

export class BattleRoom extends ChatRoom {
	override readonly classType = 'battle';
	declare pmTarget: null;
	declare challengeMenuOpen: false;
	declare challengingFormat: null;
	declare challengedFormat: null;

	override battle: Battle = null!;
	/** null if spectator, otherwise current player's info */
	side: BattleRequestSideInfo | null = null;
	request: BattleRequest | null = null;
	choices: BattleChoiceBuilder | null = null;
	autoTimerActivated: boolean | null = null;
	requireForfeit = false;
	/** should be false if we joined right after accepting or challenging a battle,
	  * and true if we refreshed and rejoined a battle.
		* null = initializing, we don't know yet */
	rejoining: boolean | null = null;
	overlayActive: 'move' | 'switch' | null = null;
	tcgMode = isTcgBattleId(this.id);
	tcgSnapshot: TcgSnapshot | null = null;
	/** format rules only come on the first snapshot of a battle, so merge them into every later one */
	tcgFormat: TcgSnapshot['format'] = undefined;
	tcgFxSnapshot: TcgSnapshot | null = null;
	tcgEvents: TcgEvent[] = [];
	tcgFxKey = 0;
	/** so a board that remounts mid-batch carries on instead of replaying it */
	tcgBeatAt = 0;
	tcgLastSeq = 0;
	tcgLogNeedsIntro = false;
	tcgWait = false;
	tcgNotice = '';
	tcgNoticeN = 0;
	tcgPlaying = false;
	tcgOpeningFlipDone = false;
	/** highest event seq already queued, repeats get dropped */
	tcgSeqSeen = 0;
	tcgChat: { after: number, args: Args }[] = [];
	tcgChatShown = 0;
	tcgResyncAt: number | null = null;
	/** asks again while the resync is unanswered. only a few tries, never into another battle */
	tcgResyncRetry = createTcgResyncRetry({
		send: () => this.sendDirect('/tcgresync'),
		pending: () => this.tcgResyncAt != null,
		alive: () => !!this.connected && PS.rooms[this.id] === this && !this.tcgReplayMode,
	});
	tcgLatestStatus: string | undefined = undefined;
	tcgSetupHidden: { [seat: number]: { [slot: string]: string } } = {};
	/** both players were ready in the newest snapshot, so setup pokemon are face up even if status is still setup */
	tcgSetupRevealed = false;
	/** payloads that come in during a (re)join are history, show the result instead of replaying every beat */
	tcgSyncUntil = Date.now() + 2500;
	tcgQueue: {
		snapshot?: TcgSnapshot,
		events?: TcgEvent[],
		actions?: TcgAction[],
		wait?: boolean,
		animate: boolean,
		/** |request| repeats events that |tcg| will log, don't write them again */
		silent?: boolean,
		replay?: boolean,
		turnReplay?: boolean,
		/** the board already shows this payload, so the beat shouldn't rewind the snapshot when it ends */
		painted?: boolean,
		markEnded?: boolean,
		winner?: string | null,
		/** `watch` = public room log (spectators), `you` = private sideupdate (players) */
		kind?: string,
		historyIndex?: number,
	}[] = [];
	/**
	 * public room log for this game, kept even when it doesn't drive the board. once the game is over it's the
	 * replay if this client saw less of the game privately (a player who reopens the battle only gets one resync
	 * board)
	 */
	tcgPublicHistory: BattleRoom['tcgQueue'] = [];
	tcgHistory: BattleRoom['tcgQueue'] = [];
	tcgPaused = false;
	tcgHalt = 0;
	tcgEnded = false;
	tcgResultShown = false;
	/** a card effect failed. input stops, this isn't a result and has no replay */
	tcgAborted = false;
	tcgStopReason = '';
	tcgWinner: string | null = null;
	/** after login, ignore public watch until a private `you` or spectator resync arrives */
	tcgAwaitingPrivate = false;
	tcgViewpoint: 0 | 1 = 0;
	tcgSide: 0 | 1 | null = null;
	tcgP1 = { id: '', name: '' };
	tcgP2 = { id: '', name: '' };
	tcgKickingInactive: number | boolean = false;
	tcgTotalTimeLeft = 0;
	tcgGraceTimeLeft = 0;
	tcgReplayMode = false;
	tcgSeekIndex = -1;
	tcgTurnReplay = false;

	private pendingLines: Args[] = [];
	/** showdex compat */
	onRequest: ((request: BattleRequest | null) => void) | null = null;

	override receiveBatch(batch: Args[]) {
		if (this.tcgMode || isTcgBattleId(this.id) || batch.some(args =>
			args[0] === 'tcg' || (args[0] === 'request' && requestMarksTcgRoom(args[1]))
		)) {
			this.tcgMode = true;
			for (const args of batch) {
				(this as any).receiveLine(args); // showdex compat
				if (this.handleLine(args)) continue;
				this.update(args);
			}
			this.update(null);
			return;
		}
		for (const args of batch) (this as any).receiveLine(args); // showdex compat
		if (!this.battle) {
			this.pendingLines.push(...batch);
			this.update(null);
			return;
		}
		if (this.pendingLines.length) {
			batch = [...this.pendingLines, ...batch];
			this.pendingLines = [];
		}
		if (!batch.length) {
			this.update(null);
			return;
		}

		const battleLines: string[] = [];
		const controlLines: Args[] = [];
		for (const args of batch) {
			if (this.handleLine(args)) continue;
			switch (args[0]) {
			case 'request': case 'sentchoice': case 'initdone':
				controlLines.push(args);
				continue;
			case 'win': case 'tie': case 'error':
				controlLines.push(args);
				break;
			}
			battleLines.push('|' + args.join('|'));
		}
		this.battle.addBatch(battleLines);
		// delayed to after `battle.addBatch` because these can depend on battle state
		for (const args of controlLines) this.handleLineAfterBattleUpdate(args);
		if (PS.prefs.noanim || (this.rejoining && this.side)) {
			this.battle.seekTurn(Infinity);
		}
		if (this.side) this.rejoining = false;
		// A reconnect can send |sentchoice| immediately after |request|, so do this after the batch
		this.updateChoiceNotification();
		this.update(null);
	}
	override handleLine(args: Args): boolean {
		if (super.handleLine(args)) return true;
		switch (args[0]) {
		case 'cantleave':
			this.requireForfeit = true;
			return true;
		case 'allowleave':
			this.requireForfeit = false;
			return true;
		}
		return false;
	}
	handleLineAfterBattleUpdate(args: Args) {
		switch (args[0]) {
		case 'initdone':
			if (!PS.prefs.spectatefromstart) this.battle.seekTurn(Infinity);
			break;
		case 'request': case 'win': case 'tie': {
			const request = args[0] === 'request' && args[1] ? JSON.parse(args[1]) : null;
			this.receiveRequest(request);
			this.onRequest?.(request);
			break;
		}
		case 'error':
			if (args[1].startsWith('[Invalid choice]') && this.request) {
				this.choices = new BattleChoiceBuilder(this.request);
			}
			break;
		case 'sentchoice':
			if (this.request) {
				let choices = new BattleChoiceBuilder(this.request);
				const possibleError = choices.addChoices(args[1]);
				if (possibleError || !choices.isDone()) {
					choices = new BattleChoiceBuilder(this.request);
					choices.serializedChoice = args[1];
				}
				this.choices = choices;
			}
			break;
		}
	}
	receiveRequest(request: BattleRequest | null) {
		if (!request) {
			this.request = null;
			this.choices = null;
			return;
		}

		if (PS.prefs.autotimer && !this.battle.kickingInactive && !this.autoTimerActivated) {
			this.send('/timer on');
			this.autoTimerActivated = true;
		}

		BattleChoiceBuilder.fixRequest(request, this.battle);

		if (request.side) {
			this.battle.myPokemon = request.side.pokemon;
			this.battle.setViewpoint(request.side.id);
			this.side = request.side;
		}
		if (request.ally) {
			this.battle.myAllyPokemon = request.ally.pokemon;
		}

		this.request = request;
		this.choices = new BattleChoiceBuilder(request);
	}

	override interruptClose(explicit?: boolean, elem?: HTMLElement | null) {
		if (this.isPlaying() || this.requireForfeit) {
			PS.join('forfeitbattle' as RoomID, { parentElem: elem, parentRoomid: this.id });
			return TL`You are still in ${this.title}`;
		}
		return super.interruptClose(explicit, elem);
	}
	isPlaying() {
		if (this.tcgReplayMode) return false;
		if (this.tcgMode) {
			return this.tcgIsBattleSeat() && !this.tcgEnded &&
				this.connectMode !== 'deleted' && !!this.tcgSnapshot;
		}
		return this.battle && !this.battle.ended && this.request && this.connectMode !== 'deleted';
	}
	updateChoiceNotification() {
		const oName = this.battle?.farSide.name;
		let title = '';
		let body = '';
		switch (this.request?.requestType) {
		case 'move':
			title = BattleTextParser.ui('notifyMoveTitle');
			body = oName ? BattleTextParser.ui('notifyMoveAgainst', { OPPONENT: oName }) : BattleTextParser.ui('notifyMove');
			break;
		case 'switch':
			title = BattleTextParser.ui('notifySwitchTitle');
			body = oName ? BattleTextParser.ui('notifySwitchAgainst', { OPPONENT: oName }) : BattleTextParser.ui('notifySwitch');
			break;
		case 'team':
			title = BattleTextParser.ui('notifyTeamTitle');
			body = oName ? BattleTextParser.ui('notifyTeamAgainst', { OPPONENT: oName }) : BattleTextParser.ui('notifyTeam');
			break;
		}

		if (!this.choices || this.choices.isDone()) body = '';

		if (this.tcgMode && this.tcgSide != null && this.tcgSnapshot && !this.tcgWait &&
			this.tcgSnapshot.actions?.length && !this.tcgEnded) {
			title = "Your turn!";
			body = "Choose a TCG action" + oName;
		}

		const current = this.notifications.find(notification => notification.id === 'choice');
		if ((current?.body || '') === body) return;

		if (!body) {
			this.dismissNotification('choice');
		} else {
			this.notify({ title, body, id: 'choice', noAutoDismiss: true });
		}
	}

	override handleReconnect(): boolean | void {
		this.pendingLines = [];
		if (this.battle) {
			this.battle.stepQueue = [];
			this.battle.preemptStepQueue = [];
			this.battle.resetStep();
		}
		this.side = null;
		this.request = null;
		this.choices = null;
		this.tcgSnapshot = null;
		this.tcgFxSnapshot = null;
		this.tcgEvents = [];
		this.tcgQueue = [];
		this.tcgHistory = [];
		this.tcgPublicHistory = [];
		this.tcgPaused = false;
		this.tcgPlaying = false;
		this.tcgOpeningFlipDone = false;
		this.tcgSyncUntil = Date.now() + 2500;
		this.tcgLastSeq = 0;
		this.tcgSeqSeen = 0;
		this.tcgChat = [];
		this.tcgChatShown = 0;
		this.tcgResyncAt = null;
		this.tcgResyncRetry.cancel();
		this.tcgLatestStatus = undefined;
		this.tcgSetupHidden = {};
		this.tcgSetupRevealed = false;
		this.tcgEnded = false;
		this.tcgResultShown = false;
		this.tcgAborted = false;
		this.tcgStopReason = '';
		this.tcgWinner = null;
		this.tcgViewpoint = 0;
		this.tcgSide = null;
		this.tcgAwaitingPrivate = false;
		this.tcgKickingInactive = false;
		this.tcgTotalTimeLeft = 0;
		this.tcgGraceTimeLeft = 0;
		this.tcgReplayMode = false;
		this.tcgSeekIndex = -1;
		this.updateChoiceNotification();
		return false;
	}

	tcgFormatId() {
		const parts = this.id.split('-');
		return parts[1] || 'tcgstandard';
	}
	tcgOpponentId() {
		if (this.tcgSide === 0) return toID(this.tcgP2.id || this.tcgP2.name);
		if (this.tcgSide === 1) return toID(this.tcgP1.id || this.tcgP1.name);
		return '';
	}
	/** like `room.side`: comes from the private sideupdate (`snapshot.you`), not public `watch` */
	isTcgPlayer() {
		return this.tcgSide != null && !this.tcgReplayMode;
	}
	isTcgSpectator() {
		return this.tcgSide == null || this.tcgReplayMode;
	}
	/**
	 * public watch mustn't drive a seat holder's board or use up event seqs, or `you` loses the opening coin and
	 * deal to seq dedupe
	 */
	tcgIsBattleSeat() {
		if (this.isTcgPlayer() || this.tcgAwaitingPrivate) return true;
		const me = PS.user?.userid;
		if (!me || !PS.user.named || me.startsWith('guest')) return false;
		const p1 = toID(this.tcgP1.id || this.tcgP1.name);
		const p2 = toID(this.tcgP2.id || this.tcgP2.name);
		return !!((p1 && p1 === me) || (p2 && p2 === me));
	}
	tcgWatchDrivesBoard() {
		return this.isTcgSpectator() && !this.tcgIsBattleSeat();
	}
	tcgApplyIdentityResync(kind: 'watch' | 'you') {
		this.tcgAwaitingPrivate = false;
		if (this.tcgPlaying && this.tcgQueue[0]?.kind === 'watch') {
			this.tcgHalt++;
			this.tcgPlaying = false;
			this.tcgQueue.shift();
			this.tcgFxSnapshot = null;
			this.tcgEvents = [];
		}
		this.dropTcgWatchQueue();
		if (kind === 'watch') {
			this.tcgSide = null;
			this.tcgViewpoint = 0;
		}
	}
	switchTcgViewpoint = () => {
		if (!this.isTcgSpectator() && !this.tcgEnded && !this.tcgReplayMode) return;
		this.tcgViewpoint = this.tcgViewpoint === 0 ? 1 : 0;
		this.update(null);
	};
	/** doesn't change `snapshot.you` (spectators stay `you: null`) */
	tcgBoardViewpoint(): 0 | 1 {
		if (this.tcgViewpoint === 0 || this.tcgViewpoint === 1) return this.tcgViewpoint;
		return this.tcgSide ?? 0;
	}
	turnAtHistoryIndex(index: number, history = this.tcgHistory): number {
		let turn = 0;
		for (let i = 0; i <= index && i < history.length; i++) {
			const item = history[i];
			if (item.snapshot?.turnNumber != null) turn = item.snapshot.turnNumber;
			for (const ev of item.events || []) {
				if (ev.type === 'turn' && typeof ev.number === 'number') turn = ev.number;
			}
		}
		return turn;
	}
	noteTcgPublicPayload(data: { snapshot?: TcgSnapshot, events?: TcgEvent[] }) {
		let snapshot = data.snapshot;
		if (snapshot) {
			if (!snapshot.format && this.tcgFormat) snapshot = { ...snapshot, format: this.tcgFormat };
			snapshot = scrubTcgSpectatorView(snapshot);
		}
		const events = filterTcgEventsForViewer(data.events, null)?.slice();
		const ended = snapshot?.status === 'over' || !!events?.some(ev => ev.type === 'over');
		const winner = ended && snapshot?.winner != null ? snapshot.players?.[snapshot.winner]?.name || null : undefined;
		this.tcgPublicHistory.push({ snapshot, events, animate: false, markEnded: ended || undefined, winner, kind: 'watch' });
	}
	tcgTurnsCovered(history: BattleRoom['tcgQueue']) {
		const turns: number[] = [];
		for (let i = 0; i < history.length; i++) {
			const turn = this.turnAtHistoryIndex(i, history);
			if (!turns.includes(turn)) turns.push(turn);
		}
		return turns.length;
	}
	/**
	 * an ended game replays from the public room log if it covers more than our own history. that's a player who
	 * rejoined, the replay shouldn't depend on having watched in this tab
	 */
	useTcgPublicReplay() {
		if (!this.tcgEnded || this.tcgAborted || !this.tcgPublicHistory?.some(item => item.snapshot)) return;
		if (this.tcgTurnsCovered(this.tcgPublicHistory) <= this.tcgTurnsCovered(this.tcgHistory)) return;
		const history = this.tcgPublicHistory.map(item => ({ ...item, events: item.events?.slice() }));
		const last = history[history.length - 1];
		last.markEnded = true;
		if (last.winner === undefined) last.winner = this.tcgWinner;
		this.tcgHistory = history;
		this.tcgSeekIndex = -1;
	}
	tcgReplayItems(animate: boolean): BattleRoom['tcgQueue'] {
		let seen = 0;
		return this.tcgHistory.map((item, historyIndex) => {
			const events = (item.events || []).filter(ev => {
				if (typeof ev.seq !== 'number') return true;
				if (ev.seq <= seen) return false;
				seen = ev.seq;
				return true;
			});
			return {
				...item,
				events,
				animate: animate && !!events.length && !PS.prefs.noanim,
				silent: true,
				replay: true,
				historyIndex,
			};
		});
	}
	noteTcgReplayAt(item: BattleRoom['tcgQueue'][number]) {
		if (!item.replay || item.historyIndex == null) return;
		this.tcgSeekIndex = item.historyIndex >= this.tcgHistory.length - 1 ? -1 : item.historyIndex;
	}
	playTcgReplay = () => {
		this.useTcgPublicReplay();
		if (this.tcgEnded) this.tcgReplayMode = true;
		if (this.tcgPaused && this.tcgQueue.some(item => item.replay)) {
			this.tcgPaused = false;
			this.pumpTcg();
			this.update(null);
			return;
		}
		const from = this.tcgSeekIndex;
		if (from < 0 || this.tcgPlaying) {
			this.replayTcg();
			return;
		}
		this.tcgPaused = false;
		this.tcgTurnReplay = false;
		this.tcgPlaying = false;
		this.tcgHalt++;
		this.tcgFxSnapshot = null;
		this.tcgEvents = [];
		this.tcgWait = true;
		this.tcgQueue = this.tcgReplayItems(true).slice(from + 1);
		if (!this.tcgQueue.length) {
			this.update(null);
			return;
		}
		this.pumpTcg();
	};
	fftoTcg(target: string | number) {
		this.useTcgPublicReplay();
		if (!this.tcgHistory.length) return;
		if (this.tcgResultShown && !this.tcgEnded) this.skipTcgToEnd();
		if (this.tcgEnded) this.tcgReplayMode = true;
		const canScrub = this.tcgEnded || this.tcgReplayMode || this.isTcgSpectator();
		if (!canScrub) {
			if (target === 'end' || target === Infinity) this.skipTcgToEnd();
			return;
		}
		const turns: number[] = [];
		for (let i = 0; i < this.tcgHistory.length; i++) {
			turns.push(this.turnAtHistoryIndex(i));
		}
		const curIdx = this.tcgSeekIndex < 0 ? this.tcgHistory.length - 1 : this.tcgSeekIndex;
		const curTurn = turns[curIdx] || 0;
		let wantTurn: number;
		if (target === 'end' || target === Infinity) {
			this.tcgSeekIndex = -1;
			this.replayTcgSeek(this.tcgHistory.length - 1, false);
			this.skipTcgToEnd();
			return;
		}
		const t = String(target);
		if (t.startsWith('+')) {
			wantTurn = curTurn + (parseInt(t.slice(1), 10) || 1);
		} else if (t.startsWith('-') || (typeof target === 'number' && target < 0)) {
			wantTurn = Math.max(0, curTurn + (typeof target === 'number' ? target : parseInt(t, 10)));
		} else {
			wantTurn = Number(target);
			if (isNaN(wantTurn)) wantTurn = 0;
		}
		let idx = 0;
		for (let i = 0; i < turns.length; i++) {
			if (turns[i] <= wantTurn) idx = i;
			if (turns[i] >= wantTurn && wantTurn > 0) {
				idx = i;
				break;
			}
		}
		if (wantTurn <= 0) idx = 0;
		this.tcgSeekIndex = idx;
		this.replayTcgSeek(idx, false);
	}
	clearTcgLog() {
		this.tcgLastSeq = 0;
		this.tcgChatShown = 0;
		this.tcgLogNeedsIntro = true;
		this.log?.reset();
	}
	logTcgOpening() {
		const snap = this.tcgFxSnapshot?.players ? this.tcgFxSnapshot : this.tcgSnapshot;
		const format = snap?.format;
		const title = tcgFormatTitle(format);
		if (title) this.log?.add(['tier', title]);
		for (const line of tcgOpeningRules(format)) this.log?.add(['rule', line]);
		const a = snap?.players?.[0]?.name;
		const b = snap?.players?.[1]?.name;
		if (a && b) {
			const esc = (s: string) => String(s)
				.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			this.log?.add(['html',
				`Battle started between <strong>${esc(a)}</strong> and <strong>${esc(b)}</strong>!`]);
		}
	}
	replayTcgSeek(throughIndex: number, animate: boolean) {
		this.tcgTurnReplay = false;
		this.tcgPaused = !animate;
		this.tcgPlaying = false;
		this.tcgHalt++;
		this.tcgFxSnapshot = null;
		this.tcgEvents = [];
		this.tcgWait = true;
		this.tcgQueue = [];
		// the live game already logged every line, and seq dedupe would skip them on a second pass
		this.clearTcgLog();
		const mapped = this.tcgReplayItems(animate).slice(0, throughIndex + 1);
		// keep a board on screen. nulling the snapshot unmounts TcgBoard, so the fx clock never starts and the table and
		// chat go empty
		const firstSnap = mapped.find(item => item.snapshot)?.snapshot;
		if (firstSnap) this.tcgSnapshot = firstSnap;
		if (!animate) {
			for (const item of mapped) this.commitTcg(item, false);
			this.update(null);
			return;
		}
		this.tcgQueue = mapped;
		this.pumpTcg();
	}
	historyIndexForTurn(turn: number): number {
		if (!(turn > 0)) return -1;
		for (let i = 0; i < this.tcgHistory.length; i++) {
			const events = this.tcgHistory[i].events || [];
			for (const ev of events) {
				if (ev.type === 'turn' && Number(ev.number) === turn) return i;
			}
		}
		return -1;
	}
	replayTcgFromTurn = (turn: number) => {
		this.useTcgPublicReplay();
		if (!this.tcgHistory.length) return;
		const start = this.historyIndexForTurn(turn);
		if (start < 0) return;
		const through = this.tcgHistory.length - 1;
		this.tcgSeekIndex = -1;
		this.tcgPaused = false;
		this.tcgTurnReplay = false;
		if (this.tcgEnded) this.tcgReplayMode = true;
		this.tcgPlaying = false;
		this.tcgHalt++;
		this.tcgFxSnapshot = null;
		this.tcgEvents = [];
		this.tcgWait = true;
		this.tcgQueue = [];
		this.clearTcgLog();
		const mapped = this.tcgReplayItems(false).slice(0, through + 1);
		const firstSnap = mapped.find(item => item.snapshot)?.snapshot;
		if (firstSnap) this.tcgSnapshot = firstSnap;
		for (const item of mapped.slice(0, start)) this.commitTcg(item, false);
		const rest = mapped.slice(start).map(item => ({
			...item,
			animate: !!item.events?.length && !PS.prefs.noanim,
			turnReplay: true,
		}));
		this.tcgTurnReplay = rest.length > 0;
		this.tcgWait = true;
		if (!rest.length) {
			this.update(null);
			return;
		}
		this.tcgQueue = rest;
		this.pumpTcg();
	};
	buildTcgReplayDownload(): string {
		this.useTcgPublicReplay();
		let snapshot: TcgSnapshot | null = null;
		const events: TcgEvent[] = [];
		let seen = 0;
		for (const item of this.tcgHistory) {
			if (item.snapshot && !snapshot) snapshot = item.snapshot;
			if (item.snapshot && item.snapshot.you == null) snapshot = snapshot || item.snapshot;
			for (const ev of item.events || []) {
				if (typeof ev.seq === 'number') {
					if (ev.seq <= seen) continue;
					seen = ev.seq;
				}
				events.push(ev);
			}
		}
		if (!snapshot) {
			for (let i = this.tcgHistory.length - 1; i >= 0; i--) {
				if (this.tcgHistory[i].snapshot) {
					snapshot = this.tcgHistory[i].snapshot!;
					break;
				}
			}
		}
		const payload = {
			format: this.tcgFormatId(),
			formatName: this.tcgFormatId(),
			p1: this.tcgP1.name,
			p2: this.tcgP2.name,
			winner: this.tcgWinner || '',
			replay: {
				snapshot: snapshot && { ...snapshot, cardNames: { ...snapshot.cardNames, ...cardNamesOfEvents(events) } },
				events,
			},
		};
		return `|tcgreplay|${JSON.stringify(payload)}`;
	}
	loadTcgReplayPayload(raw: string, titleHint?: string, indexTried = false) {
		let body = raw.trim();
		if (body.startsWith('|tcgreplay|')) body = body.slice('|tcgreplay|'.length);
		const data = JSON.parse(body) as {
			format?: string, formatName?: string, p1?: string, p2?: string, winner?: string,
			replay?: { snapshot?: TcgSnapshot, events?: TcgEvent[] },
			snapshot?: TcgSnapshot, events?: TcgEvent[],
		};
		const hosted = spectatorReplayFrom(data);
		const replay = hosted || data.replay || { snapshot: data.snapshot, events: data.events };
		if (!replay?.snapshot) throw new Error('Missing TCG replay snapshot');
		// older replays only have ids, so the current card index names them. the replay opens once that's loaded
		noteTcgCardNames(replay.snapshot);
		const unnamed = unnamedCardIds(eventCardIds(replay.events));
		if (unnamed.length) {
			if (!indexTried && tcgCardIndexStatus() !== 'ready') {
				void loadTcgCardIndex().then(() => this.loadTcgReplayPayload(raw, titleHint, true));
				return;
			}
			const found: { [id: string]: string } = {};
			for (const id of unnamed) {
				const row = getTcgCard(id);
				if (row?.n) found[id] = row.n;
			}
			noteTcgCardNames({ cardNames: found });
		}
		this.tcgMode = true;
		this.tcgReplayMode = true;
		this.tcgEnded = true;
		this.tcgAborted = false;
		this.tcgSide = null;
		this.tcgFormat = replay.snapshot.format;
		this.tcgWinner = data.winner || hosted?.winnerName || null;
		this.tcgP1 = { id: toID(data.p1 || ''), name: data.p1 || 'Player 1' };
		this.tcgP2 = { id: toID(data.p2 || ''), name: data.p2 || 'Player 2' };
		this.title = titleHint ||
			`[${data.formatName || data.format || 'TCG'}] ${this.tcgP1.name} vs. ${this.tcgP2.name}`;
		this.connectMode = null;
		this.connectError = null;
		this.tcgHistory = [{
			snapshot: replay.snapshot,
			events: replay.events || [],
			animate: false,
			wait: false,
			markEnded: true,
			winner: this.tcgWinner,
		}];
		// split events into the batches the game sent them in (each starts with its `act` row), same as a live room, so
		// go to turn and next stop at the same boards. splitting at `turn` rows showed the end of turn N for turn N.
		// keep the opening snapshot on its own payload, commitTcg replaces the board with `item.snapshot` and would drop
		// events bundled with it
		if (replay.events?.length) {
			const chunks: BattleRoom['tcgQueue'] = [{
				snapshot: replay.snapshot,
				events: [],
				animate: false,
				wait: false,
			}];
			const boundary = replay.events.some(ev => ev.type === 'act') ? 'act' : 'turn';
			for (const ev of replay.events) {
				const last = chunks[chunks.length - 1];
				if (ev.type === boundary && last.events?.length) {
					chunks.push({ events: [ev], animate: true, wait: false });
				} else if (last.snapshot && !last.events?.length) {
					chunks.push({ events: [ev], animate: true, wait: false });
				} else {
					(last.events ||= []).push(ev);
				}
			}
			chunks[chunks.length - 1].markEnded = true;
			chunks[chunks.length - 1].winner = this.tcgWinner;
			this.tcgHistory = chunks;
		}
		this.tcgChat = tcgReplayChatFrom((data.replay as { chat?: unknown } | undefined)?.chat);
		this.tcgChatShown = 0;
		this.tcgSeekIndex = -1;
		this.replayTcgSeek(this.tcgHistory.length - 1, false);
		this.update(null);
	}
	/** how long a silent |request| echo waits for its animated |tcg| twin before painting by itself */
	static readonly TCG_ECHO_HOLD_MS = 400;
	enqueueTcg(item: BattleRoom['tcgQueue'][number]) {
		// each batch comes as a silent |request| echo, then the animated |tcg| payload with the same events. if the echo
		// is still queued, let the twin carry the board so the result never paints before its beat
		if (item.animate && item.events?.length && !item.replay) {
			const last = this.tcgQueue[this.tcgQueue.length - 1];
			if (last && !last.animate && last.silent && !last.replay && sameTcgEvents(last.events, item.events)) {
				this.tcgQueue.pop();
				const hist = this.tcgHistory[this.tcgHistory.length - 1];
				if (hist && hist.silent && sameTcgEvents(hist.events, last.events)) this.tcgHistory.pop();
			}
		}
		if (!item.replay) {
			// the backlog only comes once we're logged in, which can be well after the room was built. measure the catch-up
			// window from the first payload so a rejoin never animates
			if (!this.tcgHistory.length) this.tcgSyncUntil = Math.max(this.tcgSyncUntil, Date.now() + 2500);
			this.tcgHistory.push({
				...item,
				events: item.events?.slice(),
			});
		}
		const status = item.snapshot?.status ?? this.tcgSnapshot?.status;
		if (Date.now() < this.tcgSyncUntil && status && status !== 'setup') {
			// catch-up after rejoining a game in progress: write the log, jump the board, no beats. a new game is still in
			// setup here, so its opening beats keep animating
			item.animate = false;
			if (this.tcgPlaying || this.tcgQueue.length) {
				// the backlog's opening beats started before we knew it was a rejoin, drop them and jump to the newest board
				this.tcgQueue.push(item);
				this.skipTcgToEnd();
			} else {
				this.commitTcg(item, false);
			}
			return;
		}
		// a request shouldn't paint the result while an earlier beat is still playing
		if (!item.animate && !this.tcgPlaying && !this.tcgQueue.length) {
			if (item.silent && item.events?.length) {
				this.tcgQueue.push(item);
				this.tcgWait = true;
				window.setTimeout(() => this.pumpTcg(), BattleRoom.TCG_ECHO_HOLD_MS);
				return;
			}
			// who-goes-first often comes as a silent |request| (no events) before the coin |tcg|
			if (!this.tcgOpeningFlipDone && tcgHasChooseFirst(item)) {
				this.tcgQueue.push(item);
				this.tcgWait = true;
				window.setTimeout(() => this.pumpTcg(), BattleRoom.TCG_ECHO_HOLD_MS);
				return;
			}
			this.commitTcg(item, false);
			return;
		}
		this.tcgQueue.push(item);
		// a cpu turn comes as lots of payloads a few hundred ms apart, play every one. jumping the board here dropped
		// the in-between events. the only skip is the player's own click (skipTcgToEnd)
		if (!this.tcgPlaying) this.tcgWait = true;
		this.pumpTcg();
	}
	pumpTcg() {
		if (this.tcgPaused || this.tcgPlaying || !this.tcgQueue.length) {
			if (!this.tcgPlaying && !this.tcgQueue.length) this.tcgTurnReplay = false;
			return;
		}
		const item = this.tcgQueue[0];
		if (this.tcgTurnReplay && !item.turnReplay) this.tcgTurnReplay = false;
		if (!item.animate) {
			if (!this.tcgOpeningFlipDone && tcgHasChooseFirst(item) && !tcgHasOpeningFlip(item.events)) {
				const flipAt = this.tcgQueue.findIndex((q, i) => i > 0 && q.animate && tcgHasOpeningFlip(q.events));
				if (flipAt > 0) {
					const [req] = this.tcgQueue.splice(0, 1);
					this.tcgQueue.splice(flipAt, 0, req);
					this.pumpTcg();
					return;
				}
			}
			this.tcgQueue.shift();
			this.commitTcg(item, false);
			this.pumpTcg();
			return;
		}
		this.tcgPlaying = true;
		// soft batches leave out the board, predict the post-batch state so fx overlays work
		this.tcgFxSnapshot = item.snapshot || (
			this.tcgSnapshot && item.events?.length ?
				applyTcgEvents(this.tcgSnapshot, item.events, item.actions) : null
		);
		// never paint a public watch board for a seated player while their private payload is pending
		const watchBlocked = !item.replay && item.kind === 'watch' && !this.tcgWatchDrivesBoard();
		if (!watchBlocked && tcgHasOpeningFlip(item.events) && !this.tcgOpeningFlipDone) {
			const src = this.tcgSnapshot || item.snapshot;
			if (src && tcgHasChooseFirst({ snapshot: src, actions: item.actions })) {
				this.tcgSnapshot = {
					...src,
					actions: (src.actions || item.actions || []).filter(a => a.type !== 'chooseFirst'),
				};
			} else if (!this.tcgSnapshot && item.snapshot) {
				this.tcgSnapshot = item.snapshot;
			}
		} else if (!this.tcgSnapshot && item.snapshot && !watchBlocked) {
			this.tcgSnapshot = item.snapshot;
		}
		if (!this.tcgSnapshot && !this.tcgFxSnapshot) {
			// no board to animate on, commit right away or replay can stall on a blank table
			this.tcgPlaying = false;
			this.tcgQueue.shift();
			this.commitTcg(item, false);
			this.pumpTcg();
			return;
		}
		const openingFlip = !watchBlocked && tcgHasOpeningFlip(item.events) && !this.tcgOpeningFlipDone;
		const seated = (this.tcgFxSnapshot?.you ?? this.tcgSnapshot?.you ?? this.tcgSide) != null;
		// every batch plays on the board as it was before it, one beat at a time, so each result shows with its
		// animation. that includes the player's own actions. the new choices come with the request beat
		// (`TcgBoard.acts`) and the room commits at the end
		if (this.tcgFxSnapshot && item.actions && this.tcgFxSnapshot.actions !== item.actions) {
			this.tcgFxSnapshot = { ...this.tcgFxSnapshot, actions: item.actions };
		}
		if (this.tcgFxSnapshot) normalizeTcgEnergy(this.tcgFxSnapshot);
		// input waits on the batch's own choices for opening flips, replays, spectators and a batch the other player
		// started (or one that hands you the turn). otherwise on the server's wait flag
		const viewer = this.tcgFxSnapshot?.you ?? this.tcgSnapshot?.you ?? this.tcgSide;
		const holdInput = openingFlip || !!item.replay || this.tcgReplayMode || !seated ||
			tcgInputWaitsOnBatch(item.events, viewer);
		this.tcgEvents = item.events || [];
		this.tcgBeatAt = 0;
		this.tcgFxKey++;
		if (holdInput) {
			// the coin stays locked while "who goes first" is the only choice. setup can be clicked while that animation
			// still plays
			const acts = item.actions || this.tcgSnapshot?.actions || [];
			this.tcgWait = !acts.some(a => a.type !== 'chooseFirst');
		} else if (item.wait != null) this.tcgWait = item.wait;
		else if (item.actions) this.tcgWait = !item.actions.length;
		else this.tcgWait = !this.tcgSnapshot?.actions?.length;
		if (this.tcgTurnReplay) this.tcgWait = true;
		this.update(null);
	}
	dropTcgWatchQueue() {
		this.tcgQueue = this.tcgQueue.filter(item => item.kind !== 'watch');
	}
	noteTcgAbort(reason?: string) {
		this.tcgAborted = true;
		this.tcgEnded = false;
		this.tcgResultShown = false;
		this.tcgReplayMode = false;
		this.tcgWinner = null;
		this.tcgStopReason = reason || this.tcgStopReason || 'The game stopped because a card effect failed.';
	}
	commitTcg(item: BattleRoom['tcgQueue'][number], paced: boolean) {
		// public watch is for spectators, players only use the private sideupdate. local replay still applies those
		// payloads since the seat is filled
		if (!item.replay && item.kind === 'watch' && !this.tcgWatchDrivesBoard()) {
			return;
		}
		if (item.snapshot) {
			if (item.snapshot.format) this.tcgFormat = item.snapshot.format;
			else if (this.tcgFormat) item.snapshot = { ...item.snapshot, format: this.tcgFormat };
			if (item.actions) item.snapshot = { ...item.snapshot, actions: item.actions };
			if (item.snapshot.you == null) {
				if (!item.replay && (this.isTcgPlayer() || this.tcgIsBattleSeat())) return;
				if (!item.replay && !this.tcgReplayMode) {
					item.snapshot = scrubTcgSpectatorView(item.snapshot);
				}
			}
			normalizeTcgEnergy(item.snapshot);
			this.tcgSnapshot = item.snapshot;
			this.noteTcgSeqs(item.events);
			if (item.snapshot.you != null) {
				this.tcgSide = item.snapshot.you;
				if (!item.replay) this.tcgViewpoint = this.tcgSide;
			}
			if (item.snapshot.status === 'over') {
				this.tcgEnded = true;
				this.tcgAborted = false;
				if (this.tcgWinner == null && item.snapshot.winner != null) {
					this.tcgWinner = item.snapshot.players?.[item.snapshot.winner]?.name || null;
				}
			}
			if (item.snapshot.status === 'aborted') {
				this.noteTcgAbort(item.snapshot.winReason);
			}
		} else if (this.tcgSnapshot) {
			this.tcgSnapshot = applyTcgEvents(this.tcgSnapshot, item.events, item.actions);
			this.noteTcgSeqs(item.events);
		}
		if (item.markEnded) this.tcgEnded = true;
		if (this.tcgSnapshot?.status === 'aborted') this.noteTcgAbort(this.tcgSnapshot.winReason);
		if (item.winner !== undefined) this.tcgWinner = item.winner;
		if (item.wait != null) this.tcgWait = item.wait;
		else if (item.actions) this.tcgWait = !item.actions.length;
		else if (this.tcgSnapshot) this.tcgWait = !this.tcgSnapshot.actions?.length;
		if (tcgHasOpeningFlip(item.events)) this.tcgOpeningFlipDone = true;
		else if (tcgHasChooseFirst(item) && !this.tcgQueue.some(q => q.animate && tcgHasOpeningFlip(q.events))) {
			this.tcgOpeningFlipDone = true;
		}
		// a playing replay writes each line when its beat starts. an instant seek has no beats, so write the lines here
		if (!paced && item.events?.length && (!item.silent || item.replay)) {
			for (const ev of item.events) this.revealTcgEvent(ev, item.events);
		}
		this.noteTcgReplayAt(item);
		this.tcgFxSnapshot = null;
		this.updateChoiceNotification();
		this.update(null);
	}
	requestTcgResync() {
		this.tcgResyncRetry.request();
	}
	tcgResyncDone() {
		this.tcgResyncRetry.cancel();
	}
	/** a committed batch shouldn't be applied again when its animated twin arrives */
	noteTcgSeqs(events?: TcgEvent[]) {
		if (!events) return;
		for (const ev of events) {
			if (typeof ev.seq === 'number' && ev.seq > this.tcgSeqSeen) this.tcgSeqSeen = ev.seq;
		}
	}
	revealTcgEvent(ev: TcgEvent, batch?: TcgEvent[]) {
		this.revealTcgEventLine(ev, batch);
		if (typeof ev.seq === 'number') this.showTcgChatThrough(ev.seq);
	}
	showTcgChatThrough(seq: number) {
		while (this.tcgChatShown < this.tcgChat.length && this.tcgChat[this.tcgChatShown].after <= seq) {
			this.log?.add(this.tcgChat[this.tcgChatShown++].args);
		}
	}
	addTcgChat(args: Args) {
		const caughtUp = this.tcgChatShown === this.tcgChat.length;
		this.tcgChat.push({ after: this.tcgSeqSeen, args });
		if (caughtUp) {
			this.tcgChatShown++;
			this.log?.add(args);
		}
	}
	revealTcgEventLine(ev: TcgEvent, batch: TcgEvent[] = this.tcgEvents) {
		noteTcgMons(this.tcgSnapshot?.players);
		noteTcgMons(this.tcgFxSnapshot?.players);
		noteTcgCardNames(this.tcgSnapshot);
		if (typeof ev.seq === 'number' && ev.seq <= this.tcgLastSeq) return;
		if (typeof ev.seq === 'number') this.tcgLastSeq = Math.max(this.tcgLastSeq, ev.seq);
		if (ev.type === 'start') {
			if (this.tcgLogNeedsIntro) this.logTcgOpening();
			this.tcgLogNeedsIntro = false;
			return;
		}
		const players = this.tcgFxSnapshot?.players || this.tcgSnapshot?.players;
		const entry = chatEntryForEvent(
			ev, players, this.tcgFxSnapshot || this.tcgSnapshot, batch
		);
		if (!entry) return;
		if (ev.type === 'turn') {
			const esc = (s: string) => String(s || '')
				.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			const n = Number(ev.number) || 0;
			if (this.log) this.log.onTcgTurnPlay = this.replayTcgFromTurn;
			const play = n > 0 ?
				`<button type="button" class="button small tcg-turn-play" name="tcgTurnPlay" value="${n}" title="Replay from turn ${n}" aria-label="Replay from turn ${n}"><i class="fa fa-play" aria-hidden="true"></i></button>` :
				'';
			this.log?.add(['html',
				`<h2 class="battle-history tcg-turn-head">${play}Turn ${n || '?'}: ${esc(entry.text)}</h2>`]);
			return;
		}
		this.log?.add(['html', chatHtmlForEntry(entry)]);
	}
	onTcgEvent = (ev: TcgEvent) => {
		const at = this.tcgEvents.indexOf(ev);
		if (at >= this.tcgBeatAt) this.tcgBeatAt = at + 1;
		this.revealTcgEvent(ev);
		if (ev.type === 'over') {
			this.tcgResultShown = true;
			if (this.tcgWinner == null && !ev.tie) {
				const named = typeof ev.winnerName === 'string' ? ev.winnerName : '';
				const seat = typeof ev.winner === 'number' ? ev.winner : null;
				this.tcgWinner = named || (seat != null ? this.tcgSnapshot?.players?.[seat]?.name || null : null);
			}
		}
		this.update(null);
	};
	/** every beat plays at full length however many queue up (a fast cpu turn). the board offers skip instead */
	tcgAnimating(): boolean {
		return this.tcgPlaying || this.tcgQueue.length > 0;
	}
	/** @returns whether another beat started */
	onTcgFxDone = (halt?: number) => {
		// the board's beat timer can fire after a seek or a new play replaced the queue, before it saw the new
		// `tcgHalt`. that beat is from the old queue, taking it would drop the first payload of the new one
		if (halt != null && halt !== this.tcgHalt) return this.tcgPlaying;
		const item = this.tcgQueue.shift();
		this.tcgPlaying = false;
		if (item && !item.painted) this.commitTcg(item, true);
		else if (item?.events?.length) {
			for (const ev of item.events) this.revealTcgEvent(ev, item.events);
		}
		if (item?.painted) this.noteTcgReplayAt(item);
		if (!this.tcgPaused) this.pumpTcg();
		if (!this.tcgPlaying) this.tcgTurnReplay = false;
		return this.tcgPlaying;
	};
	toggleTcgPause = () => {
		this.tcgPaused = !this.tcgPaused;
		if (!this.tcgPaused) this.pumpTcg();
		else this.update(null);
	};
	skipTcgToEnd = () => {
		this.tcgPaused = false;
		this.tcgTurnReplay = false;
		const pending = this.tcgQueue.slice();
		this.tcgQueue = [];
		this.tcgPlaying = false;
		this.tcgHalt++;
		const flipping = tcgHasOpeningFlip(this.tcgEvents) || pending.some(q => tcgHasOpeningFlip(q.events));
		const pastSetup = this.tcgSnapshot?.status === 'playing' || this.tcgSnapshot?.status === 'over';
		if (flipping || pastSetup) this.tcgOpeningFlipDone = true;
		if (pending.length) {
			for (const item of pending) this.commitTcg(item, false);
		} else {
			this.update(null);
		}
	};
	replayTcg = () => {
		this.useTcgPublicReplay();
		if (!this.tcgHistory.length) return;
		this.tcgSeekIndex = -1;
		this.tcgPaused = false;
		if (this.tcgEnded) this.tcgReplayMode = true;
		this.replayTcgSeek(this.tcgHistory.length - 1, true);
	};

	override destroy() {
		this.tcgResyncRetry.cancel();
		this.request = null;
		this.choices = null;
		super.destroy();
	}

	loadReplay() {
		const replayid = this.id.slice(7);
		const tcg = isTcgBattleId(this.id) || this.tcgMode;
		const urls = tcg ? [] as string[] : [
			`https://${Config.routes.replays}/${replayid}.json`,
			`https://replay.pokemonshowdown.com/${replayid}.json`,
		];
		if (tcg && PS.server?.host) {
			const proto = PS.server.protocol === 'http' ? 'http' : 'https';
			const port = PS.server.httpport || (proto === 'http' ? PS.server.port : 0);
			const origin = `${proto}://${PS.server.host}${port && port !== 80 && port !== 443 ? `:${port}` : ''}`;
			urls.push(`${origin}/replay/${replayid}.json`);
		}
		if (tcg) {
			urls.push(`/replay/${replayid}.json`);
			if (Config.routes?.client) urls.push(`https://${Config.routes.client}/replay/${replayid}.json`);
		}
		const tryFetch = (i: number): Promise<string> =>
			Net(urls[i]).get().then(data => {
				const body = String(data || '').trim();
				if (body.startsWith('{') || body.startsWith('[')) return body;
				if (i + 1 < urls.length) return tryFetch(i + 1);
				return '';
			}).catch(() => (i + 1 < urls.length ? tryFetch(i + 1) : ''));
		tryFetch(0).then(data => {
			try {
				const replay = JSON.parse(data);
				const log = String(replay.log || '');
				if (isTcgBattleId(this.id) || log.includes('|tcgreplay|') || /^\s*\{/.test(log)) {
					this.tcgMode = true;
					const marker = log.indexOf('|tcgreplay|');
					const raw = marker >= 0 ? log.slice(marker) :
						/^\s*\{/.test(log) ? log : '';
					if (!raw) throw new Error('no tcg replay');
					this.connectMode = null;
					this.connectError = null;
					this.loadTcgReplayPayload(raw, `[${replay.format}] ${replay.players?.join(' vs. ') || ''}`);
					return;
				}
				if (!this.battle) {
					this.connectError = `Battle "${replayid}" not found`;
					this.update(null);
					return;
				}
				this.title = `[${replay.format}] ${replay.players.join(' vs. ')}`;
				this.battle.stepQueue = log.split('\n');
				this.battle.atQueueEnd = false;
				this.battle.pause();
				this.battle.seekTurn(0);
				this.connectMode = null;
				this.connectError = null;
				this.update(null);
			} catch {
				this.connectError = `Battle "${replayid}" not found`;
				if (this.battle?.stepQueue && !this.battle.stepQueue.length) {
					this.battle.scene.message(
						`<div class="broadcast-red pad"><strong>${BattleLog.escapeHTML(this.connectError)}</strong></div><br />` +
						`${TL`The battle you're looking for has expired. Battles expire after 15 minutes of inactivity unless they're saved.`}<br /><br />` +
						TL`In the future, remember to click "Save replay" to save a replay permanently.`
					);
				}
				this.update(null);
			}
		});
	}
}

class BattleDiv extends preact.Component<{ room: BattleRoom }> {
	override shouldComponentUpdate() {
		return false;
	}
	override componentDidMount() {
		const room = this.props.room;
		if (room.battle) {
			this.base!.replaceChild(room.battle.scene.$frame![0], this.base!.firstChild!);
		}
	}
	override render() {
		return <div><div class="battle"></div></div>;
	}
}

class TimerButton extends preact.Component<{ room: BattleRoom, top: number, inline?: boolean }> {
	timerInterval: number | null = null;
	override componentWillUnmount() {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
	}
	secondsToTime(seconds: number | true) {
		if (seconds === true) return '-:--';
		const minutes = Math.floor(seconds / 60);
		seconds -= minutes * 60;
		return `${minutes}:${(seconds < 10 ? '0' : '')}${seconds}`;
	}
	kicking(room: BattleRoom) {
		return room.tcgMode ? room.tcgKickingInactive : room.battle?.kickingInactive;
	}
	render() {
		let time = TL`Timer`;
		const room = this.props.room;
		const kicking = this.kicking(room);
		if (!this.timerInterval && kicking) {
			this.timerInterval = setInterval(() => {
				if (room.tcgMode) {
					// same as PS: only tick while you still have a choice to make
					if (room.tcgWait || room.tcgEnded) return;
					if (typeof room.tcgKickingInactive === 'number' && room.tcgKickingInactive > 1) {
						room.tcgKickingInactive--;
						if (room.tcgGraceTimeLeft) room.tcgGraceTimeLeft--;
						else if (room.tcgTotalTimeLeft) room.tcgTotalTimeLeft--;
					}
				} else {
					if (room.choices?.isDone()) return;
					if (typeof room.battle.kickingInactive === 'number' && room.battle.kickingInactive > 1) {
						room.battle.kickingInactive--;
						if (room.battle.graceTimeLeft) room.battle.graceTimeLeft--;
						else if (room.battle.totalTimeLeft) room.battle.totalTimeLeft--;
					}
				}
				this.forceUpdate();
			}, 1000);
		} else if (this.timerInterval && !kicking) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}

		let timerTicking = '';
		if (room.tcgMode) {
			timerTicking = (room.tcgKickingInactive && room.isTcgPlayer() && !room.tcgWait && !room.tcgEnded) ?
				' timerbutton-on' : '';
		} else {
			timerTicking = (room.battle.kickingInactive &&
				room.request && room.request.requestType !== "wait" && (room.choices && !room.choices.isDone())) ?
				' timerbutton-on' : '';
		}

		if (kicking) {
			const secondsLeft = kicking;
			time = this.secondsToTime(secondsLeft);
			if (secondsLeft !== true) {
				if ((secondsLeft) <= 10 && timerTicking) {
					timerTicking = ' timerbutton-critical';
				}
				const total = room.tcgMode ? room.tcgTotalTimeLeft : room.battle?.totalTimeLeft;
				if (total) {
					// compact on the tcg hud so a long "total" line doesn't cover the turn badge
					time += this.props.inline ?
						` / ${this.secondsToTime(total)}` :
						` |  ${this.secondsToTime(total)} total`;
				}
			}
		}

		return <button
			style={this.props.inline ? undefined : { position: "absolute", right: '10px', top: `${this.props.top}px` }}
			data-href="battletimer" class={`button timerbutton${timerTicking}`} role="timer"
			title={this.props.inline && kicking && typeof kicking === 'number' ?
				`Turn ${this.secondsToTime(kicking)}${room.tcgTotalTimeLeft ? `, total ${this.secondsToTime(room.tcgTotalTimeLeft)}` : ''}` :
				undefined}
		>
			<i class="fa fa-hourglass-start" aria-hidden></i> {time}
		</button>;
	}
};

class BattlePanel extends PSRoomPanel<BattleRoom> {
	static readonly id = 'battle';
	static readonly routes = ['battle-*', 'game-*'];
	static readonly Model = BattleRoom;
	static getTitle(room: PSRoom) {
		const { battle, title } = room as BattleRoom;
		if (title === 'Uploaded replay') return TL`Uploaded replay`;

		const p1 = battle?.sides[0]?.name;
		const p2 = battle?.sides[1]?.name;
		if (!p1 || !p2) return title;

		const [, prefix = '', mainTitle] = /^(\[[^\]]*\] )?([^]*)$/.exec(title)!;
		if (battle.gameType === 'multi' && mainTitle === `Team ${p1} vs. Team ${p2}`) {
			const player1 = TL`Team ${p1}`;
			const player2 = TL`Team ${p2}`;
			return prefix + TL`${player1} vs. ${player2}`;
		} else if (battle.gameType === 'freeforall' && mainTitle === `${p1} and friends`) {
			return prefix + TL`${p1} and friends`;
		} else if (mainTitle === `${p1} vs. ${p2}`) {
			return prefix + TL`${p1} vs. ${p2}`;
		}
		return title;
	}
	static handleDrop(ev: DragEvent) {
		const file = ev.dataTransfer?.files?.[0];
		if (!file) return;
		const isJson = file.type === 'application/json' || /\.json$/i.test(file.name);
		const isHtml = file.type === 'text/html' || /\.html?$/i.test(file.name);
		if (isJson) {
			let roomNum = 1;
			for (; roomNum < 100; roomNum++) {
				if (!PS.rooms[`battle-tcguploaded-${roomNum}`]) break;
			}
			file.text().then(text => {
				try {
					const id = `battle-tcguploaded-${roomNum}` as RoomID;
					PS.join(id);
					const room = PS.rooms[id] as BattleRoom;
					if (!room) return;
					room.tcgMode = true;
					room.connectMode = null;
					const raw = text.includes('|tcgreplay|') ? text :
						`|tcgreplay|${text.trim().startsWith('{') ? text : JSON.stringify(JSON.parse(text))}`;
					room.loadTcgReplayPayload(raw, file.name.replace(/\.json$/i, ''));
				} catch (err) {
					PS.alert(`Unrecognized TCG replay JSON: ${String(err)}`);
				}
			});
			return true;
		}
		if (isHtml) {
			let roomNum = 1;
			for (; roomNum < 100; roomNum++) {
				if (!PS.rooms[`battle-uploaded-${roomNum}`]) break;
			}
			file.text().then(html => {
				const titleStart = html.indexOf('<title>');
				const titleEnd = html.indexOf('</title>');
				let title = 'Uploaded replay';
				if (titleStart >= 0 && titleEnd > titleStart) {
					title = html.slice(titleStart + 7, titleEnd - 1);
					const colonIndex = title.indexOf(':');
					const hyphenIndex = title.lastIndexOf('-');
					if (hyphenIndex > colonIndex + 2) {
						title = title.substring(colonIndex + 2, hyphenIndex - 1);
					} else {
						title = title.substring(colonIndex + 2);
					}
				}
				const index1 = html.indexOf('<script type="text/plain" class="battle-log-data">');
				const index2 = html.indexOf('<script type="text/plain" class="log">');
				if (index1 < 0 && index2 < 0) {
					PS.alert(TL`Unrecognized HTML file: Only replay files are supported.`);
					return;
				}
				if (index1 >= 0) {
					html = html.slice(index1 + 50);
				} else if (index2 >= 0) {
					html = html.slice(index2 + 38);
				}
				const index3 = html.indexOf('</script>');
				html = html.slice(0, index3);
				html = html.replace(/\\\//g, '/');

				PS.join(`battle-uploaded-${roomNum}` as RoomID);
				const room = PS.rooms[`battle-uploaded-${roomNum}`] as BattleRoom;
				if (!room) return;

				room.title = title;
				room.connectMode = null;
				PS.receive(`>battle-uploaded-${roomNum}\n${html}`);
			});
			return true;
		}
	}
	renderUIText(id: string, values?: { [placeholder: string]: string | undefined }) {
		return <span
			dangerouslySetInnerHTML={{
				__html: BattleLog.parseLogMessage(BattleTextParser.ui(id, values))[0],
			}}
		></span>;
	}
	/** last displayed team. will not show the most recent request until the last one is gone. */
	team: ServerPokemon[] | null = null;
	mobileChatShown = false;
	showMobileChat = () => {
		this.mobileChatShown = true;
		this.forceUpdate();
	};
	showMobileBattle = () => {
		this.mobileChatShown = false;
		this.forceUpdate();
	};
	send = (text: string, elem?: HTMLElement) => {
		this.props.room.send(text, elem);
	};
	focusIfNoSelection = () => {
		if (window.getSelection?.()?.type === 'Range') return;
		this.focus();
	};
	onKey = (e: KeyboardEvent) => {
		if (e.keyCode === 33) { // Pg Up key
			const chatLog = this.base!.getElementsByClassName('chat-log')[0] as HTMLDivElement;
			chatLog.scrollTop = chatLog.scrollTop - chatLog.offsetHeight + 60;
			return true;
		} else if (e.keyCode === 34) { // Pg Dn key
			const chatLog = this.base!.getElementsByClassName('chat-log')[0] as HTMLDivElement;
			chatLog.scrollTop = chatLog.scrollTop + chatLog.offsetHeight - 60;
			return true;
		}
		return false;
	};
	toggleBoostedMove = (e: Event) => {
		const checkbox = e.currentTarget as HTMLInputElement;
		const choices = this.props.room.choices;
		if (!choices) return; // shouldn't happen
		switch (checkbox.name) {
		case 'mega':
			choices.current.mega = checkbox.checked;
			break;
		case 'megax':
			choices.current.megax = checkbox.checked;
			choices.current.megay = false;
			break;
		case 'megay':
			choices.current.megay = checkbox.checked;
			choices.current.megax = false;
			break;
		case 'ultra':
			choices.current.ultra = checkbox.checked;
			break;
		case 'z':
			choices.current.z = checkbox.checked;
			break;
		case 'max':
			choices.current.max = checkbox.checked;
			break;
		case 'tera':
			choices.current.tera = checkbox.checked;
			break;
		}
		this.props.room.update(null);
	};
	override componentDidMount() {
		const room = this.props.room;
		if (room.tcgMode || isTcgBattleId(room.id)) {
			room.tcgMode = true;
			const logEl = this.base!.querySelector<HTMLDivElement>('.battle-log');
			if (logEl) {
				room.log ||= new BattleLog(logEl);
				room.log.getHighlight = room.handleHighlight;
				room.log.onTcgTurnPlay = room.replayTcgFromTurn;
			}
			if (room.backlog) {
				const backlog = room.backlog;
				room.backlog = null;
				for (const line of backlog) this.receiveTcgLine(line);
			}
			super.componentDidMount();
			if (!room.log && room.tcgNotice) this.forceUpdate();
			return;
		}
		const $elem = $(this.base!);
		const battle = (room.battle ||= new Battle({
			id: room.id as any,
			$frame: $elem.find('.battle'),
			$logFrame: $elem.find('.battle-log'),
		}));
		const scene = battle.scene as BattleScene;
		room.log = scene.log;
		room.log.getHighlight = room.handleHighlight;
		room.log.isIgnored = room.isIgnored;
		scene.tooltips.unlisten(scene.$frame);
		scene.tooltips.listen(this.base!);
		battle.subscribe(() => this.forceUpdate());
		room.onRequest = request => (this as any).receiveRequest(request); // showdex compat
		room.receiveBatch([]);
		super.componentDidMount();
		this.forceUpdate();
		if (!PS.prefs.spectatefromstart) battle.seekTurn(Infinity);
		if (PS.prefs.autohardcore) {
			battle.setHardcoreMode(true);
		}
	}
	override componentWillUnmount() {
		this.props.room.onRequest = null;
		const scene = this.props.room.battle?.scene as BattleScene | undefined;
		if (this.base) scene?.tooltips.unlisten(this.base);
		super.componentWillUnmount();
	}
	battleHeight = 360;
	updateLayout() {
		if (!this.base) return;
		const room = this.props.room;
		if (!room.width) return;
		const { battleHeight } = this.chooseLayout();
		this.battleHeight = battleHeight;
		if (battleHeight !== 360) {
			room.battle?.scene.$frame!.css('transform', `scale(${battleHeight / 360})`);
		} else {
			room.battle?.scene.$frame!.css('transform', 'none');
		}
	}
	chooseLayout(): {
		layout: BattlePanelLayout,
		battleHeight: number,
		battleWidth: number,
		overlayControls: boolean,
	} {
		const room = this.props.room;
		return PS.chooseBattleLayout(room.width, room.height, PS.prefs.battlelayout);
	}
	fastForwardIfRejoining() {
		const room = this.props.room;
		if (!room.rejoining || !room.side) return;
		room.rejoining = false;
		room.battle.seekTurn(Infinity);
	}
	override receiveLine(args: Args) {
		const room = this.props.room;
		if (room.tcgMode || args[0] === 'tcg' || (args[0] === 'request' && requestMarksTcgRoom(args[1]))) {
			room.tcgMode = true;
			this.receiveTcgLine(args);
			return;
		}
		switch (args[0]) {
		case 'cantleave':
			room.requireForfeit = true;
			return;
		case 'allowleave':
			room.requireForfeit = false;
			return;
		case 'initdone':
			if (!PS.prefs.spectatefromstart) room.battle.seekTurn(Infinity);
			return;
		case 'request':
			this.receiveRequest(args[1] ? JSON.parse(args[1]) : null);
			return;
		case 'win': case 'tie':
			this.receiveRequest(null);
			break;
		case 'c': case 'c:': case 'chat': case 'chatmsg': case 'inactive':
			room.battle.instantAdd('|' + args.join('|'));
			return;
		case 'error':
			if (args[1].startsWith('[Invalid choice]') && room.request) {
				room.choices = new BattleChoiceBuilder(room.request);
				room.updateChoiceNotification();
				room.update(null);
			}
			break;
		case 'sentchoice':
			if (room.request) {
				let choices = new BattleChoiceBuilder(room.request);
				const possibleError = choices.addChoices(args[1]);
				if (possibleError || !choices.isDone()) {
					choices = new BattleChoiceBuilder(room.request);
					choices.serializedChoice = args[1];
				}
				room.choices = choices;
			}
			room.updateChoiceNotification();
			room.update(null);
			return;
		}
		room.battle.add('|' + args.join('|'));
		if (PS.prefs.noanim) this.props.room.battle.seekTurn(Infinity);
	}
	rejectMalformedTcg(room: BattleRoom) {
		const message = 'Ignored a malformed |tcg| message.';
		if (room.log) {
			room.log.add(['error', message]);
			return;
		}
		room.tcgNotice = message;
		room.tcgNoticeN++;
		room.update(null);
	}
	receiveTcgLine(args: Args) {
		const room = this.props.room;
		switch (args[0]) {
		case 'tcg': {
			let data: any;
			try {
				data = JSON.parse(args[1] || '{}');
			} catch (err) {
				if (!(err instanceof SyntaxError)) throw err;
				this.rejectMalformedTcg(room);
				return;
			}
			this.applyTcgPayload(data);
			return;
		}
		case 'request':
			if (!args[1]) return;
			try {
				const data = JSON.parse(args[1]) as {
					tcg?: boolean, events?: TcgEvent[], snapshot?: TcgSnapshot, wait?: boolean, actions?: TcgAction[],
				};
				if (data.tcg && data.wait != null) {
					// Go First stays hidden till the opening coin finishes, any later choice can be clicked during an animation
					const opening = room.tcgPlaying && !room.tcgOpeningFlipDone && !data.wait;
					if (!opening) {
						if (!data.wait) room.tcgWait = false;
						else {
							const you = room.tcgSnapshot?.you;
							const stillMine = you != null && !!(room.tcgSnapshot?.actions || []).length &&
								(room.tcgSnapshot?.status !== 'playing' || room.tcgSnapshot.turn === you);
							if (!stillMine) room.tcgWait = true;
						}
						room.update(null);
					}
				}
				// slim |request| is timer-only (wait). fat echoes from older servers still apply silently
				if (!data.events?.length && !data.snapshot) return;
				this.applyTcgPayload(data, true);
			} catch {}
			return;
		case 'player': {
			// |player|p1|Name|avatar|rating|
			const side = args[1] || '';
			const name = args[2] || '';
			const idx = side === 'p1' ? 0 : side === 'p2' ? 1 : null;
			if (name && idx === 0) room.tcgP1 = { id: toID(name), name };
			if (name && idx === 1) room.tcgP2 = { id: toID(name), name };
			if (name && room.tcgSnapshot?.players && idx !== null && room.tcgSnapshot.players[idx]) {
				room.tcgSnapshot.players[idx].name = name;
				room.update(null);
			}
			return;
		}
		case 'inactive': {
			const msg = args[1] || '';
			if (!msg.startsWith('Time left: ')) room.log?.add(args);
			if (msg.startsWith('Time left: ')) {
				const [time, totalTime, graceTime] = msg.split(' | ');
				room.tcgKickingInactive = parseInt(time.slice(11), 10) || true;
				room.tcgTotalTimeLeft = parseInt(totalTime || '', 10) || 0;
				room.tcgGraceTimeLeft = parseInt(graceTime || '', 10) || 0;
				if (room.tcgTotalTimeLeft === room.tcgKickingInactive) room.tcgTotalTimeLeft = 0;
			} else if (msg.startsWith('You have ')) {
				room.tcgKickingInactive = parseInt(msg.slice(9), 10) || true;
			} else if (msg.includes('Battle timer is ON')) {
				room.tcgKickingInactive = true;
			} else if (msg.endsWith(' seconds left this turn.') || msg.endsWith(' seconds left.')) {
				const hasIndex = msg.indexOf(' has ');
				if (hasIndex >= 0 && toID(msg.slice(0, hasIndex)) === PS.user.userid) {
					room.tcgKickingInactive = parseInt(msg.slice(hasIndex + 5), 10) || true;
				}
			}
			room.update(null);
			return;
		}
		case 'inactiveoff':
			room.tcgKickingInactive = false;
			room.log?.add(args);
			room.update(null);
			return;
		case 'win': case 'tie': {
			const winnerName = args[0] === 'win' ? (args[1] || '').trim() : '';
			const endingAlready = room.tcgEnded ||
				room.tcgEvents.some(ev => ev.type === 'over') ||
				room.tcgQueue.some(item => item.markEnded || item.events?.some(ev => ev.type === 'over'));
			if (endingAlready) {
				if (args[0] === 'win' && winnerName && !room.tcgWinner) room.tcgWinner = winnerName;
				room.update(null);
				return;
			}
			room.enqueueTcg({
				animate: !PS.prefs.noanim,
				markEnded: true,
				winner: args[0] === 'tie' ? null : (winnerName || null),
				events: [{
					seq: room.tcgLastSeq + 1,
					type: 'over',
					reason: args[0] === 'tie' || !winnerName ?
						'The battle ended in a draw.' :
						`${winnerName} won the battle!`,
					winnerName: winnerName || undefined,
					tie: args[0] === 'tie' || !winnerName,
				}],
			});
			return;
		}
		case 'html': case 'raw': case 'c': case 'c:': case 'chat': case 'chatmsg':
		case 'error': case 'bigerror': case 'tier':
			if (args[0] === 'error' && /not your turn/i.test(args[1] || '')) {
				room.tcgWait = false;
				room.tcgNotice = 'Wait for your turn';
				room.tcgNoticeN++;
				room.update(null);
				return;
			}
			if (isTcgChatLine(args[0], room.tcgSeqSeen > 0)) room.addTcgChat(args);
			else room.log?.add(args);
			if (args[0] === 'error' && /invalid choice/i.test(args[1] || '')) {
				// the server refused the play and nothing changed. show why on the board too (a phone might not show the log)
				// and give the controls back
				room.tcgWait = false;
				room.tcgNotice = tcgRefusalText(args[1] || '');
				room.tcgNoticeN++;
				room.update(null);
			}
			return;
		case 'cantleave':
			room.requireForfeit = true;
			return;
		case 'allowleave':
			room.requireForfeit = false;
			return;
		case '-message':
			room.log?.add(['chatmsg', args.slice(1).join('|')]);
			return;
		case 'turn':
			return;
		case 'title':
			if (args[1]) room.title = args[1];
			PS.update();
			return;
		}
		if (args[0] && !['init', 'request', 'done', ''].includes(args[0])) {
			if (isTcgChatLine(args[0], room.tcgSeqSeen > 0)) room.addTcgChat(args);
			else room.log?.add(args);
		}
	}
	applyTcgPayload(data: {
		tcg?: boolean, kind?: string, wait?: boolean, seq?: number, resync?: boolean,
		snapshot?: TcgSnapshot, events?: TcgEvent[], actions?: TcgAction[], cardNames?: { [id: string]: string },
	}, skipFx = false) {
		const room = this.props.room;
		if (!data) return;
		// card names this batch mentions, so a batch with no board still logs names, not ids
		if (data.cardNames) noteTcgCardNames({ cardNames: data.cardNames });
		if (data.snapshot?.players?.[0]?.name) {
			room.tcgP1 = {
				id: toID(data.snapshot.players[0].id || data.snapshot.players[0].name),
				name: data.snapshot.players[0].name,
			};
		}
		if (data.snapshot?.players?.[1]?.name) {
			room.tcgP2 = {
				id: toID(data.snapshot.players[1].id || data.snapshot.players[1].name),
				name: data.snapshot.players[1].name,
			};
		}
		if (data.resync) {
			const board = room.tcgSnapshot;
			room.tcgApplyIdentityResync(data.kind === 'you' ? 'you' : 'watch');
			// a login/connect resync often comes while the opening deal and coin still animate. applying it with
			// skipTcgToEnd() wiped out the coin toss, so in setup keep the live fx and only jump when catching up mid-game
			if (data.snapshot?.you != null) {
				room.tcgSide = data.snapshot.you;
				room.tcgViewpoint = room.tcgSide;
				room.tcgAwaitingPrivate = false;
			}
			const animating = room.tcgPlaying || room.tcgQueue.length > 0;
			if (tcgDropSetupResync(board, animating, room.tcgResyncAt != null, data)) return;
		}
		// like normal battles: everyone gets the public log, secrets only come on sideupdate. `watch` on update, `you`
		// on sideupdate. spectators drive the board from watch, seat holders only apply `you`. never let watch use up
		// tcgSeqSeen for a seat, that deleted the coin toss from the next private batch
		if (data.kind === 'watch' && !room.tcgWatchDrivesBoard()) {
			room.noteTcgPublicPayload(data);
			return;
		}
		// an event ahead of the next one means a batch never arrived. apply none of this one, the resync snapshot brings
		// back the board and the sequence
		const gate = tcgSeqGate(room, {
			events: data.events, seq: data.seq, snapshot: !!data.snapshot, resync: !!data.resync,
		}, skipFx);
		if (gate.drop) return;
		if (data.kind === 'you') {
			if (room.tcgPlaying && room.tcgQueue[0]?.kind === 'watch') {
				room.tcgHalt++;
				room.tcgPlaying = false;
				room.tcgQueue.shift();
				room.tcgFxSnapshot = null;
				room.tcgEvents = [];
			}
			room.dropTcgWatchQueue();
		}
		if (data.snapshot) {
			if (data.snapshot.format) room.tcgFormat = data.snapshot.format;
			else if (room.tcgFormat) data.snapshot = { ...data.snapshot, format: room.tcgFormat };
			// only scrub real spectator snapshots, never because a field is missing on a soft `you` batch
			if (!room.tcgReplayMode && (data.kind === 'watch' || (data.kind !== 'you' && data.snapshot.you == null))) {
				data.snapshot = scrubTcgSpectatorView(data.snapshot);
			}
		}
		if (data.snapshot && !data.snapshot.format?.energyZone &&
			!data.snapshot.players?.some(p => p?.energyZone)) {
			loadPaperNames();
		}
		if (data.snapshot?.you != null) {
			room.tcgSide = data.snapshot.you;
			room.tcgViewpoint = room.tcgSide;
			room.tcgAwaitingPrivate = false;
		}
		const viewerSeat: 0 | 1 | null = data.kind === 'watch' ? null :
			(data.snapshot?.you ?? room.tcgSide ?? room.tcgSnapshot?.you ?? null);
		const seatedPayload = data.kind === 'you' || viewerSeat != null;
		const actions = seatedPayload ?
			(data.actions ?? data.snapshot?.actions) :
			(data.actions ?? data.snapshot?.actions ?? []);
		const events = room.tcgReplayMode ? (data.events || []) : (seatedPayload ?
			(viewerSeat != null ? filterTcgEventsForViewer(data.events, viewerSeat) : data.events) :
			filterTcgEventsForViewer(data.events, null));
		const wait = data.wait != null ? data.wait :
			(actions ? !actions.length : (data.snapshot ? !data.snapshot.actions?.length : undefined));
		const aborted = data.snapshot?.status === 'aborted';
		const ended = !aborted && (data.snapshot?.status === 'over' ||
			!!data.events?.some(ev => ev.type === 'over'));
		let winner: string | null | undefined;
		if (ended && data.snapshot?.winner != null) {
			winner = data.snapshot.players?.[data.snapshot.winner]?.name || null;
		}
		if (ended && winner == null) {
			const over = data.events?.find(ev => ev.type === 'over');
			if (over?.winner != null && room.tcgSnapshot?.players) {
				winner = room.tcgSnapshot.players[over.winner as number]?.name || null;
			}
		}
		// the server can send the same batch twice (the opening |tcg| gets repeated), so animate each event once. the
		// silent |request| echo never animates, so it isn't counted
		const fresh = tcgFreshEvents(room, events, skipFx);
		// the payload's own rows were counted above, the resync snapshot also covers rows it doesn't list
		if (gate.seqAfter > room.tcgSeqSeen) room.tcgSeqSeen = gate.seqAfter;
		const setupEvents = this.hideSetupPlacements(data.snapshot, fresh);
		room.enqueueTcg({
			snapshot: data.snapshot,
			events: setupEvents,
			actions,
			wait,
			// only animate when this payload still has beats, empty after seq dedupe shouldn't stall the fx
			animate: !skipFx && !!setupEvents?.length && !PS.prefs.noanim,
			silent: skipFx,
			markEnded: ended || undefined,
			winner,
			kind: data.kind,
		});
		// a reconnect snapshot jumps to the live board, but a cpu turn's own snapshot still has to play. skipping it
		// dropped the beats in between
		const catchUp = !!data.resync && !!data.snapshot && data.snapshot.status !== 'setup' &&
			(room.tcgPlaying || room.tcgQueue.length > 1);
		if (catchUp) {
			room.skipTcgToEnd();
		}
	}
	/**
	 * official rules: opening active and bench pokemon go down face down and only flip once both players are ready.
	 * the sim still names the other seat's card in setup `place` events, so strip it here and show a card back
	 */
	hideSetupPlacements(snapshot: TcgSnapshot | undefined, events: TcgEvent[] | undefined): TcgEvent[] | undefined {
		const room = this.props.room;
		const status = snapshot?.status ?? room.tcgLatestStatus;
		if (snapshot) {
			room.tcgLatestStatus = snapshot.status;
			room.tcgSetupRevealed = (snapshot.players || []).length > 0 &&
				(snapshot.players || []).every(p => p?.setup === 'done');
		}
		if (status !== 'setup' || room.tcgSetupRevealed) {
			room.tcgSetupHidden = {};
			return events;
		}
		const you = snapshot?.you ?? room.tcgSnapshot?.you ?? null;
		const hidden = room.tcgSetupHidden;
		const out = events?.map(ev => {
			if (ev.type !== 'place' || ev.seat == null || ev.seat === you || !ev.iid) return ev;
			const slot = ev.slot === 'active' || ev.slot == null ? 'active' : String(ev.slot);
			hidden[ev.seat] = { ...hidden[ev.seat], [slot]: ev.iid };
			return { ...ev, cardId: '', faceDown: true };
		});
		if (snapshot) {
			Object.keys(hidden).forEach(seatKey => {
				const seat = Number(seatKey);
				const p = snapshot.players?.[seat];
				if (!p || seat === you) return;
				const slots = hidden[seat];
				const placeholder = (iid: string): TcgPokemonView => ({
					iid, cardId: '', name: '', hp: 0, maxHp: 0, faceDown: true,
					types: [], energy: [], energyCards: [], tools: [],
				});
				if (slots.active && !p.active) p.active = placeholder(slots.active);
				const bench = (p.bench || []).slice();
				Object.keys(slots).forEach(slotKey => {
					if (slotKey === 'active') return;
					const i = Number(slotKey);
					if (!bench[i]) bench[i] = placeholder(slots[slotKey]);
				});
				// no sparse holes, the board maps over this array
				p.bench = Array.from(bench, m => m || null);
			});
		}
		return out;
	}
	sendTcgAction = (action: TcgAction) => {
		const room = this.props.room;
		if (room.tcgSide == null || room.tcgSnapshot?.you == null) return;
		// the choice starts its own animation, so cut whatever beat is still playing
		if (room.tcgPlaying || room.tcgQueue.length) room.skipTcgToEnd();
		room.tcgWait = true;
		room.sendDirect(`/choose ${JSON.stringify(action)}`);
		room.update(null);
		window.setTimeout(() => {
			if (!room.tcgWait || room.tcgEnded) return;
			if (room.tcgSnapshot?.actions?.length) {
				room.tcgWait = false;
				room.update(null);
			}
		}, 4500);
	};
	receiveRequest(request: BattleRequest | null) {
		const room = this.props.room;
		if (!request) {
			room.request = null;
			room.choices = null;
			room.updateChoiceNotification();
			return;
		}

		if (PS.prefs.autotimer && !room.battle.kickingInactive && !room.autoTimerActivated) {
			this.send('/timer on');
			room.autoTimerActivated = true;
		}

		BattleChoiceBuilder.fixRequest(request, room.battle);

		if (request.side) {
			const wasPlayer = !!room.side;
			room.battle.myPokemon = request.side.pokemon;
			room.battle.setViewpoint(request.side.id);
			room.side = request.side;
			if (!wasPlayer) this.fastForwardIfRejoining();
		}
		if (request.ally) {
			room.battle.myAllyPokemon = request.ally.pokemon;
		}

		room.request = request;
		room.choices = new BattleChoiceBuilder(request);
		// a reconnect can send `|sentchoice|` right after `|request|`. wait till the whole message is processed before
		// notifying
		Promise.resolve().then(() => room.updateChoiceNotification());
		room.update(null);
	}
	renderConnectError() {
		const room = this.props.room;
		if (room.connectMode !== 'deleted' && room.connectMode !== 'not-found') {
			return null;
		}
		if (room.tcgMode && (room.tcgSnapshot || room.tcgReplayMode || room.tcgPlaying || room.tcgHistory.length)) return null;
		return <div class="pad"><div class="broadcast-red pad">
			<h3>{room.connectError || TL`Error`}</h3>
			<p class="buttonbar"><button class="button" data-cmd="/close"><strong>{TL`[Close]`}</strong></button></p>
		</div></div>;
	}
	renderControls(overlayVersion = false, hidePlayerControls = false) {
		const room = this.props.room;
		if (!room.battle) return null;
		if (overlayVersion) {
			if (!room.side || !room.request || room.battle.ended) return null;
			return this.renderPlayerControls(room.request, true);
		}
		if (room.battle.ended) return this.renderAfterBattleControls();
		if (room.side && room.request) {
			if (hidePlayerControls) return null;
			return this.renderPlayerControls(room.request);
		}
		if (room.battle.stepQueue.length === 0) return null;

		const atStart = !room.battle.started;
		const atEnd = room.battle.atQueueEnd;
		return <div class="inline-controls">
			<p>
				{atEnd ? (
					<button class="button disabled" aria-disabled data-cmd="/play" style="min-width:4.5em">
						<i class="fa fa-play" aria-hidden></i><br />{TL`[Play]`}
					</button>
				) : room.battle.paused ? (
					<button class="button" data-cmd="/play" style="min-width:4.5em">
						<i class="fa fa-play" aria-hidden></i><br />{TL`[Play]`}
					</button>
				) : (
					<button class="button" data-cmd="/pause" style="min-width:4.5em">
						<i class="fa fa-pause" aria-hidden></i><br />{TL`[Pause]`}
					</button>
				)} {}
				{!room.battle.hardcoreMode && <>
					<button class={"button button-first" + (atStart ? " disabled" : "")} data-cmd="/ffto 0" style="margin-right:2px">
						<i class="fa fa-undo" aria-hidden></i><br />{TL`[First turn]`}
					</button>
					<button class={"button button-first" + (atStart ? " disabled" : "")} data-cmd="/ffto -1">
						<i class="fa fa-step-backward" aria-hidden></i><br />{TL`[Prev turn]`}
					</button>
					<button class={"button button-last" + (atEnd ? " disabled" : "")} data-cmd="/ffto +1" style="margin-right:2px">
						<i class="fa fa-step-forward" aria-hidden></i><br />{TL`[Skip turn]`}
					</button>
					<button class={"button button-last" + (atEnd ? " disabled" : "")} data-cmd="/ffto end">
						<i class="fa fa-fast-forward" aria-hidden></i><br />{TL`[Skip to end]`}
					</button>
				</>}
			</p>
			<p>
				<button class="button" data-cmd="/switchsides">
					<i class="fa fa-random" aria-hidden></i> {TL`[Switch viewpoint]`}
				</button> {}
				{!room.battle.hardcoreMode && <button class="button" data-cmd="/ffto">
					<i class="fa fa-random" aria-hidden></i> {TL`[Go to turn]`}
				</button>}
			</p>
		</div>;
	}
	renderMoveButton(props: {
		name: string, cmd: string, type: Dex.TypeName, tags: string, tooltip: string,
		moveData: { pp?: number, maxpp?: number, disabled?: boolean },
	} | null) {
		if (!props) {
			return <button class="movebutton" disabled>&nbsp;</button>;
		}
		const pp = props.moveData.maxpp ? `${props.moveData.pp!}/${props.moveData.maxpp}` : '\u2014';
		return <button
			data-cmd={props.cmd} data-tooltip={props.tooltip}
			class={`movebutton has-tooltip ${props.moveData.disabled ? 'disabled' : `type-${props.type}`}`}
			aria-disabled={props.moveData.disabled}
		>
			{props.name}<br />
			<small class="type">{props.type} <span class="effectiveness-icon">{props.tags}</span></small> {}
			<small class="pp">{pp}</small>&nbsp;
		</button>;
	}
	renderPokemonButton(props: {
		pokemon: Pokemon | ServerPokemon | null, cmd: string, noHPBar?: boolean, disabled?: boolean | 'fade', tooltip: string,
	}) {
		const pokemon = props.pokemon;
		if (!pokemon) {
			return <button
				data-cmd={props.cmd} class={`${props.disabled ? 'disabled ' : ''}has-tooltip`}
				aria-disabled={props.disabled}
				style={props.disabled === 'fade' ? 'opacity: 0.5' : ''} data-tooltip={props.tooltip}
			>
				{TL`(empty slot)`}
			</button>;
		}

		let hpColorClass;
		switch (BattleScene.getHPColor(pokemon)) {
		case 'y': hpColorClass = 'hpbar hpbar-yellow'; break;
		case 'r': hpColorClass = 'hpbar hpbar-red'; break;
		default: hpColorClass = 'hpbar'; break;
		}

		return <button
			data-cmd={props.cmd} class={`${props.disabled ? 'disabled ' : ''}has-tooltip`}
			aria-disabled={props.disabled}
			style={props.disabled === 'fade' ? 'opacity: 0.5' : ''} data-tooltip={props.tooltip}
		>
			{PSIcon({ pokemon })}
			{pokemon.name}
			{
				!props.noHPBar && !pokemon.fainted &&
				<span class={hpColorClass}>
					<span style={{ width: Math.round(pokemon.hp * 92 / pokemon.maxhp) || 1 }}></span>
				</span>
			}
			{!props.noHPBar && pokemon.status && <span class={`status ${pokemon.status}`}></span>}
		</button>;
	}
	renderMoveMenu(choices: BattleChoiceBuilder, overlayVersion?: boolean) {
		const moveRequest = choices.currentMoveRequest()!;

		const canDynamax = moveRequest.canDynamax && !choices.alreadyMax;
		const alreadyMega = choices.alreadyMega && !this.props.room.battle.format.allowMultipleMegas;
		const canMegaEvo = moveRequest.canMegaEvo && !alreadyMega;
		const canMegaEvoX = moveRequest.canMegaEvoX && !alreadyMega;
		const canMegaEvoY = moveRequest.canMegaEvoY && !alreadyMega;
		const canZMove = moveRequest.zMoves && !choices.alreadyZ;
		const canUltraBurst = moveRequest.canUltraBurst;
		const canTerastallize = moveRequest.canTerastallize;

		const maybeDisabled = moveRequest.maybeDisabled;
		const maybeLocked = moveRequest.maybeLocked;

		return <div class="movemenu">
			{maybeDisabled && <p><em class="movewarning">
				{this.renderUIText('mightBeDisabled')}
			</em></p>}
			{maybeLocked && <p><em class="movewarning">
				{this.renderUIText('mightBeLocked')} {}
				<button class="button" data-cmd="/choose testfight">{TL`[Try Fight button]`}</button> {}
				{this.renderUIText('lockedExplanation')}
			</em></p>}
			{!overlayVersion && this.renderMoveControls(moveRequest, choices)}
			<div class="megaevo-box">
				{canDynamax && <label class={`megaevo${choices.current.max ? ' cur' : ''}`}>
					<input type="checkbox" name="max" checked={choices.current.max} onChange={this.toggleBoostedMove} /> {}
					{moveRequest.gigantamax ? TL.tag.gigantamax : TL`Dynamax`}
				</label>}
				{canMegaEvo && <label class={`megaevo${choices.current.mega ? ' cur' : ''}`}>
					<input type="checkbox" name="mega" checked={choices.current.mega} onChange={this.toggleBoostedMove} /> {}
					{TL`Mega Evolution`}
				</label>}
				{canMegaEvoX && <label class={`megaevo${choices.current.mega ? ' cur' : ''}`}>
					<input type="checkbox" name="megax" checked={choices.current.megax} onChange={this.toggleBoostedMove} /> {}
					{TL`Mega Evolution`} X
				</label>}
				{canMegaEvoY && <label class={`megaevo${choices.current.mega ? ' cur' : ''}`}>
					<input type="checkbox" name="megay" checked={choices.current.megay} onChange={this.toggleBoostedMove} /> {}
					{TL`Mega Evolution`} Y
				</label>}
				{canUltraBurst && <label class={`megaevo${choices.current.ultra ? ' cur' : ''}`}>
					<input type="checkbox" name="ultra" checked={choices.current.ultra} onChange={this.toggleBoostedMove} /> {}
					{TL`Ultra Burst`}
				</label>}
				{canZMove && <label class={`megaevo${choices.current.z ? ' cur' : ''}`}>
					<input type="checkbox" name="z" checked={choices.current.z} onChange={this.toggleBoostedMove} /> {}
					{TL`Z-Power`}
				</label>}
				{canTerastallize && <label class={`megaevo${choices.current.tera ? ' cur' : ''}`}>
					<input type="checkbox" name="tera" checked={choices.current.tera} onChange={this.toggleBoostedMove} /> {}
					{TL`Tera ${'{TYPE}'}`.split(/(\{TYPE\})/).map(part => (
						part === '{TYPE}' ? PSIcon({ type: canTerastallize, new: true, tera: true }) : part
					))}
				</label>}
			</div>
			{overlayVersion && this.renderMoveControls(moveRequest, choices)}
		</div>;
	}
	renderMoveControls(active: BattleRequestActivePokemon, choices: BattleChoiceBuilder) {
		const battle = this.props.room.battle;
		const dex = battle.dex;
		const pokemonIndex = choices.index();
		const activeIndex = battle.mySide.n > 1 ? pokemonIndex + battle.pokemonControlled : pokemonIndex;
		const serverPokemon = choices.request.side!.pokemon[pokemonIndex];
		const valueTracker = new ModifiableValue(battle, battle.nearSide.active[activeIndex]!, serverPokemon);
		const tooltips = (battle.scene as BattleScene).tooltips;

		if (choices.current.max || (active.maxMoves && !active.canDynamax)) {
			if (!active.maxMoves) {
				return <div class="message-error">{TL`Maxed with no max moves`}</div>;
			}
			const gmax = active.gigantamax && dex.moves.get(active.gigantamax);
			return active.moves.map((moveData, i) => {
				const move = dex.moves.get(moveData.name);
				const [moveType, tags] = tooltips.getMoveTypeText(move, valueTracker, gmax || true);
				let maxMoveData: { name: string, id: ID } = active.maxMoves![i];
				if (maxMoveData.name !== 'Max Guard') {
					maxMoveData = tooltips.getMaxMoveFromType(moveType, gmax);
				}
				const gmaxTooltip = maxMoveData.id.startsWith('gmax') ? `|${maxMoveData.id}` : ``;
				const tooltip = `maxmove|${moveData.name}|${pokemonIndex}${gmaxTooltip}`;
				return this.renderMoveButton({
					name: TL(dex.moves.get(maxMoveData.name)),
					cmd: `/move ${i + 1} max`,
					type: moveType,
					tags,
					tooltip,
					moveData: { ...moveData, disabled: active.maxMoves![i].disabled },
				});
			});
		}

		if (choices.current.z) {
			if (!active.zMoves) {
				return <div class="message-error">{TL`No Z moves`}</div>;
			}
			return active.moves.map((moveData, i) => {
				const zMoveData = active.zMoves![i];
				if (!zMoveData) {
					return this.renderMoveButton(null);
				}
				const specialMove = dex.moves.get(zMoveData.name);
				const move = specialMove.exists ? specialMove : dex.moves.get(moveData.name);
				let moveName = TL(move);
				if (zMoveData.name.startsWith('Z-') && !moveName.startsWith('Z-')) moveName = `Z-${moveName}`;
				const [moveType, tags] = tooltips.getMoveTypeText(move, valueTracker);
				const tooltip = `zmove|${moveData.name}|${pokemonIndex}`;
				return this.renderMoveButton({
					name: moveName,
					cmd: `/move ${i + 1} zmove`,
					type: moveType,
					tags,
					tooltip,
					moveData: { pp: 1, maxpp: 1 },
				});
			});
		}

		const special = choices.moveSpecial(choices.current);
		return active.moves.map((moveData, i) => {
			const move = dex.moves.get(moveData.name);
			const [moveType, tags] = tooltips.getMoveTypeText(move, valueTracker);
			const tooltip = `move|${moveData.name}|${pokemonIndex}`;
			return this.renderMoveButton({
				name: TL(move),
				cmd: `/move ${i + 1}${special}`,
				type: moveType,
				tags,
				tooltip,
				moveData,
			});
		});
	}
	renderMoveTargetControls(request: BattleMoveRequest, choices: BattleChoiceBuilder) {
		const battle = this.props.room.battle;
		let moveTarget = choices.currentMove()?.target;
		if ((moveTarget === 'adjacentAlly' || moveTarget === 'adjacentFoe') && battle.gameType === 'freeforall') {
			moveTarget = 'normal';
		}
		const moveChoice = choices.stringChoice(choices.current);

		const userSlot = choices.index() + Math.floor(battle.mySide.n / 2) * battle.pokemonControlled;
		const userSlotCross = battle.farSide.active.length - 1 - userSlot;

		return <>
			{battle.farSide.active.map((pokemon, i) => {
				let disabled = false;
				if (moveTarget === 'adjacentAlly' || moveTarget === 'adjacentAllyOrSelf') {
					disabled = true;
				} else if (moveTarget === 'normal' || moveTarget === 'adjacentFoe') {
					if (Math.abs(userSlotCross - i) > 1) disabled = true;
				}

				if (pokemon?.fainted) pokemon = null;
				return this.renderPokemonButton({
					pokemon,
					cmd: disabled ? `` : `/${moveChoice} +${i + 1}`,
					disabled: disabled && 'fade',
					tooltip: `activepokemon|1|${i}`,
				});
			}).reverse()}
			<div style={{ clear: 'left' }}></div>
			{battle.nearSide.active.map((pokemon, i) => {
				let disabled = false;
				if (moveTarget === 'adjacentFoe') {
					disabled = true;
				} else if (moveTarget === 'normal' || moveTarget === 'adjacentAlly' || moveTarget === 'adjacentAllyOrSelf') {
					if (Math.abs(userSlot - i) > 1) disabled = true;
				}
				if (moveTarget !== 'adjacentAllyOrSelf' && userSlot === i) disabled = true;

				if (pokemon?.fainted) pokemon = null;
				return this.renderPokemonButton({
					pokemon,
					cmd: disabled ? `` : `/${moveChoice} -${i + 1}`,
					disabled: disabled && 'fade',
					tooltip: `activepokemon|0|${i}`,
				});
			})}
		</>;
	}
	renderSwitchMenu(
		request: BattleMoveRequest | BattleSwitchRequest, choices: BattleChoiceBuilder, ignoreTrapping?: boolean
	) {
		const numActive = choices.requestLength();
		const maybeTrapped = !ignoreTrapping && choices.currentMoveRequest()?.maybeTrapped;
		const trapped = !ignoreTrapping && !maybeTrapped && choices.currentMoveRequest()?.trapped;
		const isReviving = choices.isReviving();

		return <div class="switchmenu">
			{maybeTrapped && <em class="movewarning">
				{this.renderUIText('mightBeTrapped')}<br />
			</em>}
			{trapped && <em class="movewarning">
				{this.renderUIText('cantSwitchTrapped')}<br />
			</em>}
			{request.side.pokemon.map((serverPokemon, i) => {
				let cantSwitch = trapped || i < numActive || choices.alreadySwitchingIn.includes(i + 1) || serverPokemon.fainted;
				if (isReviving) cantSwitch = !serverPokemon.fainted || choices.alreadySwitchingIn.includes(i + 1);
				return this.renderPokemonButton({
					pokemon: serverPokemon,
					cmd: `/switch ${i + 1}`,
					disabled: cantSwitch,
					tooltip: `switchpokemon|${i}`,
				});
			})}
			{request.ally?.pokemon?.map((serverPokemon, i) => {
				return this.renderPokemonButton({
					pokemon: serverPokemon,
					cmd: `/switch notMine`,
					disabled: true,
					tooltip: `allypokemon|${i}`,
				});
			})}
		</div>;
	}
	renderTeamPreviewChooser(request: | BattleTeamRequest, choices: BattleChoiceBuilder) {
		return request.side.pokemon.map((serverPokemon, i) => {
			const cantSwitch = choices.alreadySwitchingIn.includes(i + 1);
			return this.renderPokemonButton({
				pokemon: serverPokemon,
				cmd: `/switch ${i + 1}`,
				disabled: cantSwitch && 'fade',
				tooltip: `switchpokemon|${i}`,
			});
		});
	}
	renderTeamList(overlayVersion = false) {
		const team = this.team;
		if (!team) return;
		return <div class="switchcontrols">
			{!overlayVersion && <h3 class="switchselect">{TL`[Team]`}</h3>}
			<div class="switchmenu">
				{team.map((serverPokemon, i) => {
					return this.renderPokemonButton({
						pokemon: serverPokemon,
						cmd: "",
						disabled: true,
						tooltip: `switchpokemon|${i}`,
					});
				})}
			</div>
		</div>;
	}
	renderChosenTeam(request: BattleTeamRequest, choices: BattleChoiceBuilder) {
		return choices.alreadySwitchingIn.map(slot => {
			const serverPokemon = request.side.pokemon[slot - 1];
			return this.renderPokemonButton({
				pokemon: serverPokemon,
				cmd: `/switch ${slot}`,
				tooltip: `switchpokemon|${slot - 1}`,
			});
		});
	}
	renderOldChoices(request: BattleRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		if (!choices) return null; // should not happen
		if (
			(request.requestType !== 'move' && request.requestType !== 'switch' && request.requestType !== 'team') ||
			choices.isEmpty()
		) {
			return null;
		}

		let buf: preact.ComponentChild[] = [
			<button data-cmd="/cancelone" class="button"><i class="fa fa-chevron-left" aria-hidden></i> {TL`[Back]`}</button>, ' ',
		];
		if (choices.isDone() && (
			choices.noCancel || this.props.room.battle.hardcoreMode ||
			(choices.choices.length <= 1 && !overlayVersion)
		)) {
			buf = [];
		}

		if (choices.serializedChoice) {
			if (choices.serializedChoice === 'default') {
				return [BattleTextParser.ui('autoChoice'), <br />];
			}
			return [BattleTextParser.ui('unrecognizedChoice') + ' ', <code>{choices.serializedChoice}</code>, <br />];
		}

		const battle = this.props.room.battle;
		const pickedNames: string[] = [];
		for (let i = 0; i < choices.choices.length; i++) {
			const choiceString = choices.choices[i];
			if (choiceString === "testfight") {
				buf.push(this.renderUIText('lockedIntoMove', { POKEMON: request.side.pokemon[i].name }));
				return buf;
			}
			let choice;
			try {
				choice = choices.parseChoice(choiceString, i);
			} catch (err: any) {
				buf.push(<span class="message-error">{err.message}</span>);
			}
			if (!choice) continue;
			const pokemon = request.side.pokemon[i];
			const active = request.requestType === 'move' ? request.active[i] : null;
			if (choice.choiceType === 'move') {
				let actions = '';
				if (choice.mega) actions += BattleTextParser.ui('actionMegaEvolve');
				if (choice.megax) actions += BattleTextParser.ui('actionMegaEvolveX');
				if (choice.megay) actions += BattleTextParser.ui('actionMegaEvolveY');
				if (choice.ultra) actions += BattleTextParser.ui('actionUltraBurst');
				if (choice.tera) actions += BattleTextParser.ui('actionTerastallize', { TYPE: active?.canTerastallize || '???' });
				if (choice.max && active?.canDynamax) {
					actions += BattleTextParser.ui(active?.gigantamax ? 'actionGigantamax' : 'actionDynamax');
				}
				let target = '';
				if (choice.targetLoc > 0) {
					const targetPokemon = battle.farSide.active[choice.targetLoc - 1];
					target = targetPokemon ?
						BattleTextParser.ui('atTarget', { TARGET: targetPokemon.name }) :
						BattleTextParser.ui('atSlot', { NUMBER: `${choice.targetLoc}` });
				} else if (choice.targetLoc < 0) {
					const targetPokemon = battle.nearSide.active[-choice.targetLoc - 1];
					const isAlly = battle.gameType !== 'freeforall';
					if (targetPokemon) {
						target = BattleTextParser.ui(isAlly ? 'atAllyTarget' : 'atTarget', { TARGET: targetPokemon.name });
					} else {
						target = BattleTextParser.ui(isAlly ? 'atAllySlot' : 'atSlot', { NUMBER: `${choice.targetLoc}` });
					}
				}
				buf.push(this.renderUIText('willUseMove', {
					POKEMON: pokemon.name,
					ACTIONS: actions,
					MOVE: choices.currentMove(choice, i)?.name || '???',
					AT: target,
				}));
			} else if (choice.choiceType === 'switch') {
				const target = request.side.pokemon[choice.targetPokemon - 1];
				buf.push(this.renderUIText(choices.isReviving(i) ? 'willRevive' : 'willSwitch', {
					POKEMON: pokemon.name, TARGET: target.name,
				}));
			} else if (choice.choiceType === 'shift') {
				buf.push(this.renderUIText('willShift', { POKEMON: pokemon.name }));
			} else if (choice.choiceType === 'team') {
				const target = request.side.pokemon[choice.targetPokemon - 1];
				pickedNames.push(target.name);
			}
			if (!pickedNames.length) buf.push(<br />);
		}
		if (pickedNames.length) {
			const pickedList = pickedNames.map(name => `**${name}**`).join(BattleTextParser.ui('listComma'));
			buf.push(this.renderUIText('youPicked', { POKEMON: pickedList }), <br />);
		}
		return buf;
	}
	overlayControlClass(overlay: 'move' | 'switch') {
		return `button ${overlay}-button${this.props.room.overlayActive === overlay ? ' cur' : ''}`;
	}
	renderPlayerAnimationControls(overlayVersion = false) {
		const room = this.props.room;
		if (overlayVersion) {
			const canSkip = !room.battle.hardcoreMode;
			return <>
				{canSkip && <div class="overlay-controls-skip">
					<button class="button" data-cmd="/ffto end"><i class="fa fa-fast-forward" aria-hidden></i><br />{TL`[Skip]`}</button>
				</div>}
			</>;
		}
		return <div class="inline-controls">
			{!room.battle.hardcoreMode && <div class="whatdo" style="padding-bottom:0">
				<button class="button" data-cmd="/ffto end">
					<i class="fa fa-fast-forward" aria-hidden></i><br />{TL`[Skip animation]`}
				</button>
			</div>}
			{this.renderTeamList()}
		</div>;
	}
	renderPlayerMoveControls(request: BattleMoveRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		const room = this.props.room;
		const index = choices.index();
		const pokemon = request.side.pokemon[index];

		if (choices.current.move) {
			const moveName = choices.currentMove()?.name;
			if (overlayVersion) {
				return <>
					<div class="overlay-controls-list">
						<button class="button move-button cur"><strong>{TL`[Battle]`}</strong></button> {}
						<button class="button switch-button disabled"><strong>{TL`[Switch]`}</strong></button>
					</div>
					<div class="targetcontrols">
						<p class="overlay-message">
							{this.renderOldChoices(request, choices, true)}
							{this.renderUIText('moveTarget', { POKEMON: pokemon.name, MOVE: moveName })}
						</p>
						<div class="switchmenu">
							{this.renderMoveTargetControls(request, choices)}
						</div>
					</div>
				</>;
			}
			return <div class="inline-controls">
				<div class="whatdo">
					{this.renderOldChoices(request, choices)}
					{this.renderUIText('moveTarget', { POKEMON: pokemon.name, MOVE: moveName })} {}
				</div>
				<div class="switchcontrols">
					<div class="switchmenu">
						{this.renderMoveTargetControls(request, choices)}
					</div>
				</div>
			</div>;
		}

		const canShift = room.battle.gameType === 'triples' && index !== 1;

		if (overlayVersion) {
			return <>
				<div class="overlay-controls-list">
					<button class={this.overlayControlClass('move')} data-cmd="/movemenu"><strong>{TL`[Battle]`}</strong></button> {}
					<button class={this.overlayControlClass('switch')} data-cmd="/switchmenu"><strong>{TL`[Switch]`}</strong></button>
				</div>
				{!room.overlayActive && <div class="whatdo">
					{this.renderOldChoices(request, choices, true)}
					{this.renderUIText('whatDo', { POKEMON: pokemon.name })}
				</div>}
				{room.overlayActive === 'move' && <div class="movecontrols">
					{this.renderMoveMenu(choices, true)}
				</div>}
				{room.overlayActive === 'switch' && <div class="switchcontrols">
					{canShift && (
						<button data-cmd="/shift">{TL`[Move to center]`}</button>
					)}
					{this.renderSwitchMenu(request, choices)}
				</div>}
			</>;
		}
		return <div class="inline-controls">
			<div class="whatdo">
				{this.renderOldChoices(request, choices)}
				{this.renderUIText('whatDo', { POKEMON: pokemon.name })}
			</div>
			<div class="movecontrols">
				<h3 class="moveselect">{TL`[Battle]`}</h3>
				{this.renderMoveMenu(choices)}
			</div>
			<div class="switchcontrols">
				{canShift && [
					<h3 class="shiftselect">{TL`[Shift]`}</h3>,
					<button data-cmd="/shift">{TL`[Move to center]`}</button>,
				]}
				<h3 class="switchselect">{TL`[Switch]`}</h3>
				{this.renderSwitchMenu(request, choices)}
			</div>
		</div>;
	}
	renderPlayerSwitchControls(request: BattleSwitchRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		const pokemon = request.side.pokemon[choices.index()];
		const prompt = choices.isReviving() ?
			this.renderUIText('reviveWho', { POKEMON: pokemon.name }) :
			this.renderUIText('replaceWho', { POKEMON: pokemon.name });
		if (overlayVersion) {
			return <>
				<div class="overlay-controls-list">
					<button class="button switch-button cur"><strong>{TL`[Switch]`}</strong></button>
				</div>
				<div class="switchcontrols">
					<p class="overlay-message">
						{this.renderOldChoices(request, choices, true)}
						{prompt}
					</p>
					{this.renderSwitchMenu(request, choices, true)}
				</div>
			</>;
		}
		return <div class="inline-controls">
			<div class="whatdo">
				{this.renderOldChoices(request, choices)}
				{prompt}
			</div>
			<div class="switchcontrols">
				<h3 class="switchselect">{TL`[Switch]`}</h3>
				{this.renderSwitchMenu(request, choices, true)}
			</div>
		</div>;
	}
	renderPlayerTeamPreviewControls(request: BattleTeamRequest, choices: BattleChoiceBuilder, overlayVersion = false) {
		const prompt = choices.alreadySwitchingIn.length > 0 ? (
			[<button data-cmd="/cancelone" class="button"><i class="fa fa-chevron-left" aria-hidden></i> {TL`[Back]`}</button>,
				" ", this.renderUIText('teamRest'), " "]
		) : (
			[this.renderUIText('teamStart'), " "]
		);
		const chosenTeamSizeLabel = (request.chosenTeamSize || 0) > 1 ? ` / ${request.chosenTeamSize!}` : '';
		const chooseLabel = (choices.alreadySwitchingIn.length <= 0 ?
			BattleTextParser.ui('chooseLead') : BattleTextParser.ui('chooseSlot', { NUMBER: `${choices.alreadySwitchingIn.length + 1}` })) + chosenTeamSizeLabel;
		if (overlayVersion) {
			return <>
				<div class="overlay-controls-list">
					<button class="button switch-button cur"><strong>{TL`[Team]`}</strong></button>
				</div>
				<div class="teamcontrols">
					<p class="overlay-message">{prompt}</p>
					<h3 class="switchselect">{chooseLabel}</h3>
					<div class="switchmenu">
						{this.renderTeamPreviewChooser(request, choices)}
						<div style="clear:left"></div>
					</div>
					{choices.alreadySwitchingIn.length > 0 && <>
						<h3 class="switchselect">{this.renderUIText('teamSoFar')}</h3>
						<div class="switchmenu">
							{this.renderChosenTeam(request, choices)}
						</div>
					</>}
				</div>
			</>;
		}
		return <div class="inline-controls">
			<div class="whatdo">
				{prompt}
			</div>
			<div class="switchcontrols">
				<h3 class="switchselect">
					{chooseLabel}
				</h3>
				<div class="switchmenu">
					{this.renderTeamPreviewChooser(request, choices)}
					<div style="clear:left"></div>
				</div>
			</div>
			<div class="switchcontrols">
				{choices.alreadySwitchingIn.length > 0 && <h3 class="switchselect">
					{this.renderUIText('teamSoFar')}
				</h3>}
				<div class="switchmenu">
					{this.renderChosenTeam(request, choices)}
				</div>
			</div>
		</div>;
	}
	renderPlayerControls(request: BattleRequest, overlayVersion = false) {
		const room = this.props.room;
		const atEnd = room.battle.atQueueEnd;
		if (!atEnd) return this.renderPlayerAnimationControls(overlayVersion);

		let choices = room.choices;
		if (!choices) return 'Error: Missing BattleChoiceBuilder';
		if (choices.request !== request) {
			choices = new BattleChoiceBuilder(request);
			room.choices = choices;
			room.overlayActive = null;
		}

		if (choices.isDone()) {
			if (overlayVersion) {
				return <>
					<div class="overlay-controls-list">
						<button class={this.overlayControlClass('switch')} data-cmd="/switchmenu"><strong>{TL`[Team]`}</strong></button>
					</div>
					{!room.overlayActive && <div class="whatdo">
						{this.renderOldChoices(request, choices, true)}
					</div>}
					{room.overlayActive === 'switch' && this.renderTeamList(true)}
				</>;
			}
			return <div class="inline-controls">
				<div class="whatdo">
					{this.renderOldChoices(request, choices)}
					<em>{this.renderUIText('waitingOpponent')}</em> {choices.noCancel || room.battle.hardcoreMode ?
						null : <button data-cmd="/cancel" class="button">{TL`[Cancel]`}</button>}
				</div>
				{this.renderTeamList()}
			</div>;
		}
		if (request.side) {
			room.battle.myPokemon = request.side.pokemon;
			this.team = request.side.pokemon;
		}
		switch (request.requestType) {
		case 'move':
			return this.renderPlayerMoveControls(request, choices, overlayVersion);
		case 'switch':
			return this.renderPlayerSwitchControls(request, choices, overlayVersion);
		case 'team':
			return this.renderPlayerTeamPreviewControls(request, choices, overlayVersion);
		}
		return null;
	}

	renderAfterBattleControls() {
		const room = this.props.room;
		const isNotTiny = room.width > 700;
		return <div class="inline-controls">
			<p>
				<span style="float: right">
					<a
						onClick={this.handleDownloadReplay}
						href={`//${Config.routes.replays}/download`}
						class="button replayDownloadButton"
					>
						<i class="fa fa-download" aria-hidden></i> Download replay</a>
					<br />
					<br />
					<button class="button" data-cmd="/savereplay">
						<i class="fa fa-upload" aria-hidden></i> {TL`[Upload and share replay]`}
					</button>
				</span>

				<button class="button" data-cmd="/play" style="min-width:4.5em">
					<i class="fa fa-undo" aria-hidden></i><br />{TL`[Replay]`}
				</button> {}
				{isNotTiny && !room.battle.hardcoreMode && <>
					<button class="button button-first" data-cmd="/ffto 0" style="margin-right:2px">
						<i class="fa fa-undo" aria-hidden></i><br />{TL`[First turn]`}
					</button>
					<button class="button button-first" data-cmd="/ffto -1">
						<i class="fa fa-step-backward" aria-hidden></i><br />{TL`[Prev turn]`}
					</button>
				</>}
			</p>
			{room.side ? (
				<p>
					<button class="button" data-cmd="/close">
						<strong>{TL`[Main menu]`}</strong><br /><small>{TL`(closes this battle)`}</small>
					</button> {}
					<button class="button" data-cmd={`/closeand /challenge ${room.battle.farSide.id},${room.battle.tier}`}>
						<strong>{TL`[Rematch]`}</strong><br /><small>{TL`(closes this battle)`}</small>
					</button>
				</p>
			) : (
				<p>
					<button class="button" data-cmd="/switchsides">
						<i class="fa fa-random" aria-hidden></i> {TL`[Switch viewpoint]`}
					</button> {}
					{!room.battle.hardcoreMode && <button class="button" data-cmd="/ffto">
						<i class="fa fa-random" aria-hidden></i> {TL`[Go to turn]`}
					</button>}
				</p>
			)}
		</div>;
	}

	handleDownloadReplay = (e: MouseEvent) => {
		let room = this.props.room;
		const target = e.currentTarget as HTMLAnchorElement;
		let date = new Date();
		const stamp = `${date.getFullYear()}-${date.getMonth() >= 9 ? '' : '0'}${date.getMonth() + 1}` +
			`-${date.getDate() >= 10 ? '' : '0'}${date.getDate()}`;
		if (room.tcgMode) {
			const filename = `${room.tcgFormatId()}-${stamp}-${toID(room.tcgP1.name)}-${toID(room.tcgP2.name)}`;
			const blob = new Blob([room.buildTcgReplayDownload()], { type: 'application/json' });
			target.href = URL.createObjectURL(blob);
			target.download = filename + '.json';
			e.stopPropagation();
			return;
		}
		let filename = (room.battle.tier || 'Battle').replace(/[^A-Za-z0-9]/g, '');
		filename += `-${stamp}`;
		filename += '-' + toID(room.battle.p1.name);
		filename += '-' + toID(room.battle.p2.name);
		target.href = window.BattleLog.createReplayFileHref(room);
		target.download = filename + '.html';
		e.stopPropagation();
	};

	renderTcgReplayBar() {
		const room = this.props.room;
		if (!room.tcgReplayMode || room.tcgAborted) return null;
		const atEnd = room.tcgSeekIndex < 0 && !room.tcgQueue.length;
		const atStart = room.tcgSeekIndex === 0 ||
			(room.tcgSeekIndex < 0 && room.tcgHistory.length <= 1 && !room.tcgQueue.length);
		const btn = (cmd: string, icon: string, label: string, off = false) => <button
			class={`button${off ? ' disabled' : ''}`} data-cmd={cmd} title={label} aria-label={label}
		>
			<i class={`fa fa-${icon}`} aria-hidden></i> <span class="tcg-replay-label">{label}</span>
		</button>;
		return <div class="tcg-replay-dock" role="group" aria-label="Replay controls">
			{room.tcgAnimating() && !room.tcgPaused ? btn('/pause', 'pause', 'Pause') :
			atEnd ? btn('/play', 'undo', 'Replay') : btn('/play', 'play', 'Play')}
			{btn('/ffto 0', 'fast-backward', 'First turn', atStart)}
			{btn('/ffto -1', 'step-backward', 'Prev turn', atStart)}
			{btn('/ffto +1', 'step-forward', 'Next turn', atEnd)}
			{btn('/ffto end', 'fast-forward', 'Last turn', atEnd)}
			{btn('/ffto', 'search', 'Go to turn')}
			{btn('/switchsides', 'random', 'Switch viewpoint')}
		</div>;
	}

	renderTcgControls() {
		const room = this.props.room;
		const ended = room.tcgEnded || room.tcgReplayMode || room.tcgResultShown;
		const isPlayer = room.isTcgPlayer();
		const isSpec = room.isTcgSpectator();
		const atEnd = room.tcgSeekIndex < 0 && !room.tcgQueue.length;
		const atStart = room.tcgSeekIndex === 0 ||
			(room.tcgSeekIndex < 0 && room.tcgHistory.length <= 1 && !room.tcgQueue.length);
		const canScrub = ended || (isSpec && !ended);
		// the server drops the game (and timer) as soon as the match ends, while we're still animating the last beats.
		// hide the timer from the latest server status, not the fx one
		const stopped = room.tcgAborted;
		if (room.tcgReplayMode && !stopped) return null;
		const showTimer = isPlayer && !ended && !stopped &&
			room.tcgLatestStatus !== 'over' && room.tcgLatestStatus !== 'aborted';
		const showSpecLive = !ended && !stopped && isSpec;
		const showScrub = ended && canScrub;
		const showEndPlayer = ended && room.tcgSide != null;
		const showEndSpec = ended && isSpec;
		if (!showTimer && !showSpecLive && !showScrub && !showEndPlayer && !showEndSpec && !stopped) return null;

		const mode = ended ? 'ended' : showSpecLive ? 'spec' : 'live';
		// viewing an earlier turn hides the result banner, so center the bar in the mid-board gap
		const scrubbing = ended && room.tcgSnapshot?.status !== 'over';
		return <div
			class={`tcg-chrome ${mode}${scrubbing ? ' scrubbing' : ''}`}
			role="complementary"
			aria-label="TCG Battle Controls"
		>
			{showTimer && <TimerButton room={room} top={0} inline />}
			{showSpecLive && <div class="tcg-chrome-group" aria-label="Spectator controls">
				{room.tcgPaused || !room.tcgPlaying ? (
					<button class="button" data-cmd="/play" title="Play">
						<i class="fa fa-play" aria-hidden></i>
					</button>
				) : (
					<button class="button" data-cmd="/pause" title="Pause">
						<i class="fa fa-pause" aria-hidden></i>
					</button>
				)}
				<button class="button" data-cmd="/ffto end" title="Skip to end">
					<i class="fa fa-fast-forward" aria-hidden></i>
				</button>
				<button class="button" data-cmd="/switchsides" title="Switch viewpoint">
					<i class="fa fa-random" aria-hidden></i>
				</button>
			</div>}
			{(stopped || ended) && (() => {
				const opp = room.tcgOpponentId();
				const rematch = opp ? `/closeand /challenge ${opp},${room.tcgFormatId()}` : '';
				const snap = room.tcgSnapshot;
				const winner = room.tcgWinner || (snap?.winner != null ? snap.players[snap.winner]?.name : '') || '';
				const title = stopped ? 'Match stopped' : winner ? `${winner} won the battle!` : 'The battle ended in a draw';
				const step = (cmd: string, icon: string, label: string, off: boolean, part: string) => <button
					class={`button ${part}${off ? ' disabled' : ''}`} data-cmd={cmd} title={label}
				>
					<i class={`fa fa-${icon}`} aria-hidden></i><br /><span class="tcg-result-label">{label}</span>
				</button>;
				const replayRow = showScrub && <p class="buttonbar tcg-result-replay">
					<button class="button" data-cmd="/play">
						<i class="fa fa-undo" aria-hidden></i><br /><span class="tcg-result-label">Replay</span>
					</button> {}
					<span class="tcg-result-steps" role="group" aria-label="Turns">
						{step('/ffto 0', 'fast-backward', 'First turn', atStart, 'button-first')}
						{step('/ffto -1', 'step-backward', 'Prev turn', atStart, 'button-middle')}
						{step('/ffto +1', 'step-forward', 'Next turn', atEnd, 'button-middle')}
						{step('/ffto end', 'fast-forward', 'Last turn', atEnd, 'button-last')}
					</span> {}
					<button class="button" data-cmd="/ffto">
						<i class="fa fa-search" aria-hidden></i><br /><span class="tcg-result-label">Go to turn</span>
					</button> {}
					<button class="button" data-cmd="/switchsides" title="Switch viewpoint">
						<i class="fa fa-random" aria-hidden></i><br /><span class="tcg-result-label">Switch viewpoint</span>
					</button>
				</p>;
				return <div class="tcg-result" role="group" aria-label="Battle over">
					<h3>{title}</h3>
					{stopped && room.tcgStopReason && <p class="tcg-result-reason">{room.tcgStopReason}</p>}
					<div class="tcg-result-body">
						<div class="tcg-result-main">
							{!stopped && replayRow}
							{(showEndPlayer || stopped) && <p class="buttonbar">
								<button class="button" data-cmd="/close" title="Closes this battle">
									<strong>Main menu</strong><br /><small>(closes this battle)</small>
								</button> {}
								{!!rematch && <button class="button" data-cmd={rematch} title="Closes this battle">
									<strong>Rematch</strong><br /><small>(closes this battle)</small>
								</button>}
							</p>}
						</div>
						{!stopped && (showEndPlayer || showEndSpec) && <p class="tcg-result-file">
							<a
								onClick={this.handleDownloadReplay}
								href={`//${Config.routes.replays}/download`}
								class="button replayDownloadButton" title="Download replay"
							>
								<i class="fa fa-download" aria-hidden></i> <span class="tcg-result-label">Download replay</span>
							</a>
							{showEndPlayer && <button class="button" data-cmd="/savereplay" title="Upload and share replay">
								<i class="fa fa-upload" aria-hidden></i> <span class="tcg-result-label">Upload and share replay</span>
							</button>}
						</p>}
					</div>
				</div>;
			})()}
		</div>;
	}

	override render() {
		this.updateLayout();
		const room = this.props.room;
		if (room.tcgMode || isTcgBattleId(room.id)) {
			return this.renderTcg();
		}
		const id = `room-${room.id}`;
		const hardcoreStyle = room.battle?.hardcoreMode ? <style
			dangerouslySetInnerHTML={{ __html: `#${id} .battle .turn, #${id} .battle-history { display: none !important; }` }}
		></style> : null;
		const { layout, battleHeight, battleWidth, overlayControls } = this.chooseLayout();
		const overlayVersion = overlayControls && !!room.battle && !!room.side && !!room.request && !room.battle.ended;

		if (layout === 'scrolling') {
			// low-width-low-height layout
			// TODO: nicer phone horizontal layout
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				{hardcoreStyle}
				<ChatLog
					class="battle-log hasuserlist" room={room} noSubscription hasPreempt bottom={0}
				>
					<div style="height:18px;position:relative">
						<ChatUserList room={room} top={0} minimized />
					</div>
					<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} left={0} tinyLayout={room.width < 400} />
					<div style={`height:${battleHeight}px;width:${battleWidth}px;margin: 0 auto;position:relative`}>
						<BattleDiv room={room} />
					</div>
					{overlayVersion && <div class="overlay-controls" style="position:relative;height:0">
						{this.renderControls(true)}
					</div>}
					<div
						class={`battle-controls inline-battle${room.width > 660 ? ' wide-controls' : ''}`}
						role="complementary" aria-label={TL`Battle controls`}
					>
						{this.renderControls(false, overlayVersion)}
						{this.renderConnectError()}
					</div>
				</ChatLog>
				{(room.battle && !room.battle.ended && room.request && room.battle.mySide.id === PS.user.userid) &&
					<TimerButton room={room} top={7} />}
				<div class="battle-controls-container"></div>
			</PSPanelWrapper>;
		}

		if (layout === 'top-and-bottom') {
			// phone vertical layout
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				{hardcoreStyle}
				<div style={`position:relative;height:${battleHeight}px;width:${battleWidth}px;margin:0 auto`}>
					<BattleDiv room={room} />
				</div>
				{overlayVersion && <div
					class="overlay-controls"
					style={`position:absolute;left:0;top:${battleHeight}px;width:100%;height:0`}
				>
					{this.renderControls(true)}
				</div>}
				<ChatLog
					class="battle-log hasuserlist" room={room} top={battleHeight} noSubscription hasPreempt
				>
					<div
						class={`battle-controls${room.width > 660 ? ' wide-controls' : ''}`}
						role="complementary" aria-label={TL`Battle controls`}
					>
						{this.renderControls(false, overlayVersion)}
						{this.renderConnectError()}
					</div>
				</ChatLog>
				<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} left={0} tinyLayout={room.width < 400} />
				<ChatUserList room={room} top={battleHeight} minimized />
				{(room.battle && !room.battle.ended && room.request && room.battle.mySide.id === PS.user.userid) &&
					<TimerButton room={room} top={battleHeight + 7} />}
				<div class="battle-controls-container"></div>
			</PSPanelWrapper>;
		}

		if (room.width < 500) {
			// oldclient phone layout
			const showingChat = this.mobileChatShown;
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				{hardcoreStyle}
				<div class="scrollable-battle-container" style={`width:${battleWidth}px;${showingChat ? 'display:none;' : ''}`}>
					<BattleDiv room={room} />
					{overlayVersion && <div
						class="overlay-controls"
						style={`position:absolute;left:0;top:${battleHeight}px;width:${battleWidth}px;height:0`}
					>
						{this.renderControls(true)}
					</div>}
					<div class="battle-controls-container">
						<div
							class={`battle-controls${battleWidth >= 639 ? ' wide-controls' : ''}`}
							role="complementary" aria-label={TL`Battle controls`}
							style={`top:${battleHeight + 10}px;width:${battleWidth}px;`}
						>
							{(room.battle && !room.battle.ended && room.request &&
								room.battle.mySide.id === PS.user.userid) && <TimerButton room={room} top={0} />}
							{this.renderControls(false, overlayVersion)}
							{this.renderConnectError()}
						</div>
					</div>
				</div>
				<div style={!showingChat ? 'display:none;' : ''}>
					<ChatLog class="battle-log hasuserlist" room={room} noSubscription hasPreempt />
					<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} tinyLayout />
					<ChatUserList room={room} minimized />
				</div>
				{showingChat ? (
					<button class="battle-chat-toggle button" name="hideChat" onClick={this.showMobileBattle}>
						{TL`Battle`} <i class="fa fa-caret-right" aria-hidden></i>
					</button>
				) : (
					<button class="battle-chat-toggle button" name="showChat" onClick={this.showMobileChat}>
						<i class="fa fa-caret-left" aria-hidden></i> {TL`Chat`}
					</button>
				)}
			</PSPanelWrapper>;
		}

		// regular layout
		return <PSPanelWrapper room={room} focusClick noScroll="hidden">
			{hardcoreStyle}
			<div class="scrollable-battle-container" style={`width:${battleWidth}px`}>
				<BattleDiv room={room} />
				{overlayVersion && <div
					class="overlay-controls"
					style={`position:absolute;left:0;top:${battleHeight}px;width:${battleWidth}px;height:0`}
				>
					{this.renderControls(true)}
				</div>}
				<div class="battle-controls-container">
					<div
						class={`battle-controls${battleWidth >= 639 ? ' wide-controls' : ''}`}
						role="complementary" aria-label={TL`Battle controls`}
						style={`top:${battleHeight + 10}px;width:${battleWidth}px;`}
					>
						{(room.battle && !room.battle.ended && room.request && room.battle.mySide.id === PS.user.userid) &&
							<TimerButton room={room} top={0} />}
						{this.renderControls(false, overlayVersion)}
						{this.renderConnectError()}
					</div>
				</div>
			</div>
			<ChatLog
				class="battle-log hasuserlist" room={room} left={battleWidth} noSubscription hasPreempt
			>
				{}
			</ChatLog>
			<ChatTextEntry
				room={room} onMessage={this.send} onKey={this.onKey} left={battleWidth} tinyLayout={room.width < battleWidth + 340}
			/>
			<ChatUserList room={room} left={battleWidth} minimized />
		</PSPanelWrapper>;
	}

	renderTcg() {
		const room = this.props.room;
		const { battleHeight, battleWidth, layout } = this.chooseLayout();
		const chatWidth = Math.min(400, Math.max(300, Math.floor(room.width * 0.3)));
		const boardW = layout === 'top-and-bottom' ?
			Math.max(battleWidth, Math.min(room.width, 960)) :
			Math.max(battleWidth, room.width - chatWidth);
		// chooseBattleLayout sizes a 640×360 gen scene. a tcg board in the stacked layout should use the room and leave
		// chat a strip
		const boardH = layout === 'top-and-bottom' ?
			Math.max(battleHeight, room.height - 180) :
			battleHeight;
		const viewSnap = room.tcgSnapshot;
		const viewFx = room.tcgFxSnapshot;
		const board = viewSnap ? <TcgBoardErrorBoundary onResync={() => room.sendDirect('/tcgresync')}>
			<TcgBoard
				snapshot={viewSnap}
				fxSnapshot={viewFx}
				viewpoint={room.tcgBoardViewpoint()}
				events={room.tcgEvents}
				playing={room.tcgPlaying}
				resumeAt={room.tcgBeatAt}
				fxKey={room.tcgFxKey}
				halt={room.tcgHalt}
				paused={room.tcgPaused}
				onTogglePause={room.toggleTcgPause}
				onReplay={room.replayTcg}
				onSkip={room.skipTcgToEnd}
				animating={room.tcgAnimating()}
				waiting={room.tcgWait}
				notice={room.tcgNotice}
				noticeN={room.tcgNoticeN}
				ended={room.tcgEnded || room.tcgReplayMode}
				aborted={room.tcgAborted}
				stopReason={room.tcgStopReason}
				showReplayControls={false}
				replayDock={this.renderTcgReplayBar()}
				winnerName={room.tcgWinner}
				onAct={this.sendTcgAction}
				onEvent={room.onTcgEvent}
				onFxDone={room.onTcgFxDone}
				prizeTakes={collectPrizeTakes(room.tcgHistory, room.tcgSeekIndex)}
			/>
		</TcgBoardErrorBoundary> : <div class="tcg-table"><div class="tcg-felt"></div>{room.tcgNotice ?
			<p class="tcg-waiting" role="status">{room.tcgNotice}</p> :
			<p class="tcg-waiting">Shuffling…</p>}</div>;
		const controls = this.renderTcgControls();

		const isPhone = room.width < 640 || room.height < 500;
		if (isPhone) {
			const showingChat = this.mobileChatShown;
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				<div
					class="tcg-mobile-board"
					style={showingChat ? 'display:none;' :
					'position:absolute;inset:0;display:flex;flex-direction:column;' +
					'padding:0;box-sizing:border-box;z-index:1;min-height:0;'}
				>
					<div class="tcg-board-shell">
						{board}
						{controls}
					</div>
					{this.renderConnectError()}
				</div>
				<div class="tcg-mobile-chat" style={showingChat ? 'position:absolute;inset:0;z-index:1;' : 'display:none;'}>
					<ChatLog class="battle-log hasuserlist" room={room} noSubscription hasPreempt />
					<ChatTextEntry room={room} onMessage={this.send} onKey={this.onKey} tinyLayout />
					<ChatUserList room={room} minimized />
				</div>
				{showingChat ? (
					<button
						type="button" class="button tcg-view-toggle" name="hideChat"
						onClick={this.showMobileBattle}
					>
						Board <i class="fa fa-caret-right" aria-hidden></i>
					</button>
				) : (
					<button
						type="button" class="button tcg-view-toggle" name="showChat"
						onClick={this.showMobileChat}
					>
						<i class="fa fa-caret-left" aria-hidden></i> Chat
					</button>
				)}
			</PSPanelWrapper>;
		}

		// every layout nests the board as wrapper > shell > board, so a resize or rotation keeps the same TcgBoard with
		// its selection and running animation. `display: contents` keeps the wrapper out of desktop layouts
		if (layout === 'top-and-bottom') {
			return <PSPanelWrapper room={room} focusClick noScroll="hidden">
				<div class="tcg-board-frame" style="display:contents;"><div
					class="tcg-board-shell"
					style={`height:${boardH}px;width:${boardW}px;margin:0 auto;`}
				>
					{board}
					{controls}
				</div></div>
				<ChatLog
					class="battle-log hasuserlist" room={room} top={boardH} noSubscription hasPreempt
				/>
				<ChatTextEntry
					room={room} onMessage={this.send} onKey={this.onKey} left={0} tinyLayout={room.width < 400}
				/>
				<ChatUserList room={room} top={boardH} minimized />
			</PSPanelWrapper>;
		}

		return <PSPanelWrapper room={room} focusClick noScroll="hidden">
			<div class="tcg-board-frame" style="display:contents;"><div
				class="tcg-board-shell tcg-board-shell-side"
				style={`width:${boardW}px;`}
			>
				{board}
				{controls}
				{this.renderConnectError()}
			</div></div>
			<ChatLog
				class="battle-log hasuserlist" room={room} left={boardW} noSubscription hasPreempt
			/>
			<ChatTextEntry
				room={room} onMessage={this.send} onKey={this.onKey} left={boardW}
				tinyLayout={room.width < boardW + 340}
			/>
			<ChatUserList room={room} left={boardW} minimized />
		</PSPanelWrapper>;
	}
}

PS.addRoomType(BattlePanel, BattlesPanel);
