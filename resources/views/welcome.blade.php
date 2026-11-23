@extends('layouts.app')

@section('content')
    <div class="flex items-start sm:items-center justify-center py-6 sm:py-10">
        <div class="w-full max-w-lg bg-surface-card border border-hairline-border rounded-[10px] p-6 sm:p-9 text-center">
            <div class="flex items-center justify-center mb-4">
                <svg class="w-8 h-8" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#161310"/><path d="M26 20l18 12-18 12z" fill="#E8A33D"/></svg>
            </div>
            <p class="font-label-sm text-label-sm text-text-muted uppercase tracking-widest mb-3">Private Screening Room</p>
            <h1 class="font-headline-md text-display-lg italic text-text-primary tracking-tight">
                Cinema <span class="text-primary-container">for</span> Two
            </h1>
            <p class="text-text-secondary text-sm sm:text-base mt-2 max-w-sm mx-auto leading-relaxed">
                Create a room, share the code with your partner, and browse the web together
                in the shared mini-browser — same page on both screens.
            </p>
            <div class="flex flex-col sm:flex-row gap-3 mt-8 justify-center">
                <a href="{{ route('register') }}" class="px-5 h-10 inline-flex items-center justify-center rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background text-sm font-semibold">Create a free account</a>
                <a href="{{ route('login') }}" class="px-5 h-10 inline-flex items-center justify-center rounded-[6px] bg-surface-control hover:bg-surface-variant border border-hairline-border text-text-primary text-sm font-semibold">Log in</a>
            </div>
            <p class="text-text-muted text-xs mt-6">Free. No card. Live sync runs peer-to-peer — the video never touches a server.</p>
        </div>
    </div>
@endsection
