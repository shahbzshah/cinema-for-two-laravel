@extends('layouts.app')

@section('content')
    <div class="py-10 sm:py-16 max-w-2xl">
        <p class="font-mono text-xs uppercase tracking-widest text-textMuted">Two people · One room</p>
        <h1 class="font-display text-4xl sm:text-5xl leading-tight mt-3">A private cinema<br>for two.</h1>
        <p class="text-textSecondary mt-4 leading-relaxed">
            Create a room, share the code with your partner, and browse the web together
            in the shared mini-browser — same page on both screens, each of you scrolling
            and choosing on your own phone.
        </p>
        <div class="flex flex-wrap gap-3 mt-8">
            <a href="{{ route('register') }}" class="px-5 h-10 inline-flex items-center rounded-md bg-primary text-canvas text-sm font-medium">Create a free account</a>
            <a href="{{ route('login') }}" class="px-5 h-10 inline-flex items-center rounded-md bg-control border border-hairline text-sm">Log in</a>
        </div>
        <p class="text-textMuted text-xs mt-6">Free. No card. Live sync runs peer-to-peer — the video never touches a server.</p>
    </div>
@endsection
