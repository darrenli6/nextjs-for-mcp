import { prisma } from '@/app/prisma';
import { hashToken, jsonError, randomToken, verifyPkce, withCors } from '@/lib/oauth';

export const runtime = 'nodejs';

function getBasicClientCredentials(request: Request) {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return null;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return {
      clientId: decoded.slice(0, separator),
      clientSecret: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}

export async function POST(request: Request) {
  const form = await request.formData();
  const grantType = String(form.get('grant_type') ?? '');
  const code = String(form.get('code') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const bodyClientId = String(form.get('client_id') ?? '');
  const bodyClientSecret = String(form.get('client_secret') ?? '');
  const codeVerifier = String(form.get('code_verifier') ?? '');
  const basicCredentials = getBasicClientCredentials(request);
  const clientId = basicCredentials?.clientId || bodyClientId;
  const clientSecret = basicCredentials?.clientSecret || bodyClientSecret;

  if (grantType !== 'authorization_code' || !code || !redirectUri || !clientId) {
    return jsonError('invalid_request', 400);
  }

  const client = await prisma.client.findUnique({ where: { clientId } });
  if (!client) return jsonError('invalid_client', 401);

  if (client.clientSecret && client.clientSecret !== clientSecret) {
    return jsonError('invalid_client', 401);
  }

  const authCode = await prisma.authCode.findUnique({ where: { code } });

  if (
    !authCode ||
    authCode.clientId !== client.id ||
    authCode.redirectUri !== redirectUri
  ) {
    return jsonError('invalid_grant', 400);
  }

  if (authCode.expiresAt < new Date()) {
    await prisma.authCode.delete({ where: { id: authCode.id } });
    return jsonError('invalid_grant', 400);
  }

  if (
    !authCode.codeChallenge ||
    authCode.codeChallengeMethod !== 'S256' ||
    !codeVerifier ||
    !verifyPkce(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)
  ) {
    return jsonError('invalid_grant', 400);
  }

  const accessToken = randomToken(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.authCode.delete({ where: { id: authCode.id } }),
    prisma.accessToken.create({
      data: {
        token: hashToken(accessToken),
        expiresAt,
        clientId: client.id,
        userId: authCode.userId,
      },
    }),
  ]);

  return withCors(
    Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    }),
  );
}
