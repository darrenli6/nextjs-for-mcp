import { prisma } from '@/app/prisma';
import { getGoogleCallbackUrl, jsonError } from '@/lib/oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get('state');

  if (!state) return jsonError('invalid_request', 400);

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return jsonError('Google OAuth is not configured', 500);
  }

  const oauthRequest = await prisma.oAuthRequest.findUnique({
    where: { state },
  });

  if (!oauthRequest || oauthRequest.expiresAt < new Date()) {
    return jsonError('invalid_or_expired_state', 400);
  }

  const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  googleUrl.searchParams.set('redirect_uri', getGoogleCallbackUrl(request));
  googleUrl.searchParams.set('response_type', 'code');
  googleUrl.searchParams.set('scope', 'openid profile email');
  googleUrl.searchParams.set('state', state);
  googleUrl.searchParams.set('access_type', 'online');
  googleUrl.searchParams.set('prompt', 'select_account');

  return Response.redirect(googleUrl);
}
