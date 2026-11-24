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

    // --- Synced video player -------------------------------------------
    // Ported from the static app (app.js, ?v=33/?v=43/?v=49). Pure
    // decisions live in public/js/room-player.js (window.CinemaPlayer);
    // this block owns the DOM: the <video> element, the YouTube embed,
    // the transport bar, and the PeerJS messages. The mini-browser above
    // is untouched — theater and browser are separate sections.
    var playerLib = (typeof window !== 'undefined' && window.CinemaPlayer) || null;

    var videoEl = document.getElementById('roomVideo');
    var ytWrap = document.getElementById('ytMountWrap');
    var videoEmpty = document.getElementById('videoEmpty');
    var movieWaiting = document.getElementById('movieWaiting');
    var movieWaitingText = document.getElementById('movieWaitingText');
    var mediaErrorBanner = document.getElementById('mediaErrorBanner');
    var mediaErrorText = document.getElementById('mediaErrorText');
    var unmuteBtn = document.getElementById('unmuteBtn');
    var playPauseBtn = document.getElementById('playPauseBtn');
    var seekSlider = document.getElementById('seekSlider');
    var currentTimeLabel = document.getElementById('currentTimeLabel');
    var durationLabel = document.getElementById('durationLabel');
    var nowPlayingTitle = document.getElementById('nowPlayingTitle');
    var mediaForm = document.getElementById('mediaForm');
    var mediaInput = document.getElementById('mediaInput');
    var localFileInput = document.getElementById('localFileInput');

    var mediaStoreUrl = root.dataset.mediaStoreUrl;
    var myPeerId = null;
    var isHost = false;
    var connPeerId = null;
    var partnerMedia = null;

    // Player state. mediaType: 'none' | 'youtube' | 'url' | 'local' |
    // 'movie' (receiving a shared file). mediaUrl is the video id for
    // youtube, the link for url, the file name for local. ytVideoId
    // remembers the YouTube id behind a Piped stream so a dead stream can
    // fall back to the embed. mySeq numbers our own playback messages —
    // seq is per-device, never compared with the partner's counter.
    var playerState = {
        mediaType: 'none',
        mediaUrl: '',
        mediaTitle: '',
        mediaId: null,
        ytVideoId: null,
        viaPiped: false,
        mySeq: 0,
        lastSeqBySender: {},
        lastRemotePauseAt: 0,
        lastRemoteApplied: null,
        userPlayIntent: false,
        remoteSyncUntil: 0,
        ytApiReady: false,
        ytApiLoading: false,
        pendingYtVideoId: null,
        ytPlayer: null,
        localFileUrl: null,
        localFileName: null,
        movieSharing: false,
        movieCall: null,
        receivingMovie: false,
        movieRemoteTime: null,
        errorRetried: false,
        scrubbing: false,
    };
    roomDebug.player = playerState;
    roomDebug.lastPlayback = null;
    roomDebug.lastBroadcast = null;
    roomDebug.lastMedia = null;
    roomDebug.lastMovieControl = null;

    function formatTime(seconds) {
        var s = Math.max(0, Math.floor(Number(seconds) || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function showMediaError(message) {
        if (!message) return;
        mediaErrorText.textContent = message;
        mediaErrorBanner.classList.remove('hidden');
    }

    function hideMediaError() {
        mediaErrorBanner.classList.add('hidden');
    }

    if (document.getElementById('mediaErrorDismissBtn')) {
        document.getElementById('mediaErrorDismissBtn').addEventListener('click', hideMediaError);
    }

    function showUnmute() { unmuteBtn.classList.remove('hidden'); }
    function hideUnmute() { unmuteBtn.classList.add('hidden'); }
    unmuteBtn.addEventListener('click', function () {
        videoEl.muted = false;
        hideUnmute();
    });

    // --- Player clock (shared by both engines) -------------------------
    function getPlayerCurrentTime() {
        if (playerState.receivingMovie && playerLib) {
            return playerLib.movieRemoteCurrentTime(playerState.movieRemoteTime, Date.now());
        }
        if (playerState.mediaType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.getCurrentTime === 'function') {
            return playerState.ytPlayer.getCurrentTime() || 0;
        }
        if (videoEl) return videoEl.currentTime || 0;
        return 0;
    }

    function getPlayerDuration() {
        if (playerState.receivingMovie) return (playerState.movieRemoteTime && playerState.movieRemoteTime.duration) || 0;
        if (playerState.mediaType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.getDuration === 'function') {
            return playerState.ytPlayer.getDuration() || 0;
        }
        if (videoEl) return videoEl.duration || 0;
        return 0;
    }

    function isPlayerCurrentlyPlaying() {
        if (playerState.receivingMovie) return !!(playerState.movieRemoteTime && playerState.movieRemoteTime.isPlaying);
        if (playerState.mediaType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.getPlayerState === 'function' && window.YT) {
            return playerState.ytPlayer.getPlayerState() === window.YT.PlayerState.PLAYING;
        }
        if (videoEl) return !videoEl.paused && !videoEl.ended;
        return false;
    }

    function isRemoteSyncLocked() {
        return Date.now() < playerState.remoteSyncUntil;
    }

    function engageRemoteSyncLock() {
        playerState.remoteSyncUntil = Date.now() + (playerLib ? playerLib.REMOTE_SYNC_LOCK_MS : 750);
    }

    function executeLocalPlay() {
        if (playerState.mediaType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.playVideo === 'function') {
            playerState.ytPlayer.playVideo();
        } else if (videoEl) {
            videoEl.play().catch(function (err) {
                // The browser blocked autoplay with sound — play muted
                // instead and offer one tap to unmute, instead of a
                // frozen screen.
                if (err && err.name === 'NotAllowedError') {
                    videoEl.muted = true;
                    videoEl.play().catch(function () {});
                    showUnmute();
                    showToast('Video started muted — tap Tap to unmute for sound.');
                } else {
                    showToast('Tap Play once to allow browser audio playback.');
                }
            });
        }
        updatePlayButtonUI(true);
    }

    function executeLocalPause() {
        if (playerState.mediaType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.pauseVideo === 'function') {
            playerState.ytPlayer.pauseVideo();
        } else if (videoEl) {
            videoEl.pause();
        }
        updatePlayButtonUI(false);
    }

    function executeLocalSeek(seconds) {
        var clamped = Math.max(0, Number(seconds) || 0);
        if (playerState.mediaType === 'youtube' && playerState.ytPlayer && typeof playerState.ytPlayer.seekTo === 'function') {
            playerState.ytPlayer.seekTo(clamped, true);
        } else if (videoEl) {
            if (Number.isFinite(videoEl.duration)) {
                videoEl.currentTime = Math.min(clamped, videoEl.duration);
            } else {
                videoEl.currentTime = clamped;
            }
        }
        updateTimelineUI();
    }

    function updatePlayButtonUI(playing) {
        playPauseBtn.textContent = playing ? 'Pause' : 'Play';
    }

    function updateTimelineUI() {
        var cur = getPlayerCurrentTime();
        var dur = getPlayerDuration();
        currentTimeLabel.textContent = formatTime(cur);
        durationLabel.textContent = formatTime(dur);
        if (dur > 0) {
            seekSlider.max = dur;
            if (!playerState.scrubbing) seekSlider.value = cur;
            var pct = Math.min(100, (cur / dur) * 100);
            seekSlider.style.background = 'linear-gradient(to right, #E5A93C ' + pct + '%, rgba(255,255,255,0.16) ' + pct + '%)';
        }
    }

    // --- Broadcasting playback (with the ?v=49 echo guards) ------------
    function broadcastPlaybackChange(isPlaying, currentTime, actionLabel) {
        if (!playerLib) return;
        if (playerState.mediaType === 'none') return;
        // A movie receiver's clock is the sender's — its own play event
        // is the stream starting, never a state change to send back.
        if (playerState.receivingMovie) return;
        var decision = playerLib.shouldBroadcastPlayback({
            isPlaying: isPlaying,
            actionLabel: actionLabel || null,
            userPlayIntent: playerState.userPlayIntent,
            lastRemotePauseAt: playerState.lastRemotePauseAt,
            lastRemoteApplied: playerState.lastRemoteApplied,
            currentTime: currentTime,
            nowMs: Date.now(),
        });
        if (!decision.send) return;
        if (decision.consumeIntent) playerState.userPlayIntent = false;
        // A real state flip by us clears the echo guard, so a play
        // pressed after our own pause is never swallowed.
        if (playerState.lastRemoteApplied && isPlaying !== playerState.lastRemoteApplied.isPlaying) {
            playerState.lastRemoteApplied = null;
        }
        playerState.mySeq += 1;
        var msg = {
            kind: 'playback',
            isPlaying: Boolean(isPlaying),
            currentTime: Number(currentTime) || 0,
            duration: getPlayerDuration(),
            actionLabel: actionLabel || (isPlaying ? 'played' : 'paused'),
            seq: playerState.mySeq,
            by: userName,
            byPeer: myPeerId,
            updatedBy: myPeerId,
            at: Date.now(),
        };
        roomDebug.lastBroadcast = msg;
        sendPeer(msg);
    }

    // "Still playing" every 10s while playing — a late joiner, or a side
    // whose player drifted, re-syncs from it. A heartbeat never starts
    // playback and never moves the playhead (the receiver enforces both).
    setInterval(function () {
        if (playerState.mediaType === 'none' || playerState.receivingMovie) return;
        if (!isPlayerCurrentlyPlaying()) return;
        broadcastPlaybackChange(true, getPlayerCurrentTime(), 'heartbeat');
    }, playerLib ? playerLib.PLAYBACK_HEARTBEAT_MS : 10000);

    // --- Applying the partner's playback --------------------------------
    function applyRemotePlayback(playback) {
        if (!playerLib) return;
        var decision = playerLib.shouldApplyPlayback(playback, {
            myId: myPeerId,
            lastSeqBySender: playerState.lastSeqBySender,
            isPlayingNow: isPlayerCurrentlyPlaying(),
            nowMs: Date.now(),
        });
        if (!decision.apply) return;
        if (playback.seq) {
            playerState.lastSeqBySender[playback.updatedBy || playback.byPeer || 'partner'] = playback.seq;
        }
        roomDebug.lastPlayback = playback;
        engageRemoteSyncLock();
        var targetTime = decision.targetTime;
        if (playback.updatedBy || playback.byPeer) {
            playerState.lastRemoteApplied = { isPlaying: playback.isPlaying, currentTime: targetTime, at: Date.now() };
            if (!playback.isPlaying) playerState.lastRemotePauseAt = Date.now();
        }
        // Receiving a shared movie: our player is a live stream with no
        // seekable timeline — never touch the element (pausing it would
        // freeze our view while the sender keeps playing). Just mirror
        // the sender's clock for the time display.
        if (playerState.receivingMovie) {
            playerState.movieRemoteTime = {
                currentTime: targetTime,
                duration: (playback.duration && Number.isFinite(playback.duration)) ? playback.duration : ((playerState.movieRemoteTime && playerState.movieRemoteTime.duration) || 0),
                isPlaying: playback.isPlaying,
                at: Date.now(),
            };
            updatePlayButtonUI(playback.isPlaying);
            updateTimelineUI();
            if (playback.by && playback.actionLabel !== 'heartbeat') {
                showToast(playback.by + ' ' + (playback.actionLabel || (playback.isPlaying ? 'played' : 'paused')) + ' at ' + formatTime(targetTime) + '.');
            }
            return;
        }
        // Anti-stutter: heartbeats never move the playhead — their
        // timestamp comes from the partner's clock, so every heartbeat
        // would yank the video and make it freeze and re-buffer.
        var isHeartbeat = playback.actionLabel === 'heartbeat';
        var drift = Math.abs(getPlayerCurrentTime() - targetTime);
        if (drift > playerLib.SEEK_DRIFT_S && !isHeartbeat) {
            executeLocalSeek(targetTime);
        }
        if (playback.isPlaying) {
            executeLocalPlay();
        } else {
            executeLocalPause();
        }
        if (playback.by && playback.actionLabel !== 'heartbeat') {
            showToast(playback.by + ' ' + (playback.actionLabel || (playback.isPlaying ? 'played' : 'paused')) + ' at ' + formatTime(targetTime) + '.');
        }
    }

    // --- Mounting --------------------------------------------------------
    function showStage(which) {
        videoEmpty.classList.add('hidden');
        movieWaiting.classList.add('hidden');
        if (which === 'video') {
            videoEl.classList.remove('hidden');
            ytWrap.classList.add('hidden');
        } else if (which === 'youtube') {
            videoEl.classList.add('hidden');
            ytWrap.classList.remove('hidden');
        } else {
            videoEl.classList.add('hidden');
            ytWrap.classList.add('hidden');
        }
    }

    function stopYtPlayer() {
        if (playerState.ytPlayer && typeof playerState.ytPlayer.stopVideo === 'function') {
            try { playerState.ytPlayer.stopVideo(); } catch (e) {}
        }
    }

    function mountDirectVideo(src) {
        stopYtPlayer();
        hideMediaError();
        hideUnmute();
        showStage('video');
        playerState.errorRetried = false;
        if (videoEl.getAttribute('src') !== src) {
            videoEl.srcObject = null;
            videoEl.setAttribute('src', src);
            videoEl.load();
        }
    }

    function fetchJsonWithTimeout(url, timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        return fetch(url, { signal: controller.signal })
            .then(function (res) { if (!res.ok) return null; return res.json(); })
            .catch(function () { return null; })
            .finally(function () { clearTimeout(timer); });
    }

    async function resolveYouTubeViaPiped(videoId) {
        for (var i = 0; i < playerLib.PIPED_API_BASES.length; i++) {
            var data = await fetchJsonWithTimeout(playerLib.PIPED_API_BASES[i] + '/streams/' + videoId, playerLib.PIPED_FETCH_TIMEOUT_MS);
            if (data) {
                var picked = playerLib.pickPipedStream(data);
                if (picked) return picked;
            }
        }
        return null;
    }

    function waitForPlayable(videoEl, timeoutMs) {
        if (videoEl.readyState >= 3) return Promise.resolve(true);
        return new Promise(function (resolve) {
            var done = false;
            var timer = setTimeout(function () { finish(false); }, timeoutMs);
            function finish(ok) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                videoEl.removeEventListener('canplay', onCanPlay);
                videoEl.removeEventListener('error', onError);
                resolve(ok);
            }
            function onCanPlay() { finish(true); }
            function onError() { finish(false); }
            videoEl.addEventListener('canplay', onCanPlay, { once: true });
            videoEl.addEventListener('error', onError, { once: true });
        });
    }

    // YouTube via the Piped redirect (ad-free direct stream, MP4
    // preferred). Any failure falls back to the YouTube embed — never a
    // dead screen. A stream that dies mid-play falls back the same way.
    async function mountYouTubeAdFree(videoId, titleLabel) {
        nowPlayingTitle.textContent = 'Finding an ad-free stream…';
        try {
            var piped = await resolveYouTubeViaPiped(videoId);
            if (piped) {
                var title = piped.title || titleLabel || ('YouTube (' + videoId + ')');
                playerState.ytVideoId = videoId;
                playerState.viaPiped = true;
                playerState.mediaType = 'url';
                playerState.mediaUrl = piped.streamUrl;
                playerState.mediaTitle = title;
                nowPlayingTitle.textContent = title;
                mountDirectVideo(piped.streamUrl);
                var playable = await waitForPlayable(videoEl, 10000);
                if (playable) return true;
            }
        } catch (e) { /* fall through to the embed */ }
        mountYouTubePlayer(videoId, titleLabel);
        return false;
    }

    function loadYouTubeApi() {
        if (playerState.ytApiReady || playerState.ytApiLoading) return;
        if (typeof window !== 'undefined' && window.YT && window.YT.Player) {
            playerState.ytApiReady = true;
            return;
        }
        playerState.ytApiLoading = true;
        var tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        var firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    if (typeof window !== 'undefined') {
        window.onYouTubeIframeAPIReady = function () {
            playerState.ytApiReady = true;
            playerState.ytApiLoading = false;
            if (playerState.pendingYtVideoId) {
                var id = playerState.pendingYtVideoId;
                playerState.pendingYtVideoId = null;
                mountYouTubePlayer(id);
            }
        };
    }

    function mountYouTubePlayer(videoId, titleLabel) {
        stopYtPlayer();
        videoEl.pause();
        hideMediaError();
        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || '')) {
            showMediaError('That YouTube link did not play — check the full link and try again.');
            showToast('That YouTube link did not play — check the full link and try again.');
            return;
        }
        playerState.ytVideoId = videoId;
        playerState.viaPiped = false;
        playerState.mediaType = 'youtube';
        playerState.mediaUrl = videoId;
        playerState.mediaTitle = titleLabel || ('YouTube (' + videoId + ')');
        nowPlayingTitle.textContent = 'Loading YouTube video...';
        showStage('youtube');
        if (!playerState.ytApiReady) {
            playerState.pendingYtVideoId = videoId;
            loadYouTubeApi();
            return;
        }
        if (playerState.ytPlayer && typeof playerState.ytPlayer.loadVideoById === 'function') {
            playerState.ytPlayer.loadVideoById(videoId);
            return;
        }
        playerState.ytPlayer = new window.YT.Player('ytMount', {
            videoId: videoId,
            width: '100%',
            height: '100%',
            playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, playsinline: 1 },
            events: {
                onReady: function (event) {
                    var data = event.target.getVideoData && event.target.getVideoData();
                    if (data && data.title) {
                        playerState.mediaTitle = data.title;
                        nowPlayingTitle.textContent = data.title;
                    }
                },
                onError: function (event) {
                    var code = event && event.data;
                    var why = (code === 101 || code === 150)
                        ? 'the owner turned off embedding'
                        : (code === 100)
                            ? 'it may be private or deleted'
                            : 'check the link and try another video';
                    showMediaError('This YouTube video can\'t play here — ' + why + '.');
                    showToast('This YouTube video can\'t play here — ' + why + '.');
                },
                onStateChange: function (event) {
                    if (isRemoteSyncLocked()) return;
                    if (event.data === window.YT.PlayerState.PLAYING) {
                        // Echo of the partner's pause: YouTube can resume
                        // on its own after buffering even though pause was
                        // called — re-pause instead of broadcasting a
                        // 'played' that re-plays the partner. A deliberate
                        // press sets userPlayIntent first.
                        if (!playerState.userPlayIntent && playerState.lastRemotePauseAt && Date.now() - playerState.lastRemotePauseAt < playerLib.PAUSE_ECHO_MS) {
                            if (playerState.ytPlayer && typeof playerState.ytPlayer.pauseVideo === 'function') playerState.ytPlayer.pauseVideo();
                            updatePlayButtonUI(false);
                            return;
                        }
                        var data = event.target.getVideoData && event.target.getVideoData();
                        if (data && data.title) {
                            playerState.mediaTitle = data.title;
                            nowPlayingTitle.textContent = data.title;
                        }
                        updatePlayButtonUI(true);
                        broadcastPlaybackChange(true, getPlayerCurrentTime());
                    } else if (event.data === window.YT.PlayerState.PAUSED) {
                        updatePlayButtonUI(false);
                        broadcastPlaybackChange(false, getPlayerCurrentTime());
                    }
                },
            },
        });
    }

    // One mount path for every media record — local picks, partner picks,
    // and the room's saved video on load.
    function mountMedia(media) {
        if (!media || !media.type || !media.url) return;
        if (playerState.movieSharing) stopMovieShare(false);
        if (playerState.receivingMovie) stopReceivingMovie(false);
        playerState.mediaId = media.id || null;
        playerState.mediaTitle = media.title || '';
        roomDebug.lastMedia = media;
        if (media.type === 'youtube') {
            mountYouTubeAdFree(media.url, media.title);
        } else if (media.type === 'url') {
            playerState.ytVideoId = null;
            playerState.viaPiped = false;
            playerState.mediaType = 'url';
            playerState.mediaUrl = media.url;
            playerState.mediaTitle = media.title || media.url;
            nowPlayingTitle.textContent = playerState.mediaTitle;
            mountDirectVideo(media.url);
        } else if (media.type === 'local') {
            // Our own file is already in the <video> element (the file
            // picker mounts it before sharing). A partner's file has no
            // picture here yet — the shared stream arrives next.
            if (playerState.mediaType === 'local' && playerState.localFileName === media.url) return;
            playerState.mediaType = 'movie';
            playerState.mediaUrl = media.url;
            playerState.mediaTitle = media.title || media.url;
            nowPlayingTitle.textContent = playerState.mediaTitle;
            videoEl.classList.add('hidden');
            ytWrap.classList.add('hidden');
            videoEmpty.classList.add('hidden');
            movieWaiting.classList.remove('hidden');
            movieWaitingText.textContent = (media.title || media.url) + ' — your partner is sharing it from their device. It will start here when the stream arrives.';
        }
    }

    // --- Sharing a video (same shape as shareLink) ----------------------
    function shareMedia(type, url, title) {
        return fetch(mediaStoreUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRF-TOKEN': csrf,
            },
            body: JSON.stringify({ type: type, url: url, title: title || null }),
        })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
            .then(function (res) {
                if (!res.ok) throw new Error((res.body && res.body.message) || 'Could not share that video.');
                var media = res.body;
                partnerMedia = null;
                mountMedia(media);
                sendPeer({ kind: 'media', id: media.id, type: media.type, url: media.url, title: media.title, by: userName, byPeer: myPeerId, at: Date.now() });
                return media;
            })
            .catch(function (err) { showToast(err.message || 'Could not share that video.'); return null; });
    }

    mediaForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!playerLib) { showToast('The video player did not load — refresh the page.'); return; }
        var plan = playerLib.parseVideoInput(mediaInput.value);
        if (plan.via === 'none') {
            if (plan.reason === 'unsupported-format') {
                showToast('That format needs a converter first — pick an MP4 or WebM file, or a YouTube link.');
            } else {
                showToast('That does not look like a video — paste a YouTube link or a direct video link.');
            }
            return;
        }
        if (plan.via === 'piped') {
            shareMedia('youtube', plan.videoId, null);
        } else {
            shareMedia('url', plan.url, null);
        }
    });

    localFileInput.addEventListener('change', function () {
        var file = localFileInput.files && localFileInput.files[0];
        if (!file) return;
        var ext = playerLib ? playerLib.detectVideoExtension(file.name) : '';
        if (ext === 'm3u8') {
            showMediaError(playerLib.mediaErrorMessage('hls-local', true));
            return;
        }
        if (playerState.localFileUrl) {
            try { URL.revokeObjectURL(playerState.localFileUrl); } catch (e) {}
        }
        playerState.localFileUrl = URL.createObjectURL(file);
        playerState.localFileName = file.name;
        playerState.ytVideoId = null;
        playerState.viaPiped = false;
        playerState.mediaType = 'local';
        playerState.mediaUrl = file.name;
        playerState.mediaTitle = file.name;
        nowPlayingTitle.textContent = file.name;
        hideMediaError();
        mountDirectVideo(playerState.localFileUrl);
        shareMedia('local', file.name, file.name).then(function (media) {
            if (media) startMovieShare();
        });
    });

    // --- Transport bar ----------------------------------------------------
    playPauseBtn.addEventListener('click', function () {
        if (playerState.mediaType === 'none') { showToast('No video yet — paste a link or pick a file first.'); return; }
        if (playerState.receivingMovie) {
            var action = isPlayerCurrentlyPlaying() ? 'pause' : 'play';
            sendMovieControl(action, getPlayerCurrentTime());
            return;
        }
        playerState.userPlayIntent = true;
        if (isPlayerCurrentlyPlaying()) {
            executeLocalPause();
        } else {
            executeLocalPlay();
        }
    });

    seekSlider.addEventListener('input', function () {
        playerState.scrubbing = true;
        currentTimeLabel.textContent = formatTime(Number(seekSlider.value) || 0);
    });

    seekSlider.addEventListener('change', function () {
        playerState.scrubbing = false;
        var target = Number(seekSlider.value) || 0;
        if (playerState.receivingMovie) {
            sendMovieControl('seek', target);
            return;
        }
        executeLocalSeek(target);
        broadcastPlaybackChange(isPlayerCurrentlyPlaying(), target, 'seeked');
    });

    // --- HTML5 video events (play / pause come from the element too) -----
    videoEl.addEventListener('play', function () {
        if (isRemoteSyncLocked()) return;
        // Echo of the partner's pause — re-pause instead of broadcasting
        // a 'played' that re-plays the partner. A movie receiver's own
        // play is the stream starting, never an echo.
        if (!playerState.userPlayIntent && !playerState.receivingMovie && playerLib && playerState.lastRemotePauseAt && Date.now() - playerState.lastRemotePauseAt < playerLib.PAUSE_ECHO_MS) {
            videoEl.pause();
            updatePlayButtonUI(false);
            return;
        }
        updatePlayButtonUI(true);
        if (!playerState.receivingMovie) broadcastPlaybackChange(true, getPlayerCurrentTime());
    });

    videoEl.addEventListener('pause', function () {
        if (isRemoteSyncLocked()) return;
        updatePlayButtonUI(false);
        if (!playerState.receivingMovie) broadcastPlaybackChange(false, getPlayerCurrentTime());
    });

    videoEl.addEventListener('timeupdate', function () {
        updateTimelineUI();
    });

    videoEl.addEventListener('loadedmetadata', function () {
        updateTimelineUI();
        // Black screen with sound (HEVC/DivX video, audio plays, the
        // element fires no error): say so plainly instead of silence.
        setTimeout(function () {
            if (!playerLib || playerState.mediaType === 'movie') return;
            var ext = playerLib.detectVideoExtension(playerState.mediaType === 'local' ? (playerState.localFileName || '') : (playerState.mediaUrl || ''));
            if (playerLib.videoPictureMissing(videoEl.videoWidth, videoEl.videoHeight, videoEl.duration, ext)) {
                showMediaError(playerLib.mediaErrorMessage('novideo', playerState.mediaType === 'local'));
            }
        }, 2500);
    });

    videoEl.addEventListener('error', function () {
        if (!playerLib) return;
        var code = videoEl.error ? videoEl.error.code : 0;
        var action = playerLib.videoErrorRecovery(playerState.ytVideoId, code, playerState.errorRetried);
        if (action === 'embed' && playerState.ytVideoId) {
            // The Piped stream died — the YouTube id is known, so fall
            // back to the embed instead of a dead screen.
            showToast('Ad-free stream stopped — switched to YouTube.');
            mountYouTubePlayer(playerState.ytVideoId);
        } else if (action === 'retry') {
            playerState.errorRetried = true;
            videoEl.load();
        } else {
            showMediaError(playerLib.mediaErrorMessage(code, playerState.mediaType === 'local') || 'This video could not play — check the link and try another video.');
        }
    });

    // --- Live local-file sharing (second PeerJS call) --------------------
    // The sender's playing file is captured into a MediaStream and sent
    // over a second PeerJS call (metadata kind 'movie'); the receiver
    // mounts that stream on the MAIN player — the big screen — not a call
    // tile. The camera call does not exist here, so nothing else shares
    // the link.
    function partnerPeerId() {
        return playerLib.partnerPeerIdForCall(isHost, connPeerId, roomCode);
    }

    function startMovieShare() {
        if (!playerLib || !peer || peer.destroyed) return;
        if (!conn || !conn.open) return;
        if (playerState.mediaType !== 'local' || !playerState.localFileUrl || playerState.movieSharing) return;
        if (typeof videoEl.captureStream !== 'function') {
            showToast('This browser cannot share the video live — your partner needs the file to watch along.');
            return;
        }
        var movieStream = null;
        try {
            movieStream = videoEl.captureStream(20);
        } catch (e) {
            showToast('This browser cannot share the video live — your partner needs the file to watch along.');
            return;
        }
        var peerId = partnerPeerId();
        if (!peerId) return;
        var call = null;
        try {
            call = peer.call(peerId, movieStream, { metadata: { kind: 'movie', fileName: playerState.localFileName || '', title: playerState.mediaTitle || '' } });
        } catch (e) {
            return;
        }
        if (!call) return;
        playerState.movieCall = call;
        playerLib.capVideoSendBitrate(call, 800000);
        playerState.movieSharing = true;
        call.on('close', function () {
            if (playerState.movieCall !== call) return;
            playerState.movieCall = null;
            playerState.movieSharing = false;
            // Dropped, not stopped: re-share while we still have the file
            // and the partner has not picked the same file meanwhile.
            if (playerState.mediaType === 'local' && playerState.localFileUrl && conn && conn.open &&
                !playerLib.partnerHasSameLocalFile(partnerMedia, playerState.localFileName, myPeerId)) {
                setTimeout(function () { if (!playerState.movieSharing) startMovieShare(); }, 2000);
            }
        });
        call.on('error', function (err) { console.error('Movie share error:', err); });
        sendPeer({ kind: 'movie-share-start', by: userName, byPeer: myPeerId, at: Date.now(), fileName: playerState.localFileName || '', title: playerState.mediaTitle || '', duration: getPlayerDuration() });
    }

    function stopMovieShare(sendStop) {
        if (!playerState.movieSharing && !playerState.movieCall) return;
        // Clear the flag BEFORE closing: the close handler re-shares on a
        // drop, and an intentional stop is not a drop.
        playerState.movieSharing = false;
        if (playerState.movieCall) {
            var call = playerState.movieCall;
            playerState.movieCall = null;
            try { call.close(); } catch (e) {}
        }
        if (sendStop) sendPeer({ kind: 'movie-share-stop', by: userName, byPeer: myPeerId, at: Date.now() });
    }

    function attachMovieStream(stream, call) {
        playerState.receivingMovie = true;
        playerState.mediaType = 'movie';
        playerState.movieCall = call || null;
        hideMediaError();
        videoEl.srcObject = stream;
        showStage('video');
        videoEl.play().catch(function (err) {
            if (err && err.name === 'NotAllowedError') {
                videoEl.muted = true;
                videoEl.play().catch(function () {});
                showUnmute();
            }
        });
        updatePlayButtonUI(true);
    }

    function stopReceivingMovie(sendStop) {
        if (!playerState.receivingMovie && !playerState.movieCall) return;
        playerState.receivingMovie = false;
        playerState.movieRemoteTime = null;
        if (playerState.movieCall) {
            try { playerState.movieCall.close(); } catch (e) {}
            playerState.movieCall = null;
        }
        try { videoEl.srcObject = null; } catch (e) {}
        videoEl.pause();
        videoEl.classList.add('hidden');
        videoEmpty.classList.remove('hidden');
        updatePlayButtonUI(false);
        if (sendStop) showToast('The shared movie ended.');
    }

    function sendMovieControl(action, currentTime) {
        roomDebug.lastMovieControl = { action: action, currentTime: currentTime, at: Date.now() };
        sendPeer({ kind: 'movie-control', by: userName, byPeer: myPeerId, at: Date.now(), action: action, currentTime: Number(currentTime) || 0 });
    }

    // Incoming movie calls arrive on the peer, not the data connection.
    function handleIncomingCall(call) {
        if (!playerLib || !playerLib.isMovieCall(call)) return;
        try { call.answer(); } catch (e) { return; }
        call.on('stream', function (stream) { attachMovieStream(stream, call); });
        call.on('close', function () {
            if (playerState.movieCall !== call) return;
            stopReceivingMovie(false);
        });
        call.on('error', function (err) { console.error('Movie call error:', err); });
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
        } else if (msg.kind === 'media' && msg.type && msg.url) {
            // The partner picked a video — mount the same one. The id
            // guard drops a duplicate delivery of the one already on
            // screen.
            if (msg.id && msg.id === playerState.mediaId) return;
            partnerMedia = { type: msg.type, url: msg.url, title: msg.title, updatedBy: msg.byPeer };
            // Partner picked the same local file we are sharing — they
            // have the file, so the stream is redundant.
            if (msg.type === 'local' && playerState.movieSharing && playerLib &&
                playerLib.partnerHasSameLocalFile(partnerMedia, playerState.localFileName, myPeerId)) {
                stopMovieShare(false);
            }
            mountMedia({ id: msg.id || null, type: msg.type, url: msg.url, title: msg.title });
            showToast((msg.by || 'Your partner') + ' shared a video.');
        } else if (msg.kind === 'playback') {
            applyRemotePlayback(msg);
        } else if (msg.kind === 'movie-share-start') {
            // The partner started streaming their file. The 'media'
            // message just before this already showed the waiting state;
            // this is the belt-and-braces path for a share that started
            // without one (or after a re-share).
            if (playerState.receivingMovie) return;
            if (playerState.mediaType === 'local' && playerState.localFileName && playerState.localFileName === msg.fileName) return;
            mountMedia({ id: null, type: 'local', url: msg.fileName || '', title: msg.title || '' });
            if (msg.duration) {
                playerState.movieRemoteTime = { currentTime: 0, duration: Number(msg.duration) || 0, isPlaying: true, at: Date.now() };
                updateTimelineUI();
            }
        } else if (msg.kind === 'movie-share-stop') {
            if (playerState.receivingMovie) {
                stopReceivingMovie(false);
                showToast('The shared movie ended.');
            }
        } else if (msg.kind === 'movie-control') {
            // The partner is watching our shared file and pressed a
            // transport control — they have no file of their own, so
            // drive ours.
            roomDebug.lastMovieControl = msg;
            if (!playerState.movieSharing) return;
            if (msg.action === 'play') { playerState.userPlayIntent = true; executeLocalPlay(); }
            else if (msg.action === 'pause') executeLocalPause();
            else if (msg.action === 'seek' && typeof msg.currentTime === 'number') executeLocalSeek(msg.currentTime);
        }
    }
    roomDebug.handlePeerMessage = handlePeerMessage;

    function attachConn(c) {
        if (conn) { try { conn.close(); } catch (e) {} }
        conn = c;
        connPeerId = c.peer || null;
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
        peer.on('open', function (id) {
            myPeerId = id;
            isHost = id === 'c2t-' + roomCode;
            setPresence('live', 'Live Synced');
        });
        peer.on('connection', attachConn);
        peer.on('call', handleIncomingCall);
        peer.on('error', function (err) {
            if (err && err.type === 'unavailable-id') {
                try { peer.destroy(); } catch (e) {}
                peer = new Peer('c2t-guest-' + Math.random().toString(36).slice(2, 8));
                peer.on('open', function (id) {
                    myPeerId = id;
                    isHost = false;
                    connectToHost();
                });
                peer.on('call', handleIncomingCall);
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
    // The room's saved video mounts on load, paused at the start — the
    // partner's live position is not stored server-side, so a late joiner
    // presses Play to catch up. A saved local file has no stream any
    // more; say so instead of mounting a dead player.
    (function mountCurrentMediaOnLoad() {
        if (!playerLib) return;
        var type = root.dataset.currentMediaType || '';
        var url = root.dataset.currentMediaUrl || '';
        if (!type || !url) return;
        if (type === 'local') {
            videoEmpty.classList.remove('hidden');
            var p = videoEmpty.querySelector('p:last-child');
            if (p) p.textContent = 'Your partner shared the file “' + url + '” earlier — ask them to pick it again to watch it together.';
            nowPlayingTitle.textContent = url;
            return;
        }
        mountMedia({
            id: root.dataset.currentMediaId ? parseInt(root.dataset.currentMediaId, 10) : null,
            type: type,
            url: url,
            title: root.dataset.currentMediaTitle || '',
        });
    })();
})();
