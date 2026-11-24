/**
 * Cinema for Two — synced video player pure helpers (Laravel room page).
 *
 * Ported from the static app's player logic (app.js, ?v=33/?v=43/?v=49):
 * YouTube goes through the Piped redirect (ad-free direct stream, MP4
 * preferred) and falls back to the plain YouTube embed; direct links play
 * in a <video> element; a local file is shared live over a second PeerJS
 * call (metadata kind 'movie', captureStream, 800kbps cap).
 *
 * Play / pause / seek travel over the existing PeerJS data connection as
 * 'playback' messages. Each side numbers its own messages (seq is
 * per-device — never compare a partner's seq with your own counter), and
 * the guards below are the ?v=49 lessons: a stale playing-heartbeat must
 * never restart a paused player, and a PLAYING echo within 5s of applying
 * the partner's pause is the player resuming on its own after buffering,
 * not a button press.
 *
 * These helpers are pure (no DOM at load) so they can be unit-tested in
 * Node: `node tests/js/room-player.test.js`. In the browser they are
 * exposed as window.CinemaPlayer; room.js uses them.
 */
(function (root) {
    'use strict';

    // Piped instances for the ad-free YouTube stream, same as the static
    // app. Any failure falls back to the YouTube embed — never a dead
    // screen. The fetch itself lives in room.js (it needs fetch +
    // AbortController); only the bases and the timeout live here.
    var PIPED_API_BASES = [
        'https://api.piped.private.coffee',
        'https://pipedapi.kavin.rocks',
    ];
    var PIPED_FETCH_TIMEOUT_MS = 8000;

    // Playback sync guards (same numbers as the static app).
    var PLAYBACK_HEARTBEAT_MS = 10000; // "still playing" while playing
    var PAUSE_ECHO_MS = 5000; // a PLAYING echo inside this long after the partner's pause is swallowed
    var REMOTE_ECHO_DRIFT_S = 3; // same-state echo within this many seconds of the expected time
    var SEEK_DRIFT_S = 1.5; // only seek when the playheads differ by more than this
    var CATCH_UP_MAX_S = 10; // never sling the playhead further than this for clock skew
    var REMOTE_SYNC_LOCK_MS = 750; // after applying the partner's state, our own player's echo is not rebroadcast

    // Direct-link extensions the <video> element can play natively (or
    // fail on with a plain-language message). .ts/.flv need an MSE demuxer
    // and .m3u8 needs hls.js — this app ships neither, so those are
    // reported as unsupported instead of mounting a dead player.
    var DIRECT_VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'ogv', 'ogx', '3gp', 'mpg', 'mpeg', 'avi', 'wmv', 'vob'];
    var NEEDS_DEMUXER_EXTS = ['ts', 'm2ts', 'mts', 'flv', 'm3u8'];

    // Pure: the YouTube video id in a pasted link — watch, youtu.be,
    // shorts, embed, live, /v/, music.youtube.com — or '' when there is
    // none. The id is always 11 chars of [A-Za-z0-9_-].
    function extractYouTubeId(raw) {
        var s = String(raw || '').trim();
        if (!s) return '';
        var m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        if (m) return m[1];
        if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
        return '';
    }

    // Pure: the file extension of a file name or URL, lowercased, without
    // the dot — '' when there is none. A dot before the last slash belongs
    // to a domain (blob: and googlevideo URLs have none).
    function detectVideoExtension(nameOrUrl) {
        if (!nameOrUrl) return '';
        var clean = String(nameOrUrl).split('?')[0].split('#')[0].toLowerCase();
        var slashIdx = clean.lastIndexOf('/');
        var dotIdx = clean.lastIndexOf('.');
        if (dotIdx === -1 || dotIdx < slashIdx) return '';
        return clean.slice(dotIdx + 1);
    }

    // Pure: how should a pasted video address be mounted?
    // - YouTube link (or a bare 11-char id) → { via: 'piped', videoId }
    // - http(s) link to a directly playable file → { via: 'direct', url }
    // - .ts/.flv/.m3u8 → { via: 'none', reason: 'unsupported-format' }
    // - anything else → { via: 'none', reason: 'not-a-video' }
    function parseVideoInput(raw) {
        var s = String(raw || '').trim();
        if (!s) return { via: 'none', reason: 'not-a-video' };
        var videoId = extractYouTubeId(s);
        if (videoId) return { via: 'piped', videoId: videoId };
        if (!/^https?:\/\//i.test(s)) return { via: 'none', reason: 'not-a-video' };
        var ext = detectVideoExtension(s);
        if (NEEDS_DEMUXER_EXTS.indexOf(ext) !== -1) return { via: 'none', reason: 'unsupported-format' };
        if (DIRECT_VIDEO_EXTS.indexOf(ext) !== -1) return { via: 'direct', url: s };
        return { via: 'none', reason: 'not-a-video' };
    }

    // Pure: pick the best direct video file from a Piped /streams
    // response — prefer MP4 (plays everywhere), highest quality first.
    // HLS playlists are skipped: a plain <video> cannot play them
    // without a library.
    function pickPipedStream(data) {
        if (!data || !Array.isArray(data.videoStreams)) return null;
        var direct = data.videoStreams.filter(function (s) {
            return s && typeof s.url === 'string' && s.url.indexOf('http') === 0
                && typeof s.mimeType === 'string' && s.mimeType.indexOf('video/') === 0;
        });
        if (!direct.length) return null;
        var mp4 = direct.filter(function (s) { return s.mimeType.indexOf('video/mp4') === 0; });
        var pool = mp4.length ? mp4 : direct;
        pool.sort(function (a, b) {
            return (parseInt(String(b.quality || '0'), 10) || 0) - (parseInt(String(a.quality || '0'), 10) || 0);
        });
        return { streamUrl: pool[0].url, title: (data.title || '').trim() || null };
    }

    // Pure: plain-language reason a video element failed, from its
    // MediaError code. null means "no specific reason" — the caller falls
    // back to its generic message. (code 1 = aborted, 2 = network,
    // 3 = decode, 4 = format)
    function mediaErrorMessage(code, isLocalFile) {
        if (code === 4) return isLocalFile ? 'This video format cannot play in the browser (e.g. MKV, AVI or HEVC). Pick an MP4 (H.264/AAC) or WebM file instead.' : null;
        if (code === 3) return 'Video decoding failed — the file may be corrupted or use an unsupported codec.';
        if (code === 2) return 'Network error while loading the video.';
        // 'novideo' — no error event fired, but the picture never decoded:
        // the video track is HEVC/DivX/Theora while the audio plays on.
        // A black screen with sound and no message is the worst outcome,
        // so say so plainly.
        if (code === 'novideo') return 'The video picture in this file can\'t be decoded (e.g. HEVC or DivX video) — the sound plays but the screen stays black. Pick an MP4 (H.264/AAC) or WebM file instead.';
        // 'hls-local' — a playlist picked as a single local file: its
        // segment links are relative to the playlist, and a blob URL has
        // no folder to resolve them against, so the pieces can never load.
        if (code === 'hls-local') return 'This is an HLS playlist — it only lists the video pieces and needs those piece files beside it. Pick the video file itself (.mp4 or .webm) instead.';
        return null;
    }

    // Pure: what should happen when the HTML5 player errors?
    // - 'embed' — the YouTube id is known, so the dead stream is replaced
    //   by a fresh ad-free resolve (or the YouTube embed inside it).
    //   Covers a Piped stream URL that went stale and a stream that died
    //   mid-play.
    // - 'retry' — a direct link failed on the network once: reload the
    //   same URL once (mobile data drops mid-load). A second failure
    //   shows the banner.
    // - 'banner' — anything else: show the plain-language banner.
    function videoErrorRecovery(videoId, code, alreadyRetried) {
        if (videoId) return 'embed';
        if (code === 2 && !alreadyRetried) return 'retry';
        return 'banner';
    }

    // Pure: is the video picture missing — a file whose container the app
    // knows, whose duration is real, but whose video track never decoded
    // (videoWidth stays 0)? The element fires no error for this: HEVC or
    // DivX video with playable audio just plays sound over a black screen.
    // A genuinely audio-only file has no video extension, so it never
    // triggers; a corrupt file has no duration, so it never triggers.
    function videoPictureMissing(videoWidth, videoHeight, duration, ext) {
        var videoExts = DIRECT_VIDEO_EXTS.concat(NEEDS_DEMUXER_EXTS);
        if (videoExts.indexOf((ext || '').toLowerCase()) === -1) return false;
        if ((Number(videoWidth) || 0) > 0 || (Number(videoHeight) || 0) > 0) return false;
        return Number(duration) > 0;
    }

    // Pure: where should the playhead go for an incoming playback state?
    // When the partner is playing, advance their timestamp by the time
    // since they sent it — capped, so clock skew never slings the
    // playhead minutes forward. When paused, their timestamp is exact.
    function playbackTargetTime(playback, nowMs) {
        var base = Number((playback && playback.currentTime) || 0);
        if (playback && playback.isPlaying && playback.at) {
            var elapsed = Math.min(CATCH_UP_MAX_S, Math.max(0, (Number(nowMs) - Number(playback.at)) / 1000));
            return base + elapsed;
        }
        return base;
    }

    // Pure: should an incoming playback message be applied? local is
    // { myId, lastSeqBySender, isPlayingNow, nowMs }.
    // - our own message → no (the sender key is the partner's peer id)
    // - seq not newer than the last one from that sender → no (stale or
    //   duplicate; seq counters are per-device)
    // - a heartbeat that says "still playing" while our player is paused
    //   → no (it must never START playback — it is stale, fired before
    //   the partner's pause reached us)
    // Otherwise yes, with the target time already worked out.
    function shouldApplyPlayback(playback, local) {
        if (!playback || typeof playback !== 'object') return { apply: false, reason: 'no-playback' };
        if (playback.updatedBy && local && local.myId && playback.updatedBy === local.myId) {
            return { apply: false, reason: 'own' };
        }
        if (playback.seq && playback.updatedBy && local && local.lastSeqBySender) {
            var lastForSender = Number(local.lastSeqBySender[playback.updatedBy] || 0);
            if (Number(playback.seq) <= lastForSender) return { apply: false, reason: 'stale-seq' };
        }
        if (playback.actionLabel === 'heartbeat' && playback.isPlaying && local && !local.isPlayingNow) {
            return { apply: false, reason: 'heartbeat-would-start' };
        }
        return { apply: true, targetTime: playbackTargetTime(playback, local && local.nowMs) };
    }

    // Pure: should a local play/pause/seek broadcast go out? args is
    // { isPlaying, actionLabel, userPlayIntent, lastRemotePauseAt,
    //   lastRemoteApplied, currentTime, nowMs }.
    // - a raw PLAYING broadcast (no label) within 5s of applying the
    //   partner's pause, without a deliberate press → no (the player
    //   echoing: YouTube resuming on its own after buffering)
    // - a non-heartbeat broadcast whose state matches the last remote
    //   state we applied, within 3s of the expected time → no (our own
    //   player's echo of the partner's action, sent back)
    // Otherwise yes. A deliberate press (userPlayIntent) passes through
    // and the intent is consumed — the caller clears it on send.
    function shouldBroadcastPlayback(args) {
        var now = Number((args && args.nowMs) || 0);
        var isPlaying = !!(args && args.isPlaying);
        var actionLabel = (args && args.actionLabel) || null;
        if (isPlaying && !actionLabel) {
            var lastPause = Number((args && args.lastRemotePauseAt) || 0);
            if (!args.userPlayIntent && lastPause && now - lastPause < PAUSE_ECHO_MS) {
                return { send: false, reason: 'pause-echo' };
            }
        }
        var ra = args && args.lastRemoteApplied;
        if (ra && actionLabel !== 'heartbeat' && isPlaying === ra.isPlaying) {
            var expected = Number(ra.currentTime) + (ra.isPlaying ? (now - Number(ra.at || now)) / 1000 : 0);
            if (Math.abs(Number((args && args.currentTime) || 0) - expected) < REMOTE_ECHO_DRIFT_S) {
                return { send: false, reason: 'remote-echo' };
            }
        }
        return { send: true, consumeIntent: !!(args && args.userPlayIntent) };
    }

    // Pure: the partner's peer id for an outgoing call — the guest's id
    // for the host, the host's id for the guest.
    function partnerPeerIdForCall(isHost, connPeer, roomCode) {
        return (isHost && connPeer) ? connPeer : 'c2t-' + roomCode;
    }

    // Pure: a PeerJS call carrying a shared movie (not a camera call).
    function isMovieCall(call) {
        return !!(call && call.metadata && call.metadata.kind === 'movie');
    }

    // Pure: does the partner's latest media say they picked the same
    // local file we are sharing? Then they have the file and the stream
    // is redundant.
    function partnerHasSameLocalFile(media, fileName, userId) {
        if (!media || media.type !== 'local' || !fileName) return false;
        return media.url === fileName && media.updatedBy !== userId;
    }

    // Pure: the clock a movie receiver shows — the sender's time, advanced
    // while playing, capped at 10s so a stale message never slings it
    // forward.
    function movieRemoteCurrentTime(remoteTime, nowMs) {
        if (!remoteTime) return 0;
        var base = Number(remoteTime.currentTime) || 0;
        if (!remoteTime.isPlaying) return base;
        var elapsed = Math.min(CATCH_UP_MAX_S, Math.max(0, (Number(nowMs) - (Number(remoteTime.at) || Number(nowMs))) / 1000));
        return base + elapsed;
    }

    // Cap a call's video send bitrate (camera 400kbps, movie share
    // 800kbps in the static app). No-op when the call has no video
    // sender — never throws.
    async function capVideoSendBitrate(call, maxBitrate) {
        try {
            var pc = call && call.peerConnection;
            var senders = (pc && pc.getSenders) ? pc.getSenders() : [];
            var sender = null;
            for (var i = 0; i < senders.length; i++) {
                if (senders[i] && senders[i].track && senders[i].track.kind === 'video') { sender = senders[i]; break; }
            }
            if (!sender || typeof sender.setParameters !== 'function') return;
            var params = (typeof sender.getParameters === 'function' && sender.getParameters()) || {};
            var encoding = (params.encodings && params.encodings[0]) || {};
            params.encodings = [{ ...encoding, maxBitrate: maxBitrate }];
            await sender.setParameters(params);
        } catch (_) {}
    }

    var api = {
        PIPED_API_BASES: PIPED_API_BASES,
        PIPED_FETCH_TIMEOUT_MS: PIPED_FETCH_TIMEOUT_MS,
        PLAYBACK_HEARTBEAT_MS: PLAYBACK_HEARTBEAT_MS,
        PAUSE_ECHO_MS: PAUSE_ECHO_MS,
        REMOTE_ECHO_DRIFT_S: REMOTE_ECHO_DRIFT_S,
        SEEK_DRIFT_S: SEEK_DRIFT_S,
        CATCH_UP_MAX_S: CATCH_UP_MAX_S,
        REMOTE_SYNC_LOCK_MS: REMOTE_SYNC_LOCK_MS,
        extractYouTubeId: extractYouTubeId,
        detectVideoExtension: detectVideoExtension,
        parseVideoInput: parseVideoInput,
        pickPipedStream: pickPipedStream,
        mediaErrorMessage: mediaErrorMessage,
        videoErrorRecovery: videoErrorRecovery,
        videoPictureMissing: videoPictureMissing,
        playbackTargetTime: playbackTargetTime,
        shouldApplyPlayback: shouldApplyPlayback,
        shouldBroadcastPlayback: shouldBroadcastPlayback,
        partnerPeerIdForCall: partnerPeerIdForCall,
        isMovieCall: isMovieCall,
        partnerHasSameLocalFile: partnerHasSameLocalFile,
        movieRemoteCurrentTime: movieRemoteCurrentTime,
        capVideoSendBitrate: capVideoSendBitrate,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.CinemaPlayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
