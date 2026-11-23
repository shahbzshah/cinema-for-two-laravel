/**
 * Cinema for Two — room shell (Laravel v1).
 *
 * Live sync stays on PeerJS Cloud, same approach as the static app:
 * the room code is the peer id (c2t-<CODE>), the first side to open the
 * room hosts it, the other joins as a guest. The data channel carries
 * weblink events — shared links, "sync page", and scroll positions.
 * Video/voice calling arrives in v2.
 *
 * Synced browsing ("Browse together"): with the toggle on, shared pages
 * load through this app's own /proxy, which re-serves them with a sync
 * script inside — scrolling and link taps then move on both phones.
 * The toggle is per-device (both phones turn it on); the weblink record
 * always keeps the ORIGINAL url, and the proxy wrap happens at mount
 * time. The /proxy route is behind auth, so synced browsing needs the
 * user signed in here — everyone on this page already is. If the proxy
 * refuses a page, the room falls back to the direct URL and says so.
 *
 * Honest limits, by design:
 * - With the toggle off, each phone scrolls and taps inside the iframe
 *   on its own screen. Cross-origin scroll/click sync is impossible:
 *   the browser will not let this page read scroll position or clicks
 *   inside another site — only the proxied page reports them.
 * - Some sites refuse to embed at all (X-Frame-Options / CSP). A 10s
 *   load timeout shows the blocked notice with an Open-in-browser link.
 *   (Through the proxy they load anyway — the proxy strips those
 *   headers — unless the proxy itself refuses the page.)
 * - If PeerJS is unreachable, links still save to the room (server) and
 *   the 15s poll picks them up; the banner offers them instead of an
 *   instant switch.
 */
