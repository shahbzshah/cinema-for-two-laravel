<?php

namespace Tests\Unit;

use App\Support\SsrfGuard;
use PHPUnit\Framework\TestCase;

class SsrfGuardTest extends TestCase
{
    private function guardWith(array $ips): SsrfGuard
    {
        return new SsrfGuard(fn () => $ips);
    }

    public function test_allows_public_ip_from_dns(): void
    {
        $this->assertTrue($this->guardWith(['93.184.216.34'])->isAllowedHost('example.org'));
        $this->assertTrue($this->guardWith(['2606:4700:4700::1111'])->isAllowedHost('example.org'));
    }

    public function test_allows_public_ip_literals(): void
    {
        $guard = new SsrfGuard();

        $this->assertTrue($guard->isAllowedHost('93.184.216.34'));
        $this->assertTrue($guard->isAllowedHost('8.8.8.8'));
        $this->assertTrue($guard->isAllowedHost('2606:4700:4700::1111'));
    }

    public function test_rejects_localhost_names(): void
    {
        $guard = $this->guardWith(['93.184.216.34']);

        $this->assertFalse($guard->isAllowedHost('localhost'));
        $this->assertFalse($guard->isAllowedHost('LOCALHOST'));
        $this->assertFalse($guard->isAllowedHost('app.localhost'));
        $this->assertFalse($guard->isAllowedHost('foo.local'));
        $this->assertFalse($guard->isAllowedHost('printer.local.'));
    }

    public function test_rejects_private_ipv4_literals(): void
    {
        $guard = new SsrfGuard();

        foreach (['127.0.0.1', '127.5.6.7', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.10.20', '0.0.0.0'] as $ip) {
            $this->assertFalse($guard->isAllowedHost($ip), "$ip should be blocked");
        }

        // Just outside the private ranges: allowed.
        $this->assertTrue($guard->isAllowedHost('172.15.255.255'));
        $this->assertTrue($guard->isAllowedHost('172.32.0.1'));
    }

    public function test_rejects_private_ipv6_literals(): void
    {
        $guard = new SsrfGuard();

        foreach (['::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1'] as $ip) {
            $this->assertFalse($guard->isAllowedHost($ip), "$ip should be blocked");
        }
    }

    public function test_rejects_dns_failure(): void
    {
        $this->assertFalse($this->guardWith([])->isAllowedHost('no-such-host.example'));
    }

    public function test_rejects_host_with_any_blocked_answer(): void
    {
        $this->assertFalse(
            $this->guardWith(['93.184.216.34', '10.0.0.1'])->isAllowedHost('two-faced.example')
        );
    }

    public function test_rejects_blocked_answer_from_dns(): void
    {
        $this->assertFalse($this->guardWith(['169.254.169.254'])->isAllowedHost('metadata.example'));
        $this->assertFalse($this->guardWith(['::1'])->isAllowedHost('v6.example'));
    }

    public function test_is_allowed_url_rejects_missing_host(): void
    {
        $guard = $this->guardWith(['93.184.216.34']);

        $this->assertFalse($guard->isAllowedUrl('not a url'));
        $this->assertFalse($guard->isAllowedUrl('https:///path'));
        $this->assertTrue($guard->isAllowedUrl('https://example.org/page'));
    }
}
