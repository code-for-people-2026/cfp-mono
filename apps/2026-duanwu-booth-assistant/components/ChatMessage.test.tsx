import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "./ChatMessage";

describe("ChatMessage", () => {
  it("renders an assistant URL as a link without absorbing the trailing CJK sentence", () => {
    render(
      <ChatMessage
        message={{
          id: "1",
          role: "assistant",
          content: "官网是：https://www.codeforpeople.cn/。上面有《数据平权宣言》的全文。",
        }}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://www.codeforpeople.cn/");
    expect(link).toHaveTextContent("https://www.codeforpeople.cn/");
    // The link text must not include the Chinese sentence that follows the URL.
    expect(link.textContent).not.toContain("数据平权宣言");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders user messages as plain text", () => {
    render(<ChatMessage message={{ id: "2", role: "user", content: "你们官网是什么" }} />);

    expect(screen.getByText("你们官网是什么")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
