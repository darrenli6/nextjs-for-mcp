export async function GET() {
  return Response.json(
    { error: 'Use /api/oauth/authorize for MCP OAuth authorization.' },
    { status: 404 },
  );
}

export async function POST() {
  return Response.json(
    { error: 'Use /api/oauth/authorize for MCP OAuth authorization.' },
    { status: 404 },
  );
}
