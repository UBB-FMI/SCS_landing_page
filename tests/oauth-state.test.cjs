const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../js/oauth-state.js'), 'utf8');
const callbackPath = '/landing/credentials.html';
const lifetimeMs = 15 * 60 * 1000;

function createTab() {
    const storage = new Map();
    const tab = { now: 1000, href: '', replacement: '' };
    const location = {
        hash: '',
        pathname: callbackPath,
        search: '',
        replace: url => { tab.href = url; }
    };
    const context = vm.createContext({
        crypto,
        URL,
        URLSearchParams,
        Date: { now: () => tab.now },
        window: { location },
        history: {
            replaceState(_state, _title, url) {
                tab.replacement = url;
                location.hash = '';
            }
        },
        sessionStorage: {
            setItem: (key, value) => storage.set(key, value),
            getItem: key => storage.get(key) ?? null,
            removeItem: key => storage.delete(key)
        }
    });
    const oauth = vm.runInContext(source + '\nscsOAuth', context);
    tab.start = () => {
        oauth.start();
        return new URL(tab.href);
    };
    tab.finish = (state, token) => {
        const response = new URLSearchParams({ state });
        if (token) response.set('access_token', token);
        location.hash = '#' + response;
        return oauth.readCallback();
    };
    return tab;
}

test('starts a fresh sign-in using the registered callback', () => {
    const tab = createTab();
    const first = tab.start();
    const second = tab.start();
    assert.equal(second.hostname, 'login.microsoftonline.com');
    assert.equal(second.searchParams.get('redirect_uri'), 'https://www.scs.ubbcluj.ro' + callbackPath);
    assert.equal(second.searchParams.get('response_type'), 'token');
    assert.match(second.searchParams.get('state'), /^[0-9a-f]{32}$/);
    assert.notEqual(first.searchParams.get('state'), second.searchParams.get('state'));
});

test('sign-ins in separate tabs finish independently in reverse order', () => {
    const first = createTab();
    const second = createTab();
    const stateA = first.start().searchParams.get('state');
    const stateB = second.start().searchParams.get('state');
    assert.notEqual(stateA, stateB);
    assert.equal(second.finish(stateB, 'test-token-b'), 'test-token-b');
    assert.equal(first.finish(stateA, 'test-token-a'), 'test-token-a');
    assert.equal(first.replacement, callbackPath);
    assert.equal(second.replacement, callbackPath);
});

test('callbacks do not accept old, mismatched or already-used attempts', () => {
    const tab = createTab();
    const previous = tab.start().searchParams.get('state');
    const current = tab.start().searchParams.get('state');
    assert.equal(tab.finish(previous, 'old-test-token'), null);
    assert.equal(tab.replacement, callbackPath);
    assert.equal(tab.finish(current, 'current-test-token'), 'current-test-token');
    assert.equal(tab.finish(current, 'current-test-token'), null);
});

test('expired and denied sign-ins require a fresh attempt', () => {
    const tab = createTab();
    const expired = tab.start().searchParams.get('state');
    tab.now += lifetimeMs + 1;
    assert.equal(tab.finish(expired, 'expired-test-token'), null);
    const denied = tab.start().searchParams.get('state');
    assert.equal(tab.finish(denied), null);
    assert.equal(tab.finish(denied, 'denied-test-token'), null);
    assert.equal(tab.replacement, callbackPath);
});
