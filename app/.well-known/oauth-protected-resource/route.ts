import { getAppUrl, withCors } from '@/lib/oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const appUrl = getAppUrl(request);

  return withCors(
    Response.json({
      resource: `${appUrl}/mcp`,
      authorization_servers: [appUrl],
      scopes_supported: ['openid', 'profile', 'email'],
      bearer_methods_supported: ['header'],
    }),
  );
}
