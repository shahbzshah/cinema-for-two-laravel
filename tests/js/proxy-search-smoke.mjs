// Search mirroring smoke test (Phase 3) — headless Chrome against the
// REAL local Laravel app + real proxy (localhost:8000).
//
// 1. Registers a user, creates a room, turns "Browse together" ON,
//    shares a Wikipedia article through the proxy.
// 2. Real search: types in Wikipedia's search box and submits — the
//    parent must receive c2t-link with the results-page URL and share
//    it room-wide (same share flow as a link tap), and the partner leg
//    (handlePeerMessage weblink) must mount the same results page.
//    Then waits 2s and asserts no second c2t-link bounced back.
// 3. Synthetic POST form inside the proxied page: must NOT be
//    intercepted (no c2t-link, sync script did not preventDefault).
// 4. Synthetic GET form inside the proxied page: must post c2t-link
//    with action + serialised query (action query replaced, per the
//    GET submit rule), and the parent must share it.
//
// Run: node tests/js/proxy-search-smoke.mjs   (exit code 0 = all pass)
// Spawns its own `php artisan serve` on :8000 and kills it on exit.
// Needs the Playwright Chromium at ~/.cache/ms-playwright/…
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const PORT = 9348;
const APP = 'http://localhost:8000';
const PAGE = 'https://en.wikipedia.org/wiki/Cinema';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, extra) {
    console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? ' — ' + extra : ''));
    if (!ok) failures.push(name);
}

const serve = spawn('php', ['artisan', 'serve', '--host=127.0.0.1', '--port=8000'], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (_) {} try { serve.kill('SIGKILL'); } catch (_) {} });
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
        await sleep(1000);
    }
}

await send('Page.enable');
await send('Runtime.enable');

