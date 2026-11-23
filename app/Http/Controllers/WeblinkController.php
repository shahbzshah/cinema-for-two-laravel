<?php

namespace App\Http\Controllers;

use App\Models\Room;
use App\Support\WeblinkUrl;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class WeblinkController extends Controller
{
    public function index(string $code): JsonResponse
    {
        $room = Room::where('code', strtoupper($code))->firstOrFail();

        $weblinks = $room->weblinks()->with('sharer:id,name')->latest()->limit(50)->get();

        return response()->json([
            'room' => $room->code,
            'weblinks' => $weblinks->map(fn ($link) => [
                'id' => $link->id,
                'url' => $link->url,
                'title' => $link->title,
                'shared_by' => $link->sharer?->name,
                'created_at' => $link->created_at->toIso8601String(),
            ]),
        ]);
    }

    public function store(string $code, Request $request): JsonResponse|RedirectResponse
    {
        $room = Room::where('code', strtoupper($code))->firstOrFail();

        $request->validate([
            'url' => ['required', 'string', 'max:2048'],
        ]);

        $url = WeblinkUrl::normalise($request->input('url'));

        if ($url === null) {
            if ($request->expectsJson()) {
                return response()->json(['message' => 'That does not look like a web address.'], 422);
            }

            return back()->withErrors(['url' => 'That does not look like a web address.'])->withInput();
        }

        $weblink = $room->weblinks()->create([
            'shared_by' => Auth::id(),
            'url' => $url,
            'title' => $request->input('title'),
        ]);

        if ($request->expectsJson()) {
            return response()->json([
                'id' => $weblink->id,
                'url' => $weblink->url,
                'shared_by' => Auth::user()->name,
                'created_at' => $weblink->created_at->toIso8601String(),
            ], 201);
        }

        return redirect()
            ->route('rooms.show', ['code' => $room->code, 'weblink' => $weblink->id])
            ->with('status', 'Link shared to the room.');
    }
}
