# MCP Chat Demo

A streaming AI chat application built with Next.js App Router, AI SDK, and an OpenAI-compatible model gateway. The assistant can automatically call tools registered by the application while processing a conversation.

## Features

- Streaming AI chat interface
- AI SDK 7 `useChat` integration
- OpenAI-compatible API gateway support
- Built-in tools for:
  - Fetching a hello message
  - Getting the current time
  - Returning example weather data
  - Performing basic arithmetic
  - Fetching an example user list
- Next.js built-in MCP development server at `/_next/mcp`

## Tech Stack

- Next.js 16.3.5
- React 19
- AI SDK 7
- `@ai-sdk/react`
- `@ai-sdk/openai`
- TypeScript
- Tailwind CSS 4
- Zod

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` or `.env.local` file in the project root:

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://your-compatible-gateway.example.com/v1
OPENAI_MODEL=gpt-4o-mini

# Optional for local development. Defaults to http://localhost:3000.
APP_URL=http://localhost:3000
```

`OPENAI_BASE_URL` should point to the base URL of an OpenAI-compatible API. It usually includes `/v1`. For the official OpenAI API, use:

```env
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 3. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Restart the development server after changing environment variables.

## Available Scripts

```bash
npm run dev       # Start the development server
npm run build     # Create a production build
npm start         # Start the production server
npm run lint      # Run ESLint
```

## Project Structure

```text
app/
├── page.tsx                 # Chat interface
├── layout.tsx               # Root layout
└── api/
    ├── chat/route.ts        # AI chat endpoint and tool execution entry point
    ├── hello/route.ts       # Hello example endpoint
    └── users/route.ts       # Example users endpoint
lib/
├── config.ts                # Server-side configuration such as APP_URL
└── mcp-tools.ts             # Tools available to the AI model
next.config.ts               # Turbopack and Next.js MCP configuration
```

## API Endpoints

### `POST /api/chat`

Accepts AI SDK UI messages and returns a streaming response. The endpoint uses the model configured by `OPENAI_MODEL` and registers the tools from `lib/mcp-tools.ts`.

### `GET /api/hello`

Returns example hello data.

### `GET /api/users`

Returns an example user list.

## Adding a Tool

Define tools in `lib/mcp-tools.ts` with the AI SDK `tool` helper and Zod schemas:

```ts
import { tool } from 'ai';
import { z } from 'zod';

const exampleTool = tool({
  description: 'Describe what the tool does',
  inputSchema: z.object({
    value: z.string(),
  }),
  execute: async ({ value }) => {
    return { value };
  },
});
```

Add the tool to the exported `mcpTools` object and the model can call it during a conversation.

## Deployment Notes

- Configure `OPENAI_API_KEY` in production.
- Make sure `OPENAI_BASE_URL` and `OPENAI_MODEL` are supported by your model gateway.
- When deploying to Railway, Render, or a similar platform, set `APP_URL` to the public URL of the deployed application.
- `APP_URL` is used by server-side tools to access the `/api/hello` and `/api/users` endpoints.
- Never commit `.env`, API keys, or other secrets to Git.

## Related Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [AI SDK Documentation](https://ai-sdk.dev/docs)
- [Next.js MCP Documentation](https://nextjs.org/docs/app/guides/mcp)
