<?php

namespace App\Services;

/**
 * Pure HTML rewriting for the Cinema for Two web proxy.
 *
 * Given a fetched page and its original absolute URL, it:
 *  - injects a <base> so relative subresources keep resolving to the
 *    original site (images/CSS/JS load direct from there, not via us);
 *  - strips <script>/<iframe>/<link> tags whose host is on the ad
 *    blocklist, and nothing else;
 *  - injects the small sync script that reports scrolling and link taps
 *    to the parent frame (Phase 2 reads those messages) and applies
 *    scroll positions the parent sends back.
 *
 * No cookies, no credentials, no page content other than the above is
 * changed. The page's own scripts keep running as-is.
 */
class ProxyRewriter
{
    /** Hosts whose scripts, frames and stylesheets are stripped. Subdomains match too. */
    public const AD_HOSTS = [
        'googlesyndication.com',
        'doubleclick.net',
        'googleadservices.com',
        'adservice.google.com',
        'pagead2.googlesyndication.com',
        'taboola.com',
        'outbrain.com',
        'popads.net',
        'propellerads.com',
        'adnxs.com',
        'criteo.com',
        'amazon-adsystem.com',
        'ads.yahoo.com',
    ];

    /** Largest proxied body we will serve, in bytes (2 MB). */
    public const MAX_BODY_BYTES = 2 * 1024 * 1024;

    public function rewrite(string $html, string $originalUrl): string
    {
        $html = $this->injectBase($html, $originalUrl);
        $html = $this->stripAdTags($html);
        $html = $this->injectSyncScript($html);

        return $html;
    }

    public static function isBlockedHost(?string $host): bool
    {
        if ($host === null || $host === '') {
            return false;
        }

        $host = strtolower(rtrim($host, '.'));

        foreach (self::AD_HOSTS as $blocked) {
            if ($host === $blocked || str_ends_with($host, '.'.$blocked)) {
                return true;
            }
        }

        return false;
    }

    private function injectBase(string $html, string $originalUrl): string
    {
        $base = '<base href="'.htmlspecialchars($originalUrl, ENT_QUOTES, 'UTF-8').'">';

        if (preg_match('#<head\b[^>]*>#i', $html, $match, PREG_OFFSET_CAPTURE)) {
            $pos = $match[0][1] + strlen($match[0][0]);

            return substr($html, 0, $pos).$base.substr($html, $pos);
        }

        if (preg_match('#<html\b[^>]*>#i', $html, $match, PREG_OFFSET_CAPTURE)) {
            $pos = $match[0][1] + strlen($match[0][0]);

            return substr($html, 0, $pos).$base.substr($html, $pos);
        }

        return $base.$html;
    }

    private function stripAdTags(string $html): string
    {
        // <script src="...">...</script> (or a bare open tag) from a blocked host.
        $stripped = preg_replace_callback(
            '#<script\b[^>]*\bsrc\s*=\s*(["\'])(.*?)\1[^>]*>(?:.*?</script\s*>)?#is',
            fn (array $m) => self::isBlockedHost($this->hostOf($m[2])) ? '' : $m[0],
            $html
        );
        $html = $stripped ?? $html;

        // <iframe src="...">...</iframe> (or a bare open tag) from a blocked host.
        $stripped = preg_replace_callback(
            '#<iframe\b[^>]*\bsrc\s*=\s*(["\'])(.*?)\1[^>]*>(?:.*?</iframe\s*>)?#is',
            fn (array $m) => self::isBlockedHost($this->hostOf($m[2])) ? '' : $m[0],
            $html
        );
        $html = $stripped ?? $html;

        // <link href="..."> to a blocked host.
        $stripped = preg_replace_callback(
            '#<link\b[^>]*\bhref\s*=\s*(["\'])(.*?)\1[^>]*>#i',
            fn (array $m) => self::isBlockedHost($this->hostOf($m[2])) ? '' : $m[0],
            $html
        );

        return $stripped ?? $html;
    }

    private function injectSyncScript(string $html): string
    {
        $script = self::syncScriptTag();

        $pos = strripos($html, '</body>');

        if ($pos !== false) {
            return substr($html, 0, $pos).$script.substr($html, $pos);
        }

        return $html.$script;
    }

    /**
     * The script injected into every proxied page. It talks to the parent
     * frame (the Cinema room page, Phase 2) with postMessage:
     *   out: {type:'c2t-scroll', x, y}  — throttled to ~5/s while scrolling
     *   in:  {type:'c2t-scroll-to', x, y} — scrolls this page to match
     *   out: {type:'c2t-link', href}    — plain left-click on a link,
     *     or a GET form submit (search box) — the parent treats both as
     *     "the room moves to this page"
     * POST forms are never intercepted (logins, anything that changes
     * state stays on this phone). Everything is wrapped in try/catch so
     * a failure never breaks the page.
     */
    public static function syncScriptTag(): string
    {
        return <<<'HTML'
<script>
(function () {
  try {
    var lastSent = 0;
    function reportScroll() {
      try {
        var now = Date.now();
        if (now - lastSent < 200) return;
        lastSent = now;
        window.parent.postMessage({ type: 'c2t-scroll', x: window.scrollX, y: window.scrollY }, '*');
      } catch (e) {}
    }
    window.addEventListener('scroll', reportScroll, { passive: true });
    window.addEventListener('message', function (ev) {
      try {
        var d = ev.data || {};
        if (d && d.type === 'c2t-scroll-to') {
          window.scrollTo({ left: d.x || 0, top: d.y || 0, behavior: 'auto' });
        }
      } catch (e) {}
    });
    document.addEventListener('click', function (ev) {
      try {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a) return;
        if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        var href = a.href;
        if (!href) return;
        ev.preventDefault();
        window.parent.postMessage({ type: 'c2t-link', href: href }, '*');
      } catch (e) {}
    }, true);
    // Search boxes: a GET form submit is a navigation to a results page
    // (action + ?query), so it is mirrored the same way as a link tap —
    // the parent opens the same results page on both phones.
    // Bubble phase, on purpose: if the page's own script already
    // handles the submit (live search that updates the page itself),
    // defaultPrevented is set and we leave it alone.
    document.addEventListener('submit', function (ev) {
      try {
        if (ev.defaultPrevented) return;
        var form = ev.target;
        if (!form || form.tagName !== 'FORM') return;
        var submitter = ev.submitter || null;
        var method = ((submitter && submitter.formMethod) || form.method || 'get').toLowerCase();
        // Only GET is mirrored. POST (logins, anything that changes
        // state) is never intercepted — it stays on this phone.
        if (method !== 'get') return;
        var target = (submitter && submitter.formTarget) || form.target || '';
        if (target && target !== '_self') return;
        var action = (submitter && submitter.formAction) || form.action || window.location.href;
        var url;
        try { url = new URL(action, window.location.href); } catch (e) { return; }
        var qs = '';
        try {
          var fd = null;
          try { fd = new FormData(form, submitter); } catch (e2) { fd = new FormData(form); }
          qs = new URLSearchParams(fd).toString();
        } catch (e) {}
        // A GET submit replaces any query already on the action URL.
        url.search = qs;
        ev.preventDefault();
        window.parent.postMessage({ type: 'c2t-link', href: url.toString() }, '*');
      } catch (e) {}
    });
  } catch (e) {}
})();
</script>
HTML;
    }

    private function hostOf(string $url): ?string
    {
        $host = parse_url(trim($url), PHP_URL_HOST);

        return is_string($host) && $host !== '' ? $host : null;
    }
}
