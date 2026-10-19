import { useState, type FormEvent } from 'react';
import { getSupabase } from '../net/auth.ts';
import { client } from '../net/client.ts';
import { useGame } from '../state.ts';
import { StatusBadge } from '../ui/StatusBadge.tsx';

export function LoginScreen() {
  const status = useGame((s) => s.status);
  const authError = useGame((s) => s.authError);
  const supabase = getSupabase();
  return (
    <div className="center-screen">
      <div className="card login">
        <h1>CreateYourCity</h1>
        <p className="muted">Prototype de gestion urbaine et de stratégie géopolitique multijoueur.</p>
        <StatusBadge />
        {authError && <p className="error-text">{authError}</p>}
        {supabase ? <SupabaseLogin disabled={status !== 'online'} /> : <DevLogin disabled={status !== 'online'} />}
      </div>
    </div>
  );
}

function DevLogin({ disabled }: { disabled: boolean }) {
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await client.act({ t: 'auth', devName: name.trim() });
    void client.request({ t: 'listLobbies' });
  };
  return (
    <form onSubmit={submit} className="stack">
      <p className="notice">
        Mode développement : identité invitée signée par le serveur (Supabase Auth non configuré).
      </p>
      <label>
        Nom de dirigeant
        <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={24} required autoFocus />
      </label>
      <button className="primary" disabled={disabled || name.trim().length < 2}>Entrer</button>
    </form>
  );
}

function SupabaseLogin({ disabled }: { disabled: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [message, setMessage] = useState<string | null>(null);
  const supabase = getSupabase()!;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const res =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    if (res.error) return setMessage(res.error.message);
    const token = res.data.session?.access_token;
    if (!token) return setMessage('Compte créé : confirmez votre adresse e-mail puis connectez-vous.');
    await client.act({ t: 'auth', token });
    void client.request({ t: 'listLobbies' });
  };

  return (
    <form onSubmit={submit} className="stack">
      <div className="tabs">
        <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Connexion</button>
        <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Créer un compte</button>
      </div>
      {mode === 'signup' && (
        <label>Nom de dirigeant<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={24} required /></label>
      )}
      <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></label>
      {message && <p className="error-text">{message}</p>}
      <button className="primary" disabled={disabled}>{mode === 'signin' ? 'Se connecter' : "S'inscrire"}</button>
    </form>
  );
}