(function () {
    'use strict';

    var root = document.getElementById('roomRoot');
    if (!root) return;

    var roomCode = root.dataset.roomCode;
    var userName = root.dataset.userName;
    var proxyUrl = root.dataset.proxyUrl || '/proxy';
    var weblinksUrl = root.dataset.weblinksUrl;
    var weblinkStoreUrl = root.dataset.weblinkStoreUrl;
    var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

    // Synced-browsing pure helpers (public/js/room-sync.js, loaded before
    // this file). If that script failed to load, synced mode stays off
    // and the room behaves exactly as before.
    var sync = (typeof window !== 'undefined' && window.CinemaSync) || null;

    var viewer = document.getElementById('webViewer');
    var webEmpty = document.getElementById('webEmpty');
    var webAddressText = document.getElementById('webAddressText');
    var blockedNotice = document.getElementById('blockedNotice');
    var blockedDismiss = document.getElementById('blockedDismissBtn');
    var openInBrowser = document.getElementById('openInBrowser');
    var blockedOpenLink = document.getElementById('blockedOpenLink');
    var shelf = document.getElementById('weblinkShelf');
    var banner = document.getElementById('newLinkBanner');
    var bannerText = document.getElementById('newLinkBannerText');
    var bannerOpen = document.getElementById('newLinkBannerOpen');
    var toastEl = document.getElementById('roomToast');
    var pill = document.getElementById('syncPill');
    var pillDot = document.getElementById('syncPillDot');
    var pillText = document.getElementById('syncPillText');

    var currentUrl = viewer.getAttribute('src') || '';
    var currentId = null;
    var blockedTimer = null;
    var toastTimer = null;
    var pendingBannerLink = null;

    // Synced browsing state. syncEnabled is per-device (default OFF —
    // both phones turn it on); currentUrl always keeps the ORIGINAL url
    // while currentFrameSrc is what the iframe actually loads (proxied
    // when sync is on). lastWebScrollAt is when we last sent a scroll
    // position INTO the frame — the echo guard for c2t-scroll reports.
    var syncEnabled = false;
    var currentFrameSrc = viewer.getAttribute('src') || '';
    var currentProxied = false;
    var lastWebScrollAt = 0;
    var proxyFallbackArmed = false;

    // Diagnostic handle (same spirit as the static app's ?debug=1 panel):
    // the harness and a ?debug check can see the last scroll in each
    // direction and drive an incoming PeerJS message. Read-only except
    // for handlePeerMessage, which is the same handler the live
    // connection calls.
    var roomDebug = { lastFrameScroll: null, lastPartnerScroll: null, lastLinkTap: null, handlePeerMessage: null };
    if (typeof window !== 'undefined') window.__cinemaRoom = roomDebug;

    function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, 3200);
    }

    function setPresence(state, text) {
        // Sync pill dot is amber like the static app's presence pill.
        var dot = state === 'live' ? 'bg-primary-container' : state === 'offline' ? 'bg-error' : 'bg-primary-container';
        pillDot.className = 'w-1.5 h-1.5 rounded-full ' + dot + (state === 'connecting' ? ' animate-pulse' : '');
        pillText.textContent = text;
    }

    function armBlockedTimer() {
        clearTimeout(blockedTimer);
        blockedNotice.classList.add('hidden');
        blockedTimer = setTimeout(function () {
            blockedNotice.classList.remove('hidden');
        }, 10000);
    }

    function frameSrcFor(url) {
        if (sync && syncEnabled) return sync.proxiedWeblinkSrc(url, true, proxyUrl);
        return url;
    }

    function loadViewer(url, id) {
        if (!url) return;
        currentUrl = url;
        currentId = id || null;
        viewer.classList.remove('hidden');
        webEmpty.classList.add('hidden');
        openInBrowser.classList.remove('opacity-50', 'pointer-events-none');
        openInBrowser.href = url;
        blockedOpenLink.href = url;
        if (webAddressText) webAddressText.textContent = url;
        // The sandbox decides whether the framed page may touch its own
        // storage. Set it BEFORE any src assignment below — changing it
        // after the page loads would reload the frame. Synced mode wraps
        // the page through /proxy (the weblink record still stores the
        // original URL) — the sandbox decision runs on the FINAL iframe
        // src origin, so a proxied page gets the proxied tokens.
        var frameSrc = frameSrcFor(url);
        if (sync) viewer.setAttribute('sandbox', sync.sandboxTokensForSrc(frameSrc, proxyUrl, window.location.origin));
        currentFrameSrc = frameSrc;
        currentProxied = !!(sync && sync.isProxiedSrc(frameSrc, proxyUrl));
        proxyFallbackArmed = currentProxied;
        if (viewer.getAttribute('src') === frameSrc) {
            reloadViewer();
        } else {
            viewer.setAttribute('src', frameSrc);
        }
        armBlockedTimer();
        var input = document.getElementById('weblinkInput');
        if (input) input.value = url;
    }

    function reloadViewer() {
        if (!currentFrameSrc) return;
        try {
            viewer.contentWindow.location.reload();
        } catch (e) {
            viewer.setAttribute('src', currentFrameSrc);
        }
        armBlockedTimer();
    }

    // The proxy answers a refused page (bad URL, SSRF block, upstream
    // error, too large) with a plain error page titled "Cinema for Two
    // — proxy". Same-origin, so the parent can read it. When it shows
    // up, fall back to the direct URL for this page and say so plainly.
    function isProxyErrorPage() {
        try {
            var doc = viewer.contentDocument;
            if (!doc) return false;
            return doc.title === 'Cinema for Two — proxy';
        } catch (e) {
            return false;
        }
    }

    viewer.addEventListener('load', function () {
        clearTimeout(blockedTimer);
        blockedNotice.classList.add('hidden');
        if (proxyFallbackArmed && currentProxied && isProxyErrorPage()) {
            proxyFallbackArmed = false;
            currentProxied = false;
            if (sync) viewer.setAttribute('sandbox', sync.sandboxTokensForSrc(currentUrl, proxyUrl, window.location.origin));
            currentFrameSrc = currentUrl;
            viewer.setAttribute('src', currentUrl);
            armBlockedTimer();
            showToast('Synced browsing could not load that page — showing it direct instead.');
        }
    });

    if (blockedDismiss) {
        blockedDismiss.addEventListener('click', function () {
            blockedNotice.classList.add('hidden');
        });
    }

    function shelfHas(id) {
        return !!shelf.querySelector('li[data-id="' + id + '"]');
    }

    function addToShelf(link) {
        var empty = document.getElementById('weblinkShelfEmpty');
        if (empty) empty.remove();
        if (shelfHas(link.id)) return;
        var li = document.createElement('li');
        li.dataset.id = String(link.id);
        li.className = 'bg-canvas-background hover:bg-surface-control border border-hairline-border hover:border-primary-container/40 transition rounded-[6px] px-4 py-3 flex items-center justify-between gap-3';
        var div = document.createElement('div');
        div.className = 'min-w-0';
        var a = document.createElement('a');
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'text-xs font-semibold text-text-primary truncate block hover:text-primary-container';
        a.textContent = link.url.replace(/^https?:\/\//, '').split('/')[0] || link.url;
        var p = document.createElement('p');
        p.className = 'text-[11px] text-text-muted truncate mt-0.5';
        p.textContent = link.url + ' · Shared by ' + (link.shared_by || 'Someone') + ' · just now';
        div.appendChild(a);
        div.appendChild(p);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.url = link.url;
        btn.dataset.id = String(link.id);
        btn.className = 'weblink-open px-2.5 py-1.5 rounded-[6px] bg-surface-control hover:bg-surface-variant border border-hairline-border text-text-primary text-[11px] font-semibold shrink-0';
        btn.textContent = 'Open';
        li.appendChild(div);
        li.appendChild(btn);
        shelf.prepend(li);
    }

    // --- Sharing a link -------------------------------------------------
    // One share flow for every path in: the form, a shelf "Open", a
    // partner's banner tap, and a link tap inside a proxied page. It
    // saves the link to the room (the record keeps the ORIGINAL url),
    // mounts it (proxied when synced browsing is on), and tells the
    // partner over PeerJS. Returns a promise of the saved link or null.
    function shareLink(url) {
        url = (url || '').trim();
        if (!url) return Promise.resolve(null);
        return fetch(weblinkStoreUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRF-TOKEN': csrf,
            },
            body: JSON.stringify({ url: url }),
        })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
            .then(function (res) {
                if (!res.ok) throw new Error((res.body && res.body.message) || 'Could not share that link.');
                var link = res.body;
                addToShelf(link);
                loadViewer(link.url, link.id);
                sendPeer({ kind: 'weblink', id: link.id, url: link.url, by: userName });
                return link;
            })
            .catch(function (err) { showToast(err.message || 'Could not share that link.'); return null; });
    }

    document.getElementById('weblinkForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('weblinkInput');
        shareLink(input.value);
    });

    // "Browse together (synced)": wrap shared pages through /proxy so
    // scrolling and link taps move on both phones. Flipping it re-mounts
    // the page already open, in the new mode — no new weblink row, so
    // the shelf stays clean. Both phones turn it on; the toggle is
    // per-device and is not synced.
    var syncToggle = document.getElementById('webSyncToggle');
    if (syncToggle) {
        syncToggle.addEventListener('change', function () {
            syncEnabled = syncToggle.checked;
            if (currentUrl) loadViewer(currentUrl, currentId);
        });
    }

    // Shelf "Open" moves the whole room to that link.
    shelf.addEventListener('click', function (e) {
        var btn = e.target.closest('.weblink-open');
        if (!btn) return;
        var url = btn.dataset.url;
        var id = btn.dataset.id ? parseInt(btn.dataset.id, 10) : null;
        loadViewer(url, id);
        sendPeer({ kind: 'weblink', id: id, url: url, by: userName });
    });

    document.getElementById('syncPageBtn').addEventListener('click', function () {
        if (!currentUrl) { showToast('No page open yet — paste a link first.'); return; }
        reloadViewer();
        sendPeer({ kind: 'weblink-sync', url: currentUrl, by: userName });
        showToast('Page synced to the shared link.');
    });

    bannerOpen.addEventListener('click', function () {
        if (!pendingBannerLink) return;
        banner.classList.add('hidden');
        loadViewer(pendingBannerLink.url, pendingBannerLink.id);
        sendPeer({ kind: 'weblink', id: pendingBannerLink.id, url: pendingBannerLink.url, by: userName });
        pendingBannerLink = null;
    });

    // --- Synced browsing: messages from the proxied page --------------
    // Accepted ONLY from our own origin AND only from our iframe's
    // window — the proxy is same-origin with this app, so the origin
    // check is the boundary, and a message from any other frame is
    // ignored. The handler is NOT gated on the toggle: a page mounted
    // while sync was on keeps reporting until it is replaced, and the
    // origin + source check is the security boundary either way.
    // No scroll-to {0,0} is sent on mount: a fresh page already starts
    // at 0,0, and sending one could yank a partner who already scrolled.
    window.addEventListener('message', function (event) {
        if (!sync) return;
        var frameWindow = viewer.contentWindow;
        if (!sync.isProxyFrameMessage(event, window.location.origin, frameWindow)) return;
        var d = event.data;
        if (d.type === 'c2t-scroll') {
            // Echo of a scroll we just applied? Ignore it, or the two
            // phones chase each other in a loop.
            if (sync.isWebScrollEcho(lastWebScrollAt, Date.now())) return;
            var x = Number(d.x) || 0;
            var y = Number(d.y) || 0;
            roomDebug.lastFrameScroll = { x: x, y: y, at: Date.now() };
            // Forward to the partner — only scrolls from THIS phone's frame.
            sendPeer({ kind: 'web-scroll', x: x, y: y, by: userName });
        } else if (d.type === 'c2t-link') {
            var href = typeof d.href === 'string' ? d.href : '';
            if (!href) return;
            roomDebug.lastLinkTap = { href: href, at: Date.now() };
            // A tap inside the page moves the whole room, like a fresh share.
            shareLink(href);
        }
    });

    // Send a scroll position INTO the proxied page. targetOrigin is our
    // own origin, never '*'. Records the send time first, so the echo
    // guard catches the frame's own report of the jump.
    function postWebScrollTo(x, y) {
        var win = viewer.contentWindow;
        if (!win) return false;
        lastWebScrollAt = Date.now();
        try {
            win.postMessage({ type: 'c2t-scroll-to', x: Number(x) || 0, y: Number(y) || 0 }, window.location.origin);
            return true;
        } catch (e) {
            return false;
        }
    }

    // --- Poll fallback (PeerJS down? links still arrive) ---------------
    var knownIds = new Set();
    shelf.querySelectorAll('li[data-id]').forEach(function (li) { knownIds.add(li.dataset.id); });

    function pollWeblinks() {
        fetch(weblinksUrl, { headers: { 'Accept': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                (data.weblinks || []).forEach(function (link) {
                    if (knownIds.has(String(link.id))) return;
                    knownIds.add(String(link.id));
                    addToShelf(link);
                    pendingBannerLink = link;
                    bannerText.textContent = link.url;
                    banner.classList.remove('hidden');
                });
            })
            .catch(function () { /* next poll retries; offline is not fatal */ });
    }
    setInterval(pollWeblinks, 15000);

    // --- PeerJS live sync ----------------------------------------------
    var conn = null;
    var peer = null;

    function sendPeer(msg) {
        if (!conn) return false;
        try { conn.send(msg); return true; } catch (e) { return false; }
    }

    // One handler for every PeerJS message, live or simulated. It is
    // also exposed on window.__cinemaRoom so a diagnostic check (or the
    // harness) can drive an incoming message without a second phone.
    function handlePeerMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.kind === 'weblink' && msg.url) {
            if (msg.id) knownIds.add(String(msg.id));
            addToShelf({ id: msg.id || 0, url: msg.url, shared_by: msg.by });
            loadViewer(msg.url, msg.id || null);
            showToast((msg.by || 'Your partner') + ' shared a link.');
        } else if (msg.kind === 'weblink-sync' && msg.url) {
            loadViewer(msg.url, currentId);
            showToast('Page synced by ' + (msg.by || 'your partner') + '.');
        } else if (msg.kind === 'web-scroll') {
            // The partner scrolled the shared page — move our frame to
            // match. Only when the frame currently holds a proxied page;
            // a direct page has no sync script inside it, so there is
            // nothing to drive.
            if (!currentProxied) return;
            var x = Number(msg.x) || 0;
            var y = Number(msg.y) || 0;
            roomDebug.lastPartnerScroll = { x: x, y: y, at: Date.now() };
            postWebScrollTo(x, y);
        }
    }
    roomDebug.handlePeerMessage = handlePeerMessage;

    function attachConn(c) {
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = c;
        conn.on('open', function () { setPresence('live', 'Live Synced'); });
        conn.on('data', handlePeerMessage);
        conn.on('close', function () { setPresence('offline', 'Sync Offline'); });
        conn.on('error', function () { setPresence('offline', 'Sync Offline'); });
    }

    function connectToHost() {
        if (!peer || peer.destroyed) return;
        try {
            var c = peer.connect('c2t-' + roomCode, { reliable: true });
            if (c) attachConn(c);
        } catch (e) { setPresence('offline', 'Sync Offline'); }
    }

    function setupPeer() {
        if (typeof Peer === 'undefined') {
            setPresence('offline', 'Sync Offline — links still save; refresh to see new ones.');
            return;
        }
        setPresence('connecting', 'Connecting…');
        try {
            peer = new Peer('c2t-' + roomCode);
        } catch (e) {
            setPresence('offline', 'Sync Offline');
            return;
        }
        peer.on('open', function () { setPresence('live', 'Live Synced'); });
        peer.on('connection', attachConn);
        peer.on('error', function (err) {
            if (err && err.type === 'unavailable-id') {
                try { peer.destroy(); } catch (e) {}
                peer = new Peer('c2t-guest-' + Math.random().toString(36).slice(2, 8));
                peer.on('open', function () { connectToHost(); });
                peer.on('error', function () { setPresence('offline', 'Sync Offline'); });
            } else {
                setPresence('offline', 'Sync Offline');
            }
        });
        peer.on('disconnected', function () {
            setPresence('connecting', 'Reconnecting…');
            setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000);
        });
    }

    setupPeer();
    if (currentUrl) armBlockedTimer();
})();
