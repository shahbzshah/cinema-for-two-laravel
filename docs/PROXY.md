# Web proxy — synced browsing (Phase 1: server side)

`GET /proxy?url=<page>` fetches a public web page, strips the worst ad
scripts, and injects a small sync script — so that in Phase 2 both
phones can browse the same page together, with scrolling and link taps
in sync, instead of each scrolling on their own.

**Status:** server side done and tested (62 tests green, plus a live
fetch of example.org verified). The static-app / room-page side — the
parent frame that listens to the messages below and sends scroll
positions back — is **Phase 2, not built yet**. Until then, `/proxy`
works on its own (open it in a browser while signed in) but nothing
in the room page uses it.

## How it works

1. **Auth** — the route sits behind the `auth` middleware, like rooms.
   Guests are redirected to the login page. This is deliberate: an
   open proxy on a free host would be abused by anyone on the internet.
2. **URL** — `?url=` is required. `App\Support\WeblinkUrl::normalise`
   trims it and adds `https://` when no scheme is given. Only
   http/https survive; `javascript:`, `data:`, `file:`, `ftp:` and
   hosts without a dot are rejected with **422**.
3. **SSRF guard** — `App\Support\SsrfGuard` resolves the host and
   rejects the request with **502** when:
   - the host is `localhost`, `*.localhost` or `*.local`;
   - the host is an IP literal in a private/reserved range;
   - any resolved A/AAAA address is in a private/reserved range;
   - DNS returns nothing at all.
   
   Blocked ranges: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`,
   `127.0.0.0/8`, `169.254.0.0/16` (including the `169.254.169.254`
   cloud metadata address), `172.16.0.0/12`, `192.168.0.0/16`,
   `192.0.0.0/24`, `192.0.2.0/24`, `198.51.100.0/24`,
   `203.0.113.0/24`, `240.0.0.0/4`, `255.255.255.255/32`;
   IPv6 `::/128`, `::1/128`, `fc00::/7` (covers `fc00::/8` and
   `fd00::/8`), `fe80::/10`.
4. **Fetch** — Laravel HTTP client, `User-Agent: CinemaForTwo-Proxy/1.0`,
   `Accept: text/html`, 10s timeout, max 3 redirects, streamed body
   capped at 2 MB (aborts when `Content-Length` exceeds it, or when
   the streamed body does). A fetch failure or timeout is **502**.
   Non-2xx from upstream returns that same status with a plain error
   page. A non-HTML `Content-Type` is **415** — only pages are
   proxied; images, CSS and JS load direct from the original site
   (see the `<base>` note below).
5. **Rewrite** — `App\Services\ProxyRewriter::rewrite`:
   - injects `<base href="<original absolute URL>">` right after
     `<head>` (after `<html>`, or at the start, when there is no
     head). Relative images, stylesheets and scripts therefore keep
     loading from the original site, not from us.
   - removes `<script src>`, `<iframe src>` and `<link href>` tags
     whose host is on the ad blocklist (below). Everything else is
     left untouched — the page's own scripts keep running as-is.
   - injects the sync script before `</body>` (or at the end when
     there is no body tag).
6. **Response** — the rewritten HTML, `Content-Type: text/html;
   charset=utf-8`, header `X-Cinema-Proxy: 1`.

No user cookies are ever forwarded upstream, and no upstream
`Set-Cookie`, `X-Frame-Options` or CSP headers are copied back — the
page is served as ours. That is also why sites that refuse embedding
normally (X-Frame-Options / CSP) load through the proxy: the frame
sees our origin, not theirs.

### Ad blocklist (`ProxyRewriter::AD_HOSTS`)

googlesyndication.com, doubleclick.net, googleadservices.com,
adservice.google.com, pagead2.googlesyndication.com, taboola.com,
outbrain.com, popads.net, propellerads.com, adnxs.com, criteo.com,
amazon-adsystem.com, ads.yahoo.com. Subdomains match too
(`www.doubleclick.net` is stripped). Only scripts, frames and
stylesheets from those hosts are removed.

## postMessage protocol (Phase 2 implements the parent side)

The injected script runs inside the proxied page (the iframe). It
posts to `window.parent` with target origin `'*'`. The parent frame
(the room page) **must** check `event.origin === window.location.origin`
before acting on any message — the proxied page is served from our
origin, so a same-origin check is correct and sufficient.

### Iframe → parent (out of the page)

```js
{ type: 'c2t-scroll', x: <number>, y: <number> }
```
Sent while the page scrolls, throttled to at most ~5 per second
(200 ms gate). `x`/`y` are `window.scrollX` / `window.scrollY` in CSS
pixels. The parent forwards the latest position to the partner over
PeerJS (same channel as link sharing today), and the partner's parent
sends it into its own iframe as `c2t-scroll-to` below.

```js
{ type: 'c2t-link', href: <string> }
```
Sent on a plain left-click on an `<a href>` (capture phase, no
modifier keys, `button === 0`). `href` is the link's **absolute** URL
(the browser resolves it against the injected `<base>`). The parent
treats it like a newly shared link: it loads the new page through
`/proxy` on both phones (or shows it on the shared-links shelf).
The click's default navigation is prevented inside the frame.

### Parent → iframe (into the page)

```js
{ type: 'c2t-scroll-to', x: <number>, y: <number> }
```
Posted by the parent into the iframe (`iframe.contentWindow.postMessage`).
The injected script calls `window.scrollTo({ left: x, top: y, behavior: 'auto' })`.
`'auto'` (an instant jump, not smooth scrolling) is deliberate: a
smooth scroll would lag behind a partner who keeps scrolling.

The parent must **not** echo a `c2t-scroll` it just applied back to
the partner as a new scroll, or the two phones will chase each other
in a loop. Apply-then-ignore: when a `c2t-scroll-to` is sent into the
frame, ignore the `c2t-scroll` messages that arrive within ~300 ms
after it (they are the echo of the jump, not the user scrolling).

### What the script deliberately does NOT do

- No GET-form interception (Phase 1 skips it). A search box inside
  the proxied page submits to the original site and leaves the proxy.
  Recorded as a known limit below.
- No reporting of the initial scroll position on load — the first
  `c2t-scroll` arrives on the first scroll. The parent should send a
  `c2t-scroll-to` with `{x: 0, y: 0}` when the page first mounts if
  it wants a defined starting position.

## Honest limits

- **Logins do not carry.** No cookies are forwarded, so a page that
  needs a login shows its logged-out version. (That is a privacy
  feature as much as a limit — the server never sees the user's
  sessions on other sites.)
- **DRM / protected video will not play through it.** Widevine /
  FairPlay streams and most logged-in video players refuse to run in
  a re-served page. The proxy is for browsing and choosing, not for
  watching protected streams.
- **Some sites block proxies.** A site can refuse our `User-Agent`,
  block the server's IP, or detect the rewrite and break. When that
  happens the proxy returns the site's error, and the room falls back
  to the direct iframe / "Open in browser" path as today.
- **POST forms leave the proxy.** Only GET navigation is rewritten;
  a form POST goes to the original site and out of the synced view.
- **In-page ads served from the site's own domain stay.** The
  blocklist only covers known ad hosts. A site that serves its own
  ads from its own domain keeps showing them.
- **The proxy adds server data use.** Every proxied page is
  downloaded by the server and re-served to two phones — pages cost
  roughly 2× the bytes of loading them direct, plus the 2 MB cap
  means very heavy pages are refused outright.
- **Residual DNS-rebinding risk.** The guard resolves the host once
  and checks the answer, but the HTTP client resolves it again when
  it connects. A malicious DNS answer that changes between the check
  and the fetch could slip a private address through. Closing that
  needs connecting to the checked literal IP with a `Host` header
  and TLS SNI — deliberately out of scope for Phase 1.
- **Rewriting is regex-based, not a full HTML parse.** Malformed or
  adversarial markup can in principle dodge the ad strip (for
  example a `src` split across an HTML comment). The strip is a
  best-effort ad reduction, not a security boundary — the SSRF guard
  and the sandbox are the boundaries.

## Files

- `app/Http/Controllers/ProxyController.php` — the endpoint.
- `app/Services/ProxyRewriter.php` — base injection, ad strip, sync script.
- `app/Support/SsrfGuard.php` — private/reserved destination blocking.
- `routes/web.php` — `GET /proxy` (auth group).
- `tests/Unit/ProxyRewriterTest.php`, `tests/Unit/SsrfGuardTest.php`,
  `tests/Feature/ProxyTest.php` — 30 tests for the proxy.
