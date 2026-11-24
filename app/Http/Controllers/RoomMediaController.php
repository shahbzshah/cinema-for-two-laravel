<?php

namespace App\Http\Controllers;

use App\Models\Room;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class RoomMediaController extends Controller
{
    public function index(string $code): JsonResponse
    {
        $room = Room::where('code', strtoupper($code))->firstOrFail();

        $media = $room->media()->with('sharer:id,name')->latest()->limit(50)->get();

        return response()->json([
            'room' => $room->code,
            'media' => $media->map(fn ($item) => [
                'id' => $item->id,
                'type' => $item->type,
                'url' => $item->url,
                'title' => $item->title,
                'shared_by' => $item->sharer?->name,
                'created_at' => $item->created_at->toIso8601String(),
            ]),
        ]);
    }

    public function store(string $code, Request $request): JsonResponse|RedirectResponse
    {
        $room = Room::where('code', strtoupper($code))->firstOrFail();

        $validated = $request->validate([
            'type' => ['required', 'string', Rule::in(['youtube', 'url', 'local'])],
            'url' => ['required', 'string', 'max:2048'],
            'title' => ['nullable', 'string', 'max:255'],
        ]);

        $type = $validated['type'];
        $url = trim($validated['url']);

        // The shape of `url` depends on the type: a YouTube id is exactly
        // 11 chars, a direct link must be http(s), a local pick is just
        // the file name (the picture travels over PeerJS, not the server).
        $valid = match ($type) {
            'youtube' => (bool) preg_match('/^[A-Za-z0-9_-]{11}$/', $url),
            'url' => (bool) preg_match('/^https?:\/\//i', $url),
            'local' => $url !== '' && ! str_contains($url, '/') && ! str_contains($url, '\\'),
            default => false,
        };

        if (! $valid) {
            $message = match ($type) {
                'youtube' => 'That does not look like a YouTube video.',
                'url' => 'That does not look like a direct video link.',
                default => 'That does not look like a file name.',
            };

            if ($request->expectsJson()) {
                return response()->json(['message' => $message], 422);
            }

            return back()->withErrors(['url' => $message])->withInput();
        }

        $media = $room->media()->create([
            'shared_by' => Auth::id(),
            'type' => $type,
            'url' => $url,
            'title' => $validated['title'] ?? null,
        ]);

        if ($request->expectsJson()) {
            return response()->json([
                'id' => $media->id,
                'type' => $media->type,
                'url' => $media->url,
                'title' => $media->title,
                'shared_by' => Auth::user()->name,
                'created_at' => $media->created_at->toIso8601String(),
            ], 201);
        }

        return redirect()
            ->route('rooms.show', ['code' => $room->code])
            ->with('status', 'Video shared to the room.');
    }
}
