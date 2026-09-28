// Spotify Authorization Code flow with PKCE — runs entirely in the browser, no client secret.
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
// Library for the rack; the rest is what the Web Playback SDK needs to play in the browser.
const SCOPES = 'user-library-read streaming user-read-email user-read-private user-modify-playback-state';
const CALLBACK_PATH = '/callback';

const TOKEN_KEY = 'spotify:token';
const VERIFIER_KEY = 'spotify:verifier';
const STATE_KEY = 'spotify:state';

type Token = { accessToken: string; refreshToken: string; expiresAt: number; scope?: string };

const redirectUri = () => `${location.origin}${CALLBACK_PATH}`;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const randomString = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

function readToken(): Token | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Token) : null;
  } catch {
    return null;
  }
}

export const isSignedIn = () => readToken() !== null;

/** False for sessions signed in before playback was added — those need to sign in again. */
export function hasAllScopes() {
  const granted = readToken()?.scope?.split(' ') ?? [];
  return SCOPES.split(' ').every((scope) => granted.includes(scope));
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login() {
  if (!CLIENT_ID) throw new Error('Missing VITE_SPOTIFY_CLIENT_ID — see README.');

  const verifier = randomString(64);
  const state = randomString(16);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: base64url(new Uint8Array(digest)),
    state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

/** Finishes sign-in when Spotify redirects back to /callback. No-op on any other path. */
export async function completeLogin() {
  const url = new URL(location.href);
  if (url.pathname !== CALLBACK_PATH) return;
  history.replaceState(null, '', '/');

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  const error = url.searchParams.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Sign-in was cancelled.' : `Spotify error: ${error}`);

  const code = url.searchParams.get('code');
  if (!code || !verifier || url.searchParams.get('state') !== expectedState) {
    throw new Error('Sign-in failed. Please try again.');
  }

  await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
}

async function requestToken(body: Record<string, string>): Promise<Token> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}).`);

  const data = await res.json();
  const token: Token = {
    accessToken: data.access_token,
    // Spotify may or may not rotate the refresh token; keep the old one if not.
    refreshToken: data.refresh_token ?? readToken()?.refreshToken ?? '',
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? readToken()?.scope,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  return token;
}

let refreshing: Promise<Token | null> | null = null;

function refresh(refreshToken: string): Promise<Token | null> {
  refreshing ??= requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
    .catch(() => {
      logout();
      return null;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/** Returns a valid access token, refreshing it if needed. Null means the user must sign in again. */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const token = readToken();
  if (!token) return null;
  if (!forceRefresh && token.expiresAt - 60_000 > Date.now()) return token.accessToken;
  return (await refresh(token.refreshToken))?.accessToken ?? null;
}
