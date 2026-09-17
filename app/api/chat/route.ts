import { createHash, timingSafeEqual } from 'node:crypto';
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText } from 'ai';
import { mcpTools } from '@/lib/mcp-tools';

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

  // Get the user's message
  const { messages } = await request.json();
  
  // Call OpenAI with MCP tools
  const result = await streamText({
    // OPENAI_BASE_URL points to an OpenAI-compatible gateway, so use its
    // Chat Completions API instead of the native Responses API.
    model: openai.chat(process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    messages: await convertToModelMessages(messages),
    tools: mcpTools, // Give AI access to your tools
    stopWhen: stepCountIs(5), // Allow AI to use multiple tools
  });
  
  // Stream the response back to the user
  return result.toUIMessageStreamResponse();
}
