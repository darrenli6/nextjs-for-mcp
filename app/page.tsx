'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { TranslationProgress } from '@/lib/mcp-tools';

const ACCESS_TOKEN_STORAGE_KEY = 'access_token';

function subscribeToAccessToken(callback: () => void) {
  window.addEventListener('access-token-change', callback);
  return () => window.removeEventListener('access-token-change', callback);
}

function getAccessToken() {
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? '';
}

function getServerAccessToken() {
  return '';
}

function collectImageUrls(value: unknown, key = '', result: string[] = []) {
  if (typeof value === 'string') {
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // Keep normal URL strings as-is.
    }

    if (parsed !== value) return collectImageUrls(parsed, key, result);

    const isUrl = /^https?:\/\//i.test(value);
    const isVideo = /\.(?:mp4|mov|webm|m3u8)(?:[?#].*)?$/i.test(value);
    const isImageField = /image|result|url|picture|photo|output/i.test(key);
    if (isUrl && !isVideo && isImageField) result.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, key, result));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, childValue]) =>
      collectImageUrls(childValue, childKey, result),
    );
  }

  return [...new Set(result)];
}

function renderStandaloneImageUrls(markdown: string) {
  return markdown.replace(
    /(^|\n)([ \t]*)(https?:\/\/[^\s<>()]+\.(?:png|jpe?g|webp|gif|bmp|avif)(?:\?[^\s<>()]*)?)[ \t]*(?=\n|$)/gim,
    '$1$2![Generated image]($3)',
  );
}

