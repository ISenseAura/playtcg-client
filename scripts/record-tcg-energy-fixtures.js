/**
 * records test/battle-tcg-energy-classification.fixtures.json from a built WaveTCG checkout.
 * usage: node scripts/record-tcg-energy-fixtures.js [path-to-wave-tcg]
 * the test runs the client against what the engine sends: a few boards built with WaveTCG's test harness, and
 * the engine's basic or special call for every energy card. this saves those outputs as they are, so the test
 * doesn't need WaveTCG. re-run it after rebuilding the card index, the test's WaveTCG check fails until the two
 * match again
 * 
 * i may wanna get rid of this file and just run the test against a built WaveTCG, like i do with the card index.
 * that would mean running the test against the client, which is a pain.
 * 
 */
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {checkoutForScript} = require('../build-tools/wave-tcg');

const OUT = process.env.TCG_ENERGY_FIXTURES_OUT ||
	path.resolve(__dirname, '..', 'test', 'battle-tcg-energy-classification.fixtures.json');

const ACCELGOR = 'sv9-13';
const DECIDUEYE = 'me3-12';
const GRASS = 'mee-1';
const NEO_UPPER = 'sv5-162';
const OLD_DARKNESS = 'neo1-104';
const ENERGY_SWITCH = 'sv1-173';

function record(waveTcgRoot) {
	const dist = path.join(waveTcgRoot, 'dist');
	const {makeBoard} = require(path.join(dist, 'testing', 'board.js'));
	const catalog = require(path.join(dist, 'catalog.js'));
	const print = require(path.join(dist, 'print.js'));

	/** accelgor active with basic grass energy, decidueye ex benched with basic grass energy and neo upper energy */
	function board(hand = []) {
		const b = makeBoard({
			me: {
				active: {card: ACCELGOR, stack: ['sv9-12', ACCELGOR], energy: [GRASS]},
				bench: [{card: DECIDUEYE, stack: ['me3-10', 'me3-11', DECIDUEYE], energy: [GRASS, NEO_UPPER]}],
				hand,
			},
			foe: {active: {card: 'sv1-1'}},
		});
		b.me.turnsTaken = 1;
		b.foe.turnsTaken = 1;
		for (const m of [b.me.active, ...b.me.bench]) if (m) m.justPlayed = false;
		return b;
	}
	const snap = (b, who) => JSON.parse(JSON.stringify(b.game.snapshot(who)));
	const events = b => JSON.parse(JSON.stringify(b.game.viewEvents('p1', b.game.lastEvents.slice())));

	const reported = board();

	const energySwitch = board([ENERGY_SWITCH]);
	energySwitch.act({type: 'playTrainer', hand: 0});
	const energySwitchBefore = snap(energySwitch, 'p1');
	energySwitch.act(energySwitch.actions().find(a => a.ref && a.ref.iid === energySwitch.me.active.iid));

	const retreat = board();
	const retreatBefore = snap(retreat, 'p1');
	retreat.act({type: 'retreat', bench: 0});

	const attach = board([OLD_DARKNESS]);
	const attachBefore = snap(attach, 'p1');
	attach.act({type: 'attachEnergy', hand: 0, slot: 'active'});

	return {
		boards: {
			reported: {p1: snap(reported, 'p1'), p2: snap(reported, 'p2'), spectator: snap(reported, undefined)},
			energySwitch: {before: energySwitchBefore, events: events(energySwitch), after: snap(energySwitch, 'p1')},
			retreat: {before: retreatBefore, events: events(retreat), afterForOpponent: snap(retreat, 'p2')},
			attachOldDarkness: {before: attachBefore, events: events(attach)},
		},
		energies: catalog.allCards().filter(print.isEnergy)
			.map(c => [c.id, c.name, print.isBasicEnergy(c) ? 'basic' : 'special'])
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
	};
}

function source(waveTcgRoot) {
	const git = args => {
		try {
			return childProcess.execFileSync('git', args, {cwd: waveTcgRoot, encoding: 'utf8'}).trim();
		} catch {
			return null;
		}
	};
	const commit = git(['rev-parse', 'HEAD']);
	const pinFile = path.join(waveTcgRoot, 'data', 'paper', '.catalog-pin');
	return {
		wavetcgCommit: commit,
		wavetcgTrackedChanges: commit === null ? null : git(['status', '--porcelain', '--untracked-files=no']) !== '',
		paperCatalogPin: fs.existsSync(pinFile) ? fs.readFileSync(pinFile, 'utf8').trim() : null,
		recordedBy: 'scripts/record-tcg-energy-fixtures.js',
	};
}

if (require.main === module) {
	const root = checkoutForScript(process.argv[2]);
	const fixtures = {source: source(root), ...record(root)};
	fs.writeFileSync(OUT, JSON.stringify(fixtures, null, '\t') + '\n');
	const b = fixtures.boards;
	console.log(`Wrote ${OUT}`);
	console.log(`  WaveTCG ${fixtures.source.wavetcgCommit}${fixtures.source.wavetcgTrackedChanges ? ' (with tracked changes)' : ''}`);
	console.log(`  events: Energy Switch ${b.energySwitch.events.length}, retreat ${b.retreat.events.length}, ` +
		`attach ${b.attachOldDarkness.events.length}; Energy cards: ${fixtures.energies.length}`);
}

module.exports = {record};
