'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it} = require('node:test');
const vm = require('vm');

global.window = global;
global.document = {
	querySelectorAll() { return []; },
};
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

const {rewriteLoggedCardIds, printedNames, seenCardNames} = global;

function makeMockElement(classes, attrs, text = '') {
	return {
		className: classes.join(' '),
		classList: {
			contains(c) { return classes.includes(c); },
		},
		attributes: attrs,
		getAttribute(k) { return this.attributes[k] || null; },
		textContent: text,
	};
}

function makeMockContainer(elements) {
	return {
		elements,
		querySelectorAll(sel) {
			if (sel === '.tcg-log-card-id[data-card-id]') {
				return this.elements.filter(el =>
					el.classList.contains('tcg-log-card-id') && el.getAttribute('data-card-id')
				);
			}
			return [];
		},
	};
}

describe('room isolation in battle log card ID rewriting', () => {
	it('only mutates card ID spans within the specified room element', () => {
		printedNames['sv1-1'] = 'Sprigatito';

		const room1Card = makeMockElement(['tcg-log-card-id'], {'data-card-id': 'sv1-1'}, 'sv1-1');
		const room2Card = makeMockElement(['tcg-log-card-id'], {'data-card-id': 'sv1-1'}, 'sv1-1');

		const room1 = makeMockContainer([room1Card]);
		const room2 = makeMockContainer([room2Card]);

		rewriteLoggedCardIds(room1);

		assert.equal(room1Card.textContent, 'Sprigatito');
		assert.equal(room2Card.textContent, 'sv1-1');
	});

	it('does not mutate player usernames or regular chat elements', () => {
		printedNames['sv1-1'] = 'Sprigatito';

		const usernameEl = makeMockElement(['username'], {}, 'sv1-1');
		const chatMessageEl = makeMockElement(['chat-message'], {}, 'Played sv1-1 from hand');
		const cardEl = makeMockElement(['tcg-log-card-id'], {'data-card-id': 'sv1-1'}, 'sv1-1');

		const room = makeMockContainer([usernameEl, chatMessageEl, cardEl]);

		rewriteLoggedCardIds(room);

		assert.equal(usernameEl.textContent, 'sv1-1');
		assert.equal(chatMessageEl.textContent, 'Played sv1-1 from hand');
		assert.equal(cardEl.textContent, 'Sprigatito');
	});

	it('leaves unknown card IDs untouched', () => {
		const unknownCard = makeMockElement(['tcg-log-card-id'], {'data-card-id': 'unknown-card-999'}, 'unknown-card-999');
		const room = makeMockContainer([unknownCard]);

		rewriteLoggedCardIds(room);

		assert.equal(unknownCard.textContent, 'unknown-card-999');
	});

	it('handles spans with empty or missing data-card-id attributes safely', () => {
		const emptyAttrCard = makeMockElement(['tcg-log-card-id'], {'data-card-id': ''}, 'Empty');
		const room = makeMockContainer([emptyAttrCard]);

		rewriteLoggedCardIds(room);

		assert.equal(emptyAttrCard.textContent, 'Empty');
	});

	it('uses seenCardNames dynamically learned from match payload', () => {
		seenCardNames['custom-card-42'] = 'Charizard ex';

		const cardEl = makeMockElement(['tcg-log-card-id'], {'data-card-id': 'custom-card-42'}, 'custom-card-42');
		const room = makeMockContainer([cardEl]);

		rewriteLoggedCardIds(room);

		assert.equal(cardEl.textContent, 'Charizard ex');
	});
});
