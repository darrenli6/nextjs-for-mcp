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

type SocialContent = { title?: string; description?: string; hashtags?: string[] };

function parseSocial(output: unknown): SocialContent | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const o = output as Record<string, unknown>;
  const s = o.social;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return s as SocialContent;
}

function SocialCard({ social, index }: { social: SocialContent; index?: number }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => null);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const hashtagLine = (social.hashtags ?? []).map((t) => `#${t}`).join(' ');
  const prefix = index !== undefined ? `图片 ${index + 1} ` : '';

  return (
    <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 space-y-2 text-xs text-violet-900">
      <p className="font-semibold text-violet-700">{prefix}社媒内容</p>

      {social.title && (
        <div className="flex items-start gap-1.5">
          <span className="shrink-0 font-medium w-14">标题</span>
          <span className="flex-1 break-words">{social.title}</span>
          <button
            type="button"
            onClick={() => copyText('title', social.title!)}
            className="shrink-0 rounded border border-violet-300 px-1.5 py-0.5 hover:bg-violet-200 transition-colors"
          >
            {copied === 'title' ? '✓' : '复制'}
          </button>
        </div>
      )}

      {social.description && (
        <div className="flex items-start gap-1.5">
          <span className="shrink-0 font-medium w-14">描述</span>
          <span className="flex-1 break-words leading-relaxed">{social.description}</span>
          <button
            type="button"
            onClick={() => copyText('desc', social.description!)}
            className="shrink-0 rounded border border-violet-300 px-1.5 py-0.5 hover:bg-violet-200 transition-colors"
          >
            {copied === 'desc' ? '✓' : '复制'}
          </button>
        </div>
      )}

      {hashtagLine && (
        <div className="flex items-start gap-1.5">
          <span className="shrink-0 font-medium w-14">Hashtag</span>
          <span className="flex-1 break-words text-violet-600">{hashtagLine}</span>
          <button
            type="button"
            onClick={() => copyText('tags', hashtagLine)}
            className="shrink-0 rounded border border-violet-300 px-1.5 py-0.5 hover:bg-violet-200 transition-colors"
          >
            {copied === 'tags' ? '✓' : '复制'}
          </button>
        </div>
      )}

      {/* One-click copy everything */}
      <button
        type="button"
        onClick={() =>
          copyText(
            'all',
            [social.title, social.description, hashtagLine].filter(Boolean).join('\n\n'),
          )
        }
        className="w-full rounded border border-violet-300 px-2 py-1 text-center hover:bg-violet-200 transition-colors font-medium"
      >
        {copied === 'all' ? '已全部复制 ✓' : '一键复制全部'}
      </button>
    </div>
  );
}

function TranslateToolResult({ output, label }: { output: unknown; label: string }) {
  const imageUrls = collectImageUrls(output);
  const social = parseSocial(output);

  return (
    <details className="my-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" open={imageUrls.length > 0}>
      <summary className="cursor-pointer font-medium">
        {imageUrls.length > 0 ? label : '图片翻译工具结果'}
      </summary>
      {imageUrls.length > 0 ? (
        <>
          <ImageGrid imageUrls={imageUrls} />
          {social && <SocialCard social={social} />}
        </>
      ) : (
        <p className="mt-2 text-red-700">翻译工具未返回图片链接。</p>
      )}
    </details>
  );
}

