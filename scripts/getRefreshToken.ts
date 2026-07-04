/**
 * Local one-time OAuth2 PKCE helper to obtain an X (Twitter) refresh token.
 *
 * The interactive user-consent step cannot run in CI/agent environments, so run
 * this ONCE on your own machine, approve the app in the browser, and copy the
 * printed X_REFRESH_TOKEN into your secrets. The pipeline then auto-refreshes
 * the access token from it.
 *
 * Scopes: bookmark.read tweet.read users.read offline.access
 *   (offline.access is what makes X return a refresh_token.)
 *
 * Run: npm run auth
 * Requires env: X_CLIENT_ID  (+ X_CLIENT_SECRET for confidential apps)
 * Optional env: X_REDIRECT_URI (default http://127.0.0.1:8723/callback)
 *               X_SCOPES       (default the four scopes above)
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { URL } from 'node:url';

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const ME_URL = 'https://api.x.com/2/users/me';
const DEFAULT_REDIRECT = 'http://127.0.0.1:8723/callback';
const DEFAULT_SCOPES = 'bookmark.read tweet.read users.read offline.access';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fail(msg: string): never {
  process.stderr.write(`\n[auth] ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET; // optional (confidential clients)
  if (!clientId) fail('X_CLIENT_ID is required. Set it and re-run.');

  const redirectUri = process.env.X_REDIRECT_URI ?? DEFAULT_REDIRECT;
  const scopes = process.env.X_SCOPES ?? DEFAULT_SCOPES;
  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || '80');

  // PKCE + CSRF state.
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
  const state = b64url(randomBytes(16));

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return;
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== redirect.pathname) {
        res.writeHead(404).end('not found');
        return;
      }
      const err = u.searchParams.get('error');
      const returnedState = u.searchParams.get('state');
      const returnedCode = u.searchParams.get('code');
      if (err) {
        res.writeHead(400).end(`Authorization error: ${err}. You can close this tab.`);
        server.close();
        reject(new Error(`authorization returned error: ${err}`));
        return;
      }
      if (returnedState !== state) {
        res.writeHead(400).end('state mismatch (possible CSRF). You can close this tab.');
        server.close();
        reject(new Error('state mismatch'));
        return;
      }
      if (!returnedCode) {
        res.writeHead(400).end('no code in callback. You can close this tab.');
        server.close();
        reject(new Error('no code in callback'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(
        '認可が完了しました。ターミナルに戻って X_REFRESH_TOKEN を確認してください。このタブは閉じて構いません。',
      );
      server.close();
      resolve(returnedCode);
    });
    server.on('error', reject);
    server.listen(port, redirect.hostname, () => {
      process.stdout.write('\n=== X OAuth2 PKCE 認可 ===\n');
      process.stdout.write(`スコープ: ${scopes}\n`);
      process.stdout.write(`リダイレクト先: ${redirectUri} で待機中...\n\n`);
      process.stdout.write('次の URL をブラウザで開き、アプリを承認してください:\n\n');
      process.stdout.write(authUrl.toString() + '\n\n');
    });
  });

  // Exchange the authorization code for tokens.
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  if (clientSecret) headers['authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch(TOKEN_URL, { method: 'POST', headers, body: body.toString() });
  if (!tokenRes.ok) fail(`token exchange failed ${tokenRes.status}: ${await tokenRes.text()}`);
  const token = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number };

  if (!token.refresh_token) {
    fail('No refresh_token returned. Ensure "offline.access" is in the scopes and the app allows OAuth2.');
  }

  // Bonus: resolve the numeric user id for X_USER_ID.
  let userId = '(users.read scope で /2/users/me を確認してください)';
  try {
    const meRes = await fetch(ME_URL, { headers: { authorization: `Bearer ${token.access_token}` } });
    if (meRes.ok) {
      const me = (await meRes.json()) as { data?: { id?: string; username?: string } };
      if (me.data?.id) userId = `${me.data.id}${me.data.username ? ` (@${me.data.username})` : ''}`;
    }
  } catch {
    /* non-fatal */
  }

  process.stdout.write('\n=== 取得成功。以下を secret / .env に設定してください ===\n\n');
  process.stdout.write(`X_REFRESH_TOKEN=${token.refresh_token}\n`);
  process.stdout.write(`X_USER_ID=${userId}\n`);
  process.stdout.write(`\n(参考) 付与スコープ: ${token.scope ?? scopes}\n`);
  process.stdout.write('(参考) access_token は自動更新されるため保存不要です。\n');
}

main().catch((err) => {
  process.stderr.write('\n[auth] error: ' + (err as Error).message + '\n');
  process.exit(1);
});
