<?php

namespace Tests\Unit;

use App\Services\ProxyRewriter;
use PHPUnit\Framework\TestCase;

class ProxyRewriterTest extends TestCase
{
    private ProxyRewriter $rewriter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->rewriter = new ProxyRewriter();
    }

    public function test_injects_base_after_head(): void
    {
        $out = $this->rewriter->rewrite(
            '<html><head><title>T</title></head><body>hi</body></html>',
            'https://example.org/movies/list?page=2'
        );

        $this->assertStringContainsString(
            '<head><base href="https://example.org/movies/list?page=2">',
            $out
        );
    }

    public function test_injects_base_after_html_when_no_head(): void
    {
        $out = $this->rewriter->rewrite('<html><body>hi</body></html>', 'https://example.org/');

        $this->assertStringContainsString('<html><base href="https://example.org/">', $out);
    }

    public function test_injects_base_at_start_when_no_head_or_html(): void
    {
        $out = $this->rewriter->rewrite('plain text', 'https://example.org/');

        $this->assertStringStartsWith('<base href="https://example.org/">', $out);
    }

    public function test_removes_ad_script_and_keeps_normal_script(): void
    {
        $html = '<html><head>'
            .'<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>'
            .'<script src="https://cdn.example.org/player.js"></script>'
            .'<script>var x = 1;</script>'
            .'</head><body>hi</body></html>';

        $out = $this->rewriter->rewrite($html, 'https://example.org/');

        $this->assertStringNotContainsString('googlesyndication', $out);
        $this->assertStringContainsString('cdn.example.org/player.js', $out);
        $this->assertStringContainsString('var x = 1;', $out);
    }

    public function test_removes_ad_script_from_subdomain_and_uppercase_tags(): void
    {
        $html = '<HTML><HEAD>'
            .'<SCRIPT SRC="https://www.doubleclick.net/instream/ad.js"></SCRIPT>'
            .'</HEAD><BODY>hi</BODY></HTML>';

        $out = $this->rewriter->rewrite($html, 'https://example.org/');

        $this->assertStringNotContainsString('doubleclick', $out);
    }

    public function test_removes_ad_iframe_and_keeps_normal_iframe(): void
    {
        $html = '<html><body>'
            .'<iframe src="https://taboola.com/widget"></iframe>'
            .'<iframe src="https://player.example.org/embed/1"></iframe>'
            .'</body></html>';

        $out = $this->rewriter->rewrite($html, 'https://example.org/');

        $this->assertStringNotContainsString('taboola', $out);
        $this->assertStringContainsString('player.example.org/embed/1', $out);
    }

    public function test_removes_ad_link_and_keeps_normal_link(): void
    {
        $html = '<html><head>'
            .'<link rel="stylesheet" href="https://criteo.com/ads.css">'
            .'<link rel="stylesheet" href="/static/site.css">'
            .'</head><body>hi</body></html>';

        $out = $this->rewriter->rewrite($html, 'https://example.org/');

        $this->assertStringNotContainsString('criteo', $out);
        $this->assertStringContainsString('/static/site.css', $out);
    }

    public function test_relative_link_href_is_untouched(): void
    {
        $html = '<html><body><a href="/movies/123">Pick this</a></body></html>';

        $out = $this->rewriter->rewrite($html, 'https://example.org/browse');

        $this->assertStringContainsString('<a href="/movies/123">Pick this</a>', $out);
    }

    public function test_sync_script_is_injected_before_close_body(): void
    {
        $out = $this->rewriter->rewrite(
            '<html><head></head><body><p>x</p></body></html>',
            'https://example.org/'
        );

        $this->assertStringContainsString("type: 'c2t-scroll'", $out);
        $this->assertStringContainsString("'c2t-scroll-to'", $out);
        $this->assertStringContainsString("type: 'c2t-link'", $out);
        $this->assertStringContainsString('window.parent.postMessage', $out);
        $this->assertLessThan(
            strpos($out, '</body>'),
            strpos($out, "type: 'c2t-scroll'")
        );
    }

    public function test_sync_script_appended_when_no_body_tag(): void
    {
        $out = $this->rewriter->rewrite('<html><head></head><p>x</p></html>', 'https://example.org/');

        $this->assertStringContainsString("type: 'c2t-scroll'", $out);
    }

    public function test_sync_script_watches_get_form_submits(): void
    {
        // A search box is a GET form — the injected script must watch
        // submits and mirror them as a c2t-link (results-page URL),
        // while leaving the form itself untouched.
        $html = '<html><head></head><body>'
            .'<form action="/w/index.php" method="get">'
            .'<input type="hidden" name="title" value="Special:Search">'
            .'<input type="search" name="search">'
            .'</form></body></html>';

        $out = $this->rewriter->rewrite($html, 'https://example.org/');

        $this->assertStringContainsString(
            '<form action="/w/index.php" method="get">',
            $out
        );
        $this->assertStringContainsString("addEventListener('submit'", $out);
        // GET-only guard (submitter override included) and the target
        // URL built from the form's action + serialised fields.
        $this->assertStringContainsString('formMethod', $out);
        $this->assertStringContainsString("if (method !== 'get') return;", $out);
        $this->assertStringContainsString('new FormData(form', $out);
        $this->assertStringContainsString('url.search = qs;', $out);
    }

    public function test_sync_script_never_intercepts_post_forms(): void
    {
        // The script text must return early for any non-GET method, so
        // a login or any other POST stays on the phone that submitted it.
        // Behaviour (a POST submit posts no c2t-link) is proven in the
        // headless smoke test; here we pin the guard in place.
        $script = ProxyRewriter::syncScriptTag();

        $this->assertStringContainsString("if (method !== 'get') return;", $script);
        $this->assertStringContainsString('ev.defaultPrevented', $script);
    }

    public function test_is_blocked_host_matches_subdomains_but_not_lookalikes(): void
    {
        $this->assertTrue(ProxyRewriter::isBlockedHost('doubleclick.net'));
        $this->assertTrue(ProxyRewriter::isBlockedHost('www.doubleclick.net'));
        $this->assertTrue(ProxyRewriter::isBlockedHost('pagead2.googlesyndication.com'));
        $this->assertFalse(ProxyRewriter::isBlockedHost('notdoubleclick.net'));
        $this->assertFalse(ProxyRewriter::isBlockedHost('example.org'));
        $this->assertFalse(ProxyRewriter::isBlockedHost(null));
        $this->assertFalse(ProxyRewriter::isBlockedHost(''));
    }
}
