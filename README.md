# MCP Chat Demo

A streaming AI chat application built with Next.js App Router, AI SDK, and an OpenAI-compatible model gateway. The assistant can automatically call tools registered by the application while processing a conversation.

## Features

- Streaming AI chat interface
- AI SDK 7 `useChat` integration
- OpenAI-compatible API gateway support
- Social media transcript extraction through Supadata
- Built-in tools for:
  - Fetching a hello message
  - Getting the current time
  - Returning example weather data
  - Performing basic arithmetic
  - Fetching an example user list
  - Extracting transcripts from YouTube, TikTok, Instagram, X, and Facebook URLs
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
ACCESS_TOKEN=your_internal_access_token
SUPADATA_API_KEY=your_supadata_api_key

# Optional for local development. Defaults to http://localhost:3000.
APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
AUTH_SECRET=replace_with_a_long_random_secret
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
    ├── mcp/route.ts         # Production Streamable HTTP MCP endpoint
    ├── social/route.ts       # Social media transcript endpoint
    └── users/route.ts       # Example users endpoint
lib/
├── config.ts                # Server-side configuration such as APP_URL
└── mcp-tools.ts             # Tools available to the AI model
next.config.ts               # Turbopack and Next.js MCP configuration
```

## API Endpoints

### `POST /api/chat`

Accepts AI SDK UI messages and returns a streaming response. The endpoint requires `Authorization: Bearer <ACCESS_TOKEN>`, uses the model configured by `OPENAI_MODEL`, and registers the tools from `lib/mcp-tools.ts`.

### `GET /api/hello`

Returns example hello data.

### `GET /api/users`

Returns an example user list.

### `POST /api/social`

Extracts a plain-text transcript from a supported social media or video URL using Supadata.

Request body:

```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "lang": "en"
}
```

### `GET|POST|DELETE /mcp`

Production Streamable HTTP MCP endpoint. Configure your MCP client with:

```text
URL: https://your-domain.com/mcp
Authorization: Bearer your_internal_access_token
```

The endpoint exposes the application tools, including `get_social_transcript`, `get_users`, `calculate`, and `get_current_time`.

OAuth discovery endpoints:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/api/oauth/register
/api/oauth/authorize
/api/oauth/token
```

The `lang` field is optional. Example response:

```json
{
  "content": "Transcript text...",
  "lang": "en",
  "availableLangs": ["en", "es", "zh-TW"]
}
```

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

The project already includes a `get_social_transcript` tool. It accepts a URL and an optional language, then calls `POST /api/social` internally:

```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "lang": "en"
}
```

## Deployment Notes

- Configure `OPENAI_API_KEY` in production.
- Configure `ACCESS_TOKEN` to protect `/api/chat` and `/mcp`.
- Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google sign-in.
- Configure `DATABASE_URL` for the PostgreSQL database and run `npm run db:migrate` during deployment.
- Add this Google OAuth redirect URI to the Google Cloud OAuth client:
  `https://your-domain.com/api/oauth/google/callback`
- Configure `SUPADATA_API_KEY` to enable social media transcript extraction.
- Make sure `OPENAI_BASE_URL` and `OPENAI_MODEL` are supported by your model gateway.
- When deploying to Railway, Render, or a similar platform, set `APP_URL` to the public URL of the deployed application.
- `APP_URL` is used by server-side tools to access the `/api/hello`, `/api/social`, and `/api/users` endpoints.
- Never commit `.env`, API keys, or other secrets to Git.

## Related Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [AI SDK Documentation](https://ai-sdk.dev/docs)
- [Next.js MCP Documentation](https://nextjs.org/docs/app/guides/mcp)
