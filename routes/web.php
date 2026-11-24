<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProxyController;
use App\Http\Controllers\RoomController;
use App\Http\Controllers\RoomMediaController;
use App\Http\Controllers\WeblinkController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    if (auth()->check()) {
        return redirect()->route('rooms.index');
    }

    return view('welcome');
})->name('home');

Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'showLogin'])->name('login');
    Route::post('/login', [AuthController::class, 'login']);
    Route::get('/register', [AuthController::class, 'showRegister'])->name('register');
    Route::post('/register', [AuthController::class, 'register']);
});

Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth')->name('logout');

Route::middleware('auth')->group(function () {
    Route::get('/rooms', [RoomController::class, 'index'])->name('rooms.index');
    Route::post('/rooms', [RoomController::class, 'create'])->name('rooms.create');
    Route::post('/rooms/join', [RoomController::class, 'join'])->name('rooms.join');
    Route::get('/rooms/{code}', [RoomController::class, 'show'])
        ->where('code', '[A-Za-z0-9]{6}')->name('rooms.show');
    Route::get('/rooms/{code}/weblinks', [WeblinkController::class, 'index'])
        ->where('code', '[A-Za-z0-9]{6}')->name('rooms.weblinks.index');
    Route::post('/rooms/{code}/weblinks', [WeblinkController::class, 'store'])
        ->where('code', '[A-Za-z0-9]{6}')->name('rooms.weblinks.store');
    Route::get('/rooms/{code}/media', [RoomMediaController::class, 'index'])
        ->where('code', '[A-Za-z0-9]{6}')->name('rooms.media.index');
    Route::post('/rooms/{code}/media', [RoomMediaController::class, 'store'])
        ->where('code', '[A-Za-z0-9]{6}')->name('rooms.media.store');
    Route::get('/proxy', [ProxyController::class, 'show'])->name('proxy');
});
