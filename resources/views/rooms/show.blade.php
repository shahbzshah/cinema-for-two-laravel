@extends('layouts.app')

@section('title', 'Room ' . $room->code . ' — Cinema for Two')

@section('content')
    <div id="roomRoot"
         data-room-code="{{ $room->code }}"
         data-user-name="{{ auth()->user()->name }}"
         data-proxy-url="{{ route('proxy', [], false) }}"
         data-weblinks-url="{{ route('rooms.weblinks.index', ['code' => $room->code]) }}"
         data-weblink-store-url="{{ route('rooms.weblinks.store', ['code' => $room->code]) }}">

        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 class="font-headline-md text-headline-md italic text-text-primary tracking-tight">Room <span class="font-code-timecode text-primary-container tracking-wider">{{ $room->code }}</span></h1>
                <p class="text-text-secondary text-sm mt-1">Created by {{ $room->owner->name }} · share the code with your partner to join.</p>
            </div>
            <span id="syncPill" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary-container/25 bg-primary-container/10 text-xs font-medium text-primary-container">
                <span id="syncPillDot" class="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse"></span>
                <span id="syncPillText">Connecting…</span>
            </span>
        </div>

        {{-- Shared mini-browser --}}
        <section class="mt-6">
            <h2 class="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Web — browse together</h2>
            <p class="text-[11px] text-text-muted mt-2 leading-relaxed">
                Paste a link and both phones open the same page. With “Browse together (synced)” on, scrolling
                and link taps move on both phones; with it off, each phone scrolls on its own.
                Sharing a new link moves the room together either way.
            </p>

            <label class="mt-3 flex items-start gap-2.5 cursor-pointer select-none">
                <input id="webSyncToggle" type="checkbox" class="mt-0.5 h-4 w-4 shrink-0 accent-primary-container cursor-pointer">
                <span>
                    <span class="block text-sm font-semibold text-text-primary">Browse together (synced)</span>
                    <span class="block text-[11px] text-text-muted leading-relaxed mt-0.5">Pages load through this site (ads stripped) so scrolling and link taps stay in sync. Both phones turn it on — it is per-device, not shared. You are already signed in here, which synced browsing needs.</span>
                </span>
            </label>

            <form id="weblinkForm" class="mt-3 flex gap-2">
                <input id="weblinkInput" name="url" type="text" required placeholder="Paste any web page link…"
                    value="{{ $current?->url }}"
                    class="flex-1 min-w-0 h-10 px-3.5 rounded-[6px] bg-canvas-background border border-hairline-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container/60 transition">
                <button type="submit" class="h-10 px-4 rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background font-semibold text-sm transition cursor-pointer shrink-0">Share Web Page</button>
            </form>

            <div id="newLinkBanner" class="hidden mt-3 rounded-[6px] border border-primary-container/45 bg-surface-card px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3">
                <span><span class="text-primary-container font-medium">Your partner shared a link.</span> <span id="newLinkBannerText" class="text-text-secondary"></span></span>
                <button id="newLinkBannerOpen" type="button" class="px-3 h-8 rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background text-xs font-semibold shrink-0">Open it</button>
            </div>

            <div id="webViewerWrap" class="mt-3 w-full aspect-video bg-black rounded-[10px] border border-hairline-border overflow-hidden flex flex-col">
                <div class="flex items-center gap-2 px-3 py-2 border-b border-hairline-border bg-surface-card shrink-0">
                    <span id="webAddressText" class="flex-1 min-w-0 truncate font-code-timecode text-[11px] text-text-secondary">{{ $current?->url }}</span>
                    <button id="syncPageBtn" type="button" class="px-2.5 py-1.5 rounded-[6px] bg-surface-control hover:bg-surface-variant border border-hairline-border text-text-primary text-[11px] font-semibold transition cursor-pointer shrink-0">Sync page</button>
                    <a id="openInBrowser" href="{{ $current?->url ?? '#' }}" target="_blank" rel="noopener"
                       class="px-2.5 py-1.5 rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background text-[11px] font-semibold transition cursor-pointer shrink-0 {{ $current ? '' : 'opacity-50 pointer-events-none' }}">Open in browser</a>
                </div>
                <div id="blockedNotice" class="hidden px-4 py-2.5 bg-error-container/30 border-b border-error/20 text-[11px] text-text-primary flex items-center justify-between gap-3 shrink-0">
                    <span><span class="text-error font-medium">This site does not allow embedding.</span><span class="text-text-secondary"> It refuses to show inside an app — open it in your browser instead.</span></span>
                    <span class="flex items-center gap-2 shrink-0">
                        <a id="blockedOpenLink" href="{{ $current?->url }}" target="_blank" rel="noopener" class="text-primary-container underline underline-offset-2">Open in browser</a>
                        <button id="blockedDismissBtn" type="button" class="text-error font-bold px-1.5 cursor-pointer">✕</button>
                    </span>
                </div>
                <div class="relative flex-1 min-h-0 bg-canvas-background">
                    <div id="webEmpty" class="absolute inset-0 flex flex-col items-center justify-center text-center p-6 {{ $current ? 'hidden' : '' }}">
                        <p class="font-headline-md text-headline-md italic text-text-primary">No page open yet</p>
                        <p class="text-text-secondary text-sm max-w-md mt-1.5">Paste a link above, or pick one from the shared links below.</p>
                    </div>
                    {{-- sandbox: scripts + same-origin so pages work, but no top-navigation so a page can never break out of the app, and no pop-ups so shared sites cannot open ad windows --}}
                    <iframe id="webViewer" title="Shared mini-browser" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer"
                        src="{{ $current?->url }}" class="absolute inset-0 w-full h-full bg-white {{ $current ? '' : 'hidden' }}"></iframe>
                </div>
            </div>
        </section>

        {{-- Shared links shelf --}}
        <section class="mt-8">
            <h2 class="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Shared links</h2>
            <ul id="weblinkShelf" class="mt-3 space-y-2">
                @forelse ($weblinks as $link)
                    <li data-id="{{ $link->id }}" class="bg-canvas-background hover:bg-surface-control border border-hairline-border hover:border-primary-container/40 transition rounded-[6px] px-4 py-3 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <a href="{{ $link->url }}" target="_blank" rel="noopener" class="text-xs font-semibold text-text-primary truncate block hover:text-primary-container">{{ parse_url($link->url, PHP_URL_HOST) ?? $link->url }}</a>
                            <p class="text-[11px] text-text-muted truncate mt-0.5">{{ $link->url }} · Shared by {{ $link->sharer?->name ?? 'Someone' }} · {{ $link->created_at->diffForHumans() }}</p>
                        </div>
                        <button type="button" data-url="{{ $link->url }}" data-id="{{ $link->id }}"
                            class="weblink-open px-2.5 py-1.5 rounded-[6px] bg-surface-control hover:bg-surface-variant border border-hairline-border text-text-primary text-[11px] font-semibold shrink-0">Open</button>
                    </li>
                @empty
                    <li id="weblinkShelfEmpty" class="text-[11px] text-text-muted">No links shared yet — paste one above.</li>
                @endforelse
            </ul>
        </section>

        <section class="mt-8 bg-surface-card border border-hairline-border rounded-[10px] px-4 py-4">
            <h2 class="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Live video &amp; voice</h2>
            <p class="text-text-secondary text-sm mt-2 leading-relaxed">
                Video calling arrives in the next version — the room shell above already connects you peer-to-peer
                (the amber “Live Synced” pill) so shared links travel instantly. Until then, this room is the shared browser.
            </p>
        </section>

        <div id="roomToast" class="hidden fixed left-1/2 -translate-x-1/2 top-4 z-50 px-4 py-2.5 rounded-full border border-primary-container/45 bg-surface-card text-text-primary text-xs sm:text-sm font-medium"></div>
    </div>
@endsection

@push('head')
    <script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
@endpush

@push('scripts')
    <script src="{{ asset('js/room-sync.js') }}"></script>
    <script src="{{ asset('js/room.js') }}"></script>
@endpush
