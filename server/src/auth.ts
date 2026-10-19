// Identité des joueurs. Mode « supabase » : vérification du JWT Supabase Auth (secret HS256 ou
// clés publiques JWKS du projet). Mode « dev » : identité invitée signée par le serveur,
// réservée au développement local et aux démonstrations.
import { randomBytes, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { ServerConfig } from './config.ts';

export interface PlayerIdentity { id: string; name: string }

export class AuthError extends Error {}

export class Authenticator {
  private readonly devKey: Uint8Array;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;

  constructor(private readonly cfg: ServerConfig) {
    if (cfg.authMode === 'dev' && !cfg.devAuthSecret) {
      console.warn('[auth] DEV_AUTH_SECRET absent : secret aléatoire, les jetons invités expireront au redémarrage.');
    }
    this.devKey = new TextEncoder().encode(cfg.devAuthSecret ?? randomBytes(32).toString('hex'));
    this.jwks =
      cfg.authMode === 'supabase' && !cfg.supabaseJwtSecret && cfg.supabaseUrl
        ? createRemoteJWKSet(new URL(`${cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`))
        : null;
  }

  get mode() { return this.cfg.authMode; }

  /** Crée une identité invitée (mode dev uniquement). */
  async createDevIdentity(name: string): Promise<{ player: PlayerIdentity; token: string }> {
    if (this.cfg.authMode !== 'dev') throw new AuthError('Connexion invité désactivée : utilisez votre compte.');
    const player = { id: `dev-${randomUUID()}`, name };
    const token = await new SignJWT({ name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(player.id)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(this.devKey);
    return { player, token };
  }

  async verify(token: string): Promise<PlayerIdentity> {
    try {
      if (this.cfg.authMode === 'dev') {
        const { payload } = await jwtVerify(token, this.devKey, { algorithms: ['HS256'] });
        return { id: requireSub(payload), name: String(payload.name ?? 'Invité') };
      }
      const options = { audience: 'authenticated', issuer: `${this.cfg.supabaseUrl}/auth/v1` };
      const { payload } = this.cfg.supabaseJwtSecret
        ? await jwtVerify(token, new TextEncoder().encode(this.cfg.supabaseJwtSecret), options)
        : await jwtVerify(token, this.jwks!, options);
      const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
      const email = typeof payload.email === 'string' ? payload.email : '';
      const name = String(meta.display_name ?? meta.name ?? email.split('@')[0] ?? 'Joueur').slice(0, 24);
      return { id: requireSub(payload), name };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError('Jeton invalide ou expiré.');
    }
  }
}

function requireSub(payload: JWTPayload): string {
  if (!payload.sub) throw new AuthError('Jeton sans identifiant.');
  return payload.sub;
}
