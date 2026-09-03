'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/dashboard/logo';

const REMEMBERED_USER_KEY = 'lausana-panel-user';

function LoginForm({
  displayName,
  logoDataUri,
  logoBackground,
  requireUser,
}: {
  displayName: string;
  logoDataUri: string;
  logoBackground: '' | 'dark';
  requireUser: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Recuerda el último usuario en este navegador (comodidad, no seguridad).
  useEffect(() => {
    if (!requireUser) return;
    try {
      const saved = localStorage.getItem(REMEMBERED_USER_KEY);
      if (saved) setUser(saved);
    } catch {
      /* localStorage puede fallar en modo privado — no pasa nada */
    }
  }, [requireUser]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Credenciales incorrectas.');
      }
      if (requireUser) {
        try {
          localStorage.setItem(REMEMBERED_USER_KEY, user);
        } catch {
          /* ignore */
        }
      }
      const from = searchParams.get('from');
      const destination = !from || from === '/' ? '/meta-ads' : from;
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        {logoDataUri ? (
          <div className="mb-5 flex justify-center">
            <Logo src={logoDataUri} alt={displayName || 'Logo'} background={logoBackground} className="max-h-16" />
          </div>
        ) : null}

        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{displayName || 'Lausana'}</p>
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">Panel de Reportes</h1>

        {requireUser && (
          <>
            <label htmlFor="login-user" className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Usuario
            </label>
            <Input
              id="login-user"
              type="text"
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoFocus
              className="mb-3 border-border bg-background text-foreground"
            />
          </>
        )}

        <label htmlFor="login-password" className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Contraseña
        </label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={!requireUser}
          className="mb-3 border-border bg-background text-foreground"
        />

        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <Button
          type="submit"
          disabled={loading || !password || (requireUser && !user)}
          className="w-full bg-[#53958B] text-white hover:bg-[#53958B]/90"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  );
}

export function LoginFormBoundary(props: { displayName: string; logoDataUri: string; logoBackground: '' | 'dark'; requireUser: boolean }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginForm {...props} />
    </Suspense>
  );
}
