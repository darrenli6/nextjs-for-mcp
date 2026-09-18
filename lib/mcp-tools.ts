import { tool } from 'ai';
import { z } from 'zod';
import { APP_URL } from '@/lib/config';

const ZM_SOCIAL_ENDPOINT = 'https://api.zm.io.vn/v1/social/autolink';
const KIE_BASE_URL = 'https://api.kie.ai';
const KIE_MODEL = 'gpt-image-2-image-to-image';
const KIE_POLL_INTERVAL_MS = 2000;
const KIE_MAX_POLL_ATTEMPTS = Math.max(
  30,
  Number.parseInt(process.env.KIE_MAX_POLL_ATTEMPTS ?? '300', 10) || 300,
);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type KieTaskResponse = {
  code?: number;
  data?: {
    state?: string;
    resultJson?: string | JsonValue;
    resultUrls?: JsonValue;
    failMsg?: string;
  };
};

export type TranslationProgress = {
  stage: 'resolving' | 'image-ready' | 'submitted' | 'polling' | 'success' | 'failed';
  message: string;
  taskId?: string;
  attempt?: number;
  maxAttempts?: number;
};

function collectUrls(value: JsonValue, result: string[] = []) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    result.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, result));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectUrls(item, result));
  }

  return [...new Set(result)];
}

function collectImageUrls(value: JsonValue, key = '', result: string[] = []) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    const imageExtension = /\.(?:jpg|jpeg|png|webp|gif|bmp|avif)(?:[?#].*)?$/i.test(value);
    const imageField = /image|thumbnail|cover|poster|photo|picture/i.test(key);
    if (imageExtension || imageField) result.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, key, result));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, childValue]) =>
      collectImageUrls(childValue, childKey, result),
    );
  }

  return [...new Set(result)];
}

async function readJsonResponse(response: Response): Promise<JsonValue> {
  const body = await response.text();
  try {
    return JSON.parse(body) as JsonValue;
  } catch {
    return { text: body };
  }
}

function parseResultJson(value: string | JsonValue | undefined): JsonValue {
  if (typeof value !== 'string') return value ?? {};

  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return { raw: value };
  }
}

export async function downloadSocialResource(url: string) {
  const apiKey = process.env.ZM_API_KEY;

  if (!apiKey) throw new Error('ZM_API_KEY is not configured');

  const requestBody = { url };
  console.info('[ZM] request', {
    endpoint: ZM_SOCIAL_ENDPOINT,
    method: 'POST',
    body: requestBody,
    apiKeyConfigured: true,
  });

  const response = await fetch(ZM_SOCIAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify({ url }),
  });
  const data = await readJsonResponse(response);

  console.info('[ZM] response', {
    status: response.status,
    ok: response.ok,
    data,
  });

  if (!response.ok) {
    throw new Error(`Failed to parse social resource (${response.status}): ${JSON.stringify(data)}`);
  }

  return {
    data,
    resourceUrls: collectUrls(data),
    imageUrls: collectImageUrls(data),
  };
}

