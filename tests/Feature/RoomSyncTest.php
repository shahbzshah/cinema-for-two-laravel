<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Synced browsing (Phase 2) — the room page side of the /proxy flow.
 *
 * Server-side, what can be asserted is the page the browser gets:
 * the toggle exists and is off by default, the proxy URL is exposed
 * for the mount code, the iframe sandbox no longer allows pop-ups,
 * and the sync helpers load before room.js. The live behaviour
 * (mount through /proxy, scroll in, scroll out, link tap) is covered
 * by the headless-browser harness, not here.
 */
class RoomSyncTest extends TestCase
{
    use RefreshDatabase;

    private function roomPage(): \Illuminate\Testing\TestResponse
    {
        $user = User::factory()->create();
        $room = Room::create(['code' => 'ABC123', 'owner_id' => $user->id]);

        return $this->actingAs($user)->get(route('rooms.show', ['code' => 'ABC123']));
    }

    public function test_room_page_shows_the_synced_browsing_toggle_off_by_default(): void
    {
        $this->roomPage()
            ->assertOk()
            ->assertSee('id="webSyncToggle"', false)
            ->assertSee('Browse together (synced)')
            ->assertSee('data-proxy-url="/proxy"', false);
    }

    public function test_room_page_iframe_sandbox_has_no_popups(): void
    {
        $response = $this->roomPage()->assertOk();

        $response->assertDontSee('allow-popups', false);
        $response->assertSee('sandbox="allow-scripts allow-same-origin allow-forms"', false);
    }

    public function test_room_page_loads_the_sync_helpers_before_room_js(): void
    {
        $content = $this->roomPage()->assertOk()->getContent();

        $syncPos = strpos($content, 'js/room-sync.js');
        $roomPos = strpos($content, 'js/room.js');

        $this->assertNotFalse($syncPos, 'room-sync.js must be loaded');
        $this->assertNotFalse($roomPos, 'room.js must be loaded');
        $this->assertLessThan($roomPos, $syncPos, 'room-sync.js must load before room.js');
    }

    public function test_guests_cannot_see_the_room_page_or_the_toggle(): void
    {
        $owner = User::factory()->create();
        Room::create(['code' => 'ABC123', 'owner_id' => $owner->id]);

        $this->get(route('rooms.show', ['code' => 'ABC123']))->assertRedirect(route('login'));
    }
}