function BatchTranslateToolResult({ output, label }: { output: unknown; label?: string }) {
  type BatchItem = {
    url?: string;
    success?: boolean;
    imageUrls?: string[];
    error?: string;
    social?: SocialContent | null;
  };
  const items: BatchItem[] = Array.isArray(output)
    ? (output as BatchItem[])
    : (() => { try { return JSON.parse(String(output)) as BatchItem[]; } catch { return []; } })();

  if (items.length === 0) return null;
  const successCount = items.filter((i) => i.success).length;

  return (
    <details
      className="my-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
      open
    >
      <summary className="cursor-pointer font-medium">
        {label ?? '批量图片翻译结果'}（{successCount}/{items.length} 成功）
      </summary>
      <div className="mt-2 space-y-5">
        {items.map((item, i) => (
          <div key={item.url ?? i} className="space-y-1">
            <p className="font-medium text-emerald-800">
              {item.success ? '✅' : '❌'} 图片 {i + 1}
            </p>
            {item.success && item.imageUrls && item.imageUrls.length > 0 ? (
              <>
                <ImageGrid imageUrls={item.imageUrls} />
                {item.social && <SocialCard social={item.social} index={i} />}
              </>
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
        if (part.type === 'tool-translate_image_to_chinese' || part.type === 'tool-translate_image_to_language') {
          return <TranslateToolResult key={index} output={part.output} label="图片翻译结果" />;
        }
        if (part.type === 'tool-batch_translate_images_to_chinese' || part.type === 'tool-batch_translate_images') {
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

// ─── Pending image type ───────────────────────────────────────────────────────

type PendingImage = {
  id: string;
  previewUrl: string;   // local object URL for preview
  s3Url: string | null; // URL returned after upload
  uploading: boolean;
  error: string | null;
};

const LANGUAGES = [
  { label: '简体中文', value: 'Simplified Chinese' },
  { label: '繁体中文', value: 'Traditional Chinese' },
  { label: 'English', value: 'English' },
  { label: '日本語', value: 'Japanese' },
  { label: '한국어', value: 'Korean' },
  { label: 'Français', value: 'French' },
  { label: 'Español', value: 'Spanish' },
  { label: 'Deutsch', value: 'German' },
  { label: 'العربية', value: 'Arabic' },
  { label: 'Português', value: 'Portuguese' },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [targetLanguage, setTargetLanguage] = useState('Simplified Chinese');
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Upload one image file to S3 and update its entry in pendingImages
  async function uploadImageToS3(imageId: string, file: File) {
    setPendingImages((prev) =>
      prev.map((img) => (img.id === imageId ? { ...img, uploading: true, error: null } : img)),
    );
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? `Upload failed (${res.status})`);
      setPendingImages((prev) =>
        prev.map((img) =>
          img.id === imageId ? { ...img, uploading: false, s3Url: json.url! } : img,
        ),
      );
    } catch (err) {
      setPendingImages((prev) =>
        prev.map((img) =>
          img.id === imageId ? { ...img, uploading: false, error: String(err) } : img,
        ),
      );
    }
  }

  function addFiles(files: File[]) {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const newImages: PendingImage[] = imageFiles.map((file) => ({
      id: crypto.randomUUID(),
      previewUrl: URL.createObjectURL(file),
      s3Url: null,
      uploading: false,
      error: null,
    }));
    setPendingImages((prev) => [...prev, ...newImages]);
    newImages.forEach((img, i) => uploadImageToS3(img.id, imageFiles[i]));
  }

  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  function removeImage(id: string) {
    setPendingImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const readyImages = pendingImages.filter((img) => img.s3Url);
    const hasImages = readyImages.length > 0;
    if ((!input.trim() && !hasImages) || isLoading || !accessToken) return;

    setHistoryView(null);

    let messageText = input.trim();

    if (hasImages) {
      const langLabel = LANGUAGES.find((l) => l.value === targetLanguage)?.label ?? targetLanguage;
      const urlList = readyImages.map((img, i) => `图片${i + 1}: ${img.s3Url}`).join('\n');
      const instruction = `请将以下 ${readyImages.length} 张图片中的文字翻译成${langLabel}（targetLanguage: ${targetLanguage}）。`;
      messageText = messageText
        ? `${instruction}\n用户备注：${messageText}\n\n${urlList}`
        : `${instruction}\n\n${urlList}`;
    }

    sendMessage({ text: messageText });
    setInput('');
    // Cleanup preview URLs
    pendingImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setPendingImages([]);
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
  const hasReadyImages = pendingImages.some((img) => img.s3Url);
  const isUploading = pendingImages.some((img) => img.uploading);

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
            onPaste={handlePaste}
            className="shrink-0 flex flex-col gap-2 border-t border-gray-200 bg-white px-3 py-3 sm:px-4 sm:py-3"
          >
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Image previews */}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingImages.map((img) => (
                  <div key={img.id} className="relative w-16 h-16 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.previewUrl}
                      alt="pending"
                      className={`w-full h-full rounded-lg object-cover border-2 ${
                        img.error ? 'border-red-400' : img.s3Url ? 'border-emerald-400' : 'border-blue-300'
                      }`}
                    />
                    {img.uploading && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      </div>
                    )}
                    {img.s3Url && !img.uploading && (
                      <div className="absolute bottom-0.5 right-0.5 rounded-full bg-emerald-500 p-0.5">
                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {img.error && (
                      <div className="absolute bottom-0.5 right-0.5 rounded-full bg-red-500 px-1 text-[9px] text-white">!</div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-gray-700 p-0.5 text-white hover:bg-red-600"
                      title="移除"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Language selector — visible when images are pending */}
            {pendingImages.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span className="shrink-0">翻译语言：</span>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  disabled={isLoading}
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                  ))}
                </select>
                {isUploading && (
                  <span className="text-blue-500 flex items-center gap-1">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
                    上传中…
                  </span>
                )}
                {hasReadyImages && !isUploading && (
                  <span className="text-emerald-600">{pendingImages.filter(i => i.s3Url).length} 张已上传到 S3</span>
                )}
              </div>
            )}

            {/* Text input row */}
            <div className="flex items-end gap-2">
              {/* Upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || !accessToken}
                title="上传图片"
                className="shrink-0 rounded-xl border border-gray-300 p-2.5 text-gray-500
                           hover:bg-gray-100 active:bg-gray-200
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const readyImages = pendingImages.filter((img) => img.s3Url);
                    if (!isLoading && accessToken && (input.trim() || readyImages.length > 0)) {
                      handleSubmit(e as unknown as React.FormEvent);
                    }
                  }
                }}
                placeholder={pendingImages.length > 0 ? '可选：补充说明（Enter 发送）' : '输入消息… 或粘贴图片 (Enter 发送，Shift+Enter 换行)'}
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
                disabled={isLoading || !accessToken || (!input.trim() && !hasReadyImages) || isUploading}
                className="shrink-0 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white
                           hover:bg-blue-600 active:bg-blue-700
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-colors"
              >
                发送
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
