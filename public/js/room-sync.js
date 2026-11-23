/**
 * Cinema for Two — synced-browsing pure helpers (Laravel room page).
 *
 * The room page's mini-browser can run in two modes:
 *  - Direct: the iframe loads the shared URL as-is. Each phone scrolls
 *    and taps on its own screen.
 *  - Synced ("Browse together"): the iframe loads the page through this
 *    app's own /proxy, which re-serves it with the sync script inside.
 *    Scrolling and link taps then move on both phones over PeerJS.
 *
 * The proxy lives on this app's own origin, so the proxy URL is relative
 * (/proxy?url=...) and the parent checks messages against
 * window.location.origin — the same-origin check the Phase 1 doc
 * describes. (The static app's proxy is cross-origin, so its check is
 * against the proxy origin instead.)
 *
 * These helpers are pure (no DOM at load) so they can be unit-tested
 * in Node: `node tests/js/room-sync.test.js`. In the browser they are
 * exposed as window.CinemaSync; room.js uses them.
 */
(function (root) {
    'use strict';

    /** Ignore a c2t-scroll arriving within this long after we sent a
     *  c2t-scroll-to — it is the echo of our own jump, not the user
     *  scrolling. Forwarding it would make the phones chase each other. */
    var WEB_SCROLL_ECHO_MS = 300;

    /** Proxied page: needs allow-same-origin so the re-served page can
     *  use its own storage (a page that reads sessionStorage on load
     *  dies without it). Never allow-top-navigation: the framed page
     *  must not navigate the app away. No allow-popups: shared sites
     *  must not open pop-up ad windows (?v=56 fix in the static app). */
    var SANDBOX_PROXIED = 'allow-scripts allow-forms allow-same-origin';
    /** Direct page on another origin: same tokens as today (storage
     *  works, pop-ups do not). */
    var SANDBOX_DIRECT = 'allow-scripts allow-same-origin allow-forms';
    /** Direct page on this app's own origin: strictest — with
     *  allow-same-origin it could script the parent app. */
    var SANDBOX_STRICT = 'allow-scripts allow-forms';

    // Pure: the iframe src for a shared page. Synced mode wraps it
    // through the proxy; direct mode loads it as-is. The shared weblink
    // record always keeps the ORIGINAL url — the wrap happens here, at
    // mount time, on each phone separately.
    function proxiedWeblinkSrc(url, syncEnabled, proxyUrl) {
        if (!syncEnabled) return url;
        var base = String(proxyUrl || '').replace(/\/+$/, '');
        if (!base) return url;
        return base + '?url=' + encodeURIComponent(url);
    }

    // Pure: is this iframe src a proxied page?
    function isProxiedSrc(src, proxyUrl) {
        var base = String(proxyUrl || '').replace(/\/+$/, '');
        if (!base || typeof src !== 'string') return false;
        return src.indexOf(base + '?url=') === 0;
    }

    // Pure: sandbox tokens for the FINAL iframe src origin. Proxied
    // pages (same origin, re-served with our sync script) get the
    // proxied set; direct pages keep the strict set, with
    // allow-same-origin only when the page is on another origin (so it
    // can use its own storage). Unparseable URLs stay strict.
    function sandboxTokensForSrc(src, proxyUrl, appOrigin) {
        if (isProxiedSrc(src, proxyUrl)) return SANDBOX_PROXIED;
        try {
            var pageOrigin = new URL(src, appOrigin || undefined).origin;
            var app = new URL(appOrigin || '');
            if (pageOrigin !== 'null' && pageOrigin !== app.origin) return SANDBOX_DIRECT;
        } catch (_) {
            // Unparseable URL or origin — stay strict.
        }
        return SANDBOX_STRICT;
    }

    // Pure: echo guard — a c2t-scroll arriving within WEB_SCROLL_ECHO_MS
    // after we sent a c2t-scroll-to is the echo of our own jump.
    function isWebScrollEcho(lastScrollToAt, now) {
        return (Number(now) - Number(lastScrollToAt || 0)) < WEB_SCROLL_ECHO_MS;
    }

    // Pure: is this window message from our proxied page — right origin
    // AND right frame? The proxy is same-origin with the app, so the
    // check is against the app origin. A missing frame window skips the
    // source check — the caller passes it when it has it.
    function isProxyFrameMessage(event, appOrigin, frameWindow) {
        if (!event || !event.data || typeof event.data !== 'object') return false;
        var origin = '';
        try {
            origin = new URL(String(appOrigin || '')).origin;
        } catch (_) {
            return false;
        }
        if (!origin) return false;
        if (event.origin !== origin) return false;
        if (frameWindow && event.source !== frameWindow) return false;
        return true;
    }

    var api = {
        WEB_SCROLL_ECHO_MS: WEB_SCROLL_ECHO_MS,
        SANDBOX_PROXIED: SANDBOX_PROXIED,
        SANDBOX_DIRECT: SANDBOX_DIRECT,
        SANDBOX_STRICT: SANDBOX_STRICT,
        proxiedWeblinkSrc: proxiedWeblinkSrc,
        isProxiedSrc: isProxiedSrc,
        sandboxTokensForSrc: sandboxTokensForSrc,
        isWebScrollEcho: isWebScrollEcho,
        isProxyFrameMessage: isProxyFrameMessage,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.CinemaSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
