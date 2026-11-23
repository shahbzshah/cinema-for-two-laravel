<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RoomTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_user_can_create_room(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $response = $this->post('/rooms');

        $room = Room::first();
        $this->assertNotNull($room);
        $this->assertMatchesRegularExpression('/^[A-Z0-9]{6}$/', $room->code);
        $this->assertSame($user->id, $room->owner_id);
        $response->assertRedirect(route('rooms.show', ['code' => $room->code]));
    }

    public function test_room_codes_are_unique(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $codes = [];
        for ($i = 0; $i < 25; $i++) {
            $this->post('/rooms');
            $codes[] = Room::latest('id')->first()->code;
        }

        $this->assertCount(25, array_unique($codes));
    }

    public function test_room_page_shows_for_owner_and_for_partner(): void
    {
        $owner = User::factory()->create();
        $partner = User::factory()->create();
        $room = Room::create(['code' => 'ABC123', 'owner_id' => $owner->id]);

        $this->actingAs($owner)
            ->get(route('rooms.show', ['code' => 'ABC123']))
            ->assertOk()
            ->assertSee('ABC123');

        $this->actingAs($partner)
            ->get(route('rooms.show', ['code' => 'ABC123']))
            ->assertOk()
            ->assertSee('ABC123');
    }

    public function test_unknown_room_code_404s(): void
    {
        $this->actingAs(User::factory()->create())
            ->get(route('rooms.show', ['code' => 'NOPE99']))
            ->assertNotFound();
    }

    public function test_join_by_code_redirects_to_room(): void
    {
        $owner = User::factory()->create();
        $room = Room::create(['code' => 'XYZ789', 'owner_id' => $owner->id]);

        $this->actingAs(User::factory()->create())
            ->post(route('rooms.join'), ['code' => 'xyz789'])
            ->assertRedirect(route('rooms.show', ['code' => 'XYZ789']));
    }

    public function test_join_with_unknown_code_errors(): void
    {
        $this->actingAs(User::factory()->create())
            ->post(route('rooms.join'), ['code' => 'NOPE99'])
            ->assertSessionHasErrors('code');
    }

    public function test_rooms_index_lists_my_rooms(): void
    {
        $user = User::factory()->create();
        Room::create(['code' => 'ABC123', 'owner_id' => $user->id]);

        $this->actingAs($user)
            ->get(route('rooms.index'))
            ->assertOk()
            ->assertSee('ABC123');
    }
}
