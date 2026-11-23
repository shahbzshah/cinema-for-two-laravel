@extends('layouts.app')

@section('title', 'Room ' . $room->code . ' — Cinema for Two')

@section('content')
    <div id="roomRoot"
         data-room-code="{{ $room->code }}"
         data-user-name="{{ auth()->user()->name }}"
         data-weblinks-url="{{ route('rooms.weblinks.index', ['code' => $room->code]) }}"
         data-weblink-store-url="{{ route('rooms.weblinks.store', ['code' => $room->code]) }}">

        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 class="font-display text-3xl">Room <span class="font-mono tracking-widest">{{ $room->code }}</span></h1>
                <p class="text-textSecondary text-sm mt-1">Created by {{ $room->owner->name }} · share the code with your partner to join.</p>
            </div>
            <span id="syncPill" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/25 bg-primary/10 text-xs text-primary">
                <span id="syncPillDot" class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                <span id="syncPillText">Connecting…</span>
            </span>
        </div>

        {{-- Shared mini-browser --}}
        <section class="mt-6">
            <h2 class="text-sm font-medium text-textPrimary">Web — browse together</h2>
            <p class="text-textSecondary text-xs mt-1">
                Paste a link and both phones open the same page. Each phone scrolls and taps on its own screen;
                sharing a new link moves the room together.
            </p>

            <form id="weblinkForm" class="mt-3 flex gap-2">
                <input id="weblinkInput" name="url" type="text" required placeholder="Paste a link — example.com or https://example.com"
                    value="{{ $current?->url }}"
                    class="flex-1 h-10 px-3 rounded-md bg-control border border-hairline text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-primary">
                <button type="submit" class="px-4 h-10 rounded-md bg-primary text-canvas text-sm font-medium shrink-0">Go</button>
            </form>

            <div id="newLinkBanner" class="hidden mt-3 rounded-[10px] border border-primary/45 bg-card px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3">
                <span><span class="text-primary font-medium">Your partner shared a link.</span> <span id="newLinkBannerText" class="text-textSecondary"></span></span>
                <button id="newLinkBannerOpen" type="button" class="px-3 h-8 rounded-md bg-primary text-canvas text-xs font-medium shrink-0">Open it</button>
            </div>

            <div id="webViewerWrap" class="mt-3 relative w-full aspect-video bg-black rounded-[10px] border border-hairline overflow-hidden">
                <div id="webEmpty" class="absolute inset-0 flex flex-col items-center justify-center text-center p-6 {{ $current ? 'hidden' : '' }}">
                    <p class="font-display text-xl text-textPrimary">No page open yet</p>
                    <p class="text-textSecondary text-sm max-w-md mt-1.5">Paste a link above, or pick one from the shared links below.</p>
                </div>
                {{-- sandbox: scripts + same-origin so pages work, but no top-navigation so a page can never break out of the app --}}
                <iframe id="webViewer" title="Shared mini-browser" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"
                    src="{{ $current?->url }}" class="w-full h-full bg-white {{ $current ? '' : 'hidden' }}"></iframe>
                <div id="blockedNotice" class="hidden absolute inset-x-4 bottom-4 rounded-md bg-card border border-errorText/45 px-4 py-3 text-sm">
                    <span class="text-errorText font-medium">This site does not allow embedding.</span>
                    <span class="text-textSecondary"> It refuses to show inside an app — open it in your browser instead.</span>
                    <a id="blockedOpenLink" href="{{ $current?->url }}" target="_blank" rel="noopener" class="text-primary underline underline-offset-2">Open in browser</a>
                </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2">
                <button id="syncPageBtn" type="button" class="px-4 h-9 rounded-md bg-control border border-hairline text-sm">Sync page</button>
                <a id="openInBrowser" href="{{ $current?->url ?? '#' }}" target="_blank" rel="noopener"
                   class="px-4 h-9 inline-flex items-center rounded-md bg-control border border-hairline text-sm {{ $current ? '' : 'opacity-50 pointer-events-none' }}">Open in browser</a>
                <span class="text-xs text-textMuted">Sync page reloads the shared link on both phones.</span>
            </div>
        </section>

        {{-- Shared links shelf --}}
        <section class="mt-8">
            <h2 class="text-sm font-medium text-textPrimary">Shared links</h2>
            <ul id="weblinkShelf" class="mt-3 space-y-2">
                @forelse ($weblinks as $link)
                    <li data-id="{{ $link->id }}" class="bg-card border border-hairline rounded-[10px] px-4 py-3 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <a href="{{ $link->url }}" target="_blank" rel="noopener" class="text-sm text-textPrimary truncate block hover:text-primary">{{ $link->url }}</a>
                            <p class="text-xs text-textMuted mt-0.5">Shared by {{ $link->sharer?->name ?? 'Someone' }} · {{ $link->created_at->diffForHumans() }}</p>
                        </div>
                        <button type="button" data-url="{{ $link->url }}" data-id="{{ $link->id }}"
                            class="weblink-open px-3 h-8 rounded-md bg-control border border-hairline text-xs shrink-0">Open</button>
                    </li>
                @empty
                    <li id="weblinkShelfEmpty" class="text-textSecondary text-sm bg-card border border-hairline rounded-[10px] px-4 py-4">
                        No links shared yet — the first link either of you shares shows up here for both of you.
                    </li>
                @endforelse
            </ul>
        </section>

        <section class="mt-8 bg-card border border-hairline rounded-[10px] px-4 py-4">
            <h2 class="text-sm font-medium text-textPrimary">Live video &amp; voice</h2>
            <p class="text-textSecondary text-sm mt-1">
                Video calling arrives in the next version — the room shell above already connects you peer-to-peer
                (the green “Live Synced” pill) so shared links travel instantly. Until then, this room is the shared browser.
            </p>
        </section>

        <div id="roomToast" class="hidden fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-full border border-primary/45 bg-card text-sm"></div>
    </div>
@endsection

@push('head')
    <script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
@endpush

@push('scripts')
    <script src="{{ asset('js/room.js') }}"></script>
@endpush
