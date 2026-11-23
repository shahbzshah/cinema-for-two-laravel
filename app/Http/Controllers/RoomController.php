<?php

namespace App\Http\Controllers;

use App\Models\Room;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

class RoomController extends Controller
{
    public function index(): View
    {
        $rooms = Auth::user()->rooms()->withCount('weblinks')->latest()->get();

        return view('rooms.index', ['rooms' => $rooms]);
    }

    public function create(): RedirectResponse
    {
        $room = Room::create([
            'code' => Room::generateCode(),
            'owner_id' => Auth::id(),
        ]);

        return redirect()->route('rooms.show', ['code' => $room->code])
            ->with('status', 'Room '.$room->code.' created. Share the code with your partner.');
    }

    public function join(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'size:6'],
        ]);

        $code = strtoupper(trim($validated['code']));

        $room = Room::where('code', $code)->first();

        if (! $room) {
            return back()->withErrors(['code' => 'No room with that code. Check it and try again.']);
        }

        return redirect()->route('rooms.show', ['code' => $room->code]);
    }

    public function show(string $code, Request $request): View
    {
        $room = Room::where('code', strtoupper($code))->firstOrFail();

        $weblinks = $room->weblinks()->with('sharer')->latest()->limit(50)->get();

        $current = null;
        if ($request->filled('weblink')) {
            $current = $weblinks->firstWhere('id', (int) $request->query('weblink'));
        }
        $current ??= $weblinks->first();

        return view('rooms.show', [
            'room' => $room,
            'weblinks' => $weblinks,
            'current' => $current,
        ]);
    }
}
