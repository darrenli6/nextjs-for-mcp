'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function GoogleSignIn() {
  const searchParams = useSearchParams();
  const state = searchParams.get('state');
  const clientName = searchParams.get('client_name') || 'MCP client';

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-2xl border border-red-400/30 bg-white/10 p-8 text-center shadow-2xl backdrop-blur">
          <h1 className="text-2xl font-semibold">Invalid authorization request</h1>
          <p className="mt-3 text-sm text-slate-300">
            This authorization request is missing its state or has expired. Please start the connection again from your MCP client.
          </p>
        </section>
      </main>
    );
  }

  const googleStartUrl = `/api/oauth/google/start?state=${encodeURIComponent(state)}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl font-bold text-slate-950">
            M
          </div>
          <h1 className="text-2xl font-semibold">Sign in to continue</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {clientName} is requesting access to this MCP server. Sign in with Google to authorize the connection.
          </p>
        </div>

        <a
          href={googleStartUrl}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 font-medium text-slate-900 transition hover:bg-slate-100"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
            <path fill="#4285F4" d="M21.35 12.27c0-.73-.07-1.43-.2-2.1H12v3.98h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.27Z" />
            <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.74 9.74 0 0 0 12 21.6Z" />
            <path fill="#FBBC05" d="M6.53 13.68A5.85 5.85 0 0 1 6.22 12c0-.58.1-1.15.31-1.68V7.79H3.28A9.7 9.7 0 0 0 2.25 12c0 1.52.36 2.96 1.03 4.21l3.25-2.53Z" />
            <path fill="#EA4335" d="M12 6.29c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.84 3.37 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.72 5.39l3.25 2.53C7.3 8.01 9.46 6.29 12 6.29Z" />
          </svg>
          Continue with Google
        </a>

        <p className="mt-6 text-center text-xs leading-5 text-slate-400">
          You will be redirected to Google&apos;s secure sign-in page.
        </p>
      </section>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
          Loading authorization…
        </main>
      }
    >
      <GoogleSignIn />
    </Suspense>
  );
}
