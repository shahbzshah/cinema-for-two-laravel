<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Cinema for Two')</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23161310'/%3E%3Cpath d='M26 20l18 12-18 12z' fill='%23E8A33D'/%3E%3C/svg%3E" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        // Design tokens from DESIGN.md (Stitch system), same as the static
        // app. Fonts are self-hosted under /fonts — no Google Fonts CDN
        // (Brave mobile blocks it).
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        'canvas-background': '#0C0C0E',
                        'surface-card': '#141417',
                        'surface-control': '#1C1C21',
                        'surface-variant': '#353437',
                        'hairline-border': 'rgba(255,255,255,0.08)',
                        'text-primary': '#F4F3EF',
                        'text-secondary': '#9A9891',
                        'text-muted': '#5E5D59',
                        'primary-container': '#E5A93C',
                        'primary': '#FFC665',
                        'presence-indicator': '#4ADE80',
                        'error': '#FFB4AB',
                        'error-container': '#93000A',
                    },
                    fontFamily: {
                        'display-lg': ['Newsreader', 'Georgia', 'serif'],
                        'headline-md': ['Newsreader', 'Georgia', 'serif'],
                        'title-sm': ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
                        'body-md': ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
                        'body-sm': ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
                        'label-sm': ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                        'label-md': ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                        'code-timecode': ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                        'sans': ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
                        'display': ['Newsreader', 'Georgia', 'serif'],
                        'mono': ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                    },
                    fontSize: {
                        'display-lg': ['36px', { lineHeight: '44px', letterSpacing: '-0.02em', fontWeight: '400' }],
                        'headline-md': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '400' }],
                        'title-sm': ['15px', { lineHeight: '22px', letterSpacing: '0em', fontWeight: '500' }],
                        'body-md': ['14px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '400' }],
                        'body-sm': ['13px', { lineHeight: '18px', letterSpacing: '0em', fontWeight: '400' }],
                        'label-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '400' }],
                        'label-md': ['13px', { lineHeight: '18px', letterSpacing: '0.04em', fontWeight: '500' }],
                        'code-timecode': ['12px', { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '500' }],
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
<body class="bg-canvas-background font-body-md text-text-primary antialiased selection:bg-primary selection:text-canvas-background min-h-screen">
    <header class="fixed top-0 left-0 right-0 z-50 bg-canvas-background border-b border-hairline-border">
        <div class="h-14 w-full px-4 md:px-10 flex items-center justify-between gap-4">
            <div class="flex items-center gap-4 min-w-0">
                <a href="{{ route('home') }}" class="flex items-center gap-2 shrink-0">
                    <svg class="w-6 h-6" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#161310"/><path d="M26 20l18 12-18 12z" fill="#E8A33D"/></svg>
                    <span class="font-headline-md text-headline-md italic tracking-tight text-text-primary hidden sm:inline-block">Cinema for Two</span>
                </a>
                @auth
                    <div class="h-4 w-px bg-hairline-border hidden sm:block shrink-0"></div>
                    <span class="hidden sm:flex items-center gap-1.5 font-label-sm text-label-sm text-text-muted shrink-0">YOU&nbsp;·&nbsp;<span class="text-text-secondary">{{ auth()->user()->name }}</span></span>
                @endauth
            </div>
            <nav class="flex items-center gap-4 text-sm shrink-0">
                @auth
                    <a href="{{ route('rooms.index') }}" class="text-text-secondary hover:text-text-primary">Rooms</a>
                    <form method="POST" action="{{ route('logout') }}" class="inline">
                        @csrf
                        <button type="submit" class="text-text-secondary hover:text-text-primary">Log out</button>
                    </form>
                @else
                    <a href="{{ route('login') }}" class="text-text-secondary hover:text-text-primary">Log in</a>
                    <a href="{{ route('register') }}" class="px-3 py-1.5 rounded-[6px] bg-primary-container hover:bg-primary text-canvas-background text-sm font-semibold">Create account</a>
                @endauth
            </nav>
        </div>
    </header>

    <main class="max-w-5xl mx-auto px-4 pt-20 pb-6">
        @if (session('status'))
            <div class="mb-4 rounded-[10px] border border-presence-indicator/45 bg-surface-card px-4 py-3 text-sm text-text-primary">{{ session('status') }}</div>
        @endif
        @if ($errors->any())
            <div class="mb-4 rounded-[10px] border border-error/40 bg-surface-card px-4 py-3 text-sm text-error">
                <ul class="list-disc list-inside">
                    @foreach ($errors->all() as $error)
                        <li>{{ $error }}</li>
                    @endforeach
                </ul>
            </div>
        @endif

        @yield('content')
    </main>

    <footer class="max-w-5xl mx-auto px-4 pb-8 text-xs text-text-muted">
        Cinema for Two — Private synchronous screening suite.
    </footer>

    @stack('scripts')
</body>
</html>
