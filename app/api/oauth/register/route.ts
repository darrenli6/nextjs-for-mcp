import { prisma } from '@/app/prisma';
import { jsonError, randomToken, withCors } from '@/lib/oauth';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_client_metadata', 400);
  }

  const clientName = typeof body.client_name === 'string' ? body.client_name : 'MCP Client';
  const redirectUris = body.redirect_uris;
  const authMethod =
    body.token_endpoint_auth_method === 'client_secret_post'
      ? 'client_secret_post'
      : 'none';

  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.some((uri) => typeof uri !== 'string')
  ) {
    return jsonError('redirect_uris must be a non-empty array', 400);
  }

  try {
    const clientSecret = authMethod === 'none' ? '' : randomToken(32);
    const client = await prisma.client.create({
      data: {
        name: clientName,
        redirectUris: redirectUris as string[],
        clientSecret,
      },
    });

    return withCors(
      Response.json({
        client_id: client.clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: authMethod,
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    );
  } catch (error) {
    console.error('OAuth client registration failed:', error);
    return jsonError('server_error', 500);
  }
}
