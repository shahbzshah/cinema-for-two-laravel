<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Room extends Model
{
    use HasFactory;

    protected $fillable = ['code', 'owner_id'];

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function weblinks(): HasMany
    {
        return $this->hasMany(Weblink::class)->orderByDesc('created_at');
    }

    public function media(): HasMany
    {
        return $this->hasMany(RoomMedia::class)->orderByDesc('created_at');
    }

    public function latestMedia(): ?RoomMedia
    {
        return $this->media()->first();
    }

    public function latestWeblink(): ?Weblink
    {
        return $this->weblinks()->first();
    }

    /**
     * Generate a 6-character room code (A-Z, 0-9), same alphabet as the
     * static app's room codes. Retries until the code is unused.
     */
    public static function generateCode(): string
    {
        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[random_int(0, 35)];
            }
        } while (static::where('code', $code)->exists());

        return $code;
    }
}
