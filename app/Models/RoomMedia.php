<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RoomMedia extends Model
{
    use HasFactory;

    protected $fillable = ['room_id', 'shared_by', 'type', 'url', 'title'];

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    public function sharer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'shared_by');
    }
}
