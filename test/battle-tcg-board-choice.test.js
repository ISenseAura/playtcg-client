'use strict';


const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it} = require('node:test');
const vm = require('vm');

global.window = global;
global.preact = {
	Component: function () {},
	h(type, props, ...children) { return {type, props: props || {}, children: children.flat(Infinity)}; },
	render() {},
};
global.PS = {prefs: {tcghints: true}};
global.Net = function () {
	const pending = {then() { return pending; }, catch() { return pending; }};
	return {get() { return pending; }};
};
global.lookupAttackHit = function () { return null; };
global.getTcgCard = function () { return undefined; };
global.document = {querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }};

for (const file of ['battle-tcg-choice.js', 'battle-tcg.js']) {
	const p = path.resolve(__dirname, '../play.pokemonshowdown.com/js', file);
	vm.runInThisContext(fs.readFileSync(p, 'utf8'), {filename: p});
}
const {TcgBoard, boardChoiceOf} = global;
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'battle-tcg-board-choice.fixtures.json'), 'utf8'));
const step = (name, i) => JSON.parse(JSON.stringify(FIX[name][i]));

function board(s, extra = {}) {
	const b = new TcgBoard();
	b.sent = [];
	b.props = {
		snapshot: s.snapshot, fxSnapshot: null, events: s.events, onEvent() {}, onAct(a) { b.sent.push(a); },
		fxKey: 1, waiting: false, ended: false, ...extra,
	};
	b.state = {...b.state, fx: null, koHide: {}};
	b.setState = patch => Object.assign(b.state, typeof patch === 'function' ? patch(b.state) : patch);
	return b;
}
function next(b, s) {
	b.props = {...b.props, snapshot: s.snapshot, events: s.events};
}
const flush = () => new Promise(resolve => queueMicrotask(resolve));

function all(node, test, out = []) {
	if (!node || typeof node !== 'object') return out;
	if (test(node)) out.push(node);
	(node.children || []).forEach(c => all(c, test, out));
	return out;
}
const classOf = n => String((n.props && n.props.class) || '');
const text = n => (typeof n === 'object' && n ? n.children.map(text).join(' ') : String(n === false || n == null ? '' : n)).trim();
const byClass = (tree, cls) => all(tree, n => classOf(n).split(' ').includes(cls));
const refused = b => (b.state.refuse && b.state.refuse.text) || '';
const AT = {clientX: 5, clientY: 5};
function mons(tree) {
	const out = {};
	for (const n of all(tree, n => n.props && n.props.mon && n.props.slot !== undefined)) out[n.props.mon.iid] = n.props;
	return out;
}
const bar = tree => byClass(tree, 'tcg-choice-bar')[0];
const picker = tree => byClass(tree, 'tcg-choice-picker')[0];
const cards = tree => all(picker(tree), n => n.type === 'button' && classOf(n).includes('tcg-choice-card'));
const legacyCopy = tree => all(tree, n => classOf(n) === 'tcg-prompt kind-copy')[0];
const rowsOf = s => s.snapshot.actions;

