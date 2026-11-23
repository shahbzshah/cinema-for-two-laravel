@extends('layouts.app')

@section('title', 'Create account — Cinema for Two')

@section('content')
    <div class="max-w-md mx-auto mt-8">
        <h1 class="font-display text-3xl">Create your account</h1>
        <p class="text-textSecondary text-sm mt-2">One account, your rooms, your shared links.</p>

        <form method="POST" action="{{ route('register') }}" class="mt-6 bg-card border border-hairline rounded-[10px] p-5 space-y-4">
            @csrf
            <div>
                <label for="name" class="block text-sm text-textSecondary mb-1.5">Your name</label>
                <input id="name" name="name" type="text" required autofocus value="{{ old('name') }}"
                    class="w-full h-10 px-3 rounded-md bg-control border border-hairline text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-primary">
            </div>
            <div>
                <label for="email" class="block text-sm text-textSecondary mb-1.5">Email</label>
                <input id="email" name="email" type="email" required value="{{ old('email') }}"
                    class="w-full h-10 px-3 rounded-md bg-control border border-hairline text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-primary">
            </div>
            <div>
                <label for="password" class="block text-sm text-textSecondary mb-1.5">Password</label>
                <input id="password" name="password" type="password" required minlength="8"
                    class="w-full h-10 px-3 rounded-md bg-control border border-hairline text-textPrimary focus:outline-none focus:border-primary">
                <p class="text-xs text-textMuted mt-1">At least 8 characters.</p>
            </div>
            <div>
                <label for="password_confirmation" class="block text-sm text-textSecondary mb-1.5">Repeat password</label>
                <input id="password_confirmation" name="password_confirmation" type="password" required
                    class="w-full h-10 px-3 rounded-md bg-control border border-hairline text-textPrimary focus:outline-none focus:border-primary">
            </div>
            <button type="submit" class="w-full h-10 rounded-md bg-primary text-canvas text-sm font-medium">Create account</button>
        </form>

        <p class="text-sm text-textSecondary mt-4 text-center">
            Already have one? <a href="{{ route('login') }}" class="text-primary">Log in</a>
        </p>
    </div>
@endsection
