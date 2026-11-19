'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {describe, it} = require('node:test');
const vm = require('vm');

global.window = global;
global.preact = {
	Component: function (props) {
		this.props = props || {};
		this.state = {};
	},
	h(type, props, ...children) {
		return {type, props: Object.assign({}, props, {children})};
	},
	render() {},
};
global.preact.Component.prototype.setState = function (partial) {
	this.state = Object.assign({}, this.state, partial);
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

const {escapeSelector, TcgBoardErrorBoundary} = global;

describe('escapeSelector and DOM query sanitization', () => {
	it('escapes quotes and bracket injection payloads', () => {
		const malicious = 'p1:active" ] [test]';
		const escaped = escapeSelector(malicious);
		assert.notEqual(escaped, malicious);
		assert.ok(escaped.includes('\\"'));
		assert.ok(escaped.includes('\\]'));
		assert.ok(escaped.includes('\\['));
	});

	it('escapes colons, periods, quotes and slashes correctly', () => {
		const complex = 'p1:bench.0"attack\'\\evil';
		const escaped = escapeSelector(complex);
		assert.ok(escaped.includes('\\:'));
		assert.ok(escaped.includes('\\.'));
		assert.ok(escaped.includes('\\"'));
		assert.ok(escaped.includes('\\\''));
	});

	it('leaves normal alphanumeric identifiers unchanged', () => {
		assert.equal(escapeSelector('p1active0'), 'p1active0');
		assert.equal(escapeSelector('mon_123'), 'mon_123');
	});

	it('simulated DOM query does not throw syntax error with escaped selector', () => {
		const fakeDocument = {
			elements: new Map(),
			register(sel, el) { this.elements.set(sel, el); },
			querySelector(sel) {
				const unescapedQuotes = (sel.match(/(?:^|[^\\])"/g) || []).length;
				if (unescapedQuotes > 2 || sel.includes('" ]')) {
					throw new Error('DOMException: Invalid selector');
				}
				return this.elements.get(sel) || null;
			},
		};

		const maliciousIid = 'p1:active" ] [evil]';
		const rawSelector = `.tcg-mon[data-iid="${maliciousIid}"]`;
		assert.throws(() => fakeDocument.querySelector(rawSelector));

		const safeIid = escapeSelector(maliciousIid);
		const safeSelector = `.tcg-mon[data-iid="${safeIid}"]`;
		fakeDocument.register(safeSelector, {iid: maliciousIid});
		const result = fakeDocument.querySelector(safeSelector);
		assert.ok(result);
		assert.equal(result.iid, maliciousIid);
	});
});

describe('TcgBoardErrorBoundary', () => {
	it('passes through children when no error has occurred', () => {
		const boundary = new TcgBoardErrorBoundary({children: 'normal-child'});
		const rendered = boundary.render();
		assert.equal(rendered, 'normal-child');
	});

	it('getDerivedStateFromError captures the error in state', () => {
		const err = new Error('Render crash');
		const state = TcgBoardErrorBoundary.getDerivedStateFromError(err);
		assert.equal(state.error, err);
	});

	it('renders fallback UI with a resync button when an error is present', () => {
		const boundary = new TcgBoardErrorBoundary({children: 'hidden-child'});
		boundary.state = {error: new Error('Render crash')};
		const rendered = boundary.render();
		assert.ok(rendered);
		assert.equal(rendered.type, 'div');
		assert.equal(rendered.props.class, 'tcg-board-error');
		assert.equal(rendered.props.role, 'alert');
	});

	it('reset callback clears error state and triggers onResync', () => {
		let resynced = 0;
		const boundary = new TcgBoardErrorBoundary({
			onResync() { resynced++; },
			children: 'child-content',
		});
		boundary.state = {error: new Error('Simulated failure')};

		boundary.reset();
		assert.equal(boundary.state.error, null);
		assert.equal(resynced, 1);
		assert.equal(boundary.render(), 'child-content');
	});

	it('componentDidCatch catches errors without throwing', () => {
		const boundary = new TcgBoardErrorBoundary({});
		assert.doesNotThrow(() => {
			boundary.componentDidCatch(new Error('Crash'), {componentStack: 'TcgBoard'});
		});
	});
});
