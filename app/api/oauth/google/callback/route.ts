import { prisma } from '@/app/prisma';
import { getGoogleCallbackUrl, jsonError, randomToken } from '@/lib/oauth';

export const runtime = 'nodejs';

function redirectWithError(request: Request, redirectUri: string, state: string | null, error: string) {
  const redirect = new URL(redirectUri);
  redirect.searchParams.set('error', error);
  if (state) redirect.searchParams.set('state', state);
  return Response.redirect(redirect);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const googleCode = url.searchParams.get('code');
  const googleState = url.searchParams.get('state');

  if (!googleState) return jsonError('invalid_request', 400);

  const oauthRequest = await prisma.oAuthRequest.findUnique({
    where: { state: googleState },
    include: { client: true },
  });

  if (!oauthRequest || oauthRequest.expiresAt < new Date()) {
    return jsonError('invalid_or_expired_state', 400);
  }

  if (!googleCode) {
    await prisma.oAuthRequest.delete({ where: { id: oauthRequest.id } });
    return redirectWithError(request, oauthRequest.redirectUri, oauthRequest.clientState, 'access_denied');
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: googleCode,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: getGoogleCallbackUrl(request),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) throw new Error('Google token exchange failed');

    const googleTokens = (await tokenResponse.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!googleTokens.access_token) throw new Error('Google did not return an access token');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${googleTokens.access_token}` },
    });

    if (!profileResponse.ok) throw new Error('Google userinfo request failed');

    const profile = (await profileResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!profile.sub || !profile.email) throw new Error('Google account has no usable email');

    const user = await prisma.user.upsert({
      where: { email: profile.email },
      update: {
        name: profile.name,
        image: profile.picture,
        emailVerified: profile.email_verified ? new Date() : null,
      },
      create: {
        email: profile.email,
        name: profile.name,
        image: profile.picture,
        emailVerified: profile.email_verified ? new Date() : null,
      },
    });

    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: profile.sub,
        },
      },
      update: {
        access_token: googleTokens.access_token,
        token_type: googleTokens.token_type,
        expires_at: googleTokens.expires_in
          ? Math.floor(Date.now() / 1000) + googleTokens.expires_in
          : null,
        scope: googleTokens.scope,
      },
      create: {
        userId: user.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: profile.sub,
        access_token: googleTokens.access_token,
        token_type: googleTokens.token_type,
        expires_at: googleTokens.expires_in
          ? Math.floor(Date.now() / 1000) + googleTokens.expires_in
          : null,
        scope: googleTokens.scope,
      },
    });

    const authorizationCode = randomToken(32);

    await prisma.$transaction([
      prisma.authCode.create({
        data: {
          code: authorizationCode,
          expiresAt: new Date(Date.now() + 60 * 1000),
          clientId: oauthRequest.clientId,
          userId: user.id,
          redirectUri: oauthRequest.redirectUri,
          codeChallenge: oauthRequest.codeChallenge,
          codeChallengeMethod: oauthRequest.codeChallengeMethod,
        },
      }),
      prisma.oAuthRequest.delete({ where: { id: oauthRequest.id } }),
    ]);

    const redirect = new URL(oauthRequest.redirectUri);
    redirect.searchParams.set('code', authorizationCode);
    if (oauthRequest.clientState) redirect.searchParams.set('state', oauthRequest.clientState);
    return Response.redirect(redirect);
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    return redirectWithError(request, oauthRequest.redirectUri, oauthRequest.clientState, 'server_error');
  }
}
