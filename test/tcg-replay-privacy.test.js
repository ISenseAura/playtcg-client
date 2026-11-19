'use strict';


const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it} = require('node:test');
const vm = require('vm');

global.window = global;
global.preact = {
	Component: class {},
	h() { return null; },
	render() {},
};
global.PS = {prefs: {}};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.lookupAttackHit = function () { return null; };

const choicePath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg-choice.js');
vm.runInThisContext(fs.readFileSync(choicePath, 'utf8'), {filename: choicePath});
const boardPath = path.resolve(__dirname, '../play.pokemonshowdown.com/js/battle-tcg.js');
vm.runInThisContext(fs.readFileSync(boardPath, 'utf8'), {filename: boardPath});

const {publicGameEnd, spectatorReplayFrom, filterTcgEventsForViewer} = global;

const DIGEST = 'manifest-digest-public';

function boardSnapshot(players) {
	return {
		you: null,
		status: 'over',
		turn: 4,
		turnNumber: 4,
		winner: 1,
		actions: [],
		format: {id: 'pocket', benchSize: 3, prizes: 3, energyZone: true},
		players: players || [
			{id: 'alice', name: 'Alice', deck: {count: 10}},
			{id: 'bob', name: 'Bob', deck: {count: 12}},
		],
	};
}

function spectator(snapshot, events) {
	return {snapshot, events};
}

function assertNoSecrets(value) {
	const text = JSON.stringify(value);
	assert.equal(text.includes('SECRET-'), false);
	assert.equal(text.includes('"seed"'), false);
	assert.equal(text.includes('"manifest"'), false);
	assert.equal(text.includes('"zoneTypes"'), false);
}

