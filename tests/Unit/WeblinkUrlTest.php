<?php

namespace Tests\Unit;

use App\Support\WeblinkUrl;
use PHPUnit\Framework\TestCase;

class WeblinkUrlTest extends TestCase
{
    public function test_keeps_valid_https_url(): void
    {
        $this->assertSame('https://example.com/a?b=c', WeblinkUrl::normalise('https://example.com/a?b=c'));
    }

    public function test_adds_https_when_scheme_missing(): void
    {
        $this->assertSame('https://example.com', WeblinkUrl::normalise('example.com'));
        $this->assertSame('https://example.com/path', WeblinkUrl::normalise('  example.com/path  '));
    }

    public function test_keeps_http(): void
    {
        $this->assertSame('http://example.com', WeblinkUrl::normalise('http://example.com'));
    }

    public function test_rejects_non_web_schemes(): void
    {
        $this->assertNull(WeblinkUrl::normalise('javascript:alert(1)'));
        $this->assertNull(WeblinkUrl::normalise('data:text/html,<h1>x</h1>'));
        $this->assertNull(WeblinkUrl::normalise('file:///etc/passwd'));
        $this->assertNull(WeblinkUrl::normalise('ftp://example.com/file'));
    }

    public function test_rejects_garbage_and_empty(): void
    {
        $this->assertNull(WeblinkUrl::normalise('not a url'));
        $this->assertNull(WeblinkUrl::normalise(''));
        $this->assertNull(WeblinkUrl::normalise(null));
        $this->assertNull(WeblinkUrl::normalise('   '));
    }

    public function test_rejects_host_without_dot(): void
    {
        $this->assertNull(WeblinkUrl::normalise('localhost'));
        $this->assertNull(WeblinkUrl::normalise('https://localhost'));
    }

    public function test_rejects_overlong_url(): void
    {
        $this->assertNull(WeblinkUrl::normalise('https://example.com/'.str_repeat('a', 2100)));
    }
}
