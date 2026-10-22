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
  const SYSTEM_PROMPT = `You are an AI assistant specialising in image text translation and social media content creation.

## Tools available for image translation
- \`translate_image_to_language\` — single image
- \`batch_translate_images\` — multiple images (preferred when there are 2+ URLs)

## What each translation tool returns
Each result includes:
- \`imageUrls\` — translated image URLs (ready for download)
- \`social\` — auto-generated social media content in the target language:
  - \`title\` — catchy post title
  - \`description\` — engaging caption
  - \`hashtags\` — relevant hashtags (without #)

## Key rules
1. When the user provides image URLs (S3, http, or https), ALWAYS call the tool immediately — no need to ask.
2. For ONE URL → \`translate_image_to_language\`; for 2+ URLs → \`batch_translate_images\`.
3. Extract the \`targetLanguage\` from the user's message (e.g. "翻译成日语" → "Japanese", "translate to English" → "English"). Default: "Simplified Chinese".
4. Pass image URLs as-is to the \`urls\` parameter.
5. After the tool completes, write a SHORT summary in the user's language. Do NOT reproduce the full social media content in your text reply — the UI already displays it in a dedicated card. Just confirm success and note the language.
6. You also have tools for social media video transcription (\`get_social_transcript\`, \`analyze_video_content\`) and utilities.`;

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
