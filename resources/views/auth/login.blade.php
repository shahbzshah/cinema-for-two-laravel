@extends('layouts.app')

@section('title', 'Log in — Cinema for Two')

@section('content')
    <div class="flex justify-center py-6 sm:py-10">
        <div class="w-full max-w-md bg-surface-card border border-hairline-border rounded-[10px] p-6 sm:p-9">
            <h1 class="font-headline-md text-headline-md italic text-text-primary tracking-tight">Welcome back</h1>
            <p class="text-text-secondary text-sm mt-2">Log in to your rooms.</p>

            <form method="POST" action="{{ route('login') }}" class="mt-6 space-y-4">
                @csrf
                <div>
                    <label for="email" class="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider mb-2">Email</label>
                    <input id="email" name="email" type="email" required autofocus value="{{ old('email') }}"
                        class="w-full h-10 px-4 rounded-[6px] bg-canvas-background border border-hairline-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container/70 transition">
                </div>
                <div>
                    <label for="password" class="block font-label-sm text-label-sm text-text-secondary uppercase tracking-wider mb-2">Password</label>
                    <input id="password" name="password" type="password" required
                        class="w-full h-10 px-4 rounded-[6px] bg-canvas-background border border-hairline-border text-text-primary focus:outline-none focus:border-primary-container/70 transition">
                </div>
                <label class="flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" name="remember" class="accent-[#E5A93C]"> Remember me
                </label>
                <button type="submit" class="w-full h-10 rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background text-sm font-semibold">Log in</button>
            </form>

            <p class="text-sm text-text-secondary mt-4 text-center">
                No account yet? <a href="{{ route('register') }}" class="text-primary-container">Create one</a>
            </p>
        </div>
    </div>
@endsection
