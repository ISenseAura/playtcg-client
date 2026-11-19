/** tcg deck builder (standard and pocket), the team panel mounts it for tcg formats */
import preact from "../js/lib/preact";
import { PS, type Team } from "./client-main";
import {
	allTcgCards, canAddTcgCard, deckCounts,
	deckProblemsClient, exportTcgDeck, fillTcgDeck, filterTcgCards, getTcgCard, groupDeck, importTcgDeck,
	isTcgPacked, loadTcgCardIndex, packTcgDeck, publishTcgFormatRules, showdownFormatFor, tcgCardIndexStatus,
	tcgCardLabel, tcgDeckFormatOf, tcgDeckRulesFor, tcgLegalAsReprint, tcgLegalityHint, tcgRegulationMarks, tcgSearchKey,
	unpackTcgDeck,
	type TcgCardRow, type TcgDeckFormat, type TcgDeckLine, type TcgExportStyle,
} from "./battle-tcg-deck";
import { toID } from "./battle-dex";

type SuperFilter = '' | 'P' | 'T' | 'E';
type EditorMode = 'deck' | 'import';

export type ValidateResult = {
	ok: boolean,
	errors: string[],
	deckSize?: number,
	rulesSize?: number,
	requestId?: number,
	deckKey?: string,
	cancelled?: boolean,
	/** the reply couldn't be tied to just this deck, so it can't approve it */
	ambiguous?: boolean,
};

export const TCG_AMBIGUOUS_VALIDATION_ERROR =
	'This check overlapped another deck of the same size. Validate again.';

type PendingValidateEntry = {
	requestId: number,
	deckKey: string,
	formatId: string,
	deckSize: number,
	cancelled: boolean,
	/** another unmatched check has the same format and deck size, so its reply can't be trusted */
	ambiguous: boolean,
	timer: number | null,
	resolve: (res: ValidateResult) => void,
};

const tcgValidateState: {
	nextId: number,
	queue: PendingValidateEntry[],
	/**
	 * a timed-out request got dropped from the queue, so its late reply would land on the next deck of the same
	 * size. the next matching reply gets thrown away once. `sinkArmed` stops one lost reply from eating every later
	 * success
	 */
	staleSink: { formatId: string, deckSize: number } | null,
	sinkArmed: boolean,
} = {
	nextId: 0,
	queue: [],
	staleSink: null,
	sinkArmed: true,
};

export function tcgDeckValidationKey(formatid: string, ids: string[]): string {
	return `${toID(formatid)}:${ids.join(',')}`;
}

export function cancelTcgValidate(requestId?: number) {
	for (const entry of tcgValidateState.queue) {
		if (requestId !== undefined && entry.requestId !== requestId) continue;
		if (entry.cancelled) continue;
		entry.cancelled = true;
		if (entry.timer != null) {
			window.clearTimeout(entry.timer);
			entry.timer = null;
		}
		entry.resolve({
			ok: false,
			errors: [],
			requestId: entry.requestId,
			deckKey: entry.deckKey,
			cancelled: true,
		});
	}
	if (requestId === undefined) {
		tcgValidateState.queue.length = 0;
		tcgValidateState.staleSink = null;
		tcgValidateState.sinkArmed = true;
	}
}

function responseFormatId(response: { format?: unknown }): string {
	return typeof response.format === 'string' ? toID(response.format) : '';
}

/** a reply pairs with a request when the host's echoed format and deck size match */
function responseMatchesEntry(entry: PendingValidateEntry, response: { format?: unknown, deckSize?: number }): boolean {
	if (typeof response.deckSize === 'number' && entry.deckSize !== response.deckSize) return false;
	const formatId = responseFormatId(response);
	if (formatId && entry.formatId && formatId !== entry.formatId) return false;
	return true;
}

function consumeStaleSink(response: { format?: unknown, deckSize?: number }): boolean {
	const sink = tcgValidateState.staleSink;
	if (!sink || typeof response.deckSize !== 'number' || sink.deckSize !== response.deckSize) return false;
	const formatId = responseFormatId(response);
	if (formatId && formatId !== sink.formatId) return false;
	const live = tcgValidateState.queue.some(entry => !entry.cancelled);
	tcgValidateState.staleSink = null;
	// nobody was waiting, so this was the timed-out reply. a newer request still waiting may have lost its own reply
	// here, so don't arm another
	tcgValidateState.sinkArmed = !live;
	return true;
}

