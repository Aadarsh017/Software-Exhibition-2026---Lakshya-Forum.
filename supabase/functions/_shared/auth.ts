// Who is calling. The browser sends the user's access token (a JWT) as "Authorization: Bearer …".
//
// Tokens signed with the project's asymmetric signing keys (ES256 or RS256) are checked here with
// the public keys from the project's JWKS endpoint, which is fast and needs no shared secret.
// Anything else (for example legacy HS256 tokens) is checked by asking Supabase Auth directly.
// Either way the token must be a signed-in user's (role "authenticated"), not a key or the service role.
import { AppError } from "./errors.ts";
import type { AuthUser, Fetch } from "./types.ts";

export type VerifyToken = (token: string) => Promise<AuthUser>;

const unauthenticated = () => new AppError("unauthenticated", "Please sign in again.");

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!match) throw unauthenticated();
  return match[1];
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodePart(part: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw unauthenticated();
}

type Jwk = JsonWebKey & { kid?: string; alg?: string };

const ALGORITHMS: Record<string, { importParams: RsaHashedImportParams | EcKeyImportParams; verifyParams: AlgorithmIdentifier | EcdsaParams }> = {
  ES256: { importParams: { name: "ECDSA", namedCurve: "P-256" }, verifyParams: { name: "ECDSA", hash: "SHA-256" } },
  RS256: { importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verifyParams: { name: "RSASSA-PKCS1-v1_5" } },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createTokenVerifier(options: {
  supabaseUrl: string;
  publishableKey: string;
  fetch: Fetch;
  now?: () => number;
  jwksTtlMs?: number;
}): VerifyToken {
  const now = options.now ?? Date.now;
  const ttl = options.jwksTtlMs ?? 10 * 60_000;
  const issuer = `${options.supabaseUrl}/auth/v1`;
  let jwks: { keys: Jwk[]; fetchedAt: number } | null = null;
  let lastForced = Number.NEGATIVE_INFINITY;
  const imported = new Map<string, CryptoKey>();

  async function loadJwks(force: boolean): Promise<Jwk[]> {
    if (!force && jwks && now() - jwks.fetchedAt < ttl) return jwks.keys;
    const response = await options.fetch(`${issuer}/.well-known/jwks.json`, {
      headers: { apikey: options.publishableKey },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`jwks_${response.status}`);
    const body = (await response.json()) as { keys?: Jwk[] };
    jwks = { keys: Array.isArray(body.keys) ? body.keys : [], fetchedAt: now() };
    imported.clear();
    return jwks.keys;
  }

  async function keyFor(kid: string, alg: string): Promise<CryptoKey | null> {
    const cached = imported.get(`${alg}:${kid}`);
    if (cached) return cached;
    let keys = await loadJwks(false);
    let jwk = keys.find((key) => key.kid === kid);
    // Keys may have been rotated since the last fetch. Refetch at most every 30 seconds, so tokens with made-up key
    // ids can't make every request fetch the key list again.
    if (!jwk && now() - lastForced >= 30_000) {
      lastForced = now();
      keys = await loadJwks(true);
      jwk = keys.find((key) => key.kid === kid);
    }
    if (!jwk) return null;
    const { kid: _kid, alg: _alg, key_ops: _ops, ...material } = jwk;
    const key = await crypto.subtle.importKey("jwk", material, ALGORITHMS[alg].importParams, false, ["verify"]);
    imported.set(`${alg}:${kid}`, key);
    return key;
  }

  function checkClaims(claims: Record<string, unknown>): AuthUser {
    const exp = Number(claims.exp);
    if (!Number.isFinite(exp) || exp * 1000 <= now()) throw unauthenticated();
    if (claims.role !== "authenticated") throw unauthenticated();
    const aud = claims.aud;
    if (!(aud === "authenticated" || (Array.isArray(aud) && aud.includes("authenticated")))) throw unauthenticated();
    if (claims.iss !== undefined && claims.iss !== issuer) throw unauthenticated();
    if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) throw unauthenticated();
    return { id: claims.sub, isAnonymous: claims.is_anonymous === true };
  }

  async function askAuthServer(token: string): Promise<AuthUser> {
    const response = await options.fetch(`${issuer}/user`, {
      headers: { apikey: options.publishableKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw unauthenticated();
    const user = (await response.json()) as { id?: unknown; is_anonymous?: unknown; role?: unknown };
    if (typeof user.id !== "string" || !UUID.test(user.id)) throw unauthenticated();
    if (user.role !== undefined && user.role !== "authenticated") throw unauthenticated();
    return { id: user.id, isAnonymous: user.is_anonymous === true };
  }

  return async function verify(token: string): Promise<AuthUser> {
    const parts = token.split(".");
    if (parts.length !== 3) throw unauthenticated();
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    const alg = typeof header.alg === "string" ? header.alg : "";
    const kid = typeof header.kid === "string" ? header.kid : "";

    if (ALGORITHMS[alg] && kid) {
      let key: CryptoKey | null = null;
      try {
        key = await keyFor(kid, alg);
      } catch {
        key = null; // JWKS unreachable: let Auth decide below
      }
      if (key) {
        const valid = await crypto.subtle.verify(
          ALGORITHMS[alg].verifyParams,
          key,
          base64UrlToBytes(parts[2]),
          new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        );
        if (!valid) throw unauthenticated();
        return checkClaims(claims);
      }
    }
    checkClaims(claims); // cheap early rejection of expired or non-user tokens
    const user = await askAuthServer(token);
    if (user.id !== claims.sub) throw unauthenticated();
    return user;
  };
}
