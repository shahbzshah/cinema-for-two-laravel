@extends('layouts.app')

@section('title', 'Rooms — Cinema for Two')

@section('content')
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <h1 class="font-display text-3xl">Your rooms</h1>
            <p class="text-textSecondary text-sm mt-1">Share a room code with your partner — that code is the invite.</p>
        </div>
        <form method="POST" action="{{ route('rooms.create') }}">
            @csrf
            <button type="submit" class="px-4 h-10 rounded-md bg-primary text-canvas text-sm font-medium">Create a room</button>
        </form>
    </div>

    <div class="mt-6 bg-card border border-hairline rounded-[10px] p-5">
        <h2 class="text-sm font-medium text-textPrimary">Join a room</h2>
        <form method="POST" action="{{ route('rooms.join') }}" class="mt-3 flex gap-2">
            @csrf
            <input name="code" type="text" required minlength="6" maxlength="6" placeholder="6-letter code"
                class="flex-1 h-10 px-3 rounded-md bg-control border border-hairline font-mono uppercase tracking-widest text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-primary">
            <button type="submit" class="px-4 h-10 rounded-md bg-control border border-hairline text-sm">Join</button>
        </form>
    </div>

    <div class="mt-6 space-y-3">
        @forelse ($rooms as $room)
            <a href="{{ route('rooms.show', ['code' => $room->code]) }}"
               class="block bg-card border border-hairline rounded-[10px] px-5 py-4 hover:border-primary/50">
                <div class="flex items-center justify-between gap-4">
                    <span class="font-mono text-lg tracking-widest">{{ $room->code }}</span>
                    <span class="text-xs text-textMuted">{{ $room->created_at->diffForHumans() }}</span>
                </div>
                <p class="text-sm text-textSecondary mt-1">{{ $room->weblinks_count ?? $room->weblinks()->count() }} shared link(s)</p>
            </a>
        @empty
            <p class="text-textSecondary text-sm bg-card border border-hairline rounded-[10px] px-5 py-6">
                No rooms yet. Create one above and send the code to your partner.
            </p>
        @endforelse
    </div>
@endsection