function validValidateRequestId(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function settleValidateEntry(entry: PendingValidateEntry, response: ValidateResult, exact: boolean) {
	if (entry.timer != null) {
		window.clearTimeout(entry.timer);
		entry.timer = null;
	}
	tcgValidateState.sinkArmed = true;
	// a numbered reply only belongs to this request. one without a number still refuses if an earlier check of the
	// same size never got matched
	if (!exact && entry.ambiguous) {
		entry.resolve({
			ok: false,
			errors: [TCG_AMBIGUOUS_VALIDATION_ERROR],
			deckSize: response.deckSize,
			rulesSize: response.rulesSize,
			requestId: entry.requestId,
			deckKey: entry.deckKey,
			ambiguous: true,
		});
		return;
	}
	entry.resolve({
		ok: !!response.ok,
		errors: Array.isArray(response.errors) ? response.errors : [],
		deckSize: response.deckSize,
		rulesSize: response.rulesSize,
		requestId: entry.requestId,
		deckKey: entry.deckKey,
		ambiguous: false,
	});
}

function rejectDuplicateValidateIds(requestId: number) {
	const matches = tcgValidateState.queue.filter(item => item.requestId === requestId);
	if (matches.length < 2) return false;
	tcgValidateState.queue = tcgValidateState.queue.filter(item => item.requestId !== requestId);
	for (const entry of matches) {
		if (entry.cancelled) continue;
		entry.cancelled = true;
		if (entry.timer != null) {
			window.clearTimeout(entry.timer);
			entry.timer = null;
		}
		entry.resolve({
			ok: false,
			errors: [TCG_AMBIGUOUS_VALIDATION_ERROR],
			requestId: entry.requestId,
			deckKey: entry.deckKey,
			ambiguous: true,
		});
	}
	return true;
}

export function receiveTcgValidate(response: ValidateResult | null | undefined) {
	if (!response || typeof response !== 'object') return;
	if (validValidateRequestId(response.requestId)) {
		if (rejectDuplicateValidateIds(response.requestId)) return;
		const queue = tcgValidateState.queue;
		const idx = queue.findIndex(item => item.requestId === response.requestId);
		if (idx < 0) return;
		const entry = queue[idx];
		queue.splice(idx, 1);
		if (entry.cancelled) return;
		settleValidateEntry(entry, response, true);
		return;
	}
	if (consumeStaleSink(response)) return;
	const queue = tcgValidateState.queue;
	if (!queue.length) return;

	let entry: PendingValidateEntry | undefined;
	{
		while (
			queue.length > 1 &&
			queue[0].cancelled &&
			!responseMatchesEntry(queue[0], response) &&
			queue.some(item => !item.cancelled && responseMatchesEntry(item, response))
		) {
			queue.shift();
		}
		entry = queue.shift();
		if (entry && !entry.cancelled && !responseMatchesEntry(entry, response)) {
			queue.unshift(entry);
			return;
		}
	}

	if (!entry || entry.cancelled) return;
	settleValidateEntry(entry, response, false);
}

export function requestTcgValidate(formatid: string, ids: string[], timeoutMs = 8000): Promise<ValidateResult> {
	for (const prev of tcgValidateState.queue) {
		if (!prev.cancelled) {
			prev.cancelled = true;
			if (prev.timer != null) {
				window.clearTimeout(prev.timer);
				prev.timer = null;
			}
			prev.resolve({
				ok: false,
				errors: [],
				requestId: prev.requestId,
				deckKey: prev.deckKey,
				cancelled: true,
			});
		}
	}
	const deckIds = ids.slice();
	const requestId = ++tcgValidateState.nextId;
	const formatId = toID(formatid);
	const deckKey = tcgDeckValidationKey(formatid, deckIds);
	const deckSize = deckIds.length;
	const sink = tcgValidateState.staleSink;
	const sameShape = (prev: { formatId: string, deckSize: number }) =>
		prev.formatId === formatId && prev.deckSize === deckSize;
	const ambiguous = tcgValidateState.queue.some(sameShape) || (!!sink && sameShape(sink));
	return new Promise(resolve => {
		const entry: PendingValidateEntry = {
			requestId,
			deckKey,
			formatId,
			deckSize,
			cancelled: false,
			ambiguous,
			timer: null,
			resolve,
		};
		entry.timer = window.setTimeout(() => {
			entry.timer = null;
			if (entry.cancelled) return;
			entry.cancelled = true;
			const idx = tcgValidateState.queue.indexOf(entry);
			if (idx >= 0) tcgValidateState.queue.splice(idx, 1);
			if (tcgValidateState.sinkArmed) {
				tcgValidateState.staleSink = { formatId, deckSize };
			} else {
				tcgValidateState.sinkArmed = true;
			}
			resolve({
				ok: false,
				errors: ['Server did not respond. Client checks are shown above.'],
				requestId,
				deckKey,
			});
		}, timeoutMs);
		tcgValidateState.queue.push(entry);
		try {
			const deck = JSON.stringify(deckIds);
			const id = tcgFormatMetadataCache?.validateRequestId === true ? ` ${requestId}` : '';
			PS.send(`/cmd tcgvalidate ${toID(formatid)}${id} ${deck}`);
		} catch {
			const idx = tcgValidateState.queue.indexOf(entry);
			if (idx >= 0) tcgValidateState.queue.splice(idx, 1);
			if (entry.timer != null) {
				window.clearTimeout(entry.timer);
				entry.timer = null;
			}
			entry.cancelled = true;
			resolve({
				ok: false,
				errors: ['Server did not respond. Client checks are shown above.'],
				requestId,
				deckKey,
			});
		}
	});
}

export type TcgSubmitDecision = {
	submit: boolean,
	errors: string[],
};

/**
 * only the host's answer decides, local hints aren't used. a cancelled, failed or rejected request doesn't count
 * as legal. `rulesId` on the reply is the engine rules id and is ignored
 */
export function tcgHostDeckDecision(formatid: string, ids: string[]): Promise<TcgSubmitDecision> {
	const expectedKey = tcgDeckValidationKey(formatid, ids);
	return requestTcgValidate(formatid, ids).then(res => {
		if (res.cancelled || (res.deckKey && res.deckKey !== expectedKey)) {
			return { submit: false, errors: [] };
		}
		// an overlapped check is never a yes, even if the paired reply says ok
		if (res.ambiguous || !res.ok) {
			return {
				submit: false,
				errors: res.errors.length ? res.errors : ['The server could not validate this deck.'],
			};
		}
		return { submit: true, errors: [] };
	});
}

export type TcgPublicDeck = {
	minSize: number,
	maxSize: number,
	copyLimit: number,
	energyZone: boolean,
	allowAceSpec: boolean,
	allowRadiant: boolean,
	allowRuleBox: boolean,
	minPokemon?: number,
	samePokemonType?: boolean,
	legality?: 'standard' | 'expanded' | 'unlimited',
	regulationMin?: string,
	series?: string[],
};

export type TcgPublicFormat = {
	hostFormatId: string,
	engineRulesId: string,
	name: string,
	description: string,
	deckSource: 'player' | 'assigned',
	deck: TcgPublicDeck,
};

/** `validateRequestId` is stored but not used */
export type TcgFormatMetadata = {
	schema: 1,
	revision: number,
	complete: true,
	validateRequestId: boolean,
	formats: TcgPublicFormat[],
};

const TCG_LEGALITY = ['standard', 'expanded', 'unlimited'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeInt(value: unknown, min: number): number | null {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) return null;
	return value;
}

function requiredText(value: unknown): string | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	return value;
}

