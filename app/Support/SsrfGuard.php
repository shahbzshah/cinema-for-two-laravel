<?php

namespace App\Support;

/**
 * SSRF guard for the web proxy: a URL is only fetchable when its host
 * resolves to public IP addresses.
 *
 * Blocked outright:
 *  - hostnames: localhost, *.localhost, *.local
 *  - IPv4: 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8,
 *    169.254.0.0/16 (incl. the 169.254.169.254 cloud metadata address),
 *    172.16.0.0/12, 192.168.0.0/16, 192.0.0.0/24, 192.0.2.0/24,
 *    198.51.100.0/24, 203.0.113.0/24, 240.0.0.0/4, 255.255.255.255/32
 *  - IPv6: ::/128, ::1/128, fc00::/7 (covers fc00::/8 and fd00::/8),
 *    fe80::/10
 *  - any host that fails DNS (no A/AAAA records at all)
 *  - any host where ANY resolved address is blocked (a public name that
 *    also resolves to a private address is rejected)
 *
 * Residual risk (documented in docs/PROXY.md, not fixed here): this
 * resolves the host once and checks the answer, but the HTTP client
 * resolves it again when it connects, so a DNS-rebinding attack could
 * swap the answer between the check and the fetch. Closing that hole
 * needs connecting to the checked literal IP with a Host header and
 * SNI, which is out of scope for Phase 1.
 */
class SsrfGuard
{
    private const BLOCKED_V4 = [
        '0.0.0.0/8',
        '10.0.0.0/8',
        '100.64.0.0/10',
        '127.0.0.0/8',
        '169.254.0.0/16',
        '172.16.0.0/12',
        '192.0.0.0/24',
        '192.0.2.0/24',
        '192.168.0.0/16',
        '198.51.100.0/24',
        '203.0.113.0/24',
        '240.0.0.0/4',
        '255.255.255.255/32',
    ];

    private const BLOCKED_V6 = [
        '::/128',
        '::1/128',
        'fc00::/7',
        'fe80::/10',
    ];

    /** @var callable|null fn(string $host): string[] — injectable for tests. */
    private $resolver;

    public function __construct(?callable $resolver = null)
    {
        $this->resolver = $resolver;
    }

    public function isAllowedUrl(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST);

        if (! is_string($host) || $host === '') {
            return false;
        }

        return $this->isAllowedHost($host);
    }

    public function isAllowedHost(string $host): bool
    {
        $host = strtolower(rtrim(trim($host), '.'));

        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $host = substr($host, 1, -1);
        }

        if ($host === '') {
            return false;
        }

        if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local')) {
            return false;
        }

        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_IPV6)) {
            return ! $this->isBlockedIp($host);
        }

        $ips = $this->resolve($host);

        if ($ips === []) {
            return false;
        }

        foreach ($ips as $ip) {
            if ($this->isBlockedIp($ip)) {
                return false;
            }
        }

        return true;
    }

    /** @return string[] */
    private function resolve(string $host): array
    {
        if ($this->resolver !== null) {
            $ips = ($this->resolver)($host);

            return array_values(array_unique(array_filter(array_map('strval', (array) $ips))));
        }

        $ips = [];

        $a = gethostbynamel($host);

        if (is_array($a)) {
            $ips = array_merge($ips, $a);
        }

        $aaaa = @dns_get_record($host, DNS_AAAA);

        if (is_array($aaaa)) {
            foreach ($aaaa as $record) {
                if (! empty($record['ipv6'])) {
                    $ips[] = $record['ipv6'];
                }
            }
        }

        return array_values(array_unique($ips));
    }

    private function isBlockedIp(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            foreach (self::BLOCKED_V4 as $cidr) {
                if ($this->ipv4InCidr($ip, $cidr)) {
                    return true;
                }
            }

            return false;
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            foreach (self::BLOCKED_V6 as $cidr) {
                if ($this->ipv6InCidr($ip, $cidr)) {
                    return true;
                }
            }

            return false;
        }

        // Not an IP at all: fail closed.
        return true;
    }

    private function ipv4InCidr(string $ip, string $cidr): bool
    {
        [$network, $bits] = explode('/', $cidr, 2);

        $ipLong = ip2long($ip);
        $netLong = ip2long($network);

        if ($ipLong === false || $netLong === false) {
            return false;
        }

        $bits = (int) $bits;

        if ($bits === 0) {
            return true;
        }

        $mask = -1 << (32 - $bits);

        return ($ipLong & $mask) === ($netLong & $mask);
    }

    private function ipv6InCidr(string $ip, string $cidr): bool
    {
        [$network, $bits] = explode('/', $cidr, 2);

        $bits = (int) $bits;
        $ipBin = @inet_pton($ip);
        $netBin = @inet_pton($network);

        if ($ipBin === false || $netBin === false) {
            return false;
        }

        $bytes = intdiv($bits, 8);
        $remainder = $bits % 8;

        if ($bytes > 0 && substr($ipBin, 0, $bytes) !== substr($netBin, 0, $bytes)) {
            return false;
        }

        if ($remainder > 0) {
            $mask = (0xFF << (8 - $remainder)) & 0xFF;

            if ((ord($ipBin[$bytes]) & $mask) !== (ord($netBin[$bytes]) & $mask)) {
                return false;
            }
        }

        return true;
    }
}
