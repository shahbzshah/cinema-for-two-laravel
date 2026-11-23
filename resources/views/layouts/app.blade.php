<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Cinema for Two')</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        canvas: '#0C0C0E',
                        card: '#141417',
                        control: '#1C1C21',
                        hairline: 'rgba(255,255,255,0.08)',
                        textPrimary: '#F4F3EF',
                        textSecondary: '#9A9891',
                        textMuted: '#5E5D59',
                        primary: '#E5A93C',
                        presence: '#4ADE80',
                        errorText: '#FFB4AB',
                    },
                    fontFamily: {
                        display: ['Newsreader', 'Georgia', 'serif'],
                        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
                        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                    },
                },
            },
        };
    </script>
    <style>
        @font-face { font-family: 'Newsreader'; src: url('/fonts/newsreader-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
        @font-face { font-family: 'Newsreader'; src: url('/fonts/newsreader-400-italic.woff2') format('woff2'); font-weight: 400; font-style: italic; font-display: swap; }
        @font-face { font-family: 'Plus Jakarta Sans'; src: url('/fonts/jakarta-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
        @font-face { font-family: 'Plus Jakarta Sans'; src: url('/fonts/jakarta-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
        @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/jetbrains-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
        @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/jetbrains-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
        body { background: #0C0C0E; }
    </style>
    @stack('head')
</head>
<body class="bg-canvas text-textPrimary font-sans min-h-screen antialiased">
    <header class="border-b border-hairline">
        <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
            <a href="{{ route('home') }}" class="font-display text-xl tracking-tight text-textPrimary">Cinema for Two</a>
            <nav class="flex items-center gap-4 text-sm">
                @auth
                    <a href="{{ route('rooms.index') }}" class="text-textSecondary hover:text-textPrimary">Rooms</a>
                    <span class="text-textMuted hidden sm:inline">{{ auth()->user()->name }}</span>
                    <form method="POST" action="{{ route('logout') }}" class="inline">
                        @csrf
                        <button type="submit" class="text-textSecondary hover:text-textPrimary">Log out</button>
                    </form>
                @else
                    <a href="{{ route('login') }}" class="text-textSecondary hover:text-textPrimary">Log in</a>
                    <a href="{{ route('register') }}" class="px-3 py-1.5 rounded-md bg-primary text-canvas text-sm font-medium">Create account</a>
                @endauth
            </nav>
        </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 py-6">
        @if (session('status'))
            <div class="mb-4 rounded-[10px] border border-presence/40 bg-card px-4 py-3 text-sm text-textPrimary">{{ session('status') }}</div>
        @endif
        @if ($errors->any())
            <div class="mb-4 rounded-[10px] border border-errorText/40 bg-card px-4 py-3 text-sm text-errorText">
                <ul class="list-disc list-inside">
                    @foreach ($errors->all() as $error)
                        <li>{{ $error }}</li>
                    @endforeach
                </ul>
            </div>
        @endif

        @yield('content')
    </main>

    <footer class="max-w-5xl mx-auto px-4 pb-8 text-xs text-textMuted">
        Cinema for Two — watch together, two people, one room.
    </footer>

    @stack('scripts')
</body>
</html>
