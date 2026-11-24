<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\RoomMedia;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RoomMediaTest extends TestCase
{
    use RefreshDatabase;

    private function room(string $code = 'ABC123'): Room
    {
        return Room::create(['code' => $code, 'owner_id' => User::factory()->create()->id]);
    }

    public function test_store_youtube_media(): void
    {
        $this->room();
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->postJson(route('rooms.media.store', ['code' => 'ABC123']), [
                'type' => 'youtube',
                'url' => 'aqz-KE-bpKQ',
                'title' => 'Big Buck Bunny',
            ]);

        $response->assertCreated()->assertJsonPath('type', 'youtube')->assertJsonPath('url', 'aqz-KE-bpKQ');
        $this->assertDatabaseHas('room_media', ['url' => 'aqz-KE-bpKQ', 'type' => 'youtube', 'shared_by' => $user->id]);
    }

    public function test_store_direct_link_media(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.media.store', ['code' => 'ABC123']), [
                'type' => 'url',
                'url' => 'https://example.org/film.mp4',
            ]);

        $response->assertCreated()->assertJsonPath('type', 'url');
    }

    public function test_store_local_file_media(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.media.store', ['code' => 'ABC123']), [
                'type' => 'local',
                'url' => 'film.mp4',
                'title' => 'film.mp4',
            ]);

        $response->assertCreated()->assertJsonPath('type', 'local')->assertJsonPath('url', 'film.mp4');
    }

    public function test_store_rejects_bad_youtube_id(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.media.store', ['code' => 'ABC123']), [
                'type' => 'youtube',
                'url' => 'not-an-id',
            ]);

        $response->assertStatus(422);
        $this->assertDatabaseCount('room_media', 0);
    }

    public function test_store_rejects_non_http_direct_link(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.media.store', ['code' => 'ABC123']), [
                'type' => 'url',
                'url' => 'ftp://example.org/film.mp4',
            ]);

        $response->assertStatus(422);
        $this->assertDatabaseCount('room_media', 0);
    }

    public function test_store_rejects_local_path_with_slashes(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.media.store', ['code' => 'ABC123']), [
                'type' => 'local',
                'url' => '../secret.mp4',
            ]);

        $response->assertStatus(422);
        $this->assertDatabaseCount('room_media', 0);
    }

    public function test_store_rejects_unknown_type(): void
    {
        $this->room();

        $response = $this->actingAs(User::factory()->create())
            ->postJson(route('rooms.media.store', ['code' => 'ABC123']), [
                'type' => 'camera',
                'url' => 'x',
            ]);

        $response->assertStatus(422);
        $this->assertDatabaseCount('room_media', 0);
    }

    public function test_index_returns_latest_first_and_only_this_room(): void
    {
        $room = $this->room();
        $other = $this->room('DEF456');
        $user = User::factory()->create();
        RoomMedia::create(['room_id' => $room->id, 'shared_by' => $user->id, 'type' => 'url', 'url' => 'https://example.org/old.mp4']);
        RoomMedia::create(['room_id' => $room->id, 'shared_by' => $user->id, 'type' => 'youtube', 'url' => 'aqz-KE-bpKQ']);
        RoomMedia::create(['room_id' => $other->id, 'shared_by' => $user->id, 'type' => 'url', 'url' => 'https://example.org/other.mp4']);

        $response = $this->actingAs($user)->getJson(route('rooms.media.index', ['code' => 'ABC123']));

        $response->assertOk();
        $media = $response->json('media');
        $this->assertCount(2, $media);
        $this->assertSame('youtube', $media[0]['type']);
        $this->assertSame('aqz-KE-bpKQ', $media[0]['url']);
    }

    public function test_guests_cannot_list_or_store_media(): void
    {
        $this->room();

        $this->getJson(route('rooms.media.index', ['code' => 'ABC123']))->assertUnauthorized();
        $this->postJson(route('rooms.media.store', ['code' => 'ABC123']), ['type' => 'url', 'url' => 'https://example.org/film.mp4'])
            ->assertUnauthorized();
    }

    public function test_show_passes_current_media_to_the_room_page(): void
    {
        $room = $this->room();
        $user = User::factory()->create();
        RoomMedia::create(['room_id' => $room->id, 'shared_by' => $user->id, 'type' => 'youtube', 'url' => 'aqz-KE-bpKQ', 'title' => 'Big Buck Bunny']);

        $response = $this->actingAs($user)->get(route('rooms.show', ['code' => 'ABC123']));

        $response->assertOk();
        $response->assertViewHas('currentMedia', fn ($media) => $media->url === 'aqz-KE-bpKQ');
        $response->assertSee('Watch together');
        $response->assertSee('data-current-media-url="aqz-KE-bpKQ"', false);
    }

    public function test_show_without_media_renders_empty_theater(): void
    {
        $this->room();
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get(route('rooms.show', ['code' => 'ABC123']));

        $response->assertOk();
        $response->assertViewHas('currentMedia', null);
        $response->assertSee('No video yet');
    }
}
