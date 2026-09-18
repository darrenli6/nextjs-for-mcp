import { prisma } from '@/app/prisma';
import { getGoogleCallbackUrl, jsonError, randomToken } from '@/lib/oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const scope = url.searchParams.get('scope') ?? 'openid profile email';
  const clientState = url.searchParams.get('state');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');

  if (
    !clientId ||
    !redirectUri ||
    responseType !== 'code' ||
    !codeChallenge ||
    codeChallengeMethod !== 'S256'
  ) {
    return jsonError('invalid_request', 400);
  }

  const client = await prisma.client.findUnique({ where: { clientId } });

  if (!client || !client.redirectUris.includes(redirectUri)) {
    return jsonError('invalid_client_or_redirect_uri', 400);
  }

  const state = randomToken(32);

  await prisma.oAuthRequest.create({
    data: {
      state,
      clientId: client.id,
      redirectUri,
      clientState,
      scope,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
  googleUrl.searchParams.set('redirect_uri', getGoogleCallbackUrl(request));
  googleUrl.searchParams.set('response_type', 'code');
  googleUrl.searchParams.set('scope', 'openid profile email');
  googleUrl.searchParams.set('state', state);
  googleUrl.searchParams.set('access_type', 'online');
  googleUrl.searchParams.set('prompt', 'select_account');

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return jsonError('Google OAuth is not configured', 500);
  }

  return Response.redirect(googleUrl);
}
