<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\SsrfGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ProxyTest extends TestCase
{
    use RefreshDatabase;

    private const PAGE = '<html><head>'
        .'<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>'
        .'<script src="https://cdn.example.org/app.js"></script>'
        .'</head><body><a href="/movies/1">One</a></body></html>';

    /** Bind a guard whose DNS always answers with a public IP (no real DNS in tests). */
    private function allowPublicDns(): void
    {
        $this->app->instance(SsrfGuard::class, new SsrfGuard(fn () => ['93.184.216.34']));
    }

    private function user(): User
    {
        return User::factory()->create();
    }

    public function test_guest_is_redirected_to_login(): void
    {
        $this->get(route('proxy', ['url' => 'https://example.org']))
            ->assertRedirect(route('login'));
    }

    public function test_proxies_and_rewrites_html(): void
    {
        $this->allowPublicDns();

        Http::fake([
            '*' => Http::response(self::PAGE, 200, ['Content-Type' => 'text/html; charset=utf-8']),
        ]);

        $response = $this->actingAs($this->user())
            ->get(route('proxy', ['url' => 'https://example.org/browse']));

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $response->assertHeader('X-Cinema-Proxy', '1');

        $body = $response->getContent();
        $this->assertStringContainsString('<base href="https://example.org/browse">', $body);
        $this->assertStringNotContainsString('googlesyndication', $body);
        $this->assertStringContainsString('cdn.example.org/app.js', $body);
        $this->assertStringContainsString('<a href="/movies/1">One</a>', $body);
        $this->assertStringContainsString("type: 'c2t-scroll'", $body);
        $this->assertStringContainsString("'c2t-scroll-to'", $body);
        $this->assertStringContainsString("type: 'c2t-link'", $body);
    }

    public function test_normalises_url_without_scheme(): void
    {
        $this->allowPublicDns();

        Http::fake(['*' => Http::response('<html><body>x</body></html>', 200, ['Content-Type' => 'text/html'])]);

        $this->actingAs($this->user())
            ->get(route('proxy', ['url' => 'example.org/page']))
            ->assertOk()
            ->assertSee('<base href="https://example.org/page">', false);
    }

    public function test_missing_url_is_422(): void
    {
        $this->actingAs($this->user())->get(route('proxy'))->assertStatus(422);
    }

    public function test_rejects_non_web_schemes(): void
    {
        $user = $this->user();

        $this->actingAs($user)->get(route('proxy', ['url' => 'javascript:alert(1)']))->assertStatus(422);
        $this->actingAs($user)->get(route('proxy', ['url' => 'data:text/html,<h1>x</h1>']))->assertStatus(422);
        $this->actingAs($user)->get(route('proxy', ['url' => 'ftp://example.org/file']))->assertStatus(422);
        $this->actingAs($user)->get(route('proxy', ['url' => 'https://localhost']))->assertStatus(422);
    }

    public function test_rejects_private_destinations_with_502(): void
    {
        $user = $this->user();

        // Real guard here (no fake DNS): IP literals are blocked without any lookup.
        $this->actingAs($user)->get(route('proxy', ['url' => 'http://127.0.0.1/']))->assertStatus(502);
        $this->actingAs($user)->get(route('proxy', ['url' => 'http://10.1.2.3/admin']))->assertStatus(502);
        $this->actingAs($user)->get(route('proxy', ['url' => '169.254.169.254/latest/meta-data/']))->assertStatus(502);
        $this->actingAs($user)->get(route('proxy', ['url' => 'https://192.168.0.1/']))->assertStatus(502);
        $this->actingAs($user)->get(route('proxy', ['url' => 'https://foo.localhost/']))->assertStatus(502);

        // Nothing was fetched upstream for the blocked ones.
        Http::assertSentCount(0);
    }

    public function test_upstream_error_status_is_passed_through(): void
    {
        $this->allowPublicDns();

        Http::fake(['*' => Http::response('missing', 404, ['Content-Type' => 'text/html'])]);

        $this->actingAs($this->user())
            ->get(route('proxy', ['url' => 'https://example.org/gone']))
            ->assertStatus(404);
    }

    public function test_non_html_upstream_is_415(): void
    {
        $this->allowPublicDns();

        Http::fake(['*' => Http::response("\x89PNG", 200, ['Content-Type' => 'image/png'])]);

        $this->actingAs($this->user())
            ->get(route('proxy', ['url' => 'https://example.org/pic.png']))
            ->assertStatus(415);
    }

    public function test_oversized_content_length_is_rejected(): void
    {
        $this->allowPublicDns();

        Http::fake(['*' => Http::response('small', 200, [
            'Content-Type' => 'text/html',
            'Content-Length' => '3000000',
        ])]);

        $this->actingAs($this->user())
            ->get(route('proxy', ['url' => 'https://example.org/big']))
            ->assertStatus(502);
    }

    public function test_oversized_streamed_body_is_rejected(): void
    {
        $this->allowPublicDns();

        Http::fake(['*' => Http::response(str_repeat('x', 2 * 1024 * 1024 + 1), 200, [
            'Content-Type' => 'text/html',
        ])]);

        $this->actingAs($this->user())
            ->get(route('proxy', ['url' => 'https://example.org/big']))
            ->assertStatus(502);
    }
}
