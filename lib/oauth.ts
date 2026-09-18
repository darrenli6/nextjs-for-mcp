import { createHash, randomBytes } from 'node:crypto';

export function getAppUrl(request?: Request) {
  const configuredUrl = process.env.APP_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');
  return request ? new URL(request.url).origin : '';
}

export function getGoogleCallbackUrl(request?: Request) {
  return `${getAppUrl(request)}/api/oauth/google/callback`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    },
  );
}

export function withCors(response: Response) {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return response;
}

export function verifyPkce(codeVerifier: string, challenge: string, method: string) {
  if (method !== 'S256') return false;
  const digest = createHash('sha256').update(codeVerifier).digest();
  return digest.toString('base64url') === challenge;
}