describe('Energy Switch on the board', () => {
	it('step 1: only the Pokémon with a legal Energy row are offered; the board is dimmed, not covered', () => {
		const s = step('energySwitch', 0);
		const b = board(s);
		const tree = b.render();
		assert.equal(legacyCopy(tree), undefined, 'no text-button menu over the board');
		assert.ok(classOf(all(tree, n => classOf(n).startsWith('tcg-table'))[0]).includes('is-choosing'));
		assert.deepEqual([b.slotActionable('active'), b.slotActionable(0), b.slotActionable(1), b.slotActionable('active', true)],
			[true, true, false, false], 'the two Bulbasaur with Basic Energy, not the Pokémon without, not the opponent');
		const m = mons(tree);
		assert.deepEqual([m.m1.keyPick, m.m2.keyPick, m.m3.keyPick], [true, true, undefined], 'keyboard focus only on offered Pokémon');
		assert.equal(m.m1.mon.name, m.m2.mon.name, 'two Pokémon with the same name');
		assert.match(text(bar(tree)), /Choose the Basic Energy to move\./);
		assert.match(text(bar(tree)), /Choose a highlighted Pokémon, then its Energy\./);
		const thumb = all(bar(tree), n => n.type === 'img' && classOf(n) === 'tcg-choice-source')[0];
		assert.ok(thumb && /me1/.test(thumb.props.src), 'the Energy Switch played this batch is shown');
		assert.equal(picker(tree), undefined, 'no picker before a Pokémon is chosen');
	});

	it('step 2: each Bulbasaur opens its own Energy; identical copies are one card; a card sends exactly its row', () => {
		const s = step('energySwitch', 0);
		const b = board(s);
		b.clickSlot('active', false, AT);
		let tree = b.render();
		assert.deepEqual(b.sent, [], 'opening a Pokémon sends nothing');
		assert.equal(mons(tree).m1.selected, true);
		const active = cards(tree);
		assert.deepEqual(active.map(c => c.props['aria-label']).map(l => /2 copies/.test(l)), [true, false],
			'two Grass are one card (×2), Fire is the other');
		assert.equal(active.length, 2);
		active[0].props.onClick();
		const grassRow = rowsOf(s).find(a => a.ref && a.ref.iid === 'm1' && a.ref.cardId === 'sve-1');
		assert.deepEqual(b.sent, [grassRow], 'the engine row for the Active\'s Grass');

		const c = board(s);
		c.clickSlot(0, false, AT);
		tree = c.render();
		assert.equal(mons(tree).m2.selected, true, 'the Benched Bulbasaur, by instance');
		assert.equal(cards(tree).length, 1);
		cards(tree)[0].props.onClick();
		assert.deepEqual(c.sent, [rowsOf(s).find(a => a.ref && a.ref.iid === 'm2')]);
	});

	it('a Pokémon that is not offered is refused; Back and Escape return to the Pokémon without sending', () => {
		const s = step('energySwitch', 0);
		const b = board(s);
		b.clickSlot(1, false, AT);
		assert.deepEqual([b.sent, b.state.boardPick], [[], null]);
		assert.match(refused(b), /highlighted Pokémon/);
		b.clickSlot('active', false, AT);
		let back = all(picker(b.render()), n => n.type === 'button' && text(n) === 'Back')[0];
		assert.ok(back, 'Back is offered while nothing has been sent');
		back.props.onClick();
		assert.deepEqual([b.state.boardPick, b.sent], [null, []]);
		b.clickSlot(0, false, AT);
		b.onKeyDown({key: 'Escape'});
		assert.deepEqual([b.state.boardPick, b.sent], [null, []], 'Escape is Back');
		b.clickSlot(0, false, AT);
		cards(b.render())[0].props.onClick();
		back = all(picker(b.render()), n => n.type === 'button' && text(n) === 'Back')[0];
		assert.equal(back, undefined, 'no Back once the row is sent');
	});

	it('while the answer is in flight the cards are disabled and the sent one is marked', () => {
		const s = step('energySwitch', 0);
		const b = board(s);
		b.clickSlot('active', false, AT);
		cards(b.render())[1].props.onClick();
		b.props = {...b.props, waiting: true};
		const tree = b.render();
		assert.ok(cards(tree).every(c => c.props.disabled));
		assert.deepEqual(cards(tree).map(c => classOf(c).includes('is-sent')), [false, true]);
		cards(tree)[0].props.onClick();
		assert.equal(b.sent.length, 1, 'no second send');
	});

	it('step 3: the destination shows what moves and from where, and sends the engine\'s slot pick', () => {
		const s = step('energySwitch', 1);
		const b = board(s);
		const tree = b.render();
		assert.match(text(bar(tree)), /Choose the Pokémon to move the Energy to\./);
		assert.match(text(bar(tree)), /from Bulbasaur/);
		const m = mons(tree);
		assert.equal(m.m2.choiceFrom, true, 'the Pokémon the Energy comes off is marked');
		assert.deepEqual([b.slotLegal('active'), b.slotLegal(0), b.slotLegal(1)], [true, false, true], 'not the source');
		b.clickSlot(0, false, AT);
		assert.deepEqual(b.sent, []);
		assert.match(refused(b), /highlighted Pokémon/);
		b.clickSlot(1, false, AT);
		assert.deepEqual(b.sent, [{type: 'pickSlot', slot: 1}]);
	});

	it('a changed prompt, a stale attachment, or a finished choice clears the board choice', async () => {
		const b = board(step('energySwitch', 0));
		b.clickSlot('active', false, AT);
		next(b, step('energySwitch', 1));
		b.render();
		await flush();
		assert.equal(b.state.boardPick, null, 'the destination prompt drops the opened Pokémon');

		const stale = step('energySwitch', 0);
		stale.snapshot.players[0].active.energyCards = ['sve-2', 'sve-1', 'sve-1'];
		assert.equal(boardChoiceOf(stale.snapshot, null), null, 'a ref that no longer matches the board is not used');
		const s = board(stale);
		const tree = s.render();
		assert.ok(legacyCopy(tree), 'the old menu takes over');
		assert.ok(!classOf(all(tree, n => classOf(n).startsWith('tcg-table'))[0]).includes('is-choosing'));

		const done = board(step('energySwitch', 2));
		const t = done.render();
		assert.equal(bar(t), undefined, 'no choice bar on the turn after');
		assert.ok(byClass(t, 'tcg-float-hint').length, 'the usual hint is back');
		done.clickSlot('active', false, AT);
		assert.equal(done.state.menuSlot, 'active', 'tapping the Active opens its menu again');
	});
});

