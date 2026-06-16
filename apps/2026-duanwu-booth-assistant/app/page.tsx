"use client";

import { ChatComposer } from "@/components/ChatComposer";
import { ChatMessage } from "@/components/ChatMessage";
import { ContinuePanel } from "@/components/ContinuePanel";
import { EntryScreen } from "@/components/EntryScreen";
import { StatusNotice } from "@/components/StatusNotice";
import { Button } from "@/components/ui/button";
import {
  compactMessagesForRequest,
  messagesForSummary,
  recentMessagesAfterSummary,
  shouldSummarize,
  type ChatMessage as ChatMessageType,
  type EntryMode,
} from "@/lib/chat/conversation";
import {
  clearStoredConversation,
  getBrowserStorage,
  loadStoredConversation,
  saveStoredConversation,
} from "@/lib/chat/localConversation";
import { useEffect, useRef, useState } from "react";

const openingMessages: Record<EntryMode, string> = {
  intro:
    "这个摊位想讨论一件事：AI 时代的软件和数据能力，能不能不只服务平台和公司，也认真服务普通劳动者。“为工友敲键盘”现在还是早期项目，正在整理理念、寻找同路人，并尝试做真正有用的工具。你可以继续问：数据平权是什么意思、AI 下乡为什么重要，或者这和普通公益有什么不同。",
  doubt:
    "怀疑很正常，尤其是看到“为工友”“AI”“数据平权”这些词放在一起。你可以直接问尖锐一点：这是不是中产自我感动，AI 会不会只是资本的新工具，或者这个项目凭什么说自己在服务工友。材料说不清的地方，我不会硬圆。",
  continue:
    "可以继续问我，也可以等摊主空下来直接聊。如果你还没想好怎么开口，可以先把问题丢给我，我也可以帮你整理成适合现场继续聊的问题。官网和联系方式在页面的“继续了解”里，不会打断你现在的对话。",
  free: "",
};

function createMessage(role: ChatMessageType["role"], content: string): ChatMessageType {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
  };
}

async function readJson(response: Response): Promise<{ answer?: string; error?: string; summary?: string }> {
  try {
    return (await response.json()) as { answer?: string; error?: string; summary?: string };
  } catch {
    return {};
  }
}

export default function Home() {
  const [mode, setMode] = useState<EntryMode>("intro");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [conversationSummary, setConversationSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  const started = messages.length > 0;

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      const storage = getBrowserStorage();
      const restored = storage ? loadStoredConversation(storage) : null;
      if (restored) {
        setMode(restored.mode);
        setMessages(restored.messages);
        setConversationSummary(restored.conversationSummary);
      }
      setStorageReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    const storage = getBrowserStorage();
    if (!storage) {
      return;
    }

    if (messages.length === 0 && !conversationSummary) {
      clearStoredConversation(storage);
      return;
    }

    saveStoredConversation(storage, {
      mode,
      messages,
      conversationSummary,
    });
  }, [conversationSummary, messages, mode, storageReady]);

  useEffect(() => {
    if (!started) {
      return;
    }

    conversationEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [loading, notice, messages.length, started]);

  function startWithMode(nextMode: EntryMode) {
    setMode(nextMode);
    const opening = openingMessages[nextMode];
    if (opening) {
      setMessages([createMessage("assistant", opening)]);
    }
  }

  function resetConversation() {
    const hasUserMessages = messages.some((message) => message.role === "user");
    if (hasUserMessages && !window.confirm("清空这次对话？内容只保存在本机浏览器。")) {
      return;
    }

    setMode("intro");
    setMessages([]);
    setConversationSummary("");
    setNotice("");
    const storage = getBrowserStorage();
    if (storage) {
      clearStoredConversation(storage);
    }
  }

  async function summarizeIfNeeded(nextMessages: ChatMessageType[]) {
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
  }

  async function sendMessage(content: string) {
    const userMessage = createMessage("user", content);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setLoading(true);
    setNotice("");

    try {
      const compacted = await summarizeIfNeeded(nextMessages);
      const contextMessages = compacted.messages.filter((message) => message.id !== userMessage.id);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          message: content,
          messages: compactMessagesForRequest(contextMessages),
          conversationSummary: compacted.summary,
        }),
      });

      const data = await readJson(response);
      if (!response.ok || !data.answer) {
        throw new Error(data.error ?? "网络可能有点不稳，可以重试一次。");
      }
      const answer = data.answer;

      setMessages((current) => [...current, createMessage("assistant", answer)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "网络可能有点不稳，可以重试一次。";
      setNotice(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      {!started ? <EntryScreen onSelectMode={startWithMode} /> : null}
      {started ? (
        <section className="chat-shell" aria-label="对话">
          <div className="chat-header">
            <span>数据平权，AI 下乡</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full bg-popover px-2.5 text-muted-foreground hover:text-foreground"
              onClick={resetConversation}
              disabled={loading}
            >
              重新开始
            </Button>
          </div>
          <div className="message-list">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {loading ? <StatusNotice>正在组织回答...</StatusNotice> : null}
            {notice ? <StatusNotice>{notice}</StatusNotice> : null}
            <div ref={conversationEndRef} aria-hidden="true" style={{ minHeight: "var(--composer-safe-area)" }} />
          </div>
        </section>
      ) : null}
      <ContinuePanel />
      <ChatComposer disabled={loading} onSend={sendMessage} />
    </main>
  );
}
