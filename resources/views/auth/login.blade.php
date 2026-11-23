@extends('layouts.app')

@section('title', 'Log in — Cinema for Two')

@section('content')
    <div class="max-w-md mx-auto mt-8">
        <h1 class="font-display text-3xl">Welcome back</h1>
        <p class="text-textSecondary text-sm mt-2">Log in to your rooms.</p>

        <form method="POST" action="{{ route('login') }}" class="mt-6 bg-card border border-hairline rounded-[10px] p-5 space-y-4">
            @csrf
            <div>
                <label for="email" class="block text-sm text-textSecondary mb-1.5">Email</label>
                <input id="email" name="email" type="email" required autofocus value="{{ old('email') }}"
                    class="w-full h-10 px-3 rounded-md bg-control border border-hairline text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-primary">
            </div>
            <div>
                <label for="password" class="block text-sm text-textSecondary mb-1.5">Password</label>
                <input id="password" name="password" type="password" required
                    class="w-full h-10 px-3 rounded-md bg-control border border-hairline text-textPrimary focus:outline-none focus:border-primary">
            </div>
            <label class="flex items-center gap-2 text-sm text-textSecondary">
                <input type="checkbox" name="remember" class="accent-[#E5A93C]"> Remember me
            </label>
            <button type="submit" class="w-full h-10 rounded-md bg-primary text-canvas text-sm font-medium">Log in</button>
        </form>

        <p class="text-sm text-textSecondary mt-4 text-center">
            No account yet? <a href="{{ route('register') }}" class="text-primary">Create one</a>
        </p>
    </div>
@endsection
