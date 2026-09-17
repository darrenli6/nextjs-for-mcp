import { tool } from 'ai';
import { z } from 'zod';
import { APP_URL } from '@/lib/config';

// Define your MCP tools
export const mcpTools = {
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

  get_users: tool({
    description: 'Get list of users',
    inputSchema: z.object({}),
    execute: async () => {
      const response = await fetch(`${APP_URL}/api/users`);
      return response.json();
    },
  }),
};
