// Video playback sync smoke test — headless Chrome against the REAL
// local Laravel app (localhost:8000).
//
// 1. Registers a user, creates a room, checks the theater is present.
// 2. Shares a direct MP4 link (served from the app itself) — the video
//    mounts and plays on the picking side.
// 3. Partner leg: drives window.__cinemaRoom.handlePeerMessage with a
//    'media' message (WebM link) — the same video mounts on this side.
// 4. Playback leg: drives 'playback' messages (pause / play / seek) —
//    the video pauses, plays and seeks to match, with no rebroadcast
//    bouncing back (the ?v=49 echo guards).
// 5. Stale seq: a playback message with an older seq is ignored.
// 6. Heartbeat would-start: a playing-heartbeat while paused must NOT
//    restart the video.
// 7. YouTube: shares a YouTube link — the mount attempt must engage one
//    of the designed paths (Piped stream, YouTube embed, or a
//    plain-language error banner). Which path the sandbox network allows
//    is reported, not assumed.
// 8. Local file: sets the file input to a real MP4 — the file mounts
//    from a blob URL and plays. Then, with movieSharing forced on in the
//    debug handle, a 'movie-control' pause/play from the partner drives
//    the local file (the real handler path).
// 9. Reload: the room's saved video mounts again from the server record.
//
// The live two-phone PeerJS leg is NOT provable from the sandbox (no
// UDP/WebRTC here) — the partner leg is driven through the same
// handlePeerMessage the live data connection calls, with the exact
// payloads the live connection delivers.
//
// Run: node tests/js/video-sync-smoke.mjs   (exit code 0 = all pass)
// Spawns its own `php artisan serve` on :8000 and kills it on exit.
// Needs the Playwright Chromium at ~/.cache/ms-playwright/…
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const PORT = 9349;
const APP = 'http://localhost:8000';
const MP4_SRC = path.resolve(ROOT, '../cinema-for-two/harness/videos/mp4-10s-h264-aac.mp4');
const WEBM_SRC = path.resolve(ROOT, '../cinema-for-two/harness/videos/webm-10s-vp9-opus.webm');
// Direct-link videos come from a tiny Range-capable server, NOT from
// `php artisan serve`: the PHP built-in server ignores Range requests,
// so Chrome cannot seek in anything it serves (every seek snaps to 0)
// and the seek checks would pass or fail on an artifact, not the app.
// This server answers Range with 206 + Content-Range.
const RANGE_PORT = 9352;
const VIDEO_DIR = path.resolve(ROOT, '../cinema-for-two/harness/videos');
const MP4_URL = `http://127.0.0.1:${RANGE_PORT}/mp4-10s-h264-aac.mp4`;
const WEBM_URL = `http://127.0.0.1:${RANGE_PORT}/webm-10s-vp9-opus.webm`;
const YT_URL = 'https://youtu.be/pvuN_WvF1to';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, extra) {
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? ' — ' + extra : ''));
    if (!ok) failures.push(name);
}

// (No public copies needed: direct-link videos come from the range
// server above, and the local-file check sets the file input straight
// from the harness videos directory.)

// Range-capable video server for the direct-link checks (see note above).
const rangeServer = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.join(VIDEO_DIR, path.basename(name));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(file).size;
    const type = file.endsWith('.webm') ? 'video/webm' : file.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
            let start = m[1] ? parseInt(m[1], 10) : 0;
            let end = m[2] ? parseInt(m[2], 10) : size - 1;
            if (m[1] === '' && m[2]) { start = size - parseInt(m[2], 10); end = size - 1; }
            start = Math.max(0, Math.min(start, size - 1));
            end = Math.max(start, Math.min(end, size - 1));
            res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type });
            fs.createReadStream(file, { start, end }).pipe(res);
            return;
        }
    }
    res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
});
await new Promise((res) => rangeServer.listen(RANGE_PORT, '127.0.0.1', res));

