/**
 * Cinema for Two — room shell (Laravel v1).
 *
 * Live sync stays on PeerJS Cloud, same approach as the static app:
 * the room code is the peer id (c2t-<CODE>), the first side to open the
 * room hosts it, the other joins as a guest. The data channel carries
 * only weblink events — shared links and "sync page". Video/voice
 * calling arrives in v2.
 *
 * Honest limits, by design:
 * - Each phone scrolls and taps inside the iframe on its own screen.
 *   Cross-origin scroll/click sync is impossible: the browser will not
 *   let this page read scroll position or clicks inside another site.
 * - Some sites refuse to embed at all (X-Frame-Options / CSP). A 10s
 *   load timeout shows the blocked notice with an Open-in-browser link.
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
    var weblinksUrl = root.dataset.weblinksUrl;
    var weblinkStoreUrl = root.dataset.weblinkStoreUrl;
    var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

    var viewer = document.getElementById('webViewer');
    var webEmpty = document.getElementById('webEmpty');
    var blockedNotice = document.getElementById('blockedNotice');
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

    function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, 3200);
    }

    function setPresence(state, text) {
        var dot = state === 'live' ? 'bg-presence' : state === 'offline' ? 'bg-errorText' : 'bg-primary';
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

    function loadViewer(url, id) {
        if (!url) return;
        currentUrl = url;
        currentId = id || null;
        viewer.classList.remove('hidden');
        webEmpty.classList.add('hidden');
        openInBrowser.classList.remove('opacity-50', 'pointer-events-none');
        openInBrowser.href = url;
        blockedOpenLink.href = url;
        if (viewer.getAttribute('src') === url) {
            reloadViewer();
        } else {
            viewer.setAttribute('src', url);
        }
        armBlockedTimer();
        var input = document.getElementById('weblinkInput');
        if (input) input.value = url;
    }

    function reloadViewer() {
        if (!currentUrl) return;
        try {
            viewer.contentWindow.location.reload();
        } catch (e) {
            viewer.setAttribute('src', currentUrl);
        }
        armBlockedTimer();
    }

    viewer.addEventListener('load', function () {
        clearTimeout(blockedTimer);
        blockedNotice.classList.add('hidden');
    });

    function shelfHas(id) {
        return !!shelf.querySelector('li[data-id="' + id + '"]');
    }

    function addToShelf(link) {
        var empty = document.getElementById('weblinkShelfEmpty');
        if (empty) empty.remove();
        if (shelfHas(link.id)) return;
        var li = document.createElement('li');
        li.dataset.id = String(link.id);
        li.className = 'bg-card border border-hairline rounded-[10px] px-4 py-3 flex items-center justify-between gap-3';
        var div = document.createElement('div');
        div.className = 'min-w-0';
        var a = document.createElement('a');
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'text-sm text-textPrimary truncate block hover:text-primary';
        a.textContent = link.url;
        var p = document.createElement('p');
        p.className = 'text-xs text-textMuted mt-0.5';
        p.textContent = 'Shared by ' + (link.shared_by || 'Someone') + ' · just now';
        div.appendChild(a);
        div.appendChild(p);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.url = link.url;
        btn.dataset.id = String(link.id);
        btn.className = 'weblink-open px-3 h-8 rounded-md bg-control border border-hairline text-xs shrink-0';
        btn.textContent = 'Open';
        li.appendChild(div);
        li.appendChild(btn);
        shelf.prepend(li);
    }

    // --- Sharing a link -------------------------------------------------
    document.getElementById('weblinkForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('weblinkInput');
        var url = input.value.trim();
        if (!url) return;
        fetch(weblinkStoreUrl, {
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
            })
            .catch(function (err) { showToast(err.message || 'Could not share that link.'); });
    });

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

    function attachConn(c) {
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = c;
        conn.on('open', function () { setPresence('live', 'Live Synced'); });
        conn.on('data', function (msg) {
            if (!msg || typeof msg !== 'object') return;
            if (msg.kind === 'weblink' && msg.url) {
                if (msg.id) knownIds.add(String(msg.id));
                addToShelf({ id: msg.id || 0, url: msg.url, shared_by: msg.by });
                loadViewer(msg.url, msg.id || null);
                showToast((msg.by || 'Your partner') + ' shared a link.');
            } else if (msg.kind === 'weblink-sync' && msg.url) {
                loadViewer(msg.url, currentId);
                showToast('Page synced by ' + (msg.by || 'your partner') + '.');
            }
        });
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
