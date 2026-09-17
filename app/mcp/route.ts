import { createHash, timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp-server';

export const runtime = 'nodejs';

function hasValidAccessToken(request: Request, expectedToken: string) {
  const authorization = request.headers.get('authorization') ?? '';
  const [scheme, token] = authorization.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return false;
  }

  const receivedHash = createHash('sha256').update(token).digest();
  const expectedHash = createHash('sha256').update(expectedToken).digest();

  return timingSafeEqual(receivedHash, expectedHash);
}

export async function POST(request: Request) {
  const accessToken = process.env.ACCESS_TOKEN;

  if (!accessToken) {
    return Response.json(
      { error: 'ACCESS_TOKEN is not configured.' },
      { status: 500 },
    );
  }

  if (!hasValidAccessToken(request, accessToken)) {
    return Response.json(
      { error: 'Unauthorized.' },
      {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      },
    );
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  return POST(request);
}
