import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, stepCountIs, streamText } from 'ai';
import { mcpTools } from '@/lib/mcp-tools';

export async function POST(request: Request) {
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
