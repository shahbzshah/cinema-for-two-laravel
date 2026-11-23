@extends('layouts.app')

@section('title', 'Create account — Cinema for Two')

@section('content')
    <div class="flex justify-center py-6 sm:py-10">
        <div class="w-full max-w-md bg-surface-card border border-hairline-border rounded-[10px] p-6 sm:p-9">
            <h1 class="font-headline-md text-headline-md italic text-text-primary tracking-tight">Create your account</h1>
            <p class="text-text-secondary text-sm mt-2">One account, your rooms, your shared links.</p>

            <form method="POST" action="{{ route('register') }}" class="mt-6 space-y-4">
                @csrf
                <div>
                    <label for="name" class="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider mb-2">Your name</label>
                    <input id="name" name="name" type="text" required autofocus value="{{ old('name') }}"
                        class="w-full h-10 px-4 rounded-[6px] bg-canvas-background border border-hairline-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container/70 transition">
                </div>
                <div>
                    <label for="email" class="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider mb-2">Email</label>
                    <input id="email" name="email" type="email" required value="{{ old('email') }}"
                        class="w-full h-10 px-4 rounded-[6px] bg-canvas-background border border-hairline-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container/70 transition">
                </div>
                <div>
                    <label for="password" class="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider mb-2">Password</label>
                    <input id="password" name="password" type="password" required minlength="8"
                        class="w-full h-10 px-4 rounded-[6px] bg-canvas-background border border-hairline-border text-text-primary focus:outline-none focus:border-primary-container/70 transition">
                    <p class="text-[11px] text-text-muted mt-2 leading-relaxed">At least 8 characters.</p>
                </div>
                <div>
                    <label for="password_confirmation" class="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider mb-2">Repeat password</label>
                    <input id="password_confirmation" name="password_confirmation" type="password" required
                        class="w-full h-10 px-4 rounded-[6px] bg-canvas-background border border-hairline-border text-text-primary focus:outline-none focus:border-primary-container/70 transition">
                </div>
                <button type="submit" class="w-full h-10 rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background text-sm font-semibold">Create account</button>
            </form>

            <p class="text-sm text-text-secondary mt-4 text-center">
                Already have one? <a href="{{ route('login') }}" class="text-primary-container">Log in</a>
            </p>
        </div>
    </div>
@endsection