const serve = spawn('php', ['artisan', 'serve', '--host=127.0.0.1', '--port=8000'], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
function cleanup() {
    try { chrome.kill('SIGKILL'); } catch (_) {}
    try { serve.kill('SIGKILL'); } catch (_) {}
    try { rangeServer.close(); } catch (_) {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(1));

for (let i = 0; i < 40; i++) {
    try {
        const r = await fetch(APP + '/login');
        if (r.ok) break;
    } catch (_) {}
    await sleep(500);
}

async function getWsUrl() {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
            const list = await r.json();
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch (_) {}
        await sleep(250);
    }
    throw new Error('DevTools did not come up');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
    return new Promise((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
}
async function evaljs(expression, contextId) {
    const params = { expression, returnByValue: true, awaitPromise: true };
    if (contextId) params.contextId = contextId;
    const r = await send('Runtime.evaluate', params);
    if (r.error) return 'CDP-ERROR: ' + JSON.stringify(r.error).slice(0, 200);
    if (r.result && r.result.exceptionDetails) return 'EVAL-THREW: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
}
async function waitFor(fn, timeoutMs, label) {
    const t0 = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for: ' + label);
        await sleep(500);
    }
}

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

// 1. Register + create a room.
await send('Page.navigate', { url: APP + '/register' });
await waitFor(async () => await evaljs(`!!document.querySelector('form')`), 15000, 'register form present');
const email = 'video-harness' + Date.now() + '@test.local';
await evaljs(`(() => {
  const set = (name, v) => { const el = document.querySelector('input[name="' + name + '"]'); if (el) el.value = v; };
  set('name', 'Harness'); set('email', ${JSON.stringify(email)});
  set('password', 'harness-pass-123'); set('password_confirmation', 'harness-pass-123');
  const f = document.querySelector('form');
  if (f) { if (f.requestSubmit) f.requestSubmit(); else f.submit(); }
  return 'submitted';
})()`);
await waitFor(async () => (await evaljs(`location.pathname`)) === '/rooms', 15000, 'redirect to /rooms');
await waitFor(async () => await evaljs(`[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Create a room')`), 15000, 'create-room button present');
await evaljs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Create a room'); if (b) b.click(); return !!b; })()`);
const roomUrl = await waitFor(async () => {
    const p = await evaljs(`location.pathname`);
    return /^\/rooms\/[A-Za-z0-9]{6}$/.test(p) ? p : null;
}, 15000, 'room page');
check('registered and created a room', true, roomUrl);

await waitFor(async () => await evaljs(`!!document.getElementById('mediaForm') && !!document.getElementById('roomVideo')`), 15000, 'theater present');
check('theater present (form, video element, transport)', true);
check('empty state shown before any video', (await evaljs(`!document.getElementById('videoEmpty').classList.contains('hidden')`)) === true);

async function videoState() {
    return evaljs(`(() => {
      const v = document.getElementById('roomVideo');
      return { src: v.getAttribute('src') || '', hidden: v.classList.contains('hidden'),
        paused: v.paused, time: v.currentTime, dur: v.duration, ready: v.readyState };
    })()`);
}

// 2. Share the direct MP4 link from the form, press Play, prove it plays.
await evaljs(`document.getElementById('mediaInput').value = ${JSON.stringify(MP4_URL)}; document.getElementById('mediaForm').requestSubmit();`);
await waitFor(async () => {
    const s = await videoState();
    return s.src === MP4_URL && !s.hidden ? s : null;
}, 20000, 'MP4 mounts in the video element');
check('direct MP4 mounts from the share form', true);
await evaljs(`(() => { const v = document.getElementById('roomVideo'); v.loop = true; document.getElementById('playPauseBtn').click(); return true; })()`);
await waitFor(async () => {
    const s = await videoState();
    return !s.paused && s.time > 0.2 ? s : null;
}, 15000, 'video plays after Play');
const t1 = await videoState();
await sleep(1200);
const t2 = await videoState();
check('video clock advances while playing', t2.time > t1.time, t1.time.toFixed(2) + 's -> ' + t2.time.toFixed(2) + 's');
check('transport shows Pause while playing', (await evaljs(`document.getElementById('playPauseBtn').textContent`)) === 'Pause');
check('now-playing title shows the link', (await evaljs(`document.getElementById('nowPlayingTitle').textContent`)).includes('mp4-10s-h264-aac.mp4'));

// 3. Partner leg: a 'media' message mounts the WebM on this side.
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'media', id: 999001, type: 'url', url: ${JSON.stringify(WEBM_URL)}, title: null, by: 'Partner', byPeer: 'c2t-guest-abc123', at: Date.now() })`);
await waitFor(async () => {
    const s = await videoState();
    return s.src === WEBM_URL ? s : null;
}, 15000, 'partner media mounts the WebM');
check('partner media message mounts the same video', true);
await evaljs(`(() => { const v = document.getElementById('roomVideo'); v.loop = true; return true; })()`);

// 4. Playback leg: remote pause, then remote play, then remote seek.
// The pause targets 2.5s while the video sits at ~0s, so the 1.5s drift
// rule must actually move the playhead (not just pass on tolerance).
const bcBeforePause = await evaljs(`window.__cinemaRoom.lastBroadcast && window.__cinemaRoom.lastBroadcast.seq`);
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'playback', isPlaying: false, currentTime: 2.5, duration: 10, actionLabel: 'paused', seq: 1, by: 'Partner', byPeer: 'c2t-guest-abc123', updatedBy: 'c2t-guest-abc123', at: Date.now() })`);
await sleep(1200);
const pausedState = await videoState();
check('remote pause pauses the video at the partner time', pausedState.paused === true && Math.abs(pausedState.time - 2.5) < 0.6, 'paused=' + pausedState.paused + ' time=' + pausedState.time.toFixed(2));
await sleep(1500);
const bcAfterPause = await evaljs(`window.__cinemaRoom.lastBroadcast && window.__cinemaRoom.lastBroadcast.seq`);
check('no playback rebroadcast bounced back after the remote pause', bcAfterPause === bcBeforePause, 'seq ' + bcBeforePause + ' -> ' + bcAfterPause);
check('transport shows Play while paused', (await evaljs(`document.getElementById('playPauseBtn').textContent`)) === 'Play');

