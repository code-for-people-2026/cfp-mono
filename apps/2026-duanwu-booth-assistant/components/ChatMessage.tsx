import type { ChatMessage as ChatMessageType } from "@/lib/chat/conversation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const assistantMarkdownElements = ["p", "strong", "em", "ul", "ol", "li", "a", "code", "pre", "blockquote", "br"];

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const label = message.role === "user" ? "你" : "摊位助手";
  const isAssistant = message.role === "assistant";

  return (
    <article className={`message message-${message.role}`}>
      <div className="message-label">{label}</div>
      <div className="message-content">
        {isAssistant ? (
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
          message.content
        )}
      </div>
    </article>
  );
}
