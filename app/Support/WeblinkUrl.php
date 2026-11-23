<?php

namespace App\Support;

/**
 * Server-side URL normalisation for shared weblinks.
 *
 * - Trims whitespace.
 * - Adds https:// when no scheme is given (people paste "example.com").
 * - Only http and https survive; javascript:, data:, file: etc. are rejected.
 * - Returns null when the result is not a usable URL.
 */
class WeblinkUrl
{
    public static function normalise(?string $input): ?string
    {
        if ($input === null) {
            return null;
        }

        $url = trim($input);

        if ($url === '' || mb_strlen($url) > 2048) {
            return null;
        }

        if (! preg_match('#^[a-z][a-z0-9+.-]*://#i', $url)) {
            $url = 'https://'.$url;
        }

        if (filter_var($url, FILTER_VALIDATE_URL) === false) {
            return null;
        }

        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));

        if (! in_array($scheme, ['http', 'https'], true)) {
            return null;
        }

        $host = (string) parse_url($url, PHP_URL_HOST);

        if ($host === '' || ! str_contains($host, '.')) {
            return null;
        }

        return $url;
    }
}