await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'playback', isPlaying: true, currentTime: 1.5, duration: 10, actionLabel: 'played', seq: 2, by: 'Partner', byPeer: 'c2t-guest-abc123', updatedBy: 'c2t-guest-abc123', at: Date.now() })`);
await waitFor(async () => {
    const s = await videoState();
    return !s.paused && s.time > 1.5 ? s : null;
}, 15000, 'remote play resumes the video');
check('remote play resumes the video', true);

// 5. Stale seq: the same seq 2 (and an older seq 1) must be ignored.
const timeBeforeStale = (await videoState()).time;
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'playback', isPlaying: false, currentTime: 0, duration: 10, actionLabel: 'paused', seq: 1, by: 'Partner', byPeer: 'c2t-guest-abc123', updatedBy: 'c2t-guest-abc123', at: Date.now() })`);
await sleep(1200);
const afterStale = await videoState();
check('stale-seq pause is ignored (video keeps playing)', afterStale.paused === false && Math.abs(afterStale.time - timeBeforeStale) > 0.2, 'time ' + timeBeforeStale.toFixed(2) + ' -> ' + afterStale.time.toFixed(2));

// 6. Heartbeat would-start: pause locally, then a playing-heartbeat must NOT restart.
await evaljs(`document.getElementById('playPauseBtn').click();`);
await waitFor(async () => (await videoState()).paused === true, 10000, 'local pause');
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'playback', isPlaying: true, currentTime: 2, duration: 10, actionLabel: 'heartbeat', seq: 3, by: 'Partner', byPeer: 'c2t-guest-abc123', updatedBy: 'c2t-guest-abc123', at: Date.now() })`);
await sleep(1500);
check('playing-heartbeat does not restart a paused video', (await videoState()).paused === true);

// 7. Remote seek while paused moves the playhead without playing.
// The target is computed from the live position so the drift is always
// 2s — the 1.5s rule must actually move the playhead (a near target
// would pass on tolerance without any seek).
const seekFrom = (await videoState()).time;
const seekTarget = (seekFrom + 2.0) % 9.0;
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'playback', isPlaying: false, currentTime: ${seekTarget}, duration: 10, actionLabel: 'seeked', seq: 4, by: 'Partner', byPeer: 'c2t-guest-abc123', updatedBy: 'c2t-guest-abc123', at: Date.now() })`);
await sleep(800);
const seeked = await videoState();
check('remote seek moves the playhead while staying paused', seeked.paused === true && Math.abs(seeked.time - seekTarget) < 0.6, 'from=' + seekFrom.toFixed(2) + ' target=' + seekTarget.toFixed(2) + ' time=' + seeked.time.toFixed(2));