function parsePublicDeck(value: unknown): TcgPublicDeck | null {
	if (!isPlainObject(value)) return null;
	const minSize = safeInt(value.minSize, 1);
	const maxSize = safeInt(value.maxSize, 1);
	const copyLimit = safeInt(value.copyLimit, 1);
	if (minSize === null || maxSize === null || copyLimit === null || maxSize < minSize) return null;
	if (typeof value.energyZone !== 'boolean') return null;
	if (typeof value.allowAceSpec !== 'boolean') return null;
	if (typeof value.allowRadiant !== 'boolean') return null;
	if (typeof value.allowRuleBox !== 'boolean') return null;
	const deck: TcgPublicDeck = {
		minSize,
		maxSize,
		copyLimit,
		energyZone: value.energyZone,
		allowAceSpec: value.allowAceSpec,
		allowRadiant: value.allowRadiant,
		allowRuleBox: value.allowRuleBox,
	};
	if (value.minPokemon !== undefined) {
		const minPokemon = safeInt(value.minPokemon, 1);
		if (minPokemon === null) return null;
		deck.minPokemon = minPokemon;
	}
	if (value.samePokemonType !== undefined) {
		if (typeof value.samePokemonType !== 'boolean') return null;
		deck.samePokemonType = value.samePokemonType;
	}
	if (value.legality !== undefined) {
		if (typeof value.legality !== 'string' || !TCG_LEGALITY.includes(value.legality as typeof TCG_LEGALITY[number])) {
			return null;
		}
		deck.legality = value.legality as TcgPublicDeck['legality'];
	}
	if (value.regulationMin !== undefined) {
		if (typeof value.regulationMin !== 'string' || !/^[A-Z]$/.test(value.regulationMin)) return null;
		deck.regulationMin = value.regulationMin;
	}
	if (value.series !== undefined) {
		if (!Array.isArray(value.series) || value.series.some(item => typeof item !== 'string' || item.trim() === '')) {
			return null;
		}
		deck.series = value.series.slice();
	}
	return deck;
}

function parsePublicFormat(value: unknown): TcgPublicFormat | null {
	if (!isPlainObject(value)) return null;
	const hostFormatId = requiredText(value.hostFormatId);
	const engineRulesId = requiredText(value.engineRulesId);
	const name = requiredText(value.name);
	const description = requiredText(value.description);
	if (!hostFormatId || !engineRulesId || !name || !description) return null;
	if (value.deckSource !== 'player' && value.deckSource !== 'assigned') return null;
	const deck = parsePublicDeck(value.deck);
	if (!deck) return null;
	return { hostFormatId, engineRulesId, name, description, deckSource: value.deckSource, deck };
}

/** one bad row rejects the whole response. host ids are never made from rules ids */
export function parseTcgFormatMetadata(value: unknown): TcgFormatMetadata | null {
	if (!isPlainObject(value)) return null;
	if (value.schema !== 1) return null;
	if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) return null;
	if (value.complete !== true) return null;
	if (typeof value.validateRequestId !== 'boolean') return null;
	if (!Array.isArray(value.formats)) return null;
	const formats: TcgPublicFormat[] = [];
	const seen: { [id: string]: 1 } = {};
	for (const row of value.formats) {
		const format = parsePublicFormat(row);
		if (!format || seen[format.hostFormatId]) return null;
		seen[format.hostFormatId] = 1;
		formats.push(format);
	}
	return {
		schema: 1,
		revision: value.revision,
		complete: true,
		validateRequestId: value.validateRequestId,
		formats,
	};
}

let tcgFormatMetadataCache: TcgFormatMetadata | null = null;
let tcgFormatMetadataInflight: Promise<TcgFormatMetadata | null> | null = null;
let tcgFormatMetadataCurrent: Promise<TcgFormatMetadata | null> | null = null;
let tcgFormatMetadataWaiters: ((response: unknown) => void)[] | null = null;

export function cachedTcgFormatMetadata(): TcgFormatMetadata | null {
	return tcgFormatMetadataCache;
}

/** for tests. a dropped in-flight query doesn't count as a cached result */
function syncPublishedFormatRules() {
	publishTcgFormatRules(tcgFormatMetadataCache ? tcgFormatMetadataCache.formats : null);
}

export function resetTcgFormatMetadata() {
	tcgFormatMetadataCache = null;
	tcgFormatMetadataInflight = null;
	tcgFormatMetadataCurrent = null;
	tcgFormatMetadataWaiters = null;
	syncPublishedFormatRules();
}

function acceptTcgFormatMetadata(response: unknown): TcgFormatMetadata | null {
	const parsed = parseTcgFormatMetadata(response);
	if (parsed) tcgFormatMetadataCache = parsed;
	syncPublishedFormatRules();
	return tcgFormatMetadataCache;
}

function queryTcgFormats(): Promise<unknown> {
	const menu = typeof PS !== 'undefined' ? PS.mainmenu : undefined;
	if (menu && typeof menu.makeQuery === 'function') return menu.makeQuery('tcgformats');
	return new Promise((resolve, reject) => {
		if (!tcgFormatMetadataWaiters) {
			tcgFormatMetadataWaiters = [];
			try {
				PS.send('/cmd tcgformats');
			} catch (err) {
				tcgFormatMetadataWaiters = null;
				reject(err instanceof Error ? err : new Error('Could not query TCG formats'));
				return;
			}
		}
		tcgFormatMetadataWaiters.push(resolve);
	});
}

/** finishes a query started without `makeQuery`. a body nobody is waiting for is only cached if it parses */
export function receiveTcgFormatMetadata(response: unknown) {
	const waiting = tcgFormatMetadataWaiters;
	tcgFormatMetadataWaiters = null;
	if (waiting) {
		for (const resolve of waiting) resolve(response);
		return;
	}
	acceptTcgFormatMetadata(response);
}

function fetchTcgFormatMetadata(): Promise<TcgFormatMetadata | null> {
	const current = queryTcgFormats().then(acceptTcgFormatMetadata, () => tcgFormatMetadataCache).then(result => {
		if (tcgFormatMetadataInflight === tcgFormatMetadataCurrent) tcgFormatMetadataInflight = null;
		return result;
	});
	tcgFormatMetadataCurrent = current;
	tcgFormatMetadataInflight = current;
	return current;
}

export function loadTcgFormatMetadata(): Promise<TcgFormatMetadata | null> {
	if (tcgFormatMetadataCache) return Promise.resolve(tcgFormatMetadataCache);
	if (tcgFormatMetadataInflight) return tcgFormatMetadataInflight;
	return fetchTcgFormatMetadata();
}

/** a failed reply keeps the old cache. if a request is already in flight, one more follows it */
export function refreshTcgFormatMetadata(): Promise<TcgFormatMetadata | null> {
	if (!tcgFormatMetadataInflight) return fetchTcgFormatMetadata();
	const chained = tcgFormatMetadataInflight.then(() => fetchTcgFormatMetadata());
	tcgFormatMetadataInflight = chained;
	return chained;
}

const TCG_DECK_PAGE_SIZE = 40;

const ENERGY_TYPES = [
	'grass', 'fire', 'water', 'lightning', 'psychic', 'fighting',
	'darkness', 'metal', 'fairy', 'dragon', 'colorless',
];

type FillState = {
	before: string[],
	added: TcgDeckLine[],
	notes: string[],
};