export default function Home() {
  const accessToken = useSyncExternalStore(
    subscribeToAccessToken,
    getAccessToken,
    getServerAccessToken,
  );
  const [input, setInput] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        headers: (): Record<string, string> =>
          accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
      }),
    [accessToken],
  );
  const { messages, sendMessage, status } = useChat({
    transport,
  });
  const isLoading = status === 'submitted' || status === 'streaming';

  function handleAccessTokenChange(value: string) {
    if (value) {
      window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    }
    window.dispatchEvent(new Event('access-token-change'));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || isLoading || !accessToken) return;

    sendMessage({ text: input });
    setInput('');
  }

  async function handleCopy(messageId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId(null), 1500);
    } catch {
      setCopiedMessageId(null);
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      <h1 className="text-3xl font-bold mb-4">Hello World MCP Chat</h1>

      <div className="mb-4 flex gap-2">
        <input
          type="password"
          value={accessToken}
          onChange={(event) => handleAccessTokenChange(event.target.value)}
          placeholder="Enter ACCESS_TOKEN"
          className="flex-1 p-3 border rounded-lg"
          disabled={isLoading}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => handleAccessTokenChange('')}
          className="px-4 py-3 border rounded-lg"
          disabled={!accessToken || isLoading}
        >
          Clear
        </button>
      </div>

      {!accessToken && (
        <p className="mb-4 text-sm text-amber-700">
          Enter an access token before sending a message.
        </p>
      )}
      
        {/* Messages */}
        <div className="flex-1 overflow-y-auto mb-4 space-y-4">
          {messages.map((message) => (
            (() => {
              const textContent = message.parts
                .filter((part) => part.type === 'text')
                .map((part) => (part.type === 'text' ? part.text : ''))
                .join('\n');
              const progressEvents = message.parts
                .filter((part) => part.type === 'data-translation-progress')
                .map((part) => (part as { data?: TranslationProgress }).data)
                .filter((progress): progress is TranslationProgress => Boolean(progress));
              const latestProgress = progressEvents.at(-1);
              const renderedTextContent = renderStandaloneImageUrls(textContent);

              return (
                <div
                  key={message.id}
                  className={`p-4 rounded-lg ${
                    message.role === 'user'
                      ? 'bg-blue-500 text-white ml-auto'
                      : 'bg-gray-200 text-black'
                  } max-w-[80%]`}
                >
                  <p className="font-semibold mb-1">
                    {message.role === 'user' ? 'You' : 'AI'}
                  </p>
                  {message.parts.map((part, index) => {
                    if (part.type === 'text') {
                      return message.role === 'user' ? (
                        <p key={index}>{part.text}</p>
                      ) : null;
                    }

                    if (part.type === 'data-translation-progress') {
                      return null;
                    }

                    if (part.type === 'tool-translate_image_to_chinese') {
                      const output = (part as {
                        output?: unknown;
                      }).output;
                      const imageUrls = collectImageUrls(output);

                      return (
                        <details
                          key={index}
                          className="my-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
                        >
                          <summary className="cursor-pointer font-medium">
                            {imageUrls.length > 0 ? '中文图片结果' : '图片翻译工具结果'}
                          </summary>
                          {imageUrls.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              {imageUrls.map((imageUrl) => (
                                <div key={imageUrl} className="space-y-2">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={imageUrl}
                                    alt="Chinese translation result"
                                    className="max-h-96 max-w-full rounded-lg border border-emerald-200 object-contain"
                                  />
                                  <a
                                    href={imageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-emerald-700 underline"
                                  >
                                    Open or download image
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-red-700">
                              The translation tool did not return an image URL.
                            </p>
                          )}
                        </details>
                      );
                    }

                    if (part.type.startsWith('tool-')) {
                      return (
                        <p key={index} className="mt-2 text-xs opacity-75">
                          🔧 Used tool: {part.type.replace('tool-', '')}
                        </p>
                      );
                    }

                    return null;
                  })}
                  {latestProgress && (
                    <details className="my-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
                        {latestProgress.stage !== 'success' && latestProgress.stage !== 'failed' && (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                        )}
                        <span>{latestProgress.message}</span>
                      </summary>
                      <div className="mt-2 space-y-2">
                        {progressEvents.map((progress, progressIndex) => (
                          <p key={`${progress.stage}-${progress.attempt ?? progressIndex}`}>
                            {progress.message}
                          </p>
                        ))}
                        {latestProgress.stage === 'polling' && latestProgress.attempt && latestProgress.maxAttempts && (
                          <div className="h-1.5 overflow-hidden rounded-full bg-blue-200">
                            <div
                              className="h-full rounded-full bg-blue-600 transition-all"
                              style={{ width: `${(latestProgress.attempt / latestProgress.maxAttempts) * 100}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                  {message.role !== 'user' && textContent && (
                    <div className="space-y-3 text-sm leading-6">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => (
                            <h1 className="text-2xl font-bold">{children}</h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="text-xl font-bold">{children}</h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="text-lg font-semibold">{children}</h3>
                          ),
                          p: ({ children }) => <p>{children}</p>,
                          ul: ({ children }) => (
                            <ul className="list-disc space-y-1 pl-6">{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="list-decimal space-y-1 pl-6">{children}</ol>
                          ),
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-4 border-gray-400 pl-4 italic text-gray-700">
                              {children}
                            </blockquote>
                          ),
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-700 underline hover:text-blue-900"
                            >
                              {children}
                            </a>
                          ),
                          img: ({ src, alt }) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={src}
                              alt={alt ?? 'Generated image'}
                              className="max-h-[32rem] max-w-full rounded-lg border border-gray-300 object-contain"
                            />
                          ),
                          pre: ({ children }) => (
                            <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-sm text-gray-100">
                              {children}
                            </pre>
                          ),
                          code: ({ className, children }) => (
                            <code
                              className={
                                className
                                  ? className
                                  : 'rounded bg-gray-300 px-1 py-0.5 text-sm'
                              }
                            >
                              {children}
                            </code>
                          ),
                          table: ({ children }) => (
                            <div className="overflow-x-auto">
                              <table className="min-w-full border-collapse border border-gray-400 text-left">
                                {children}
                              </table>
                            </div>
                          ),
                          th: ({ children }) => (
                            <th className="border border-gray-400 bg-gray-300 px-3 py-2 font-semibold">
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="border border-gray-400 px-3 py-2">
                              {children}
                            </td>
                          ),
                        }}
                      >
                        {renderedTextContent}
                      </ReactMarkdown>
                    </div>
                  )}
                  {message.role !== 'user' && textContent && (
                    <div className="mt-3 flex justify-start">
                      <button
                        type="button"
                        onClick={() => handleCopy(message.id, textContent)}
                        className="rounded-md border border-gray-400 px-2 py-1 text-xs text-gray-700 transition hover:bg-gray-300"
                        aria-label="Copy AI response"
                      >
                        {copiedMessageId === message.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()
          ))}
        
        {isLoading && (
          <div className="bg-gray-200 text-black p-4 rounded-lg">
            <p className="animate-pulse">AI is thinking...</p>
          </div>
        )}
      </div>
      
      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask me anything..."
          className="flex-1 p-3 border rounded-lg"
          disabled={isLoading || !accessToken}
        />
        <button
          type="submit"
          disabled={isLoading || !accessToken}
          className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
