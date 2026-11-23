<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WeblinkTest extends TestCase
{
    use RefreshDatabase;

    private function room(): Room
    {
        return Room::create(['code' => 'ABC123', 'owner_id' => User::factory()->create()->id]);
    }

    public function test_store_valid_url(): void
    {
        $this->room();
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->postJson(route('rooms.weblinks.store', ['code' => 'ABC123']), ['url' => 'https://example.com/page']);

        $response->assertCreated()->assertJsonPath('url', 'https://example.com/page');
        $this->assertDatabaseHas('weblinks', ['url' => 'https://example.com/page', 'shared_by' => $user->id]);
    }

    public function test_store_adds_https_when_scheme_missing(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.weblinks.store', ['code' => 'ABC123']), ['url' => 'example.com']);

        $response->assertCreated()->assertJsonPath('url', 'https://example.com');
    }

    public function test_store_rejects_javascript_scheme(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.weblinks.store', ['code' => 'ABC123']), ['url' => 'javascript:alert(1)']);

        $response->assertStatus(422);
        $this->assertDatabaseCount('weblinks', 0);
    }

    public function test_store_rejects_garbage(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.weblinks.store', ['code' => 'ABC123']), ['url' => 'not a url at all']);

        $response->assertStatus(422);
        $this->assertDatabaseCount('weblinks', 0);
    }

    public function test_store_rejects_scheme_less_host_without_dot(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.weblinks.store', ['code' => 'ABC123']), ['url' => 'localhost']);

        $response->assertStatus(422);
    }

    public function test_list_returns_room_links_newest_first(): void
    {
        $room = $this->room();
        $user = User::factory()->create();
        $room->weblinks()->create(['shared_by' => $user->id, 'url' => 'https://first.example']);
        $room->weblinks()->create(['shared_by' => $user->id, 'url' => 'https://second.example']);

        $response = $this->actingAs($user)
            ->getJson(route('rooms.weblinks.index', ['code' => 'ABC123']));

        $response->assertOk();
        $urls = collect($response->json('weblinks'))->pluck('url')->all();
        $this->assertSame(['https://second.example', 'https://first.example'], $urls);
    }

    public function test_guests_cannot_store_or_list(): void
    {
        $this->room();

        $this->postJson(route('rooms.weblinks.store', ['code' => 'ABC123']), ['url' => 'https://example.com'])
            ->assertUnauthorized();
        $this->getJson(route('rooms.weblinks.index', ['code' => 'ABC123']))
            ->assertUnauthorized();
    }

    public function test_store_on_unknown_room_404s(): void
    {
        $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.weblinks.store', ['code' => 'NOPE99']), ['url' => 'https://example.com'])
            ->assertNotFound();
    }

    public function test_room_page_shows_latest_link_in_viewer(): void
    {
        $room = $this->room();
        $user = User::factory()->create();
        $room->weblinks()->create(['shared_by' => $user->id, 'url' => 'https://example.com/watch']);

        $this->actingAs($user)
            ->get(route('rooms.show', ['code' => 'ABC123']))
            ->assertOk()
            ->assertSee('https://example.com/watch')
            ->assertSee('id="webViewer"', false);
    }
}