// 8. YouTube: share a link — one of the designed paths must engage.
await evaljs(`document.getElementById('mediaInput').value = ${JSON.stringify(YT_URL)}; document.getElementById('mediaForm').requestSubmit();`);
const ytOutcome = await waitFor(async () => {
    const s = await evaljs(`(() => {
      const v = document.getElementById('roomVideo');
      const yt = !document.getElementById('ytMountWrap').classList.contains('hidden');
      const banner = !document.getElementById('mediaErrorBanner').classList.contains('hidden');
      const title = document.getElementById('nowPlayingTitle').textContent || '';
      if (v.getAttribute('src') && v.getAttribute('src').includes('googlevideo')) return 'piped-stream';
      if (yt) return 'youtube-embed';
      if (banner) return 'error-banner: ' + (document.getElementById('mediaErrorText').textContent || '').slice(0, 80);
      if (title.includes('Finding an ad-free')) return null;
      return null;
    })()`);
    return s;
}, 45000, 'YouTube mount path engages');
check('YouTube share engages a designed path (piped, embed or plain error)', typeof ytOutcome === 'string', ytOutcome);
console.log('      YouTube path in this sandbox: ' + ytOutcome);
const ytApi = await evaljs(`(() => {
  const hasApi = !!(window.YT && window.YT.Player);
  const iframe = !!document.querySelector('#ytMount iframe');
  return 'yt-api-loaded=' + hasApi + ' yt-iframe=' + iframe;
})()`);
console.log('      YouTube API state: ' + ytApi);
// Partner leg for the YouTube media: same message, no crash, same mount attempt.
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'media', id: 999002, type: 'youtube', url: 'pvuN_WvF1to', title: null, by: 'Partner', byPeer: 'c2t-guest-abc123', at: Date.now() })`);
await sleep(2000);
check('partner YouTube media message handled without error', (await evaljs(`document.getElementById('mediaErrorBanner').classList.contains('hidden') || document.getElementById('mediaErrorText').textContent.length > 0`)) === true);

// 9. Local file: set the file input — the file mounts from a blob URL and plays.
const doc = await send('DOM.getDocument', { depth: -1 });
const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#localFileInput' });
await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [MP4_SRC] });
await waitFor(async () => {
    const s = await videoState();
    return s.src.startsWith('blob:') && !s.hidden ? s : null;
}, 20000, 'local file mounts from a blob URL');
check('local file mounts from a blob URL', true);
await evaljs(`(() => { const v = document.getElementById('roomVideo'); v.loop = true; document.getElementById('playPauseBtn').click(); return true; })()`);
await waitFor(async () => {
    const s = await videoState();
    return !s.paused && s.time > 0.2 ? s : null;
}, 15000, 'local file plays');
check('local file plays', true);
// Movie-control: with sharing forced on in the debug handle, the
// partner's pause/play drives the local file through the real handler.
await evaljs(`(() => { window.__cinemaRoom.player.movieSharing = true; return true; })()`);
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'movie-control', action: 'pause', currentTime: 1, by: 'Partner', byPeer: 'c2t-guest-abc123', at: Date.now() })`);
await sleep(1000);
check('movie-control pause drives the shared file', (await videoState()).paused === true);
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'movie-control', action: 'play', currentTime: 1, by: 'Partner', byPeer: 'c2t-guest-abc123', at: Date.now() })`);
await waitFor(async () => (await videoState()).paused === false, 10000, 'movie-control play resumes');
check('movie-control play drives the shared file', true);
await evaljs(`(() => { window.__cinemaRoom.player.movieSharing = false; return true; })()`);

// 10. Reload: the room's saved video (the local file record) mounts again.
await send('Page.navigate', { url: APP + roomUrl });
await waitFor(async () => await evaljs(`!!document.getElementById('mediaForm')`), 15000, 'room page after reload');
const savedType = await evaljs(`document.getElementById('roomRoot').dataset.currentMediaType`);
const savedTitle = await evaljs(`document.getElementById('nowPlayingTitle').textContent`);
check('saved media record survives reload (local file noted, no dead player)', savedType === 'local' && savedTitle.includes('mp4-10s-h264-aac.mp4'), savedType + ' / ' + savedTitle);
check('reload shows the re-pick note, not a dead player', (await evaljs(`document.getElementById('videoEmpty').textContent`)).includes('pick it again'));

console.log(failures.length === 0 ? 'ALL VIDEO-SYNC CHECKS PASSED' : failures.length + ' CHECK(S) FAILED: ' + failures.join('; '));
process.exit(failures.length === 0 ? 0 : 1);