describe('public replay privacy', () => {
	it('plays a legacy replay that has no manifest', () => {
		const events = [{type: 'turn', seq: 1, number: 1, seat: 0}];
		const gameEnd = {
			type: 'gameEnd',
			seq: 2,
			result: {winner: 1, reason: 'Bob took all Prize cards.'},
			replay: {
				audience: 'public',
				version: 1,
				id: 'legacy-1',
				formatId: 'standard',
				players: [
					{id: 'alice', name: 'Alice'},
					{id: 'bob', name: 'Bob'},
				],
				events,
				spectator: spectator(boardSnapshot(), events),
				result: {winner: 1, reason: 'Bob took all Prize cards.'},
			},
		};
		const clean = publicGameEnd(gameEnd);
		assert.equal(clean.replay.manifestId, undefined);
		assert.equal('manifest' in clean.replay, false);
		assert.equal(clean.replay.audience, 'public');
		assert.equal(clean.replay.id, 'legacy-1');
		assert.equal(clean.replay.formatId, 'standard');
		const played = spectatorReplayFrom(gameEnd);
		assert.equal(played.events[0].type, 'turn');
		assert.equal(played.snapshot.format.benchSize, 3);
		assert.equal(played.snapshot.players[1].name, 'Bob');
		assert.equal(played.winnerName, 'Bob');
	});

	it('keeps manifestId on a public replay and does not add a manifest', () => {
		const events = [{type: 'start', seq: 1}];
		const gameEnd = {
			type: 'gameEnd',
			seq: 4,
			result: {winner: 0, reason: 'Alice won.'},
			replay: {
				audience: 'public',
				version: 1,
				id: 'game-public',
				formatId: 'pocketrandom',
				manifestId: DIGEST,
				players: [
					{id: 'alice', name: 'Alice'},
					{id: 'bob', name: 'Bob'},
				],
				events,
				spectator: spectator(boardSnapshot(), events),
				result: {winner: 0, reason: 'Alice won.'},
			},
		};
		const clean = publicGameEnd(gameEnd);
		assert.equal(clean.replay.manifestId, DIGEST);
		assert.equal('manifest' in clean.replay, false);
		assert.equal('seed' in clean.replay, false);
		assert.equal(clean.replay.version, 1);
		assert.equal(clean.replay.formatId, 'pocketrandom');
		assert.equal(clean.replay.players[0].name, 'Alice');
		const played = spectatorReplayFrom(gameEnd);
		assert.equal(played.snapshot.status, 'over');
		assert.equal(played.events[0].type, 'start');
		assert.equal(played.winnerName, 'Alice');
		assertNoSecrets(clean);
		assertNoSecrets(played);
	});

	it('strips a host-shaped replay and leaves the archive object unchanged', () => {
		const events = [{type: 'start', seq: 1}, {type: 'turn', seq: 2, number: 1, seat: 0}];
		const manifest = {
			id: DIGEST,
			hostFormatId: 'tcgpocketrandom',
			engineRulesId: 'pocketrandom',
			seed: 7919001,
			catalogFingerprint: 'SECRET-FINGERPRINT',
			seats: [
				{cards: ['SECRET-CARD-ALICE'], zoneTypes: ['SECRET-ZONE-FIRE']},
				{cards: ['SECRET-CARD-BOB'], zoneTypes: ['SECRET-ZONE-WATER']},
			],
		};
		const gameEnd = {
			type: 'gameEnd',
			seq: 9,
			result: {winner: 1, reason: 'Bob won.'},
			replay: {
				audience: 'host',
				version: 1,
				id: 'game-host',
				formatId: 'pocketrandom',
				seed: 7919001,
				manifest,
				manifestId: DIGEST,
				players: [
					{id: 'alice', name: 'Alice', deck: ['SECRET-CARD-ALICE'], zoneTypes: ['SECRET-ZONE-FIRE']},
					{id: 'bob', name: 'Bob', deck: ['SECRET-CARD-BOB'], zoneTypes: ['SECRET-ZONE-WATER']},
				],
				events,
				spectator: spectator(boardSnapshot([
					{id: 'alice', name: 'Alice', deck: ['SECRET-CARD-ALICE'], zoneTypes: ['SECRET-ZONE-FIRE']},
					{id: 'bob', name: 'Bob', deck: {count: 12}, zoneTypes: ['SECRET-ZONE-WATER']},
				]), events),
				result: {winner: 1, reason: 'Bob won.'},
			},
		};
		const before = JSON.stringify(gameEnd);
		const clean = publicGameEnd(gameEnd);
		assert.equal(JSON.stringify(gameEnd), before);
		assert.notEqual(clean, gameEnd);
		assert.notEqual(clean.replay, gameEnd.replay);
		assert.notEqual(clean.replay.players[0], gameEnd.replay.players[0]);
		assert.notEqual(clean.replay.spectator, gameEnd.replay.spectator);
		assert.notEqual(clean.replay.spectator.snapshot, gameEnd.replay.spectator.snapshot);

		assert.equal(clean.replay.audience, 'public');
		assert.equal(clean.replay.manifestId, DIGEST);
		assert.equal('manifest' in clean.replay, false);
		assert.equal('seed' in clean.replay, false);
		assert.equal(clean.replay.id, 'game-host');
		assert.equal(clean.replay.formatId, 'pocketrandom');
		assert.equal(clean.replay.version, 1);
		assert.deepEqual(clean.replay.players[0], {id: 'alice', name: 'Alice'});
		assert.deepEqual(clean.replay.players[1], {id: 'bob', name: 'Bob'});
		assert.equal(clean.replay.result.winner, 1);
		assert.equal(clean.replay.result.reason, 'Bob won.');
		assert.equal(clean.replay.events[1].type, 'turn');
		assert.equal(clean.replay.spectator.snapshot.format.prizes, 3);
		assert.equal(clean.replay.spectator.snapshot.players[0].name, 'Alice');
		assert.equal('deck' in clean.replay.spectator.snapshot.players[0], false);
		assert.equal('zoneTypes' in clean.replay.spectator.snapshot.players[0], false);
		assert.deepEqual(clean.replay.spectator.snapshot.players[1].deck, {count: 12});
		assert.equal('zoneTypes' in clean.replay.spectator.snapshot.players[1], false);
		assertNoSecrets(clean);

		const played = spectatorReplayFrom(gameEnd);
		assert.equal(played.winnerName, 'Bob');
		assert.equal(played.events.length, 2);
		assert.equal(played.snapshot.format.energyZone, true);
		assert.deepEqual(played.snapshot.players[1].deck, {count: 12});
		assertNoSecrets(played);
		assert.equal(JSON.stringify(gameEnd), before);

		const filtered = filterTcgEventsForViewer([gameEnd], null);
		assertNoSecrets(filtered);
		assert.equal(filtered[0].replay.manifestId, DIGEST);
		assert.equal(JSON.stringify(gameEnd), before);
	});

	it('keeps the |tcgreplay| wrapper as the playback source', () => {
		const events = [{type: 'turn', seq: 1, number: 2, seat: 1}];
		const payload = {
			format: 'tcgpocketrandom',
			formatName: 'tcgpocketrandom',
			p1: 'Alice',
			p2: 'Bob',
			winner: 'Bob',
			replay: {
				snapshot: boardSnapshot(),
				events,
			},
		};
		const raw = `|tcgreplay|${JSON.stringify(payload)}`;
		let body = raw.trim();
		assert.equal(body.startsWith('|tcgreplay|'), true);
		body = body.slice('|tcgreplay|'.length);
		const data = JSON.parse(body);
		const hosted = spectatorReplayFrom(data);
		const replay = hosted || data.replay || {snapshot: data.snapshot, events: data.events};
		assert.equal(hosted, null);
		assert.equal(data.format, 'tcgpocketrandom');
		assert.equal(data.p1, 'Alice');
		assert.equal(data.p2, 'Bob');
		assert.equal(data.winner, 'Bob');
		assert.equal(replay.snapshot.format.benchSize, 3);
		assert.equal(replay.events[0].type, 'turn');
		assert.equal(replay.snapshot.players[0].deck.count, 10);
		assert.equal('manifestId' in data, false);
	});
});

