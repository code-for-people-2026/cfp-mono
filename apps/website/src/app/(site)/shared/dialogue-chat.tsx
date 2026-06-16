"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  compactMessagesForRequest,
  messagesForSummary,
  recentMessagesAfterSummary,
  shouldSummarize,
  type ChatMessage as ChatMessageType,
} from "@/lib/chat/conversation";
import {
  clearStoredConversation,
  getBrowserStorage,
  loadStoredConversation,
  saveStoredConversation,
} from "@/lib/chat/localConversation";
import { dialogueEntry, dialogueSuggestions } from "@/content/site";

const MODE = "free" as const;

const assistantMarkdownElements = [
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "a",
  "code",
  "pre",
  "blockquote",
  "br",
];

function createMessage(role: ChatMessageType["role"], content: string): ChatMessageType {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
  };
}

async function readJson(
  response: Response,
): Promise<{ answer?: string; error?: string; summary?: string }> {
  try {
    return (await response.json()) as { answer?: string; error?: string; summary?: string };
  } catch {
    return {};
  }
}

export function DialogueChat({ initialQuestion }: { initialQuestion?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [conversationSummary, setConversationSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const didInitRef = useRef(false);

  const started = messages.length > 0;
  const trimmedComposer = composerValue.trim();

  const summarizeIfNeeded = useCallback(
    async (nextMessages: ChatMessageType[]) => {
      if (!shouldSummarize(nextMessages)) {
        return { summary: conversationSummary, messages: nextMessages };
      }

      try {
        const response = await fetch("/api/summarize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            previousSummary: conversationSummary,
            messages: messagesForSummary(nextMessages),
          }),
        });

        if (!response.ok) {
          return { summary: conversationSummary, messages: nextMessages };
        }

        const data = await readJson(response);
        if (!data.summary) {
          return { summary: conversationSummary, messages: nextMessages };
        }

        setConversationSummary(data.summary);
        const recent = recentMessagesAfterSummary(nextMessages);
        setMessages(recent);
        return { summary: data.summary, messages: recent };
      } catch {
        return { summary: conversationSummary, messages: nextMessages };
      }
    },
    [conversationSummary],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userMessage = createMessage("user", trimmed);
      const nextMessages = [...messages, userMessage];
      setComposerValue("");
      setMessages(nextMessages);
      setLoading(true);
      setNotice("");

      try {
        const compacted = await summarizeIfNeeded(nextMessages);
        const contextMessages = compacted.messages.filter(
          (message) => message.id !== userMessage.id,
        );
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: MODE,
            message: trimmed,
            messages: compactMessagesForRequest(contextMessages),
            conversationSummary: compacted.summary,
          }),
        });

        const data = await readJson(response);
        if (!response.ok || !data.answer) {
          throw new Error(data.error ?? "网络可能有点不稳，可以重试一次。");
        }

        setMessages((current) => [...current, createMessage("assistant", data.answer as string)]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "网络可能有点不稳，可以重试一次。";
        setNotice(message);
      } finally {
        setLoading(false);
      }
    },
    [messages, summarizeIfNeeded],
  );

  // Restore stored conversation, or auto-send the question carried from the home page.
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      const storage = getBrowserStorage();
      const question = initialQuestion?.trim();

      if (question) {
        if (storage) clearStoredConversation(storage);
        setStorageReady(true);
        router.replace("/dialogue");
        void sendMessage(question);
        return;
      }

      const restored = storage ? loadStoredConversation(storage) : null;
      if (restored) {
        setMessages(restored.messages);
        setConversationSummary(restored.conversationSummary);
      }
      setStorageReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [initialQuestion, router, sendMessage]);

  useEffect(() => {
    if (!storageReady) return;

    const storage = getBrowserStorage();
    if (!storage) return;

    if (messages.length === 0 && !conversationSummary) {
      clearStoredConversation(storage);
      return;
    }

    saveStoredConversation(storage, { mode: MODE, messages, conversationSummary });
  }, [conversationSummary, messages, storageReady]);

  useEffect(() => {
    if (!started) return;
    conversationEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [loading, notice, messages.length, started]);

  function resetConversation() {
    const hasUserMessages = messages.some((message) => message.role === "user");
    if (hasUserMessages && !window.confirm("清空这次对话？内容只保存在本机浏览器。")) {
      return;
    }

    setMessages([]);
    setConversationSummary("");
    setNotice("");
    const storage = getBrowserStorage();
    if (storage) clearStoredConversation(storage);
  }

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedComposer || loading) return;
    void sendMessage(trimmedComposer);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
    event.preventDefault();
    if (!trimmedComposer || loading) return;
    void sendMessage(trimmedComposer);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-6 sm:px-8 lg:px-10">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)] no-underline transition-colors hover:text-[var(--accent)]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          回到首页
        </Link>
        {started ? (
          <button
            type="button"
            onClick={resetConversation}
            disabled={loading}
            className="rounded-full border border-[var(--border)] bg-[var(--chip)] px-3 py-1.5 text-xs font-bold text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            重新开始
          </button>
        ) : null}
      </div>

      <section className="mt-6 flex flex-1 flex-col" aria-label="对话">
        {!started && !loading ? (
          <div className="flex flex-1 flex-col justify-center py-10 text-center">
            <h1 className="text-3xl font-black leading-tight tracking-normal sm:text-4xl">
              从一个问题开始了解码成工
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-[var(--muted)]">
              这里基于已经公开的文本回答。可以直接提问，也可以先从下面几个问题开始。
            </p>
            <div className="mx-auto mt-8 flex max-w-xl flex-wrap justify-center gap-2">
              {dialogueSuggestions.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => void sendMessage(suggestion.value)}
                  className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--chip)] px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-5">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-[var(--border)] bg-[var(--accent)] px-4 py-3 text-[var(--paper)] shadow-[var(--shadow-soft)]"
                    : "mr-auto max-w-[90%] rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-[var(--ink)] shadow-[var(--shadow-soft)]"
                }
              >
                <div className="mb-1.5 text-xs font-bold opacity-70">
                  {message.role === "user" ? "你" : "码成工助手"}
                </div>
                <div className="dialogue-prose text-base leading-7">
                  {message.role === "assistant" ? (
                    <ReactMarkdown
                      allowedElements={assistantMarkdownElements}
                      remarkPlugins={[remarkGfm]}
                      skipHtml
                      unwrapDisallowed
                      components={{
                        a: ({ children, href, title }) => (
                          <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </article>
            ))}
            {loading ? (
              <p className="mr-auto text-sm font-semibold text-[var(--muted)]">正在组织回答…</p>
            ) : null}
            {notice ? (
              <p className="mr-auto max-w-[90%] rounded-2xl border border-[var(--border)] bg-[var(--soft)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
                {notice}
              </p>
            ) : null}
            <div ref={conversationEndRef} aria-hidden="true" />
          </div>
        )}
      </section>

      <div className="sticky bottom-0 z-10 mt-6 pb-4 pt-2">
        <form
          onSubmit={submitComposer}
          className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--composer)] shadow-[var(--shadow-large)] backdrop-blur-xl transition-colors focus-within:border-[var(--ring)] focus-within:ring-4 focus-within:ring-[var(--ring-soft)]"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_48px] items-end gap-3 p-4">
            <textarea
              aria-label="想了解的问题"
              className="max-h-[160px] min-h-[44px] w-full resize-none border-0 bg-transparent p-1 text-base leading-7 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]/75"
              maxLength={1000}
              rows={1}
              placeholder={dialogueEntry.placeholder}
              value={composerValue}
              disabled={loading}
              onChange={(event) => setComposerValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <button
              type="submit"
              aria-label={dialogueEntry.submitLabel}
              disabled={loading || trimmedComposer.length === 0}
              className="grid h-12 w-12 place-items-center rounded-full bg-[var(--ink)] text-[var(--bg)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <p className="px-4 pb-3 text-center text-xs leading-5 text-[var(--muted)]">
            内容由 AI 基于公开文本生成，请仔细甄别。
          </p>
        </form>
      </div>
    </div>
  );
}
