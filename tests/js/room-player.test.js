// Unit tests for the synced video player pure helpers (public/js/room-player.js).
// Run: node tests/js/room-player.test.js  (exit code 0 = all pass)
import assert from 'node:assert';
import '../../public/js/room-player.js';

const player = globalThis.CinemaPlayer;
assert.ok(player, 'room-player.js must expose window.CinemaPlayer');

let n = 0;
function check(name, fn) {
    fn();
    n++;
    console.log('ok ' + n + ' — ' + name);
}

// extractYouTubeId — every link shape Megah pastes.
check('extractYouTubeId reads watch, youtu.be, shorts, embed, live and bare ids', () => {
    assert.strictEqual(player.extractYouTubeId('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
    assert.strictEqual(player.extractYouTubeId('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=42s'), 'aqz-KE-bpKQ');
    assert.strictEqual(player.extractYouTubeId('https://youtu.be/eRsGyueVLvQ'), 'eRsGyueVLvQ');
    assert.strictEqual(player.extractYouTubeId('https://www.youtube.com/shorts/eRsGyueVLvQ?feature=share'), 'eRsGyueVLvQ');
    assert.strictEqual(player.extractYouTubeId('https://www.youtube.com/embed/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
    assert.strictEqual(player.extractYouTubeId('https://www.youtube.com/live/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
    assert.strictEqual(player.extractYouTubeId('https://music.youtube.com/watch?v=aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
    assert.strictEqual(player.extractYouTubeId('aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
});
check('extractYouTubeId rejects non-YouTube links and short ids', () => {
    assert.strictEqual(player.extractYouTubeId('https://example.org/watch?v=aqz-KE-bpKQ'), '');
    assert.strictEqual(player.extractYouTubeId('https://www.youtube.com/watch?v=short'), '');
    assert.strictEqual(player.extractYouTubeId(''), '');
    assert.strictEqual(player.extractYouTubeId(null), '');
});

// parseVideoInput — the mount plan for a pasted address.
check('parseVideoInput routes YouTube to piped, direct files to direct', () => {
    assert.deepStrictEqual(player.parseVideoInput('https://youtu.be/eRsGyueVLvQ'), { via: 'piped', videoId: 'eRsGyueVLvQ' });
    assert.deepStrictEqual(player.parseVideoInput('https://example.org/film.mp4'), { via: 'direct', url: 'https://example.org/film.mp4' });
    assert.deepStrictEqual(player.parseVideoInput('https://example.org/film.webm?x=1'), { via: 'direct', url: 'https://example.org/film.webm?x=1' });
    assert.deepStrictEqual(player.parseVideoInput('https://example.org/film.MOV'), { via: 'direct', url: 'https://example.org/film.MOV' });
});
check('parseVideoInput reports .ts/.flv/.m3u8 as unsupported (no demuxer shipped)', () => {
    assert.deepStrictEqual(player.parseVideoInput('https://example.org/stream.ts'), { via: 'none', reason: 'unsupported-format' });
    assert.deepStrictEqual(player.parseVideoInput('https://example.org/clip.flv'), { via: 'none', reason: 'unsupported-format' });
    assert.deepStrictEqual(player.parseVideoInput('https://example.org/list.m3u8'), { via: 'none', reason: 'unsupported-format' });
});
check('parseVideoInput rejects non-video input', () => {
    assert.deepStrictEqual(player.parseVideoInput('https://example.org/page.html'), { via: 'none', reason: 'not-a-video' });
    assert.deepStrictEqual(player.parseVideoInput('just some words'), { via: 'none', reason: 'not-a-video' });
    assert.deepStrictEqual(player.parseVideoInput('javascript:alert(1)'), { via: 'none', reason: 'not-a-video' });
    assert.deepStrictEqual(player.parseVideoInput(''), { via: 'none', reason: 'not-a-video' });
});

// detectVideoExtension — dots in domains and query strings.
check('detectVideoExtension handles queries, fragments and domain dots', () => {
    assert.strictEqual(player.detectVideoExtension('https://example.org/film.mp4?x=1#t=5'), 'mp4');
    assert.strictEqual(player.detectVideoExtension('https://video.googlevideo.com/x'), '');
    assert.strictEqual(player.detectVideoExtension('film.MKV'), 'mkv');
    assert.strictEqual(player.detectVideoExtension('blob:https://example.org/abc'), '');
});

// pickPipedStream — MP4 preferred, highest quality first, HLS skipped.
check('pickPipedStream prefers MP4 at the highest quality', () => {
    const picked = player.pickPipedStream({
        title: 'Test',
        videoStreams: [
            { url: 'https://x/webm-720', mimeType: 'video/webm', quality: '720p' },
            { url: 'https://x/mp4-360', mimeType: 'video/mp4', quality: '360p' },
            { url: 'https://x/mp4-1080', mimeType: 'video/mp4', quality: '1080p' },
            { url: 'https://x/mp4-720', mimeType: 'video/mp4', quality: '720p' },
        ],
    });
    assert.deepStrictEqual(picked, { streamUrl: 'https://x/mp4-1080', title: 'Test' });
});
check('pickPipedStream falls back to non-MP4 when no MP4 exists, null when empty', () => {
    const picked = player.pickPipedStream({
        title: '',
        videoStreams: [{ url: 'https://x/webm-480', mimeType: 'video/webm', quality: '480p' }],
    });
    assert.deepStrictEqual(picked, { streamUrl: 'https://x/webm-480', title: null });
    assert.strictEqual(player.pickPipedStream({ videoStreams: [] }), null);
    assert.strictEqual(player.pickPipedStream({ videoStreams: [{ url: 'https://x/list.m3u8', mimeType: 'application/x-mpegURL' }] }), null);
    assert.strictEqual(player.pickPipedStream(null), null);
});

// mediaErrorMessage — plain language per MediaError code.
check('mediaErrorMessage maps codes 2/3/4, novideo and hls-local', () => {
    assert.strictEqual(player.mediaErrorMessage(2, false), 'Network error while loading the video.');
    assert.strictEqual(player.mediaErrorMessage(3, false), 'Video decoding failed — the file may be corrupted or use an unsupported codec.');
    assert.ok(player.mediaErrorMessage(4, true).includes('MP4 (H.264/AAC)'));
    assert.strictEqual(player.mediaErrorMessage(4, false), null);
    assert.ok(player.mediaErrorMessage('novideo', false).includes('screen stays black'));
    assert.ok(player.mediaErrorMessage('hls-local', true).includes('HLS playlist'));
    assert.strictEqual(player.mediaErrorMessage(1, false), null);
    assert.strictEqual(player.mediaErrorMessage(99, false), null);
});

// videoErrorRecovery — embed when the id is known, one retry on network.
check('videoErrorRecovery prefers embed, retries a network error once', () => {
    assert.strictEqual(player.videoErrorRecovery('aqz-KE-bpKQ', 2, false), 'embed');
    assert.strictEqual(player.videoErrorRecovery(null, 2, false), 'retry');
    assert.strictEqual(player.videoErrorRecovery(null, 2, true), 'banner');
    assert.strictEqual(player.videoErrorRecovery(null, 4, false), 'banner');
    assert.strictEqual(player.videoErrorRecovery(null, 3, false), 'banner');
});

// videoPictureMissing — black screen with sound.
check('videoPictureMissing fires only for a known video file with duration and no picture', () => {
    assert.strictEqual(player.videoPictureMissing(0, 0, 120, 'mp4'), true);
    assert.strictEqual(player.videoPictureMissing(0, 0, 120, 'mkv'), true);
    assert.strictEqual(player.videoPictureMissing(640, 360, 120, 'mp4'), false);
    assert.strictEqual(player.videoPictureMissing(0, 0, 0, 'mp4'), false);
    assert.strictEqual(player.videoPictureMissing(0, 0, 120, 'mp3'), false);
    assert.strictEqual(player.videoPictureMissing(0, 0, 120, ''), false);
});

// playbackTargetTime — catch-up capped at 10s.
check('playbackTargetTime advances a playing state, capped at 10s', () => {
    assert.strictEqual(player.playbackTargetTime({ isPlaying: true, currentTime: 100, at: 1000 }, 4000), 103);
    assert.strictEqual(player.playbackTargetTime({ isPlaying: true, currentTime: 100, at: 1000 }, 30000), 110);
    assert.strictEqual(player.playbackTargetTime({ isPlaying: false, currentTime: 100, at: 1000 }, 30000), 100);
    assert.strictEqual(player.playbackTargetTime({ isPlaying: true, currentTime: 100 }, 30000), 100);
});

// shouldApplyPlayback — the ?v=49 guards, as decisions.
check('shouldApplyPlayback drops our own messages and stale seqs', () => {
    const local = { myId: 'me', lastSeqBySender: { partner: 5 }, isPlayingNow: false, nowMs: 10000 };
    assert.deepStrictEqual(
        player.shouldApplyPlayback({ isPlaying: true, currentTime: 10, seq: 6, updatedBy: 'me', at: 9000 }, local).apply,
        false
    );
    assert.strictEqual(
        player.shouldApplyPlayback({ isPlaying: true, currentTime: 10, seq: 5, updatedBy: 'partner', at: 9000 }, local).apply,
        false
    );
    assert.strictEqual(
        player.shouldApplyPlayback({ isPlaying: true, currentTime: 10, seq: 4, updatedBy: 'partner', at: 9000 }, local).apply,
        false
    );
    const fresh = player.shouldApplyPlayback({ isPlaying: true, currentTime: 10, seq: 6, updatedBy: 'partner', at: 9000 }, local);
    assert.strictEqual(fresh.apply, true);
    assert.strictEqual(fresh.targetTime, 11);
});
check('shouldApplyPlayback drops a playing heartbeat while paused, keeps it while playing', () => {
    const paused = { myId: 'me', lastSeqBySender: {}, isPlayingNow: false, nowMs: 10000 };
    assert.strictEqual(
        player.shouldApplyPlayback({ isPlaying: true, currentTime: 10, seq: 1, updatedBy: 'partner', actionLabel: 'heartbeat', at: 9000 }, paused).apply,
        false
    );
    const playing = { myId: 'me', lastSeqBySender: {}, isPlayingNow: true, nowMs: 10000 };
    assert.strictEqual(
        player.shouldApplyPlayback({ isPlaying: true, currentTime: 10, seq: 1, updatedBy: 'partner', actionLabel: 'heartbeat', at: 9000 }, playing).apply,
        true
    );
    // A real 'played' line still resumes a paused player.
    assert.strictEqual(
        player.shouldApplyPlayback({ isPlaying: true, currentTime: 10, seq: 1, updatedBy: 'partner', actionLabel: 'played', at: 9000 }, paused).apply,
        true
    );
    // A pause always applies.
    assert.strictEqual(
        player.shouldApplyPlayback({ isPlaying: false, currentTime: 10, seq: 1, updatedBy: 'partner', actionLabel: 'paused', at: 9000 }, playing).apply,
        true
    );
});
check('shouldApplyPlayback compares seq per sender, not against our own counter', () => {
    const local = { myId: 'me', lastSeqBySender: { partner: 2 }, isPlayingNow: true, nowMs: 10000 };
    // Our own counter may be at 40 from heartbeats — the partner's seq 3 is still newer for them.
    assert.strictEqual(
        player.shouldApplyPlayback({ isPlaying: false, currentTime: 10, seq: 3, updatedBy: 'partner', at: 9000 }, local).apply,
        true
    );
});

// shouldBroadcastPlayback — the echo guards on our side.
check('shouldBroadcastPlayback swallows a PLAYING echo within 5s of the partner pause', () => {
    const args = { isPlaying: true, actionLabel: null, userPlayIntent: false, lastRemotePauseAt: 8000, nowMs: 10000 };
    assert.deepStrictEqual(player.shouldBroadcastPlayback(args), { send: false, reason: 'pause-echo' });
    // A deliberate press passes through and consumes the intent.
    assert.deepStrictEqual(
        player.shouldBroadcastPlayback({ ...args, userPlayIntent: true }),
        { send: true, consumeIntent: true }
    );
    // 5s later the echo window is closed.
    assert.strictEqual(player.shouldBroadcastPlayback({ ...args, nowMs: 13000 }).send, true);
    // Labelled broadcasts (seeks, heartbeats) are never raw echoes.
    assert.strictEqual(player.shouldBroadcastPlayback({ ...args, actionLabel: 'seeked' }).send, true);
});
check('shouldBroadcastPlayback swallows our echo of the partner action, lets a real flip through', () => {
    const base = {
        isPlaying: true, actionLabel: null, userPlayIntent: false, lastRemotePauseAt: 0, nowMs: 20000,
        lastRemoteApplied: { isPlaying: true, currentTime: 100, at: 19000 },
    };
    // Our player reports playing at ~101s, 1s after the partner's play at 100s — echo.
    assert.deepStrictEqual(player.shouldBroadcastPlayback({ ...base, currentTime: 101 }), { send: false, reason: 'remote-echo' });
    // Same state but far from the expected time — a real position, send it.
    assert.strictEqual(player.shouldBroadcastPlayback({ ...base, currentTime: 130 }).send, true);
    // A state flip (we paused after the partner's play) always sends.
    assert.strictEqual(player.shouldBroadcastPlayback({ ...base, isPlaying: false, currentTime: 101 }).send, true);
    // Heartbeats are exempt from the echo guard.
    assert.strictEqual(player.shouldBroadcastPlayback({ ...base, currentTime: 101, actionLabel: 'heartbeat' }).send, true);
});

// Movie-share pure helpers.
check('isMovieCall only matches metadata kind movie', () => {
    assert.strictEqual(player.isMovieCall({ metadata: { kind: 'movie' } }), true);
    assert.strictEqual(player.isMovieCall({ metadata: { kind: 'camera' } }), false);
    assert.strictEqual(player.isMovieCall({}), false);
    assert.strictEqual(player.isMovieCall(null), false);
});
check('partnerPeerIdForCall gives the guest id to the host and the host id to the guest', () => {
    assert.strictEqual(player.partnerPeerIdForCall(true, 'c2t-guest-abc123', 'IRIL8R'), 'c2t-guest-abc123');
    assert.strictEqual(player.partnerPeerIdForCall(false, 'c2t-IRIL8R', 'IRIL8R'), 'c2t-IRIL8R');
    assert.strictEqual(player.partnerPeerIdForCall(true, null, 'IRIL8R'), 'c2t-IRIL8R');
});
check('partnerHasSameLocalFile matches only the same file from the partner', () => {
    assert.strictEqual(player.partnerHasSameLocalFile({ type: 'local', url: 'film.mp4', updatedBy: 'partner' }, 'film.mp4', 'me'), true);
    assert.strictEqual(player.partnerHasSameLocalFile({ type: 'local', url: 'film.mp4', updatedBy: 'me' }, 'film.mp4', 'me'), false);
    assert.strictEqual(player.partnerHasSameLocalFile({ type: 'local', url: 'other.mp4', updatedBy: 'partner' }, 'film.mp4', 'me'), false);
    assert.strictEqual(player.partnerHasSameLocalFile({ type: 'url', url: 'film.mp4', updatedBy: 'partner' }, 'film.mp4', 'me'), false);
    assert.strictEqual(player.partnerHasSameLocalFile(null, 'film.mp4', 'me'), false);
});
check('movieRemoteCurrentTime advances while playing, capped at 10s', () => {
    assert.strictEqual(player.movieRemoteCurrentTime({ currentTime: 50, isPlaying: true, at: 1000 }, 4000), 53);
    assert.strictEqual(player.movieRemoteCurrentTime({ currentTime: 50, isPlaying: true, at: 1000 }, 30000), 60);
    assert.strictEqual(player.movieRemoteCurrentTime({ currentTime: 50, isPlaying: false, at: 1000 }, 30000), 50);
    assert.strictEqual(player.movieRemoteCurrentTime(null, 30000), 0);
});

// capVideoSendBitrate — no-op without a video sender, caps with one.
check('capVideoSendBitrate sets maxBitrate on the video sender only', async () => {
    let seen = null;
    const videoSender = {
        track: { kind: 'video' },
        getParameters: () => ({ encodings: [{ maxBitrate: 0 }] }),
        setParameters: async (p) => { seen = p; },
    };
    const audioSender = { track: { kind: 'audio' }, setParameters: async () => { throw new Error('must not be called'); } };
    await player.capVideoSendBitrate({ peerConnection: { getSenders: () => [audioSender, videoSender] } }, 800000);
    assert.deepStrictEqual(seen, { encodings: [{ maxBitrate: 800000 }] });
    // No video sender and no connection at all: silent no-op.
    await player.capVideoSendBitrate({ peerConnection: { getSenders: () => [audioSender] } }, 800000);
    await player.capVideoSendBitrate(null, 800000);
    await player.capVideoSendBitrate({}, 800000);
});

console.log(n + ' room-player tests passed');