// 1. Register + create a room.
await send('Page.navigate', { url: APP + '/register' });
await waitFor(async () => await evaljs(`!!document.querySelector('form')`), 15000, 'register form present');
const email = 'search-harness' + Date.now() + '@test.local';
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
const clicked = await evaljs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent.trim() === 'Create a room');
  if (b) { b.click(); return true; }
  return false;
})()`);
if (!clicked) throw new Error('Create a room button not found');
const roomUrl = await waitFor(async () => {
    const p = await evaljs(`location.pathname`);
    return /^\/rooms\/[A-Za-z0-9]{6}$/.test(p) ? p : null;
}, 15000, 'room page');
check('registered and created a room', true, roomUrl);

// Toggle sync ON, share the Wikipedia article.
await waitFor(async () => await evaljs(`!!document.getElementById('webSyncToggle')`), 15000, 'sync toggle present');
await evaljs(`document.getElementById('webSyncToggle').click();`);
await sleep(300);
check('sync toggle on', (await evaljs(`document.getElementById('webSyncToggle').checked`)) === true);
await evaljs(`document.getElementById('weblinkInput').value = ${JSON.stringify(PAGE)}; document.getElementById('weblinkForm').requestSubmit();`);
await waitFor(async () => {
    const src = await evaljs(`document.getElementById('webViewer').getAttribute('src') || ''`);
    return src.includes('/proxy?url=') ? src : null;
}, 30000, 'iframe mounts through /proxy');
check('article mounts through the proxy', true);

// Find the proxied frame and drive it in an isolated world.
async function frameContext() {
    const tree = await send('Page.getFrameTree');
    function findId(node) {
        if (node.frame.url && node.frame.url.includes('/proxy?url=')) return node.frame.id;
        for (const c of (node.childFrames || [])) { const r = findId(c); if (r) return r; }
        return null;
    }
    const frameId = tree.result ? findId(tree.result.frameTree) : null;
    if (!frameId) return null;
    const world = await send('Page.createIsolatedWorld', { frameId, worldName: 'probe' });
    return world.result && world.result.executionContextId;
}
const ctx = await waitFor(async () => {
    const c = await frameContext();
    if (!c) return null;
    const hasScript = await evaljs(`document.documentElement.outerHTML.indexOf("addEventListener('submit'") !== -1`, c);
    return hasScript ? c : null;
}, 60000, 'proxied frame with the submit watcher');
check('proxied page carries the submit watcher', Boolean(ctx));

// 2. Real search: type in Wikipedia's search box and submit it.
const searchInfo = await evaljs(`(() => {
  const input = document.querySelector('input[name="search"]');
  if (!input) return null;
  const form = input.closest('form');
  if (!form) return null;
  input.value = 'Cinema';
  const btn = form.querySelector('button[type="submit"], input[type="submit"]');
  if (btn) btn.click(); else form.requestSubmit();
  return form.action;
})()`, ctx);
check('Wikipedia search submitted', typeof searchInfo === 'string', searchInfo);
const tap = await waitFor(async () => {
    const t = await evaljs(`window.__cinemaRoom && window.__cinemaRoom.lastLinkTap`);
    return t && typeof t.href === 'string' && t.href.includes('search=Cinema') ? t : null;
}, 20000, 'parent receives c2t-link for the search results');
check('parent got c2t-link with the results URL', Boolean(tap), tap && tap.href);
const resultsUrl = tap.href;
check('results URL is the Wikipedia search page', resultsUrl.includes('en.wikipedia.org/w/index.php') && resultsUrl.includes('title=Special%3ASearch'), resultsUrl);
await waitFor(async () => {
    const src = await evaljs(`document.getElementById('webViewer').getAttribute('src') || ''`);
    return src.includes(encodeURIComponent(resultsUrl)) ? src : null;
}, 30000, 'room mounts the results page through the proxy');
check('room shared the results page (same flow as a link tap)', true);
const shelf = await evaljs(`document.getElementById('weblinkShelf').textContent || ''`);
check('results link is on the shared-links shelf', shelf.includes('search=Cinema'));
// Partner leg: the partner receives the weblink and mounts the same page.
const tapBefore = await evaljs(`window.__cinemaRoom.lastLinkTap && window.__cinemaRoom.lastLinkTap.href`);
await evaljs(`window.__cinemaRoom.handlePeerMessage({ kind: 'weblink', id: 999001, url: ${JSON.stringify(resultsUrl)}, by: 'Partner' })`);
await sleep(1500);
const partnerSrc = await evaljs(`document.getElementById('webViewer').getAttribute('src') || ''`);
check('partner leg mounts the same results page', partnerSrc.includes(encodeURIComponent(resultsUrl)), partnerSrc.slice(0, 120));
// No bounce-back: no new c2t-link within 2s of the partner mounting.
await sleep(2000);
const tapAfter = await evaljs(`window.__cinemaRoom.lastLinkTap && window.__cinemaRoom.lastLinkTap.href`);
check('no c2t-link bounced back after the partner mounted', tapAfter === tapBefore, tapAfter);

// The results page is itself proxied — re-acquire its frame context.
const ctx2 = await waitFor(async () => {
    const c = await frameContext();
    if (!c) return null;
    const hasScript = await evaljs(`document.documentElement.outerHTML.indexOf("addEventListener('submit'") !== -1`, c);
    return hasScript ? c : null;
}, 60000, 'results frame with the submit watcher');
check('results page is proxied with the watcher', Boolean(ctx2));

// Probe listener: runs after the sync script (same document, bubble
// phase, registered later) and records whether the sync script already
// prevented the submit — then prevents it itself so the frame never
// navigates away during the synthetic checks.
await evaljs(`(() => {
  window.__probe = { prevented: null };
  document.addEventListener('submit', (ev) => {
    window.__probe.prevented = ev.defaultPrevented;
    ev.preventDefault();
  }, false);
  return true;
})()`, ctx2);

// 3. Synthetic POST form — must NOT be intercepted.
await evaljs(`(() => {
  const f = document.createElement('form');
  f.action = 'https://example.org/login'; f.method = 'post';
  const p = document.createElement('input'); p.name = 'password'; p.value = 'secret';
  f.appendChild(p); document.body.appendChild(f);
  window.__probe.prevented = null;
  window.__probeForm = f;
  f.requestSubmit();
  return true;
})()`, ctx2);
await sleep(1500);
const postPrevented = await evaljs(`window.__probe.prevented`, ctx2);
const tapAfterPost = await evaljs(`window.__cinemaRoom.lastLinkTap && window.__cinemaRoom.lastLinkTap.href`);
check('POST form was not intercepted by the sync script', postPrevented === false, 'defaultPrevented=' + postPrevented);
check('POST form posted no c2t-link', tapAfterPost === tapBefore);

// 4. Synthetic GET form — action query replaced by the serialised fields.
await evaljs(`(() => {
  const f = document.createElement('form');
  f.action = 'https://example.org/search?old=1'; f.method = 'get';
  const q = document.createElement('input'); q.name = 'q'; q.value = 'hello world';
  f.appendChild(q); document.body.appendChild(f);
  window.__probe.prevented = null;
  f.requestSubmit();
  return true;
})()`, ctx2);
const getTap = await waitFor(async () => {
    const t = await evaljs(`window.__cinemaRoom.lastLinkTap`);
    return t && t.href === 'https://example.org/search?q=hello+world' ? t : null;
}, 15000, 'c2t-link for the synthetic GET form');
check('GET form posted c2t-link with action + serialised query', Boolean(getTap), getTap && getTap.href);
const getPrevented = await evaljs(`window.__probe.prevented`, ctx2);
check('GET form submit was prevented (no local navigation)', getPrevented === true, 'defaultPrevented=' + getPrevented);
await waitFor(async () => {
    const src = await evaljs(`document.getElementById('webViewer').getAttribute('src') || ''`);
    // Proxied when the proxy serves it; direct when the proxy refuses
    // the page (example.org/search 404s upstream, so the room falls
    // back to the direct URL — the share still happened either way).
    return (src.includes(encodeURIComponent('https://example.org/search?q=hello+world')) || src === 'https://example.org/search?q=hello+world') ? src : null;
}, 30000, 'room mounts the synthetic results URL');
check('parent shared the synthetic GET results URL', true);
const shelf2 = await evaljs(`document.getElementById('weblinkShelf').textContent || ''`);
check('synthetic results link is on the shelf', shelf2.includes('q=hello+world'));

console.log(failures.length === 0 ? 'ALL PROXY-SEARCH CHECKS PASSED' : failures.length + ' CHECK(S) FAILED: ' + failures.join('; '));
process.exit(failures.length === 0 ? 0 : 1);
