// Unit tests for the synced-browsing pure helpers (public/js/room-sync.js).
// Run: node tests/js/room-sync.test.js  (exit code 0 = all pass)
import assert from 'node:assert';
import '../../public/js/room-sync.js';

const sync = globalThis.CinemaSync;
assert.ok(sync, 'room-sync.js must expose window.CinemaSync');

let n = 0;
function check(name, fn) {
    fn();
    n++;
    console.log('ok ' + n + ' — ' + name);
}

// proxiedWeblinkSrc — the wrap happens at mount time; the weblink record
// always keeps the original URL.
check('direct mode returns the url unchanged', () => {
    assert.strictEqual(sync.proxiedWeblinkSrc('https://example.org/page', false, '/proxy'), 'https://example.org/page');
});
check('synced mode wraps through the proxy with the encoded url', () => {
    assert.strictEqual(
        sync.proxiedWeblinkSrc('https://example.org/a?b=c', true, '/proxy'),
        '/proxy?url=https%3A%2F%2Fexample.org%2Fa%3Fb%3Dc'
    );
});
check('synced mode with an empty proxy url stays direct', () => {
    assert.strictEqual(sync.proxiedWeblinkSrc('https://example.org/', true, ''), 'https://example.org/');
});
check('a trailing slash on the proxy url is trimmed', () => {
    assert.strictEqual(
        sync.proxiedWeblinkSrc('https://example.org/', true, '/proxy/'),
        '/proxy?url=https%3A%2F%2Fexample.org%2F'
    );
});

// isProxiedSrc
check('proxied src recognised, direct url not', () => {
    assert.strictEqual(sync.isProxiedSrc('/proxy?url=https%3A%2F%2Fexample.org%2F', '/proxy'), true);
    assert.strictEqual(sync.isProxiedSrc('https://example.org/', '/proxy'), false);
    assert.strictEqual(sync.isProxiedSrc('/proxy', '/proxy'), false);
    assert.strictEqual(sync.isProxiedSrc('/proxy?other=1', '/proxy'), false);
});

// sandboxTokensForSrc — decided from the FINAL iframe src origin.
check('proxied page gets the proxied tokens', () => {
    assert.strictEqual(
        sync.sandboxTokensForSrc('/proxy?url=https%3A%2F%2Fexample.org%2F', '/proxy', 'https://cine4two.ct.ws'),
        'allow-scripts allow-forms allow-same-origin'
    );
});
check('direct cross-origin page keeps the direct tokens (no popups)', () => {
    const tokens = sync.sandboxTokensForSrc('https://example.org/', '/proxy', 'https://cine4two.ct.ws');
    assert.strictEqual(tokens, 'allow-scripts allow-same-origin allow-forms');
    assert.ok(!tokens.includes('allow-popups'), 'no allow-popups');
});
check('direct same-origin page gets the strict tokens', () => {
    assert.strictEqual(
        sync.sandboxTokensForSrc('https://cine4two.ct.ws/rooms/ABC123', '/proxy', 'https://cine4two.ct.ws'),
        'allow-scripts allow-forms'
    );
});
check('unparseable url stays strict', () => {
    assert.strictEqual(sync.sandboxTokensForSrc(':::', '/proxy', 'https://cine4two.ct.ws'), 'allow-scripts allow-forms');
});
check('no token set ever contains allow-popups', () => {
    for (const set of [sync.SANDBOX_PROXIED, sync.SANDBOX_DIRECT, sync.SANDBOX_STRICT]) {
        assert.ok(!set.includes('allow-popups'), set);
    }
});

// isWebScrollEcho — 300 ms gate.
check('scroll 299 ms after a scroll-to is an echo, 300 ms is real', () => {
    assert.strictEqual(sync.isWebScrollEcho(1000, 1299), true);
    assert.strictEqual(sync.isWebScrollEcho(1000, 1300), false);
    assert.strictEqual(sync.isWebScrollEcho(1000, 2000), false);
});
check('no previous scroll-to means no echo', () => {
    assert.strictEqual(sync.isWebScrollEcho(0, Date.now()), false);
    assert.strictEqual(sync.isWebScrollEcho(undefined, Date.now()), false);
});

// isProxyFrameMessage — right origin AND right frame (same-origin proxy).
check('message from the app origin and our frame is accepted', () => {
    const frame = {};
    assert.strictEqual(
        sync.isProxyFrameMessage({ origin: 'https://cine4two.ct.ws', source: frame, data: { type: 'c2t-scroll' } }, 'https://cine4two.ct.ws', frame),
        true
    );
});
check('message from another origin is rejected', () => {
    const frame = {};
    assert.strictEqual(
        sync.isProxyFrameMessage({ origin: 'https://evil.example', source: frame, data: { type: 'c2t-scroll' } }, 'https://cine4two.ct.ws', frame),
        false
    );
});
check('message from the right origin but another frame is rejected', () => {
    assert.strictEqual(
        sync.isProxyFrameMessage({ origin: 'https://cine4two.ct.ws', source: {}, data: { type: 'c2t-scroll' } }, 'https://cine4two.ct.ws', {}),
        false
    );
});
check('message with no frame window skips the source check', () => {
    assert.strictEqual(
        sync.isProxyFrameMessage({ origin: 'https://cine4two.ct.ws', source: {}, data: { type: 'c2t-scroll' } }, 'https://cine4two.ct.ws', null),
        true
    );
});
check('non-object data and missing origin are rejected', () => {
    assert.strictEqual(sync.isProxyFrameMessage({ origin: 'https://cine4two.ct.ws', source: {}, data: 'hi' }, 'https://cine4two.ct.ws', null), false);
    assert.strictEqual(sync.isProxyFrameMessage({ origin: 'https://cine4two.ct.ws', source: {}, data: {} }, '', null), false);
    assert.strictEqual(sync.isProxyFrameMessage(null, 'https://cine4two.ct.ws', null), false);
});

console.log(n + ' room-sync tests passed');
