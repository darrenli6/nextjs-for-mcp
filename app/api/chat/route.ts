import { createHash, timingSafeEqual } from 'node:crypto';
import { openai } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from 'ai';
import { createMcpTools } from '@/lib/mcp-tools';

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
  const SYSTEM_PROMPT = `You are an AI assistant specialising in image text translation. You have tools to translate text inside images to any language.

Key rules:
- When the user provides image URLs (S3, http, or https) and asks to translate them, ALWAYS call the appropriate tool immediately.
- For ONE image URL → use \`translate_image_to_language\`.
- For MULTIPLE image URLs → use \`batch_translate_images\`.
- Detect the target language from the user's message (e.g. "翻译成日语" → Japanese, "translate to English" → English). Default to "Simplified Chinese" when not specified.
- Image URLs in the user's message may be pre-signed S3 URLs or public URLs — pass them as-is to the tool's \`urls\` parameter.
- After the tool finishes, briefly summarise the results in the user's language.
- You also have tools for social media transcription, social resource download, and basic calculations.`;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = await streamText({
        // OPENAI_BASE_URL points to an OpenAI-compatible gateway, so use its
        // Chat Completions API instead of the native Responses API.
        model: openai.chat(process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
        system: SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        tools: createMcpTools((progress) => {
          writer.write({
            type: 'data-translation-progress',
            data: progress,
          });
        }),
        stopWhen: stepCountIs(8),
      });

      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