describe('Tag Switch', () => {
	it('the TAG TEAM source is a slot pick; its Energy opens at once (one source), with Done and no Back', () => {
		let b = board(step('tagSwitch', 0));
		let tree = b.render();
		assert.match(text(bar(tree)), /Choose the TAG TEAM Pokémon to move Energy from\./);
		assert.equal(picker(tree), undefined);
		b = board(step('tagSwitch', 1));
		tree = b.render();
		assert.ok(picker(tree), 'one source: no Pokémon step');
		assert.equal(all(picker(tree), n => n.type === 'button' && text(n) === 'Back')[0], undefined);
		assert.match(text(bar(tree)), /Choose up to 2 Energy to move\./);
		assert.deepEqual(cards(tree).map(c => /2 copies/.test(c.props['aria-label'])), [true, false], 'Fire ×2, Water');
		const done = all(bar(tree), n => n.type === 'button' && text(n) === 'Done')[0];
		done.props.onClick();
		assert.deepEqual(b.sent, [rowsOf(step('tagSwitch', 1)).find(a => a.pick === 'done')]);
	});

	it('after one Fire the other copy is still offered; the destination names both cards', () => {
		const b = board(step('tagSwitch', 2));
		const tree = b.render();
		const fire = cards(tree).find(c => /Fire|sve-2/.test(c.props['aria-label']));
		assert.ok(fire && !/copies/.test(fire.props['aria-label']), 'one Fire left, as the engine offers');
		const dest = board(step('tagSwitch', 3));
		const t = dest.render();
		assert.match(text(bar(t)), /Choose the Pokémon to move the Energy to\./);
		assert.equal(mons(t)[step('tagSwitch', 3).snapshot.pendingSlotPick.from.iid].choiceFrom, true);
		assert.equal(step('tagSwitch', 3).snapshot.pendingSlotPick.from.cardIds.length, 2);
	});
});

