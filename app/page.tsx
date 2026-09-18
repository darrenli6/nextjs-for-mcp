'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useState, useSyncExternalStore } from 'react';

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
                      return <p key={index}>{part.text}</p>;
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
