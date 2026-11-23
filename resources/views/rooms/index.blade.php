@extends('layouts.app')

@section('title', 'Rooms — Cinema for Two')

@section('content')
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <h1 class="font-headline-md text-headline-md italic text-text-primary tracking-tight">Your rooms</h1>
            <p class="text-text-secondary text-sm mt-1">Share a room code with your partner — that code is the invite.</p>
        </div>
        <form method="POST" action="{{ route('rooms.create') }}">
            @csrf
            <button type="submit" class="px-4 h-10 rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background text-sm font-semibold">Create a room</button>
        </form>
    </div>

    <div class="mt-6 bg-surface-card border border-hairline-border rounded-[10px] p-5">
        <h2 class="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">Join a room</h2>
        <form method="POST" action="{{ route('rooms.join') }}" class="mt-3 flex gap-2">
            @csrf
            <input name="code" type="text" required minlength="6" maxlength="6" placeholder="6-letter code"
                class="flex-1 h-10 px-4 rounded-[6px] bg-canvas-background border border-hairline-border font-code-timecode uppercase tracking-[0.22em] text-center sm:text-left text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container/70 transition">
            <button type="submit" class="px-4 h-10 rounded-[6px] bg-surface-control hover:bg-surface-variant border border-hairline-border text-text-primary text-sm font-semibold">Join</button>
        </form>
    </div>

    <div class="mt-6 space-y-3">
        @forelse ($rooms as $room)
            <a href="{{ route('rooms.show', ['code' => $room->code]) }}"
               class="block bg-surface-card border border-hairline-border rounded-[10px] px-5 py-4 hover:border-primary-container/40 transition">
                <div class="flex items-center justify-between gap-4">
                    <span class="font-mono text-lg tracking-widest text-text-primary">{{ $room->code }}</span>
                    <span class="text-xs text-text-muted">{{ $room->created_at->diffForHumans() }}</span>
                </div>
                <p class="text-sm text-text-secondary mt-1">{{ $room->weblinks_count ?? $room->weblinks()->count() }} shared link(s)</p>
            </a>
        @empty
            <p class="text-text-secondary text-sm bg-surface-card border border-hairline-border rounded-[10px] px-5 py-6">
                No rooms yet. Create one above and send the code to your partner.
            </p>
        @endforelse
    </div>
@endsection
