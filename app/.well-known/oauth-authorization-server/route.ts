import { getAppUrl, withCors } from '@/lib/oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const appUrl = getAppUrl(request);

  return withCors(
    Response.json({
      issuer: appUrl,
      authorization_endpoint: `${appUrl}/api/oauth/authorize`,
      token_endpoint: `${appUrl}/api/oauth/token`,
      registration_endpoint: `${appUrl}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['openid', 'profile', 'email'],
    }),
  );
}
