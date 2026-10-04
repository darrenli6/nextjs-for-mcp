'use client';

import { useChat } from '@ai-sdk/react';
import type { UIMessage } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { TranslationProgress } from '@/lib/mcp-tools';

// ─── Access token ─────────────────────────────────────────────────────────────

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

// ─── Chat history ─────────────────────────────────────────────────────────────

const HISTORY_STORAGE_KEY = 'chat_history';
const MAX_HISTORY_ITEMS = 30;

type HistoryEntry = {
  id: string;
  title: string;
  timestamp: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
};

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}

function persistHistory(entries: HistoryEntry[]) {
  const trimmed =
    entries.length > MAX_HISTORY_ITEMS
      ? entries.slice(entries.length - MAX_HISTORY_ITEMS)
      : entries;
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
}

function upsertSessionInHistory(
  sessionId: string,
  messages: UIMessage[],
  existing: HistoryEntry[],
): HistoryEntry[] {
  const userMsgs = messages.filter((m) => m.role === 'user');
  if (userMsgs.length === 0) return existing;

  const rawTitle = (userMsgs[0].parts as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join(' ')
    .trim();
  const title = rawTitle.length > 50 ? rawTitle.slice(0, 50) + '…' : rawTitle || '对话';

  const idx = existing.findIndex((e) => e.id === sessionId);
  const updated: HistoryEntry = { id: sessionId, title, timestamp: Date.now(), messages };

  if (idx >= 0) {
    const next = [...existing];
    next[idx] = updated;
    return next;
  }
  return [...existing, updated];
}

// ─── Image helpers ────────────────────────────────────────────────────────────

function collectImageUrls(value: unknown, key = '', result: string[] = []): string[] {
  if (typeof value === 'string') {
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep */ }
    if (parsed !== value) return collectImageUrls(parsed, key, result);
    const isUrl = /^https?:\/\//i.test(value);
    const isVideo = /\.(?:mp4|mov|webm|m3u8)(?:[?#].*)?$/i.test(value);
    const isImageField = /image|result|url|picture|photo|output/i.test(key);
    if (isUrl && !isVideo && isImageField) result.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, key, result));
  } else if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
      collectImageUrls(v, k, result),
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

// ─── ImageGrid ────────────────────────────────────────────────────────────────

function ImageGrid({ imageUrls }: { imageUrls: string[] }) {
  if (imageUrls.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {imageUrls.map((url) => (
        <div key={url} className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Chinese translation result"
            className="w-full rounded-lg border border-emerald-200 object-contain bg-white max-h-56 sm:max-h-64"
          />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-xs text-emerald-700 underline"
          >
            下载
          </a>
        </div>
      ))}
    </div>
  );
}

// ─── Tool result panels ───────────────────────────────────────────────────────

function TranslateToolResult({ output, label }: { output: unknown; label: string }) {
  const imageUrls = collectImageUrls(output);
  return (
    <details className="my-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <summary className="cursor-pointer font-medium">
        {imageUrls.length > 0 ? label : '图片翻译工具结果'}
      </summary>
      {imageUrls.length > 0 ? (
        <ImageGrid imageUrls={imageUrls} />
      ) : (
        <p className="mt-2 text-red-700">翻译工具未返回图片链接。</p>
      )}
    </details>
  );
}

function BatchTranslateToolResult({ output }: { output: unknown }) {
  type BatchItem = { url?: string; success?: boolean; imageUrls?: string[]; error?: string };
  const items: BatchItem[] = Array.isArray(output)
    ? (output as BatchItem[])
    : (() => { try { return JSON.parse(String(output)) as BatchItem[]; } catch { return []; } })();

  if (items.length === 0) return null;

  return (
    <details
      className="my-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
      open
    >
      <summary className="cursor-pointer font-medium">
        批量中文图片结果（{items.filter((i) => i.success).length}/{items.length} 成功）
      </summary>
      <div className="mt-2 space-y-4">
        {items.map((item, i) => (
          <div key={item.url ?? i} className="space-y-1">
            <p className="font-medium truncate text-emerald-800">
              {item.success ? '✅' : '❌'} {item.url}
            </p>
            {item.success && item.imageUrls && item.imageUrls.length > 0 ? (
              <ImageGrid imageUrls={item.imageUrls} />
            ) : !item.success ? (
              <p className="text-red-600">{item.error ?? '未知错误'}</p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

type Part = { type: string; text?: string; data?: unknown; output?: unknown };

function MessageBubble({
  message,
  copiedId,
  onCopy,
}: {
  message: UIMessage;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  const parts = message.parts as Part[];

  const textContent = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');

  const progressEvents = parts
    .filter((p) => p.type === 'data-translation-progress')
    .map((p) => p.data as TranslationProgress | undefined)
    .filter((p): p is TranslationProgress => Boolean(p));

  const latestProgress = progressEvents.at(-1);
  const renderedText = renderStandaloneImageUrls(textContent);

  const isUser = message.role === 'user';

  return (
    <div
      className={`rounded-xl px-3 py-3 sm:px-4 sm:py-4 text-sm sm:text-base ${
        isUser
          ? 'bg-blue-500 text-white ml-auto max-w-[88%] sm:max-w-[78%]'
          : 'bg-gray-100 text-gray-900 mr-auto max-w-[92%] sm:max-w-[85%]'
      }`}
    >
      <p className="text-xs font-semibold mb-1 opacity-70">{isUser ? 'You' : 'AI'}</p>

      {parts.map((part, index) => {
        if (part.type === 'text') {
          return isUser ? <p key={index} className="break-words">{part.text}</p> : null;
        }
        if (part.type === 'data-translation-progress') return null;
        if (part.type === 'tool-translate_image_to_chinese') {
          return <TranslateToolResult key={index} output={part.output} label="中文图片结果" />;
        }
        if (part.type === 'tool-batch_translate_images_to_chinese') {
          return <BatchTranslateToolResult key={index} output={part.output} />;
        }
        if (part.type.startsWith('tool-')) {
          return (
            <p key={index} className="mt-2 text-xs opacity-60">
              🔧 {part.type.replace('tool-', '')}
            </p>
          );
        }
        return null;
      })}

      {latestProgress && (
        <details className="my-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
            {latestProgress.stage !== 'success' && latestProgress.stage !== 'failed' && (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
            )}
            <span className="break-words">{latestProgress.message}</span>
          </summary>
          <div className="mt-2 space-y-1">
            {progressEvents.map((progress, progressIndex) => (
              <p key={progressIndex}>{progress.message}</p>
            ))}
            {latestProgress.stage === 'polling' &&
              latestProgress.attempt &&
              latestProgress.maxAttempts && (
                <div className="h-1.5 overflow-hidden rounded-full bg-blue-200">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{
                      width: `${(latestProgress.attempt / latestProgress.maxAttempts) * 100}%`,
                    }}
                  />
                </div>
              )}
          </div>
        </details>
      )}

      {!isUser && textContent && (
        <div className="space-y-2 text-sm leading-6">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-xl sm:text-2xl font-bold mt-2">{children}</h1>,
              h2: ({ children }) => <h2 className="text-lg sm:text-xl font-bold mt-2">{children}</h2>,
              h3: ({ children }) => <h3 className="text-base sm:text-lg font-semibold mt-1">{children}</h3>,
              p: ({ children }) => <p className="break-words">{children}</p>,
              ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-gray-400 pl-4 italic text-gray-600">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">
                  {children}
                </a>
              ),
              img: ({ src, alt }) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={alt ?? 'Generated image'}
                  className="max-h-72 sm:max-h-128 max-w-full rounded-lg border border-gray-300 object-contain"
                />
              ),
              pre: ({ children }) => (
                <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs sm:text-sm text-gray-100">
                  {children}
                </pre>
              ),
              code: ({ className, children }) => (
                <code className={className ?? 'rounded bg-gray-200 px-1 py-0.5 text-xs sm:text-sm'}>
                  {children}
                </code>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto -mx-1">
                  <table className="min-w-full border-collapse border border-gray-300 text-left text-xs sm:text-sm">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-300 bg-gray-200 px-2 py-1.5 font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-300 px-2 py-1.5">{children}</td>
              ),
            }}
          >
            {renderedText}
          </ReactMarkdown>
        </div>
      )}

      {textContent && (
        <div className="mt-2 flex justify-start">
          <button
            type="button"
            onClick={() => onCopy(message.id, textContent)}
            className={`rounded border px-2 py-0.5 text-xs transition active:scale-95 ${
              isUser
                ? 'border-blue-300 text-blue-100 hover:bg-blue-400'
                : 'border-gray-300 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {copiedId === message.id ? '已复制 ✓' : '复制'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar content ──────────────────────────────────────────────────────────

function SidebarContent({
  history,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
}: {
  history: HistoryEntry[];
  activeId: string | null;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200 shrink-0">
        <span className="text-sm font-semibold text-gray-700">历史记录</span>
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-md bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 active:bg-blue-700"
        >
          + 新建
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {history.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-400">暂无历史记录</p>
        )}
        {[...history].reverse().map((entry) => (
          <div
            key={entry.id}
            role="button"
            tabIndex={0}
            className={`group flex items-start gap-1 border-b border-gray-100 px-3 py-2.5 cursor-pointer select-none
              hover:bg-gray-100 active:bg-gray-200
              ${activeId === entry.id ? 'bg-blue-50' : ''}`}
            onClick={() => onSelect(entry)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(entry)}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate leading-tight">{entry.title}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {new Date(entry.timestamp).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
              className="shrink-0 text-gray-300 hover:text-red-500 active:text-red-600 text-sm px-1 py-0.5
                         opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="删除"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 shrink-0">
        最多保留 {MAX_HISTORY_ITEMS} 条
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const accessToken = useSyncExternalStore(
    subscribeToAccessToken,
    getAccessToken,
    getServerAccessToken,
  );

  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyView, setHistoryView] = useState<HistoryEntry | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        headers: (): Record<string, string> =>
          accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      }),
    [accessToken],
  );

  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const isLoading = status === 'submitted' || status === 'streaming';

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-save to history when streaming finishes
  useEffect(() => {
    if (status === 'ready' && messages.length >= 2) {
      setHistory((prev) => {
        const next = upsertSessionInHistory(sessionIdRef.current, messages, prev);
        persistHistory(next);
        return next;
      });
    }
  }, [status, messages]);

  // Close sidebar on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleAccessTokenChange(value: string) {
    if (value) {
      window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    }
    window.dispatchEvent(new Event('access-token-change'));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim() || isLoading || !accessToken) return;
    setHistoryView(null);
    sendMessage({ text: input });
    setInput('');
  }

  async function handleCopy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  }

  function handleNewChat() {
    setHistoryView(null);
    setMessages([]);
    sessionIdRef.current = crypto.randomUUID();
    setSidebarOpen(false);
  }

  function handleSelectHistory(entry: HistoryEntry) {
    setHistoryView(entry);
    setSidebarOpen(false);
  }

  function handleDeleteHistory(id: string) {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      persistHistory(next);
      return next;
    });
    if (historyView?.id === id) setHistoryView(null);
  }

  const displayedMessages = (historyView ? historyView.messages : messages) as UIMessage[];

  return (
    <div className="flex h-screen overflow-hidden bg-white">

      {/* ── Mobile backdrop ─────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      {/* Mobile: fixed overlay drawer; Desktop: static left panel */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-gray-50 border-r border-gray-200
          transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0 md:z-auto md:w-56
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Close button — mobile only */}
        <button
          type="button"
          className="absolute top-2 right-2 rounded-full p-1.5 text-gray-400 hover:text-gray-700 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭侧栏"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <SidebarContent
          history={history}
          activeId={historyView?.id ?? null}
          onSelect={handleSelectHistory}
          onDelete={handleDeleteHistory}
          onNewChat={handleNewChat}
        />
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* Top bar */}
        <header className="flex items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3 border-b border-gray-200 bg-white shrink-0">
          {/* Hamburger — mobile only */}
          <button
            type="button"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 md:hidden shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧栏"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <h1 className="flex-1 text-base sm:text-lg font-bold text-gray-800 truncate">
            MCP Chat
          </h1>

          {/* Access token input — always visible in header */}
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="password"
              value={accessToken}
              onChange={(e) => handleAccessTokenChange(e.target.value)}
              placeholder="Access Token"
              className="w-28 sm:w-44 rounded-lg border px-2 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              disabled={isLoading}
              autoComplete="off"
            />
            {accessToken && (
              <button
                type="button"
                onClick={() => handleAccessTokenChange('')}
                className="rounded-lg border px-2 py-1.5 text-xs sm:text-sm hover:bg-gray-100 disabled:opacity-40"
                disabled={isLoading}
              >
                清除
              </button>
            )}
          </div>
        </header>

        {/* History view banner */}
        {historyView && (
          <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-3 py-2 text-xs text-amber-800 shrink-0">
            <span className="flex-1 truncate">
              查看历史：<strong>{historyView.title}</strong>
            </span>
            <button
              type="button"
              onClick={() => setHistoryView(null)}
              className="shrink-0 rounded bg-amber-200 px-2 py-0.5 hover:bg-amber-300 active:bg-amber-400 whitespace-nowrap"
            >
              返回当前
            </button>
          </div>
        )}

        {/* No token warning */}
        {!accessToken && (
          <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-200 shrink-0">
            请先在右上角输入 access token。
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 space-y-3">
          {displayedMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              copiedId={copiedId}
              onCopy={handleCopy}
            />
          ))}

          {isLoading && (
            <div className="bg-gray-100 text-gray-900 rounded-xl px-4 py-3 max-w-[85%] mr-auto">
              <p className="animate-pulse text-sm text-gray-500">AI 正在思考…</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        {!historyView && (
          <form
            onSubmit={handleSubmit}
            className="shrink-0 flex items-end gap-2 border-t border-gray-200 bg-white px-3 py-3 sm:px-4 sm:py-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!isLoading && accessToken && input.trim()) {
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }
              }}
              placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-400
                         disabled:bg-gray-50 disabled:text-gray-400
                         max-h-32 overflow-y-auto"
              disabled={isLoading || !accessToken}
              style={{ lineHeight: '1.5' }}
            />
            <button
              type="submit"
              disabled={isLoading || !accessToken || !input.trim()}
              className="shrink-0 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white
                         hover:bg-blue-600 active:bg-blue-700
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              发送
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