export class TcgDeckEditor extends preact.Component<{
	team: Team,
	onChange: () => void,
	narrow?: boolean,
}> {
	override state = {
		ready: false,
		loadFailed: false,
		mode: 'deck' as EditorMode,
		searchText: '',
		q: '',
		super: '' as SuperFilter,
		type: '' as string,
		reg: '' as string,
		page: 0,
		ids: [] as string[],
		format: 'standard' as TcgDeckFormat | null,
		serverErrors: null as string[] | null,
		validating: false,
		preview: null as TcgCardRow | null,
		deckList: false,
		importText: '',
		importDirty: false,
		importErrors: null as string[] | null,
		importWarnings: null as string[] | null,
		exportStyle: 'live' as TcgExportStyle,
		copied: false,
		savedFlash: false,
		importHelp: false,
		fill: null as FillState | null,
	};

	searchTimer: number | null = null;
	copyTimer: number | null = null;
	savedTimer: number | null = null;
	importBox: HTMLTextAreaElement | null = null;
	resultsBox: HTMLDivElement | null = null;
	resultCache: { key: string, rows: TcgCardRow[], cards: TcgCardRow[] } | null = null;
	/** the saved deck this editor last read or wrote, anything else came from outside */
	lastPacked = '';
	unmounted = false;
	validateSeq = 0;
	activeValidateId = 0;

	cancelPendingValidation() {
		this.validateSeq++;
		if (this.activeValidateId) {
			cancelTcgValidate(this.activeValidateId);
			this.activeValidateId = 0;
		}
	}

	override componentDidMount() {
		this.unmounted = false;
		const format = tcgDeckFormatOf(this.props.team.format);
		const ids = unpackTcgDeck(this.props.team.packedTeam);
		this.lastPacked = this.props.team.packedTeam;
		this.setState({ format, ids });
		this.loadCatalog();
		void loadTcgFormatMetadata();
		window.addEventListener('keydown', this.onKeyDown);
	}

	loadCatalog = () => {
		this.setState({ loadFailed: false });
		loadTcgCardIndex().then(() => {
			if (this.unmounted) return;
			const status = tcgCardIndexStatus();
			this.setState({ ready: status === 'ready', loadFailed: status === 'failed' });
		});
	};

	override componentWillUnmount() {
		this.unmounted = true;
		this.cancelPendingValidation();
		window.removeEventListener('keydown', this.onKeyDown);
		if (this.searchTimer != null) window.clearTimeout(this.searchTimer);
		if (this.copyTimer != null) window.clearTimeout(this.copyTimer);
		if (this.savedTimer != null) window.clearTimeout(this.savedTimer);
	}

	onKeyDown = (ev: KeyboardEvent) => {
		if (ev.key === 'Escape' && this.state.preview) this.closePreview();
	};

	override componentDidUpdate() {
		// the team object gets changed in place, so compare with what this editor last saw
		const { packedTeam } = this.props.team;
		const format = tcgDeckFormatOf(this.props.team.format);
		if (format !== this.state.format) {
			this.cancelPendingValidation();
			this.lastPacked = packedTeam;
			// the new format might hide these filters, which would leave them on with no way to turn them off
			this.setState({
				format,
				page: 0,
				super: '',
				type: '',
				reg: '',
				ids: unpackTcgDeck(packedTeam),
				serverErrors: null,
				validating: false,
				fill: null,
			});
			return;
		}
		if (packedTeam !== this.lastPacked) {
			this.lastPacked = packedTeam;
			this.cancelPendingValidation();
			this.setState({ ids: unpackTcgDeck(packedTeam), serverErrors: null, validating: false, fill: null });
		}
	}

	commit(ids: string[], format: TcgDeckFormat | null = this.state.format) {
		this.cancelPendingValidation();
		const team = this.props.team;
		team.packedTeam = this.lastPacked = packTcgDeck(ids);
		team.iconCache = null;
		// an unknown format id stays on the saved deck, don't rewrite it to standard
		if (format) {
			const psFormat = showdownFormatFor(format);
			const cur = toID(team.format);
			if (!cur.includes('tcg') || cur.includes('random') ||
				(format === 'pocket' && !cur.includes('pocket')) ||
				(format === 'custom' && !cur.includes('custom')) ||
				(format === 'standard' && (cur.includes('pocket') || cur.includes('custom')))) {
				team.format = psFormat as any;
			}
		}
		// any edit after a fill drops its summary and undo. fillDeck sets them after committing
		this.setState({ ids, format, serverErrors: null, validating: false, fill: null });
		this.props.onChange();
	}

	fillDeck = () => {
		const format = this.state.format;
		if (!format) return;
		const before = this.state.ids;
		const result = fillTcgDeck(before, format, this.props.team.format);
		if (result.ids.length !== before.length) this.commit(result.ids);
		this.setState({ fill: { before, added: result.added, notes: result.notes } });
	};

	undoFill = () => {
		const fill = this.state.fill;
		if (fill) this.commit(fill.before);
	};

	closeFill = () => {
		this.setState({ fill: null });
	};

	/** the one place a card count changes. keeps the deck order so the row stays under the cursor */
	setQty = (id: string, qty: number) => {
		const next = this.state.ids.slice();
		let have = next.filter(x => x === id).length;
		for (; have > Math.max(0, qty); have--) next.splice(next.lastIndexOf(id), 1);
		const card = getTcgCard(id);
		const format = this.state.format;
		if (card) {
			for (; have < qty && (format ? canAddTcgCard(next, card, format, this.props.team.format) : true); have++) {
				next.push(id);
			}
		}
		if (next.length !== this.state.ids.length) this.commit(next);
	};

	addCard = (id: string) => {
		this.setQty(id, this.state.ids.filter(x => x === id).length + 1);
	};

	canAdd(card: TcgCardRow | undefined) {
		if (!card) return false;
		if (!this.state.format) return true;
		return canAddTcgCard(this.state.ids, card, this.state.format, this.props.team.format);
	}

	openPreview = (card: TcgCardRow | null) => {
		this.setState({ preview: card });
	};

	closePreview = () => {
		this.setState({ preview: null });
	};

	openDeckList = () => {
		this.setState({
			mode: 'deck', deckList: true, preview: null,
			importErrors: null, importWarnings: null, copied: false,
		});
	};

	closeDeckList = () => {
		this.setState({ deckList: false });
	};

	showDeck = () => {
		this.setState({
			mode: 'deck', deckList: false,
			importErrors: null, importWarnings: null, copied: false,
		});
	};

	onSearch = (ev: Event) => {
		const q = (ev.currentTarget as HTMLInputElement).value;
		this.setState({ searchText: q });
		if (this.searchTimer != null) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => {
			if (!this.unmounted) this.setFilters({ q });
		}, 80);
	};

	setFilters(filters: Partial<{ q: string, super: SuperFilter, type: string, reg: string }>) {
		this.setState({ ...filters, page: 0, deckList: false });
		if (this.resultsBox) this.resultsBox.scrollTop = 0;
	}

	goToPage(page: number) {
		this.setState({ page });
		if (this.resultsBox) this.resultsBox.scrollTop = 0;
	}

	validate = () => {
		this.cancelPendingValidation();
		const seq = ++this.validateSeq;
		const formatid = this.props.team.format || (this.state.format ? showdownFormatFor(this.state.format) : '');
		const snapshotIds = this.state.ids.slice();
		const expectedKey = tcgDeckValidationKey(formatid, snapshotIds);
		this.setState({ validating: true, serverErrors: null });
		const pending = requestTcgValidate(formatid, snapshotIds);
		const lastEntry = tcgValidateState.queue[tcgValidateState.queue.length - 1];
		this.activeValidateId = lastEntry ? lastEntry.requestId : 0;
		pending.then(res => {
			if (this.unmounted || seq !== this.validateSeq || res.cancelled) return;
			const currentFormat = this.props.team.format || (this.state.format ? showdownFormatFor(this.state.format) : '');
			if (tcgDeckValidationKey(currentFormat, this.state.ids) !== expectedKey) return;
			if (res.deckKey && res.deckKey !== expectedKey) return;
			this.activeValidateId = 0;
			// no errors only means clean if this reply is for this deck
			if (res.ambiguous || !res.ok) {
				this.setState({
					validating: false,
					serverErrors: res.errors.length ? res.errors : ['The server could not validate this deck.'],
				});
				return;
			}
			this.setState({ validating: false, serverErrors: [] });
		});
	};

	exportText(ids = this.state.ids) {
		return exportTcgDeck(ids, this.state.exportStyle);
	}

	setMode = (mode: EditorMode) => {
		if (mode === this.state.mode) return;
		if (mode === 'import') {
			this.setState({
				mode,
				importText: this.exportText(),
				importDirty: false,
				importErrors: null,
				importWarnings: null,
				copied: false,
				preview: null,
			});
			return;
		}
		this.setState({ mode, importErrors: null, importWarnings: null, copied: false });
	};

	onImportInput = (ev: Event) => {
		const importText = (ev.currentTarget as HTMLTextAreaElement).value;
		const importDirty = importText !== this.exportText();
		this.setState({ importText, importDirty, importErrors: null, importWarnings: null });
	};

	/** a popup opened during a click gets closed by that same click, so wait for the click to finish */
	alertAfterClick(message: string) {
		window.setTimeout(() => PS.alert(message));
	}

	applyImport = () => {
		const result = importTcgDeck(this.state.importText, this.state.format);
		// on any error keep the deck and the pasted text, so the list can be fixed
		if (result.errors.length) {
			this.setState({ importErrors: result.errors, importWarnings: result.warnings });
			return false;
		}
		this.commit(result.ids);
		this.setState({
			mode: 'deck',
			importText: this.exportText(result.ids),
			importDirty: false,
			importErrors: null,
			importWarnings: result.warnings.length ? result.warnings : null,
		});
		if (result.warnings.length) {
			this.alertAfterClick(result.warnings.slice(0, 8).join('\n') + (result.warnings.length > 8 ? '\n…' : ''));
		}
		return true;
	};

	/** the deck is already saved on every edit, this is just the button people look for at the top */
	saveDeck = () => {
		if (this.state.mode === 'import' && this.state.importDirty && !this.applyImport()) return;
		this.props.onChange();
		this.setState({ savedFlash: true });
		if (this.savedTimer != null) window.clearTimeout(this.savedTimer);
		this.savedTimer = window.setTimeout(() => {
			this.savedTimer = null;
			if (!this.unmounted) this.setState({ savedFlash: false });
		}, 1500);
	};

	setExportStyle = (exportStyle: TcgExportStyle) => {
		if (exportStyle === this.state.exportStyle) return;
		// keep text the player edited, only a clean export switches style
		if (this.state.importDirty) {
			this.setState({ exportStyle });
			return;
		}
		this.setState({ exportStyle, importText: exportTcgDeck(this.state.ids, exportStyle), copied: false });
	};

	resetImport = () => {
		this.setState({
			importText: this.exportText(),
			importDirty: false,
			importErrors: null,
			importWarnings: null,
		});
	};

	copyExport = () => {
		const text = this.state.importDirty ? this.state.importText : this.exportText();
		const clip = navigator.clipboard;
		if (!clip?.writeText) {
			this.alertAfterClick('Could not copy to clipboard. Select the text and copy manually.');
			return;
		}
		clip.writeText(text).then(() => {
			if (this.unmounted) return;
			this.setState({ copied: true });
			if (this.copyTimer != null) window.clearTimeout(this.copyTimer);
			this.copyTimer = window.setTimeout(() => {
				this.copyTimer = null;
				if (!this.unmounted) this.setState({ copied: false });
			}, 1500);
		}, () => {
			PS.alert('Could not copy to clipboard. Select the text and copy manually.');
		});
	};

	filteredCards(): TcgCardRow[] {
		if (!this.state.ready) return [];
		const { q, super: kind, type, reg, format } = this.state;
		const rows = allTcgCards();
		// render runs on every deck change and the catalog is too big to filter every time
		const key = [format, kind, type, reg, tcgSearchKey(q)].join('|');
		if (this.resultCache?.key === key && this.resultCache.rows === rows) return this.resultCache.cards;
		const cards = filterTcgCards({ format, q, super: kind, type, reg });
		this.resultCache = { key, rows, cards };
		return cards;
	}

	renderIllegal(card: TcgCardRow) {
		const { format } = this.state;
		if (!format || tcgLegalityHint(card, format, this.props.team.format) !== 'illegal') return null;
		const direct = tcgDeckRulesFor(this.props.team.format);
		const hostId = format === 'pocket' ? 'tcgpocket' : format === 'custom' ? 'tcgcustomgame' : 'tcgstandard';
		const named = direct?.format === format ? direct : tcgDeckRulesFor(hostId);
		const name = named ? named.name : 'this format';
		const reason = card.std && card.lf ? `Legal from ${card.lf}` : `Not legal in ${name}`;
		return <em class="tcg-deck-illegal" title={reason}>Illegal</em>;
	}

	resultPage(results: TcgCardRow[]) {
		const pageCount = Math.max(1, Math.ceil(results.length / TCG_DECK_PAGE_SIZE));
		const page = Math.min(this.state.page, pageCount - 1);
		const start = page * TCG_DECK_PAGE_SIZE;
		return { page, pageCount, start, cards: results.slice(start, start + TCG_DECK_PAGE_SIZE) };
	}

	override render() {
		const { ids, format, preview, mode, savedFlash, deckList } = this.state;
		const showingDeck = mode === 'deck' && !deckList;

		return <div class={`tcg-deck-builder${this.props.narrow ? ' narrow' : ''}`}>
			<div class="tcg-deck-tabrow">
				<ul class="tabbar unpadded-tabbar tcg-deck-tabs">
					<li>
						<button type="button" class={`button${showingDeck ? ' cur' : ''}`} onClick={this.showDeck}>
							Deck
						</button>
					</li>
					<li>
						<button
							type="button"
							class={`button${mode === 'deck' && deckList ? ' cur' : ''}`}
							onClick={this.openDeckList}
						>
							Preview
						</button>
					</li>
					<li>
						<button
							type="button"
							class={`button button-last${mode === 'import' ? ' cur' : ''}`}
							onClick={() => this.setMode('import')}
						>
							Import/Export
						</button>
					</li>
				</ul>
				<button type="button" class="button tcg-deck-save" onClick={this.saveDeck}>
					<i class={`fa fa-${savedFlash ? 'check' : 'save'}`} aria-hidden></i> {savedFlash ? 'Saved' : 'Save'}
				</button>
			</div>
			{mode === 'import' ? this.renderImportExport() :
			deckList ? this.renderDeckList(ids) :
			this.renderDeckBuilder()}
			{preview && mode === 'deck' && this.renderPreviewModal(preview, ids, format)}
		</div>;
	}

	renderDeckBuilder() {
		const { ids, format, ready, loadFailed, validating, serverErrors, fill } = this.state;
		const resolved = tcgDeckRulesFor(this.props.team.format);
		const rules = resolved?.format === format ? resolved : null;
		const problems = ready && format ? deckProblemsClient(ids, format, this.props.team.format) : [];
		const counts = deckCounts(ids);
		const lines = groupDeck(ids);
		const poke = lines.filter(l => l.card?.s === 'P');
		const train = lines.filter(l => l.card?.s === 'T');
		const ener = lines.filter(l => l.card?.s === 'E');
		// a card the catalog doesn't know still counts, so it needs a row to be removed from
		const other = lines.filter(l => !['P', 'T', 'E'].includes(l.card?.s || ''));
		const results = this.filteredCards();
		const resultPage = this.resultPage(results);
		const minSize = rules ? rules.minSize : 0;
		const countCls = !rules ? '' : ids.length >= minSize && ids.length <= rules.maxSize ?
			'ok' : ids.length > rules.maxSize ? 'over' : 'short';

		return <div class="tcg-deck-main">
			<aside class="tcg-deck-rail">
				<div class="tcg-deck-rail-head">
					<div class={`tcg-deck-count ${countCls}`}>{ids.length}{rules && <small>/{rules.maxSize}</small>}</div>
					<div class="tcg-deck-split">
						<span>Pokémon {counts.pokemon}</span>
						<span>Trainer {counts.trainer}</span>
						<span>Energy {counts.energy}</span>
					</div>
					<button
						type="button" class="button tcg-deck-fill" onClick={this.fillDeck}
						disabled={!ready || !rules || ids.length >= rules.maxSize}
						title="Keep your cards and complete the deck: evolution lines, Trainers and Energy"
					>
						<i class="fa fa-magic" aria-hidden></i> Fill deck
					</button>
					<button type="button" class="button tcg-deck-validate" onClick={this.validate} disabled={validating}>
						<i class="fa fa-check" aria-hidden></i> {validating ? '…' : 'Validate'}
					</button>
				</div>

				{fill && this.renderFillSummary(fill)}

				<div class="tcg-deck-lists">
					{this.renderGroup('Pokémon', poke)}
					{this.renderGroup('Trainer', train)}
					{this.renderGroup('Energy', ener)}
					{this.renderGroup(ready ? 'Unknown cards' : 'Cards', other)}
					{!lines.length && (isTcgPacked(this.props.team.packedTeam) ?
						<p class="tcg-deck-empty">Your deck is empty. Use + on cards below to add them.</p> :
						<p class="tcg-deck-empty">This deck's saved data could not be read. Adding a card replaces it.</p>
					)}
				</div>

				{!format && <p class="tcg-deck-empty">
					This format has no local deck rules. Validate asks the server.
				</p>}

				{(problems.length > 0 || serverErrors?.length) && (
					<div class="tcg-deck-legal bad">
						<ul>
							{problems.map(e => <li>{e}</li>)}
							{serverErrors?.map(e => <li>{e}</li>)}
						</ul>
					</div>
				)}
			</aside>

			<div class="tcg-deck-browser">
				<div class="tcg-deck-searchbar">
					<input
						class="textbox tcg-deck-search" type="search" placeholder="Search cards…"
						value={this.state.searchText} onInput={this.onSearch} autofocus
					/>
					<div class="tcg-deck-chips">
						{(format === 'pocket' ? ['', 'P', 'T'] as SuperFilter[] : ['', 'P', 'T', 'E'] as SuperFilter[]).map(s =>
							<button
								type="button"
								class={`button${this.state.super === s ? ' cur' : ''}`}
								onClick={() => this.setFilters({ super: s })}
							>{s === '' ? 'All' : s === 'P' ? 'Pokémon' : s === 'T' ? 'Trainer' : 'Energy'}</button>
						)}
					</div>
					{format && format !== 'pocket' && <div class="tcg-deck-chips">
						<select
							class="select" value={this.state.type}
							onChange={ev => this.setFilters({ type: (ev.currentTarget as HTMLSelectElement).value })}
						>
							<option value="">Any type</option>
							{ENERGY_TYPES.map(t => <option value={t}>{t}</option>)}
						</select>
						<select
							class="select" value={this.state.reg}
							onChange={ev => this.setFilters({ reg: (ev.currentTarget as HTMLSelectElement).value })}
						>
							<option value="">Any regulation</option>
							{tcgRegulationMarks(format).map(r => <option value={r}>{r}+</option>)}
						</select>
					</div>}
				</div>
				{ready && this.renderPager(results.length, resultPage)}
				{loadFailed && <p class="tcg-deck-load-error">
					The card catalog did not load, so cards cannot be browsed. Your deck is safe. {}
					<button type="button" class="button" onClick={this.loadCatalog}>Try again</button>
				</p>}
				{!ready ? !loadFailed && <p class="tcg-deck-loading">Loading card catalog…</p> : (
					<div class="tcg-deck-results" ref={el => { this.resultsBox = el; }}>
						{resultPage.cards.map((c, i) => {
							const before = results[resultPage.start + i - 1];
							const hinted = (card: TcgCardRow) => !!format &&
								tcgLegalityHint(card, format, this.props.team.format) === 'illegal';
							const firstIllegal = hinted(c) && (!before || !hinted(before));
							return [
								firstIllegal && <h3 key="illegal" class="tcg-deck-results-head">Illegal cards</h3>,
								this.renderCardTile(c, ids),
							];
						})}
						{!results.length && <p class="tcg-deck-empty">No cards match.</p>}
					</div>
				)}
				{ready && this.renderPager(results.length, resultPage)}
			</div>
		</div>;
	}

	renderPager(total: number, { page, pageCount, start, cards }: ReturnType<TcgDeckEditor['resultPage']>) {
		if (!total) return null;
		const onPage = (ev: Event) => {
			const input = ev.currentTarget as HTMLInputElement;
			const wanted = Math.floor(Number(input.value));
			const next = wanted >= 1 ? Math.min(wanted, pageCount) - 1 : page;
			input.value = String(next + 1);
			if (next !== page) this.goToPage(next);
		};
		return <div class="tcg-deck-pager">
			<span class="tcg-deck-pager-count">{start + 1}–{start + cards.length} of {total}</span>
			{pageCount > 1 && <span class="tcg-deck-chips">
				<button type="button" class="button" disabled={!page} onClick={() => this.goToPage(0)}>First</button>
				<button type="button" class="button" disabled={!page} onClick={() => this.goToPage(page - 1)}>Previous</button>
				<label class="tcg-deck-pager-page">
					Page {}
					<input
						class="textbox" type="number" min="1" max={pageCount} value={page + 1}
						aria-label="Page number" onChange={onPage}
					/>
					{} of {pageCount}
				</label>
				<button type="button" class="button" disabled={page >= pageCount - 1} onClick={() => this.goToPage(page + 1)}>
					Next
				</button>
				<button type="button" class="button" disabled={page >= pageCount - 1} onClick={() => this.goToPage(pageCount - 1)}>
					Last
				</button>
			</span>}
		</div>;
	}

	renderImportExport() {
		const { importText, importDirty, importErrors, importWarnings, exportStyle, copied, ready, importHelp } = this.state;
		// rebuild a clean export every time, text from before the catalog loaded has no card names
		const text = importDirty || !ready ? importText : this.exportText();
		return <div class="tcg-deck-import">
			<p class="buttonbar tcg-deck-import-actions">
				<span class={`tcg-deck-import-hint${importHelp ? ' is-open' : ''}`}>
					<button
						type="button" class="subtle tcg-deck-import-hint-icon"
						aria-label="How import and export work" aria-expanded={importHelp}
						aria-describedby="tcg-deck-import-help"
						onClick={() => this.setState({ importHelp: !importHelp })}
					>
						<i class="fa fa-question-circle" aria-hidden></i>
					</button>
					<span class="tcg-deck-import-help" id="tcg-deck-import-help" role="tooltip">
						Paste a deck list below, or copy this export. Accepts Pokémon TCG Live and Limitless lines
						(<code>4 Darkrai-EX DEX 63</code>), card id lines (<code>4 Darkrai-EX bw5-63</code>), bare card ids,
						or a JSON id array. A line with a set and number imports that exact printing or reports an error.
						Importing replaces this deck, and nothing changes if any line has an error.
					</span>
				</span> {}
				Export as: {}
				<button
					type="button"
					class={`button button-first${exportStyle === 'live' ? ' cur' : ''}`}
					onClick={() => this.setExportStyle('live')}
				>
					TCG Live
				</button>
				<button
					type="button"
					class={`button button-last${exportStyle === 'ids' ? ' cur' : ''}`}
					onClick={() => this.setExportStyle('ids')}
				>
					Card ids
				</button>
			</p>
			<p class="buttonbar tcg-deck-import-actions">
				<button type="button" class="button" onClick={this.applyImport} disabled={!ready}>
					<i class="fa fa-upload" aria-hidden></i> Import
				</button>
			</p>
			<textarea
				class="textbox tcg-deck-import-box"
				value={text}
				onInput={this.onImportInput}
				spellcheck={false}
				ref={el => { this.importBox = el; }}
			/>
			<p class="buttonbar tcg-deck-import-actions">
				<button type="button" class="button" onClick={this.applyImport} disabled={!ready}>
					<i class="fa fa-upload" aria-hidden></i> Import
				</button> {}
				<button type="button" class="button" onClick={this.copyExport} disabled={!ready}>
					<i class="fa fa-clipboard" aria-hidden></i> {copied ? 'Copied!' : 'Copy'}
				</button> {}
				{importDirty && <button type="button" class="button" onClick={this.resetImport}>
					Reset
				</button>}
			</p>
			{(importWarnings?.length || importErrors?.length) && (
				<div class="tcg-deck-import-msgs">
					{importWarnings?.map(w => <div class="tcg-deck-import-warn">{w}</div>)}
					{importErrors?.map(e => <div class="tcg-deck-import-err">{e}</div>)}
				</div>
			)}
		</div>;
	}

	reprintNote(card: TcgCardRow) {
		return tcgLegalAsReprint(card, this.state.format, this.props.team.format) ?
			'Legal as a reprint of a current printing.' : '';
	}

	renderCardTile(card: TcgCardRow, ids: string[]) {
		const inDeck = ids.filter(x => x === card.id).length;
		const label = tcgCardLabel(card);
		const reprint = this.reprintNote(card);
		return <div
			key={card.id}
			class={`tcg-deck-card${inDeck ? ' in-deck' : ''}`}
			title={`${card.n}${label ? ` (${label})` : ''}.${reprint ? ` ${reprint}` : ''} Click the art to preview.`}
		>
			<button type="button" class="tcg-deck-card-art" onClick={() => this.openPreview(card)}>
				{card.i ? <img src={card.i} alt="" /> : <span class="tcg-deck-card-fallback">{card.n}</span>}
				{this.renderIllegal(card)}
			</button>
			<span class="tcg-deck-card-meta">
				<strong>{card.n}</strong>
				<small>{label}</small>
				<code class="tcg-deck-card-id">{card.id}</code>
			</span>
			<div class="tcg-deck-card-qty">
				<button
					type="button" class="tcg-deck-qty" disabled={!inDeck}
					onClick={ev => { ev.stopPropagation(); this.setQty(card.id, inDeck - 1); }}
					aria-label={`Remove one ${card.n}`}
				>−</button>
				<span class="tcg-deck-qty-n">{inDeck}</span>
				<button
					type="button" class="tcg-deck-qty" disabled={!this.canAdd(card)}
					onClick={ev => { ev.stopPropagation(); this.addCard(card.id); }}
					aria-label={`Add one ${card.n}`}
				>+</button>
			</div>
		</div>;
	}

	renderDeckList(ids: string[]) {
		const lines = groupDeck(ids);
		const groups: [string, TcgDeckLine[]][] = [
			['Pokémon', lines.filter(l => l.card?.s === 'P')],
			['Trainer', lines.filter(l => l.card?.s === 'T')],
			['Energy', lines.filter(l => l.card?.s === 'E')],
		];
		const other = lines.filter(l => !['P', 'T', 'E'].includes(l.card?.s || ''));
		if (other.length) groups.push(['Other', other]);
		if (!lines.length) return <p class="tcg-deck-empty">Your deck is empty.</p>;
		return <div class="tcg-deck-results tcg-deck-only" ref={el => { this.resultsBox = el; }}>
			{groups.map(([title, rows]) => !rows.length ? null : [
				<h3 key={title} class="tcg-deck-results-head">{title} ({rows.reduce((n, l) => n + l.n, 0)})</h3>,
				rows.map(line => line.card ? this.renderCardTile(line.card, ids) : <div key={line.id} class="tcg-deck-card">
					<span class="tcg-deck-card-fallback">{line.id}</span>
					<span class="tcg-deck-card-meta">
						<strong>{line.id}</strong>
					</span>
					<div class="tcg-deck-card-qty">
						<button
							type="button" class="tcg-deck-qty"
							onClick={() => this.setQty(line.id, line.n - 1)}
							aria-label={`Remove one ${line.id}`}
						>−</button>
						<span class="tcg-deck-qty-n">{line.n}</span>
						<button type="button" class="tcg-deck-qty" disabled aria-label={`Add one ${line.id}`}>+</button>
					</div>
				</div>),
			])}
		</div>;
	}

	renderPreviewModal(card: TcgCardRow, ids: string[], format: TcgDeckFormat | null) {
		const inDeck = ids.filter(x => x === card.id).length;
		const label = tcgCardLabel(card);
		const large = card.i ? card.i.replace('_SM.webp', '.webp').replace('small', 'large') : '';
		const kind = card.s === 'P' ? 'Pokémon' : card.s === 'T' ? 'Trainer' : 'Energy';
		return <div
			class="ps-overlay tcg-deck-modal"
			role="dialog"
			aria-modal="true"
			aria-label={card.n}
			onClick={this.closePreview}
		>
			<div class="ps-popup tcg-deck-modal-card" onClick={ev => ev.stopPropagation()}>
				<button type="button" class="button tcg-deck-modal-close" onClick={this.closePreview} aria-label="Close">×</button>
				{large ? <img src={large} alt={card.n} /> : <div class="tcg-deck-card-fallback">{card.n}</div>}
				<div class="tcg-deck-modal-info">
					<strong>{card.n}</strong>
					{label && <div>{label}</div>}
					{this.reprintNote(card) && <div class="tcg-deck-reprint">{this.reprintNote(card)}</div>}
					{this.renderIllegal(card)}
					<div>{kind}{(card.u || []).length ? `: ${card.u.join(', ')}` : ''}</div>
					<div class="tcg-deck-card-qty tcg-deck-modal-qty">
						<button
							type="button"
							class="tcg-deck-qty"
							disabled={!inDeck}
							onClick={() => this.setQty(card.id, inDeck - 1)}
							aria-label={`Remove one ${card.n}`}
						>−</button>
						<span class="tcg-deck-qty-n">{inDeck}</span>
						<button
							type="button"
							class="tcg-deck-qty"
							disabled={!this.canAdd(card)}
							onClick={() => this.addCard(card.id)}
							aria-label={`Add one ${card.n}`}
						>+</button>
					</div>
				</div>
			</div>
		</div>;
	}

	renderFillSummary(fill: FillState) {
		const count = fill.added.reduce((n, l) => n + l.n, 0);
		return <div class="tcg-deck-fill-summary" role="status">
			<div class="tcg-deck-fill-head">
				<strong>{count ? `Added ${count} card${count === 1 ? '' : 's'}` : 'Nothing added'}</strong>
				{count > 0 && <button type="button" class="button" onClick={this.undoFill}>
					<i class="fa fa-undo" aria-hidden></i> Undo
				</button>}
				<button type="button" class="button" onClick={this.closeFill} aria-label="Dismiss">×</button>
			</div>
			{count > 0 && <p class="tcg-deck-fill-added">
				{fill.added.map(l => `${l.n} ${l.card?.n || l.id}`).join(', ')}
			</p>}
			{fill.notes.length > 0 && <ul>{fill.notes.map(n => <li>{n}</li>)}</ul>}
		</div>;
	}

	renderGroup(title: string, lines: ReturnType<typeof groupDeck>) {
		if (!lines.length) return null;
		return <section>
			<h3>{title} <small>({lines.reduce((n, l) => n + l.n, 0)})</small></h3>
			<ul>
				{lines.map(line =>
					<li key={line.id}>
						<button type="button" class="tcg-deck-qty" onClick={() => this.setQty(line.id, line.n - 1)}>−</button>
						<span class="tcg-deck-qty-n">{line.n}</span>
						<button
							type="button" class="tcg-deck-qty" disabled={!this.canAdd(line.card)}
							onClick={() => this.addCard(line.id)}
						>+</button>
						<button type="button" class="tcg-deck-line-name" onClick={() => this.openPreview(line.card || null)}>
							{line.card?.n || line.id}
							<code class="tcg-deck-card-id">{line.id}</code>
						</button>
					</li>
				)}
			</ul>
		</section>;
	}
}
