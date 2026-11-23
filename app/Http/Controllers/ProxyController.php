<?php

namespace App\Http\Controllers;

use App\Services\ProxyRewriter;
use App\Support\SsrfGuard;
use App\Support\WeblinkUrl;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Http;

class ProxyController extends Controller
{
    /**
     * GET /proxy?url=<page>
     *
     * Fetches a public web page, strips ad scripts/frames from known ad
     * hosts, injects a <base> and the scroll/link sync script, and serves
     * the rewritten HTML so both phones can browse it together (Phase 2
     * wires the parent side of the postMessage protocol).
     *
     * Guard rails:
     *  - signed-in users only (route middleware);
     *  - URL normalised by WeblinkUrl (http/https only);
     *  - SsrfGuard rejects private/reserved destinations;
     *  - 10s timeout, max 3 redirects, 2 MB body cap;
     *  - no user cookies are ever forwarded upstream, and no upstream
     *    Set-Cookie / framing headers are copied back — the page is
     *    served as ours, which is also why sites that refuse embedding
     *    load through the proxy.
     */
    public function show(Request $request, SsrfGuard $guard, ProxyRewriter $rewriter): Response
    {
        $raw = $request->query('url');

        if (! is_string($raw) || trim($raw) === '' || mb_strlen($raw) > 2048) {
            return $this->plainError('A url query parameter is required.', 422);
        }

        $url = WeblinkUrl::normalise($raw);

        if ($url === null) {
            return $this->plainError('That does not look like a web address.', 422);
        }

        if (! $guard->isAllowedUrl($url)) {
            return $this->plainError('That address is not allowed through the proxy.', 502);
        }

        try {
            $upstream = Http::withHeaders([
                'User-Agent' => 'CinemaForTwo-Proxy/1.0',
                'Accept' => 'text/html,application/xhtml+xml',
            ])
                ->timeout(10)
                ->withOptions([
                    'allow_redirects' => ['max' => 3],
                    'stream' => true,
                ])
                ->get($url);
        } catch (\Throwable) {
            return $this->plainError('Could not fetch that page.', 502);
        }

        if (! $upstream->successful()) {
            return $this->plainError('The page answered with HTTP '.$upstream->status().'.', $upstream->status());
        }

        $contentType = strtolower($upstream->header('Content-Type') ?? '');

        if (! str_contains($contentType, 'html')) {
            return $this->plainError('Only web pages are proxied.', 415);
        }

        $contentLength = $upstream->header('Content-Length');

        if ($contentLength !== null && is_numeric($contentLength)
            && (int) $contentLength > ProxyRewriter::MAX_BODY_BYTES
        ) {
            return $this->plainError('That page is too large to proxy.', 502);
        }

        $body = '';

        try {
            $stream = $upstream->toPsrResponse()->getBody();

            while (! $stream->eof()) {
                $chunk = $stream->read(65536);

                if ($chunk === '') {
                    break;
                }

                $body .= $chunk;

                if (strlen($body) > ProxyRewriter::MAX_BODY_BYTES) {
                    return $this->plainError('That page is too large to proxy.', 502);
                }
            }
        } catch (\Throwable) {
            return $this->plainError('Could not read that page.', 502);
        }

        return response($rewriter->rewrite($body, $url), 200)
            ->header('Content-Type', 'text/html; charset=utf-8')
            ->header('X-Cinema-Proxy', '1');
    }

    private function plainError(string $message, int $status): Response
    {
        $html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
            .'<title>Cinema for Two — proxy</title></head>'
            .'<body style="background:#0C0C0E;color:#F4F3EF;font-family:sans-serif;padding:2rem">'
            .'<p>'.htmlspecialchars($message, ENT_QUOTES, 'UTF-8').'</p>'
            .'</body></html>';

        return response($html, $status)->header('Content-Type', 'text/html; charset=utf-8');
    }
}
