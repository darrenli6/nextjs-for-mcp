import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { prisma } from '@/app/prisma';
import { createMcpServer } from '@/lib/mcp-server';
import { getAppUrl, hashToken } from '@/lib/oauth';

export const runtime = 'nodejs';

function withMcpCors(response: Response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Last-Event-Id');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  return response;
}

async function getAuthenticatedAccessToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const [scheme, token] = authorization.split(' ', 2);

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  const accessToken = await prisma.accessToken.findUnique({
    where: { token: hashToken(token) },
  });

  if (!accessToken) return null;

  if (accessToken.expiresAt <= new Date()) {
    await prisma.accessToken.delete({ where: { id: accessToken.id } });
    return null;
  }

  return accessToken;
}

export async function POST(request: Request) {
  const accessToken = await getAuthenticatedAccessToken(request);

  if (!accessToken) {
    return withMcpCors(Response.json(
      { error: 'Unauthorized.' },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${getAppUrl(request)}/.well-known/oauth-protected-resource/mcp"`,
        },
      },
    ));
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  return withMcpCors(await transport.handleRequest(request));
}

export async function GET(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  return POST(request);
}

export async function OPTIONS() {
  return withMcpCors(new Response(null, { status: 204 }));
}
