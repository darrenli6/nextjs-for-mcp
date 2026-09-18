import { prisma } from '@/app/prisma';
import { getAppUrl, jsonError, randomToken } from '@/lib/oauth';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieStore = await cookies();
  const savedState = cookieStore.get('google_oauth_state')?.value;

  if (!code || !state || !savedState || state !== savedState) {
    return jsonError('Invalid or expired Google login state', 400);
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: `${getAppUrl(request)}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) throw new Error('Google token exchange failed');

    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!tokens.access_token) throw new Error('Google did not return an access token');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
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
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: profile.sub } },
      update: {
        userId: user.id,
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null,
        scope: tokens.scope,
      },
      create: {
        userId: user.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: profile.sub,
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null,
        scope: tokens.scope,
      },
    });

    const sessionToken = randomToken(32);
    await prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    cookieStore.set('session-token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });
    cookieStore.delete('google_oauth_state');

    const redirect = new URL(`${getAppUrl(request)}/auth`);
    redirect.searchParams.set('login', 'success');
    redirect.searchParams.set('email', profile.email);
    return Response.redirect(redirect);
  } catch (error) {
    console.error('Web Google OAuth callback failed:', error);
    return jsonError('Google login failed', 500);
  }
}
