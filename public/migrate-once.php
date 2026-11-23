<?php

/*
|--------------------------------------------------------------------------
| One-time migration runner (InfinityFree — no shell access)
|--------------------------------------------------------------------------
|
| InfinityFree's free hosting has no shell and no artisan, so the
| database migrations cannot be run from a terminal. Visit this file
| once, right after the .env is in place:
|
|     https://<subdomain>/migrate-once.php?token=<MIGRATE_TOKEN>
|
| MIGRATE_TOKEN is a random string you put in .env for this one visit.
| The file runs `php artisan migrate --force` and prints the result.
|
| DELETE THIS FILE from the file manager immediately after it reports
| success. It must never stay on a live server: anyone who can guess
| the token could re-run migrations.
|
| Wrong or missing token -> 403. No MIGRATE_TOKEN in .env -> 403.
*/

require __DIR__.'/../vendor/autoload.php';

$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$given = (string) ($_GET['token'] ?? '');
$expected = (string) env('MIGRATE_TOKEN', '');

if ($expected === '' || $given === '' || ! hash_equals($expected, $given)) {
    http_response_code(403);
    echo "Forbidden.\n";
    exit;
}

try {
    $code = Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);
    echo Illuminate\Support\Facades\Artisan::output();
    echo $code === 0 ? "Migrations OK — now DELETE this file.\n" : "Migrate exited with code {$code}.\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo 'Migration failed: '.$e->getMessage()."\n";
}