describe('Eneporter', () => {
	it('the sources are the opponent\'s Pokémon; the picker says whose', () => {
		const s = step('eneporter', 0);
		const b = board(s);
		b.render();
		assert.deepEqual([b.slotActionable('active', true), b.slotActionable(0, true), b.slotActionable(1, true), b.slotActionable('active')],
			[true, true, false, false]);
		b.clickSlot(0, true, AT);
		const tree = b.render();
		assert.match(text(byClass(tree, 'tcg-choice-picker-head')[0]), /Opponent's Bench 1/);
		cards(tree)[0].props.onClick();
		assert.deepEqual(b.sent, [rowsOf(s).find(a => a.ref && a.ref.iid === s.snapshot.players[1].bench[0].iid)]);
	});

	it('the destination is on the opponent\'s side only: the same Bench spot on your side is not offered', () => {
		const b = board(step('eneporter', 1));
		b.render();
		assert.deepEqual([b.slotLegal(1, true), b.slotLegal(1, false), b.slotLegal('active', false)], [true, false, false]);
		b.clickSlot(1, false, AT);
		assert.deepEqual(b.sent, [], 'tapping your own Bench 2 does not send the opponent\'s');
		b.clickSlot(1, true, AT);
		assert.deepEqual(b.sent, [{type: 'pickSlot', slot: 1}]);
	});
});

describe('the damage-counter Trainers', () => {
	it('Damage Mover: the source, then the destination with the source marked', () => {
		let b = board(step('damageMover', 0));
		assert.match(text(bar(b.render())), /Choose the Pokémon to move 3 damage counters from\./);
		const s = step('damageMover', 1);
		b = board(s);
		const tree = b.render();
		assert.match(text(bar(tree)), /Choose the Pokémon to move the damage counters to\./);
		assert.equal(mons(tree)[s.snapshot.pendingSlotPick.from.iid].choiceFrom, true);
		b.clickSlot(1, false, AT);
		assert.deepEqual(b.sent, [{type: 'pickSlot', slot: 1}]);
	});

	it('Damage Pump: the count keeps its menu, titled with the instruction and its source', () => {
		const s = step('damagePump', 1);
		const b = board(s);
		const tree = b.render();
		const menu = legacyCopy(tree);
		assert.ok(menu, 'a count is not a board object');
		assert.match(text(menu), /Choose how many damage counters to move\./);
		assert.match(text(menu), /from /);
		const buttons = all(menu, n => n.type === 'button');
		assert.deepEqual(buttons.map(text), ['Move 1 damage counter', 'Move 2 damage counters']);
		buttons[1].props.onClick();
		assert.deepEqual(b.sent, [rowsOf(s)[1]]);
		const d = board(step('damagePump', 2));
		assert.match(text(bar(d.render())), /Choose a Pokémon to move a damage counter to\./);
	});

	it('Grimsley: the opponent\'s source and destination, the count in between', () => {
		const b = board(step('grimsley', 0));
		b.render();
		assert.match(text(bar(b.render())), /Choose the opponent's Pokémon to move damage counters from\./);
		assert.deepEqual([b.slotLegal('active', true), b.slotLegal('active', false)], [true, false]);
		const c = board(step('grimsley', 1));
		assert.match(text(legacyCopy(c.render())), /Choose how many damage counters to move\./);
		const d = board(step('grimsley', 2));
		const tree = d.render();
		assert.match(text(bar(tree)), /Choose the opponent's Pokémon to move the damage counters to\./);
		d.clickSlot(0, false, AT);
		assert.deepEqual(d.sent, [], 'not your own side');
		d.clickSlot(0, true, AT);
		assert.deepEqual(d.sent, [{type: 'pickSlot', slot: 0}]);
	});
});

describe('choices the board does not take', () => {
	it('rows with ref but no instruction (Tool Scrapper) keep the old menu', () => {
		const s = step('toolScrapper', 0);
		assert.equal(boardChoiceOf(s.snapshot, null), null);
		const b = board(s);
		const tree = b.render();
		const menu = legacyCopy(tree);
		assert.ok(menu);
		assert.ok(all(menu, n => n.type === 'button').length >= 4, 'Done and the three Tools');
		assert.equal(bar(tree), undefined);
	});
});

describe('one attached card on the Pokémon the Trainer names', () => {
	const art = c => all(c, n => n.type === 'img' && classOf(n) === 'tcg-choice-card-art')[0].props['data-card'];
	const thumb = tree => all(bar(tree), n => n.type === 'img' && classOf(n) === 'tcg-choice-source')[0];
	const head = tree => text(byClass(tree, 'tcg-choice-picker-head')[0]);
	const button = (tree, label) => all(tree, n => n.type === 'button' && text(n) === label)[0];

	it('Enhanced Hammer: the picker opens on the opposing Active at once, with its real cards; a card sends its row', () => {
		const s = step('enhancedHammer', 0);
		const b = board(s);
		const tree = b.render();
		assert.equal(legacyCopy(tree), undefined, 'no text-button menu');
		assert.ok(picker(tree), 'one Pokémon: no Pokémon step');
		assert.match(head(tree), /Opponent's Active/);
		assert.match(text(bar(tree)), /Choose the Special Energy to discard\./);
		assert.doesNotMatch(text(bar(tree)), /highlighted Pokémon/, 'nothing to choose before the cards');
		assert.ok(thumb(tree) && /sv6/.test(thumb(tree).props.src), 'the Enhanced Hammer played this batch');
		assert.deepEqual(cards(tree).map(art), ['sv6-166', 'sv2-190'], 'Boomerang and Jet; the Fire is not offered');
		assert.deepEqual(cards(tree).map(c => /2 copies/.test(c.props['aria-label'])), [true, false], 'the two Boomerang are one card');
		assert.equal(button(picker(tree), 'Back'), undefined, 'no Back: there is no other Pokémon to go back to');
		cards(tree)[0].props.onClick();
		assert.deepEqual(b.sent, [rowsOf(s).find(a => a.ref && a.ref.cardId === 'sv6-166')], 'exactly the offered row');
		assert.deepEqual(b.sent[0].ref.at, [0, 3]);
		const done = board(step('enhancedHammer', 1)).render();
		assert.equal(bar(done), undefined, 'the choice is over');
	});

	it('Enhanced Hammer: Escape and other Pokémon send nothing; a refusal makes the cards usable again', () => {
		const s = step('enhancedHammer', 0);
		const b = board(s);
		b.render();
		b.onKeyDown({key: 'Escape'});
		assert.ok(picker(b.render()), 'Escape does not dismiss a choice the engine requires');
		b.clickSlot('active', false, AT);
		b.clickSlot(0, true, AT);
		assert.deepEqual(b.sent, []);
		cards(b.render())[1].props.onClick();
		const prev = b.props;
		const prevState = {...b.state};
		b.props = {...prev, waiting: true};
		assert.ok(cards(b.render()).every(c => c.props.disabled), 'disabled while in flight');
		cards(b.render())[0].props.onClick();
		assert.equal(b.sent.length, 1, 'no second send');
		b.props = {...prev, notice: "That play isn't legal.", noticeN: 1};
		b.componentDidUpdate(prev, prevState);
		assert.ok(cards(b.render()).every(c => !c.props.disabled && !classOf(c).includes('is-sent')), 'usable again');
	});

	it('the opponent sees no instruction, no refs, and no picker', () => {
		const s = step('enhancedHammerFoeView', 0);
		assert.equal(s.snapshot.pendingCopyAttack, undefined);
		assert.ok(!JSON.stringify(s.snapshot.actions).includes('"ref"') && !JSON.stringify(s.events).includes('"ask"'));
		assert.equal(boardChoiceOf(s.snapshot, null), null);
		const tree = board(s).render();
		assert.deepEqual([bar(tree), picker(tree)], [undefined, undefined]);
	});

	it('Team Star Grunt: two Fire are one card; it sends the row covering both copies', () => {
		const s = step('teamStarGrunt', 0);
		const b = board(s);
		const tree = b.render();
		assert.match(text(bar(tree)), /Choose the Energy to put on top of your opponent's deck\./);
		assert.deepEqual(cards(tree).map(art), ['sve-2', 'sve-3']);
		assert.match(cards(tree)[0].props['aria-label'], /2 copies/);
		cards(tree)[0].props.onClick();
		assert.deepEqual(b.sent, [rowsOf(s)[0]]);
		assert.deepEqual(b.sent[0].ref.at, [0, 2]);
	});

	it('Giacomo: each opposing Pokémon in turn; the next one starts usable even with the same pick', () => {
		const b = board(step('giacomo', 0));
		let tree = b.render();
		assert.match(head(tree), /Opponent's Active/);
		const jet = cards(tree).find(c => art(c) === 'sv2-190');
		jet.props.onClick();
		assert.equal(b.sent[0].pick, '0:sv2-190');
		const prev = b.props;
		next(b, step('giacomo', 1));
		b.componentDidUpdate(prev, {...b.state});
		tree = b.render();
		assert.match(head(tree), /Opponent's Bench 1/);
		assert.deepEqual(cards(tree).map(art), ['base1-96', 'sv2-190']);
		assert.ok(cards(tree).every(c => !c.props.disabled && !classOf(c).includes('is-sent')));
		assert.ok(thumb(tree) && /sv2/.test(thumb(tree).props.src), 'still the Giacomo being resolved');
		cards(tree)[0].props.onClick();
		assert.deepEqual(b.sent[1], rowsOf(step('giacomo', 1))[0], 'the Benched Pokémon\'s Double Colorless');
		assert.equal(bar(board(step('giacomo', 2)).render()), undefined);
	});

	it('Ruffian: the Tools by their art, then the Special Energy; each step sends its own row', () => {
		const s = step('ruffian', 0);
		const b = board(s);
		let tree = b.render();
		assert.match(text(bar(tree)), /Choose the Pokémon Tool to discard\./);
		assert.deepEqual(cards(tree).map(art), ['sv1-197', 'sv2-176']);
		cards(tree)[1].props.onClick();
		assert.deepEqual(b.sent, [rowsOf(s)[1]]);
		assert.equal(b.sent[0].ref.zone, 'tool');
		next(b, step('ruffian', 1));
		tree = b.render();
		assert.match(text(bar(tree)), /Choose the Special Energy to discard\./);
		assert.deepEqual(cards(tree).map(art), ['sv6-166', 'sv2-190']);
	});

	it('Xerosic on your own Pokémon: the picker says whose', () => {
		const s = step('xerosic', 0);
		const b = board(s);
		const tree = b.render();
		assert.match(head(tree), /Your Active/);
		cards(tree)[0].props.onClick();
		assert.deepEqual(b.sent, [rowsOf(s)[0]]);
	});

	it('Lost Vacuum: the hand card keeps its own prompt; the Tool step shows the instruction without the Trainer', () => {
		assert.equal(boardChoiceOf(step('lostVacuum', 0).snapshot, null), null, 'the card from hand is not a board choice');
		const s = step('lostVacuum', 1);
		assert.ok(!s.events.some(e => e.type === 'trainer'), 'this batch has no Trainer event');
		const tree = board(s).render();
		assert.equal(thumb(tree), undefined);
		assert.match(text(bar(tree)), /Choose the Pokémon Tool to put in the Lost Zone\./);
		assert.deepEqual(cards(tree).map(art), ['sv1-197', 'sv2-176']);
	});
});

describe('picker and instruction bar placement, and resent or refused picks', () => {
	const {pickClearSpot} = global;
	const box = (left, top, w, h) => ({left, top, right: left + w, bottom: top + h});

	it('the choice wrapper makes no box, so the bar and picker are placed against the table', () => {
		const css = fs.readFileSync(path.resolve(__dirname, '../play.pokemonshowdown.com/style/tcg.css'), 'utf8');
		assert.match(css, /\.tcg-choice\s*\{\s*display:\s*contents;\s*\}/);
	});

	it('a picker card is one button with a plain image: no button inside it', () => {
		const b = board(step('energySwitch', 0));
		b.clickSlot('active', false, AT);
		for (const c of cards(b.render())) {
			assert.deepEqual(all(c, n => n !== c && (n.type === 'button' || typeof n.type === 'function')), [], 'nothing interactive inside');
			assert.equal(all(c, n => n.type === 'img' && classOf(n) === 'tcg-choice-card-art').length, 1);
		}
	});

	it('placement takes the first spot that covers nothing on offer', () => {
		const bounds = box(0, 0, 900, 700);
		const offered = [box(400, 560, 80, 100)];
		assert.deepEqual(pickClearSpot([{x: 300, y: 600}, {x: 300, y: 330}], 300, 60, offered, bounds), {x: 300, y: 330});
		assert.deepEqual(pickClearSpot([{x: 300, y: 330}, {x: 300, y: 600}], 300, 60, offered, bounds), {x: 300, y: 330}, 'first clear wins');
	});

	it('with no clear spot it covers the least, never its own Pokémon when anything else fits, and stays in bounds', () => {
		const bounds = box(0, 0, 500, 400);
		const own = box(200, 150, 80, 100);
		const others = [box(0, 0, 500, 120)];
		const spot = pickClearSpot([{x: 180, y: 140}, {x: 180, y: 20}], 200, 120, others, bounds, [own]);
		assert.deepEqual(spot, {x: 180, y: 20}, 'covering another Pokémon beats covering its own');
		const clamped = pickClearSpot([{x: -50, y: 900}], 200, 120, [], bounds);
		assert.deepEqual(clamped, {x: 6, y: 274}, 'pulled inside the bounds');
	});

	it('a card the server refuses comes back usable; so does one when the same prompt is resent', () => {
		for (const how of ['refused', 'resync']) {
			const s = step('energySwitch', 0);
			const b = board(s);
			b.clickSlot('active', false, AT);
			cards(b.render())[0].props.onClick();
			assert.equal(b.state.boardPick.sent, '0:sve-1');
			const prev = b.props;
			const prevState = {...b.state};
			b.props = how === 'refused' ?
				{...prev, notice: "That play isn't legal.", noticeN: 1} :
				{...prev, snapshot: JSON.parse(JSON.stringify(prev.snapshot))};
			b.componentDidUpdate(prev, prevState);
			assert.deepEqual(b.state.boardPick, {key: prevState.boardPick.key, iid: 'm1'}, `${how}: still open, not sent`);
			assert.ok(cards(b.render()).every(c => !c.props.disabled), `${how}: cards usable`);
		}
	});

	it('an answer that changes the prompt still ends the picker (the sent card is not reopened)', async () => {
		const b = board(step('energySwitch', 0));
		b.clickSlot('active', false, AT);
		cards(b.render())[0].props.onClick();
		const prev = b.props;
		next(b, step('energySwitch', 1));
		b.componentDidUpdate(prev, {...b.state});
		b.render();
		await flush();
		assert.equal(b.state.boardPick, null);
	});

	it('after a reconnect (no batch) the bar still shows the instruction, without the Trainer image', () => {
		const s = step('energySwitch', 0);
		s.events = [];
		const tree = board(s).render();
		assert.equal(all(bar(tree), n => n.type === 'img').length, 0);
		assert.match(text(bar(tree)), /Choose the Basic Energy to move\./);
	});
});

describe('cramped layouts, from measured browser geometry', () => {
	const {planChoicePicker, planChoiceBar, firstClearSpot} = global;
	const R = ([left, top, right, bottom]) => ({left, top, right, bottom});
	const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
		Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
	const pickerBox = (plan, anchored) => plan.mode === 'anchored' ?
		{left: plan.x, top: plan.y, right: plan.x + anchored.w, bottom: plan.y + anchored.h} :
		{left: plan.x, top: plan.y, right: plan.x + plan.w, bottom: plan.y + plan.h};
	const inside = (box, bounds) => box.left >= bounds.left - 0.5 && box.top >= bounds.top - 0.5 &&
		box.right <= bounds.right + 0.5 && box.bottom <= bounds.bottom + 0.5;
	const STRIP_H = 209;
	const PANEL_W = 196;
	const CASES = [
		{name: 'Eneporter, 768×1024 (board 468 wide)', table: [0, 0, 468, 1024], halves: [[6, 48, 462, 267], [6, 693, 462, 920]],
			own: [90, 53, 140, 130], others: [[190, 147, 270, 257]], anchored: {w: 393, h: 204}, narrow: false, mode: 'anchored'},
		{name: 'Eneporter, rotated to 1024×768', table: [0, 0, 717, 768], halves: [[6, 96, 711, 319], [6, 433, 711, 664]],
			own: [206, 102, 258, 181], others: [[313, 193, 397, 309]], anchored: {w: 366, h: 205}, narrow: false},
		{name: 'Eneporter, 200% zoom (683×384)', table: [0, 0, 683, 384], halves: [[6, 48, 677, 184], [6, 184, 677, 318]],
			own: [229, 53, 267, 112], others: [[318, 117, 359, 175]], anchored: {w: 349, h: 205}, narrow: false, mode: 'strip'},
		{name: 'Tag Switch, 200% zoom', table: [0, 0, 683, 384], halves: [[6, 48, 677, 184], [6, 184, 677, 318]],
			own: [318, 193, 359, 251], others: [], anchored: {w: 261, h: 176}, narrow: false, mode: 'anchored'},
		{name: 'ten cards, 360×640', table: [0, 0, 360, 640], halves: [[2, 48, 358, 214], [2, 393, 358, 558]],
			own: [147, 397, 207, 481], others: [[61, 490, 103, 555]], anchored: {w: 360, h: 352}, narrow: true, mode: 'strip'},
		{name: 'ten cards, rotated to 640×360', table: [0, 0, 640, 360], halves: [[2, 8, 638, 121], [2, 129, 638, 242]],
			own: [282, 124, 350, 218], others: [[200, 174, 242, 239]], anchored: {w: 640, h: 198}, narrow: true, mode: 'panel'},
		{name: 'ten cards, 390×844', table: [0, 0, 390, 844], halves: [[2, 48, 388, 214], [2, 597, 388, 762]],
			own: [162, 601, 222, 685], others: [[76, 694, 118, 759]], anchored: {w: 390, h: 464}, narrow: true, mode: 'strip'},
	];
	for (const c of CASES) {
		it(`${c.name}: the picker covers no Pokémon on offer and stays on the board`, () => {
			const bounds = R(c.table);
			const own = R(c.own);
			const others = c.others.map(R);
			const plan = planChoicePicker({
				bounds, own, others, halves: c.halves.map(R), anchored: c.anchored, stripH: STRIP_H, panelW: PANEL_W, narrow: c.narrow,
			});
			const box = pickerBox(plan, c.anchored);
			if (c.mode) assert.equal(plan.mode, c.mode);
			assert.equal(overlap(box, own), 0, 'not its own Pokémon');
			for (const o of others) assert.equal(overlap(box, o), 0, 'not another Pokémon on offer');
			assert.ok(inside(box, bounds), JSON.stringify(box));
		});
	}

	it('Tag Switch, 200% zoom: the bar finds the spot just below the Pokémon instead of covering it', () => {
		const bounds = R([0, 0, 683, 384]);
		const avoid = [R([318, 193, 359, 251]), R([208, 9, 469, 185])];
		const plan = planChoiceBar({
			bounds, avoid, halves: [R([6, 48, 677, 184]), R([6, 184, 677, 318])], hudBottom: 44,
			size: {w: 356, h: 58}, compact: {w: 300, h: 50}, homeY: 248,
		});
		const box = {left: plan.x, top: plan.y, right: plan.x + 356, bottom: plan.y + 58};
		assert.equal(plan.compact, false);
		for (const a of avoid) assert.equal(overlap(box, a), 0);
		assert.ok(inside(box, bounds));
	});

	it('the bar clears the Pokémon and the sheet in the Eneporter and ten-card layouts', () => {
		for (const c of [
			{table: [0, 0, 683, 384], avoid: [[229, 53, 267, 112], [318, 117, 359, 175], [0, 175, 683, 384]], size: {w: 427, h: 64}, home: 248,
				halves: [[6, 48, 677, 184], [6, 184, 677, 318]]},
			{table: [0, 0, 360, 640], avoid: [[147, 397, 207, 481], [61, 490, 103, 555], [0, 0, 360, 209]], size: {w: 270, h: 62}, home: 506,
				halves: [[2, 48, 358, 214], [2, 393, 358, 558]]},
			{table: [0, 0, 640, 360], avoid: [[282, 124, 350, 218], [200, 174, 242, 239], [444, 0, 640, 360]], size: {w: 310, h: 53}, home: 235,
				halves: [[2, 8, 638, 121], [2, 129, 638, 242]]},
		]) {
			const bounds = R(c.table);
			const avoid = c.avoid.map(R);
			const plan = planChoiceBar({bounds, avoid, halves: c.halves.map(R), hudBottom: 44, size: c.size, compact: {w: c.size.w, h: 40}, homeY: c.home});
			const size = plan.compact ? {w: c.size.w, h: 40} : c.size;
			const box = {left: plan.x, top: plan.y, right: plan.x + size.w, bottom: plan.y + size.h};
			for (const a of avoid) assert.equal(overlap(box, a), 0, JSON.stringify({box, a}));
			assert.ok(inside(box, bounds));
		}
	});

	it('the bar takes its compact form before it would cover anything', () => {
		const bounds = R([0, 0, 400, 300]);
		const avoid = [R([0, 0, 400, 120]), R([0, 180, 400, 300])];
		const halves = [R([0, 0, 400, 120]), R([0, 180, 400, 300])];
		const plan = planChoiceBar({bounds, avoid, halves, hudBottom: null, size: {w: 300, h: 70}, compact: {w: 260, h: 40}, homeY: 200});
		assert.equal(plan.compact, true);
		const box = {left: plan.x, top: plan.y, right: plan.x + 260, bottom: plan.y + 40};
		for (const a of avoid) assert.equal(overlap(box, a), 0);
	});

	it('firstClearSpot reports no spot rather than an overlapping one', () => {
		assert.equal(firstClearSpot([{x: 0, y: 0}], 100, 100, [R([0, 0, 200, 200])], R([0, 0, 200, 200])), null);
		assert.deepEqual(firstClearSpot([{x: 0, y: 0}, {x: 100, y: 100}], 50, 50, [R([0, 0, 60, 60])], R([0, 0, 200, 200])), {x: 100, y: 100});
	});
});

describe('board chrome stays in view, from recorded browser geometry', () => {
	const {planChoicePicker, planChoiceBar} = global;
	const R = ([left, top, right, bottom]) => ({left, top, right, bottom});
	const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
		Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
	const pickerBox = (plan, anchored) => plan.mode === 'anchored' ?
		{left: plan.x, top: plan.y, right: plan.x + anchored.w, bottom: plan.y + anchored.h} :
		{left: plan.x, top: plan.y, right: plan.x + plan.w, bottom: plan.y + plan.h};
	const inside = (box, bounds) => box.left >= bounds.left - 0.5 && box.top >= bounds.top - 0.5 &&
		box.right <= bounds.right + 0.5 && box.bottom <= bounds.bottom + 0.5;
	const DESK = {
		bounds: R([0, 0, 966, 768]), own: R([437, 438, 521, 554]), others: [R([330, 566, 382, 645])],
		halves: [R([6, 96, 960, 314]), R([6, 428, 960, 664])], stripH: 225, panelW: 196, narrow: false,
		chrome: [R([12, 8, 129, 40]), R([407, 44, 559, 89]), R([895, 8, 954, 33])],
		bar: {size: {w: 326, h: 64}, compact: {w: 274, h: 39}, homeY: 632, hudBottom: 89},
	};
	const PHONE = {
		bounds: R([0, 0, 360, 640]), own: R([147, 397, 207, 481]), others: [R([61, 490, 103, 555])],
		halves: [R([2, 48, 358, 214]), R([2, 393, 358, 558])], stripH: 209, panelW: 196, narrow: true,
		chrome: [R([8, 5, 120, 39]), R([132, 4, 228, 40]), R([295, 48, 352, 73]), R([296, 8, 352, 33])],
		bar: {size: {w: 180, h: 80}, compact: {w: 180, h: 39}, homeY: 500, hudBottom: 44},
		anchored: {w: 360, h: 352},
	};
	const assertClear = (c, plan) => {
		const box = pickerBox(plan, c.anchored);
		assert.ok(inside(box, c.bounds), JSON.stringify(box));
		for (const m of [c.own, ...c.others]) assert.equal(overlap(box, m), 0, 'a Pokémon on offer: ' + JSON.stringify(box));
		for (const x of c.chrome) assert.equal(overlap(box, x), 0, 'chrome ' + JSON.stringify(x));
		const bar = planChoiceBar({...c.bar, bounds: c.bounds, avoid: [c.own, ...c.others, box], halves: c.halves, chrome: c.chrome});
		const size = bar.compact ? c.bar.compact : c.bar.size;
		const barBox = {left: bar.x, top: bar.y, right: bar.x + size.w, bottom: bar.y + size.h};
		assert.equal(bar.clear, true);
		for (const a of [c.own, ...c.others, box, ...c.chrome]) assert.equal(overlap(barBox, a), 0, JSON.stringify({barBox, a}));
		assert.ok(inside(barBox, c.bounds));
		return box;
	};

	it('ordinary desktop choice (two cards, 1366×768): the picker stays next to its Pokémon, clear of the chrome', () => {
		const c = {...DESK, anchored: {w: 263, h: 221}};
		const plan = planChoicePicker(c);
		assert.equal(plan.mode, 'anchored');
		assertClear(c, plan);
	});

	it('ten cards on a 1366×768 desktop: the strip starts below the turn badge instead of covering the header', () => {
		const c = {...DESK, anchored: {w: 483, h: 461}};
		const before = pickerBox(planChoicePicker({...c, chrome: undefined, bar: undefined}), c.anchored);
		assert.equal(before.top, 0);
		for (const x of c.chrome) assert.ok(overlap(before, x) > 0);
		const plan = planChoicePicker(c);
		assert.deepEqual([plan.mode, plan.side], ['strip', 'top']);
		assert.equal(plan.y, 89 + 6, 'just below the turn badge');
		assertClear(c, plan);
	});

	it('ten cards on a 360×640 phone: the strip starts below the timer and the Chat toggle', () => {
		const plan = planChoicePicker(PHONE);
		assert.deepEqual([plan.mode, plan.side], ['strip', 'top']);
		assert.equal(plan.y, 73 + 6);
		assertClear(PHONE, plan);
	});

	it('Eneporter at 640×360: a picker that would leave the bar no clear spot gives way to one that does', () => {
		const c = {
			bounds: R([0, 0, 640, 360]), own: R([200, 11, 242, 76]), others: [R([282, 33, 350, 127])],
			halves: [R([2, 8, 638, 121]), R([2, 129, 638, 242])], stripH: 209, panelW: 196, narrow: true,
			anchored: {w: 640, h: 198},
			chrome: [R([8, 5, 127, 40]), R([272, 4, 368, 40]), R([575, 48, 632, 73]), R([576, 8, 632, 33])],
			bar: {size: {w: 320, h: 62}, compact: {w: 320, h: 39}, homeY: 238, hudBottom: 44},
		};
		const bottom = planChoicePicker({...c, bar: undefined});
		assert.deepEqual([bottom.mode, bottom.side], ['strip', 'bottom']);
		const crowded = planChoiceBar({...c.bar, bounds: c.bounds, avoid: [c.own, ...c.others, pickerBox(bottom)], halves: c.halves, chrome: c.chrome});
		assert.equal(crowded.clear, false);
		const plan = planChoicePicker(c);
		assert.deepEqual([plan.mode, plan.side, plan.y], ['panel', 'right', 73 + 6], 'the right panel, below the timer');
		assertClear(c, plan);
	});

	it('chrome never costs a Pokémon on offer: with no layout clear of both, the picker covers the chrome', () => {
		const c = {
			bounds: R([0, 0, 400, 300]), own: R([150, 200, 250, 300]), others: [R([0, 100, 400, 140])],
			halves: [], stripH: 90, panelW: 120, narrow: true, anchored: {w: 200, h: 90},
			chrome: [R([0, 0, 400, 40])],
		};
		const plan = planChoicePicker(c);
		assert.deepEqual([plan.mode, plan.side, plan.y], ['strip', 'top', 0]);
		const box = pickerBox(plan, c.anchored);
		assert.equal(overlap(box, c.own), 0);
		for (const o of c.others) assert.equal(overlap(box, o), 0);
		assert.ok(overlap(box, c.chrome[0]) > 0, 'the header gives way');
	});

	it('chrome never costs a Pokémon on offer: the bar covers the header when that is the only clear room', () => {
		const bounds = R([0, 0, 400, 300]);
		const avoid = [R([0, 46, 400, 300])];
		const chrome = [R([0, 0, 400, 40])];
		const bar = planChoiceBar({
			bounds, avoid, halves: [], chrome, size: {w: 300, h: 40}, compact: {w: 300, h: 30}, homeY: 150, hudBottom: null,
		});
		const barBox = {left: bar.x, top: bar.y, right: bar.x + 300, bottom: bar.y + (bar.compact ? 30 : 40)};
		assert.equal(bar.clear, false);
		assert.equal(overlap(barBox, avoid[0]), 0, JSON.stringify(barBox));
		assert.ok(overlap(barBox, chrome[0]) > 0);
		assert.ok(inside(barBox, bounds));
	});
});
