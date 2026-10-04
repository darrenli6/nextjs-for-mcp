import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Supadata } from '@supadata/js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { APP_URL } from '@/lib/config';
import { downloadSocialResource, translateImageToChinese } from '@/lib/mcp-tools';

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

export function createMcpServer() {
  const server = new McpServer({
    name: 'my-mcp-app',
    version: '1.0.0',
  });

  server.registerTool(
    'get_hello_message',
    {
      description: 'Get a hello message from the application',
      inputSchema: z.object({}),
    },
    async () => {
      const response = await fetch(`${APP_URL}/api/hello`, {
        cache: 'no-store',
      });
      return textResult(await response.json());
    },
  );

  server.registerTool(
    'get_current_time',
    {
      description: 'Get the current server time',
      inputSchema: z.object({}),
    },
    async () =>
      textResult({
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
  );

  server.registerTool(
    'get_weather',
    {
      description: 'Get example weather for a city',
      inputSchema: z.object({ city: z.string() }),
    },
    async ({ city }) => textResult({ city, temp: 72, condition: 'Sunny' }),
  );

  server.registerTool(
    'calculate',
    {
      description: 'Perform basic arithmetic',
      inputSchema: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number(),
        b: z.number(),
      }),
    },
    async ({ operation, a, b }) => {
      const result =
        operation === 'add'
          ? a + b
          : operation === 'subtract'
            ? a - b
            : operation === 'multiply'
              ? a * b
              : a / b;

      return textResult({ result });
    },
  );

  server.registerTool(
    'get_social_transcript',
    {
      description:
        'Get a plain-text transcript from a YouTube, TikTok, Instagram, X, or Facebook URL',
      inputSchema: z.object({
        url: z.string().url(),
        lang: z.string().optional(),
      }),
    },
    async ({ url, lang }) => {
      const apiKey = process.env.SUPADATA_API_KEY;

      if (!apiKey) {
        throw new Error('SUPADATA_API_KEY is not configured');
      }

      const supadata = new Supadata({ apiKey });
      const result = await supadata.transcript({
        url,
        ...(lang ? { lang } : {}),
        text: true,
        mode: 'auto',
      });

      return textResult(result);
    },
  );

  server.registerTool(
    'get_users',
    {
      description: 'Get the example user list',
      inputSchema: z.object({}),
    },
    async () => {
      const response = await fetch(`${APP_URL}/api/users`, {
        cache: 'no-store',
      });
      return textResult(await response.json());
    },
  );

  server.registerTool(
    'download_social_resource',
    {
      description:
        'Resolve a YouTube, TikTok, Instagram, Facebook, or X URL into downloadable media resource links',
      inputSchema: z.object({ url: z.string().url() }),
    },
    async ({ url }) => textResult(await downloadSocialResource(url)),
  );

  server.registerTool(
    'translate_image_to_chinese',
    {
      description:
        'Resolve a social media URL with ZM, select its image, translate the visible text into Simplified Chinese with KIE, poll until complete, and return the generated image URL',
      inputSchema: z.object({
        url: z.string().url(),
        prompt: z.string().optional(),
      }),
    },
    async ({ url, prompt }) =>
      textResult(await translateImageToChinese(url, prompt)),
  );

  server.registerTool(
    'analyze_video_content',
    {
      description:
        'Fetch the transcript from a YouTube or TikTok URL, translate it to Chinese, summarize the content, analyze its business value, and optionally answer a specific user question about the video.',
      inputSchema: z.object({
        url: z.string().url(),
        question: z.string().optional(),
      }),
    },
    async ({ url, question }) => {
      const apiKey = process.env.SUPADATA_API_KEY;
      if (!apiKey) throw new Error('SUPADATA_API_KEY is not configured');

      const supadata = new Supadata({ apiKey });
      const transcriptResult = await supadata.transcript({
        url,
        text: true,
        mode: 'auto',
      });

      const rawText =
        typeof transcriptResult === 'object' &&
        transcriptResult !== null &&
        'text' in transcriptResult
          ? String((transcriptResult as { text: unknown }).text)
          : JSON.stringify(transcriptResult);

      const userQuestionSection = question
        ? `\n\n## 五、用户问题\n用户的具体问题：「${question}」\n请根据视频内容，用中文详细回答此问题。`
        : '';

      const prompt = `你是一位专业的视频内容分析师。以下是一段视频的原始字幕文本，请完成以下任务并全部用**简体中文**回复：

## 一、中文字幕
将以下字幕翻译/整理为流畅的中文（如原文已是中文则直接整理）：

<transcript>
${rawText.slice(0, 8000)}
</transcript>

## 二、内容摘要
用3-5句话概括视频的核心内容和主要观点。

## 三、商业价值分析
从以下维度分析该视频的商业价值：
- 目标受众
- 核心卖点或传递的商业信息
- 可借鉴的营销策略或商业模式
- 潜在的商业机会或风险${userQuestionSection}`;

      const { text: analysis } = await generateText({
        model: openai.chat(process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
        prompt,
      });

      return textResult({ url, rawTranscriptLength: rawText.length, analysis });
    },
  );

  return server;
}