function storedReplay(data) {
	const hosted = spectatorReplayFrom(data);
	const replay = hosted || data.replay || {snapshot: data.snapshot, events: data.events};
	return {hosted, replay};
}

function hostArchive(manifest) {
	const events = [{type: 'start', seq: 1}, {type: 'turn', seq: 2, number: 1, seat: 0}];
	const archive = {
		audience: 'host',
		version: 1,
		id: 'host-file',
		formatId: 'pocketrandom',
		seed: 7919001,
		players: [
			{id: 'alice', name: 'Alice', deck: ['SECRET-CARD-ALICE'], zoneTypes: ['SECRET-ZONE-FIRE']},
			{id: 'bob', name: 'Bob', deck: ['SECRET-CARD-BOB'], zoneTypes: ['SECRET-ZONE-WATER']},
		],
		events: [{type: 'draw', seq: 1, seat: 0, ids: ['SECRET-PRIVATE-DRAW']}],
		spectator: {
			snapshot: boardSnapshot([
				{
					id: 'alice', name: 'Alice', deck: ['SECRET-CARD-ALICE'], zoneTypes: ['SECRET-ZONE-FIRE'],
					hand: ['SECRET-HAND-ALICE'],
					energyZone: {type: 'fire', types: ['fire', 'lightning'], ready: true},
				},
				{
					id: 'bob', name: 'Bob', deck: {count: 12}, zoneTypes: ['SECRET-ZONE-WATER'],
					hand: {count: 5},
					energyZone: {type: 'water', types: ['water'], ready: false},
				},
			]),
			events,
		},
		result: {winner: 1, reason: 'Bob won.'},
	};
	if (manifest) archive.manifest = manifest;
	return archive;
}

describe('raw host replay files', () => {
	const manifest = {
		id: DIGEST,
		hostFormatId: 'tcgpocketrandom',
		seed: 7919001,
		catalogFingerprint: 'SECRET-FINGERPRINT',
		seats: [{cards: ['SECRET-CARD-ALICE']}, {cards: ['SECRET-CARD-BOB']}],
	};

	it('strips a private spectator snapshot and does not store the manifest or seed', () => {
		const archive = hostArchive(manifest);
		const before = JSON.stringify(archive);
		const {hosted, replay} = storedReplay(archive);
		assert.equal(JSON.stringify(archive), before);
		assert.notEqual(hosted.snapshot, archive.spectator.snapshot);
		assert.equal(hosted.winnerName, 'Bob');
		assert.equal(replay.snapshot.format.benchSize, 3);
		assert.equal(replay.snapshot.format.energyZone, true);
		assert.equal('deck' in replay.snapshot.players[0], false);
		assert.equal('zoneTypes' in replay.snapshot.players[0], false);
		assert.deepEqual(replay.snapshot.players[0].hand, {count: 1});
		assert.deepEqual(replay.snapshot.players[0].energyZone.types, ['fire', 'lightning']);
		assert.deepEqual(replay.snapshot.players[1].deck, {count: 12});
		assert.equal('zoneTypes' in replay.snapshot.players[1], false);
		assert.deepEqual(replay.events.map(e => e.type), ['start', 'turn']);
		assert.equal(replay.events[1].number, 1);
		assertNoSecrets(replay);
		assert.equal(JSON.stringify(archive), before);
	});

	it('strips a legacy host file that has no manifest', () => {
		const archive = hostArchive();
		assert.equal('manifest' in archive, false);
		const before = JSON.stringify(archive);
		const {replay} = storedReplay(archive);
		assert.equal(JSON.stringify(archive), before);
		assert.deepEqual(replay.snapshot.players[1].deck, {count: 12});
		assert.equal(replay.events[0].type, 'start');
		assert.equal(replay.snapshot.players[1].name, 'Bob');
		assertNoSecrets(replay);
	});

	it('leaves a public replay with deck counts on its own snapshot', () => {
		const events = [{type: 'turn', seq: 1, number: 1, seat: 0}];
		const data = {
			format: 'tcgpocket',
			formatName: 'tcgpocket',
			p1: 'Alice',
			p2: 'Bob',
			winner: 'Alice',
			replay: {snapshot: boardSnapshot(), events},
		};
		const before = JSON.stringify(data);
		const {hosted, replay} = storedReplay(data);
		assert.equal(hosted, null);
		assert.equal(replay, data.replay);
		assert.deepEqual(replay.snapshot.players[0].deck, {count: 10});
		assert.deepEqual(replay.snapshot.players[1].deck, {count: 12});
		assert.equal(replay.events[0].type, 'turn');
		assert.equal(JSON.stringify(data), before);
	});
});