function kieHeaders() {
  const token = process.env.KIE_AI_BEARER_TOKEN;
  if (!token) throw new Error('KIE_AI_BEARER_TOKEN is not configured');

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function translateImageToChinese(
  sourceUrl: string,
  prompt = 'Translate all visible text in this image into natural Simplified Chinese. Preserve the original layout, style, and visual design. Replace the original text with Chinese and do not add explanations.',
  onProgress?: (progress: TranslationProgress) => void,
) {
  onProgress?.({ stage: 'resolving', message: '正在通过 ZM 解析社媒资源…' });
  const directImage = /\.(?:jpg|jpeg|png|webp|gif|bmp|avif)(?:[?#].*)?$/i.test(sourceUrl);
  const downloaded = directImage ? null : await downloadSocialResource(sourceUrl);
  const imageUrl = directImage
    ? sourceUrl
    : downloaded?.imageUrls[0] ?? downloaded?.resourceUrls.find(
        (url) => !/\.(?:mp4|mov|webm|m3u8)(?:[?#].*)?$/i.test(url),
      );

  if (!imageUrl) {
    onProgress?.({ stage: 'failed', message: 'ZM 没有返回可用图片链接。' });
    throw new Error(
      `ZM did not return an image URL for ${sourceUrl}. Available resources: ${JSON.stringify(downloaded?.resourceUrls ?? [])}`,
    );
  }

  onProgress?.({ stage: 'image-ready', message: '图片已获取，正在提交 KIE 翻译任务…' });

  const createEndpoint = `${KIE_BASE_URL}/api/v1/jobs/createTask`;
  const createRequestBody = {
    model: KIE_MODEL,
    input: {
      prompt,
      input_urls: [imageUrl],
      aspect_ratio: 'auto',
    },
  };

  console.info('[KIE] createTask request', {
    endpoint: createEndpoint,
    method: 'POST',
    body: createRequestBody,
    tokenConfigured: true,
  });

  const createResponse = await fetch(createEndpoint, {
    method: 'POST',
    headers: kieHeaders(),
    body: JSON.stringify(createRequestBody),
  });

  const createData = (await readJsonResponse(createResponse)) as JsonValue;
  console.info('[KIE] createTask response', {
    endpoint: `${KIE_BASE_URL}/api/v1/jobs/createTask`,
    status: createResponse.status,
    ok: createResponse.ok,
    data: createData,
  });
  if (!createResponse.ok || !createData || typeof createData !== 'object' || Array.isArray(createData)) {
    throw new Error(`Failed to create KIE task: ${JSON.stringify(createData)}`);
  }

  const taskId =
    'data' in createData && createData.data && typeof createData.data === 'object' && !Array.isArray(createData.data) &&
    'taskId' in createData.data && typeof createData.data.taskId === 'string'
      ? createData.data.taskId
      : null;

  if (!taskId) {
    onProgress?.({ stage: 'failed', message: 'KIE 没有返回任务 ID。' });
    throw new Error(`KIE did not return a taskId: ${JSON.stringify(createData)}`);
  }

  onProgress?.({ stage: 'submitted', message: 'KIE 任务已提交，开始轮询…', taskId });
  console.info('[KIE] task submitted', { taskId, sourceUrl, inputImageUrl: imageUrl });

  for (let attempt = 0; attempt < KIE_MAX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, KIE_POLL_INTERVAL_MS));

    const pollEndpoint = `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
    console.info('[KIE] recordInfo request', {
      endpoint: pollEndpoint,
      method: 'GET',
      taskId,
      attempt: attempt + 1,
    });
    const response = await fetch(pollEndpoint, { headers: kieHeaders() });
    const payload = (await readJsonResponse(response)) as KieTaskResponse;

    console.info('[KIE] recordInfo response', {
      taskId,
      attempt: attempt + 1,
      status: response.status,
      ok: response.ok,
      data: payload,
    });

    if (!response.ok || !payload.data) {
      throw new Error(`Failed to poll KIE task ${taskId}`);
    }

    const state = payload.data.state?.toLowerCase();
    onProgress?.({
      stage: 'polling',
      message: `正在等待 KIE 生成图片（${attempt + 1}/${KIE_MAX_POLL_ATTEMPTS}）…`,
      taskId,
      attempt: attempt + 1,
      maxAttempts: KIE_MAX_POLL_ATTEMPTS,
    });
    if (state === 'success') {
      const result = parseResultJson(payload.data.resultJson);
      const imageUrls = [
        ...collectUrls(result),
        ...collectUrls(payload.data.resultUrls ?? {}),
      ];

      console.info('[KIE] parsed result', {
        taskId,
        imageUrls: [...new Set(imageUrls)],
        result,
        resultUrls: payload.data.resultUrls,
      });

      onProgress?.({ stage: 'success', message: '中文图片已生成。', taskId });
      return {
        taskId,
        state,
        sourceUrl,
        inputImageUrl: imageUrl,
        result,
        imageUrls: [...new Set(imageUrls)],
      };
    }

    if (state === 'failed' || state === 'fail' || state === 'error') {
      onProgress?.({ stage: 'failed', message: payload.data.failMsg || 'KIE 图片翻译失败。', taskId });
      throw new Error(payload.data.failMsg || `KIE task ${taskId} failed`);
    }

    // KIE may keep the task in generating/processing/waiting for several minutes.
    // These are non-terminal states, so continue polling until success or failure.
    if (state === 'generating' || state === 'processing' || state === 'waiting' || state === 'queued') {
      continue;
    }
  }

  onProgress?.({ stage: 'failed', message: '图片翻译任务轮询超时。', taskId });
  throw new Error(`KIE task ${taskId} timed out after ${KIE_MAX_POLL_ATTEMPTS * KIE_POLL_INTERVAL_MS / 1000} seconds`);
}

// Define your MCP tools
export function createMcpTools(
  onTranslationProgress?: (progress: TranslationProgress) => void,
) {
  return {
  // Tool 1: Get hello message
  get_hello_message: tool({
    description: 'Get a hello message from the server',
    inputSchema: z.object({}), // No parameters needed
    execute: async () => {
      // Fetch data from your API
      const response = await fetch(`${APP_URL}/api/hello`);
      const data = await response.json();
      return data;
    },
  }),
  
  // Tool 2: Get current time
  get_current_time: tool({
    description: 'Get the current server time',
    inputSchema: z.object({}),
    execute: async () => {
      return {
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  }),

   // New tool: Get weather
  get_weather: tool({
    description: 'Get weather for a city',
    inputSchema: z.object({
      city: z.string().describe('City name'),
    }),
    execute: async ({ city }) => {
      // Call weather API
      return { city, temp: 72, condition: 'Sunny' };
    },
  }),
  
  // New tool: Calculate
  calculate: tool({
    description: 'Perform basic math calculations',
    inputSchema: z.object({
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      a: z.number(),
      b: z.number(),
    }),
    execute: async ({ operation, a, b }) => {
      switch (operation) {
        case 'add': return { result: a + b };
        case 'subtract': return { result: a - b };
        case 'multiply': return { result: a * b };
        case 'divide': return { result: a / b };
      }
    },
  }),

  get_social_transcript: tool({
    description:
      'Get a plain-text transcript from a YouTube, TikTok, Instagram, X, or Facebook URL',
    inputSchema: z.object({
      url: z.string().url().describe('Supported social media or video URL'),
      lang: z
        .string()
        .optional()
        .describe('Optional transcript language, such as en or zh'),
    }),
    execute: async ({ url, lang }) => {
      const response = await fetch(`${APP_URL}/api/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, lang }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to fetch social transcript');
      }

      return data;
    },
  }),

  download_social_resource: tool({
    description:
      'Resolve a YouTube, TikTok, Instagram, Facebook, or X URL into downloadable media resource links',
    inputSchema: z.object({
      url: z.string().url().describe('Social media URL to resolve'),
    }),
    execute: async ({ url }) => downloadSocialResource(url),
  }),

  translate_image_to_chinese: tool({
    description:
      'Resolve a social media URL with ZM, select its image, translate the visible text into Simplified Chinese with KIE, poll until complete, and return the generated image URL',
    inputSchema: z.object({
      url: z.string().url().describe('Social media URL, or a direct public image URL'),
      prompt: z
        .string()
        .optional()
        .describe('Optional image editing prompt; defaults to Simplified Chinese translation'),
    }),
    execute: async ({ url, prompt }) =>
      translateImageToChinese(url, prompt, onTranslationProgress),
  }),

  get_users: tool({
    description: 'Get list of users',
    inputSchema: z.object({}),
    execute: async () => {
      const response = await fetch(`${APP_URL}/api/users`);
      return response.json();
    },
  }),
  };
}

export const mcpTools = createMcpTools();
