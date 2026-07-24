import crypto from 'crypto';

export type OAuthProviderSlug = 'google' | 'meta' | 'tiktok';

const STATE_TTL_MS = 10 * 60 * 1000;

function stateSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET must be set in environment');
  return secret;
}

/**
 * OAuth callbacks are the only unauthenticated integration routes, so the
 * `state` param carries an HMAC-signed, short-lived payload instead of a JWT
 * (the app JWT payload shape is reserved for user sessions).
 */
export function createOAuthState(provider: OAuthProviderSlug, projectId?: string): string {
  const payload = JSON.stringify({
    provider,
    projectId,
    nonce: crypto.randomBytes(8).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  });
  const body = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string, provider: OAuthProviderSlug): { valid: boolean; projectId?: string } {
  const [body, sig] = state.split('.');
  if (!body || !sig) return { valid: false };

  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      provider?: string;
      projectId?: string;
      exp?: number;
    };
    const valid = payload.provider === provider && typeof payload.exp === 'number' && payload.exp > Date.now();
    return { valid, projectId: payload.projectId };
  } catch {
    return { valid: false };
  }
}

/**
 * All providers share one redirect-URI base: GOOGLE_OAUTH_REDIRECT_URI with the
 * provider segment swapped (e.g. .../integrations/meta/callback). Register each
 * resulting URL in the respective developer console.
 */
export function redirectUriFor(provider: OAuthProviderSlug): string {
  const base =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'http://localhost:3010/integrations/google/callback';
  return base.replace('/google/', `/${provider}/`);
}
