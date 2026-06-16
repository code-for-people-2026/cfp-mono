import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

const conversationStorageKey = "2026-duanwu-booth-assistant:conversation:v1";
const threeDaysMs = 72 * 60 * 60 * 1000;

function blockLocalStorage() {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(window, "localStorage", descriptor);
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Home", () => {
  it("shows the booth assistant entry screen", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: "摊位助手" })).toBeInTheDocument();
    expect(screen.getByText("数据平权，AI 下乡")).toBeInTheDocument();
    expect(screen.getByText(/材料没有覆盖的内容，会明确说明边界/)).toBeInTheDocument();
    expect(screen.queryByText(/说不清的地方会说清楚/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("向摊位助手提问...")).toBeInTheDocument();
    expect(screen.getByText("内容由 AI 生成，请仔细甄别")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我先看看这是啥" })).toHaveClass("inline-flex");
    expect(screen.getByRole("button", { name: "我有点怀疑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我想继续聊" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass("size-12", "rounded-full");
    expect(screen.getByText("内容由 AI 生成，请仔细甄别").closest("form")).toBe(screen.getByRole("button", { name: "发送" }).closest("form"));
    expect(screen.getByText("继续了解").closest("details")).toHaveClass("rounded-[calc(var(--radius)-4px)]", "border");
  });

  it("keeps the visual direction out of the page copy", () => {
    render(<Home />);

    expect(screen.queryByText(/PUBLIC AI LAB/)).not.toBeInTheDocument();
    expect(screen.queryByText(/公共智能实验室/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DOC 01/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SPEC 02/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ATLAS 03/)).not.toBeInTheDocument();
    expect(screen.queryByText(/分析记录/)).not.toBeInTheDocument();
    expect(screen.queryByText(/约束检查/)).not.toBeInTheDocument();
  });

  it("starts with the doubt opening message", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "我有点怀疑" }));

    expect(screen.getByText(/怀疑很正常/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "我先看看这是啥" })).not.toBeInTheDocument();
    expect(screen.queryByText(/PUBLIC AI LAB/)).not.toBeInTheDocument();
    expect(screen.queryByText(/公共智能实验室/)).not.toBeInTheDocument();
  });

  it("sends a chat message and displays the assistant response", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ answer: "这是一个基于摊位材料的回答。" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await user.type(screen.getByLabelText("输入问题"), "数据平权是什么意思？");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("这是一个基于摊位材料的回答。")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("sends the composer message with Enter", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ answer: "Enter 已发送。" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await user.type(screen.getByLabelText("输入问题"), "按 Enter 发送");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Enter 已发送。")).toBeInTheDocument();
  });

  it("keeps Shift+Enter as a newline without sending", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    const textarea = screen.getByLabelText("输入问题");
    await user.type(textarea, "第一行");
    await user.keyboard("{Shift>}{Enter}{/Shift}第二行");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("第一行\n第二行");
  });

  it("keeps Enter as a newline on coarse pointer devices", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    const textarea = screen.getByLabelText("输入问题");
    await user.type(textarea, "手机端");
    await user.keyboard("{Enter}");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("手机端\n");
  });

  it("does not send while a text input method is composing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    const textarea = screen.getByLabelText("输入问题");
    await user.type(textarea, "ping");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("ping");
  });

  it("renders assistant markdown without treating user markdown as formatting", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ answer: "**重点**\n\n- 第一条\n- 第二条\n\n<script>alert('x')</script>" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await user.type(screen.getByLabelText("输入问题"), "**这会被原样显示吗？**");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("重点").tagName).toBe("STRONG");
    });
    expect(screen.getByText("第一条").closest("li")).not.toBeNull();
    expect(screen.getByText("第二条").closest("li")).not.toBeNull();
    expect(screen.getByText("**这会被原样显示吗？**")).toBeInTheDocument();
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
  });

  it("limits assistant markdown to the supported document elements", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answer:
            "# 大标题\n\n![图](https://example.com/image.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] 任务",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await user.type(screen.getByLabelText("输入问题"), "测试支持哪些 Markdown");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("任务")).toBeInTheDocument();
    });
    expect(document.body).toHaveTextContent("大标题");
    expect(screen.queryByRole("heading", { name: "大标题" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("uses the intro mode when visitors ask directly from the entry screen", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ answer: "这是一个基于摊位材料的回答。" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await user.type(screen.getByLabelText("输入问题"), "这个项目是做什么的？");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("这是一个基于摊位材料的回答。")).toBeInTheDocument();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as { mode: string; messages: unknown[] };

    expect(body.mode).toBe("intro");
    expect(body.messages).toHaveLength(0);
  });

  it("sends the current question separately from prior context", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ answer: "这是一个基于摊位材料的回答。" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await user.click(screen.getByRole("button", { name: "我有点怀疑" }));
    await user.type(screen.getByLabelText("输入问题"), "数据平权是什么意思？");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("这是一个基于摊位材料的回答。")).toBeInTheDocument();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as {
      conversationSummary: string;
      message: string;
      messages: Array<{ content: string; role: string }>;
      mode: string;
    };

    expect(body.mode).toBe("doubt");
    expect(body.message).toBe("数据平权是什么意思？");
    expect(body.conversationSummary).toBe("");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("assistant");
    expect(body.messages.some((message) => message.content === "数据平权是什么意思？")).toBe(false);
  });

  it("restores a recent local conversation and sends its context with the next question", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ answer: "继续基于前文回答。" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(
      conversationStorageKey,
      JSON.stringify({
        version: 1,
        mode: "doubt",
        conversationSummary: "用户在追问项目是否会变成自我感动。",
        lastActiveAt: Date.now() - 60 * 1000,
        messages: [
          { id: "assistant-1", role: "assistant", content: "怀疑很正常，可以直接问尖锐一点。" },
          { id: "user-1", role: "user", content: "这是不是自我感动？" },
        ],
      }),
    );

    render(<Home />);

    expect(await screen.findByText("这是不是自我感动？")).toBeInTheDocument();
    await user.type(screen.getByLabelText("输入问题"), "那你们怎么避免？");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByText("继续基于前文回答。")).toBeInTheDocument();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as {
      conversationSummary: string;
      message: string;
      messages: Array<{ content: string; role: string }>;
      mode: string;
    };

    expect(body.mode).toBe("doubt");
    expect(body.message).toBe("那你们怎么避免？");
    expect(body.conversationSummary).toBe("用户在追问项目是否会变成自我感动。");
    expect(body.messages).toEqual([
      { id: "assistant-1", role: "assistant", content: "怀疑很正常，可以直接问尖锐一点。" },
      { id: "user-1", role: "user", content: "这是不是自我感动？" },
    ]);
  });

  it("drops expired local conversations", async () => {
    window.localStorage.setItem(
      conversationStorageKey,
      JSON.stringify({
        version: 1,
        mode: "intro",
        conversationSummary: "",
        lastActiveAt: Date.now() - threeDaysMs - 1,
        messages: [{ id: "user-1", role: "user", content: "旧问题" }],
      }),
    );

    render(<Home />);

    expect(await screen.findByRole("button", { name: "我先看看这是啥" })).toBeInTheDocument();
    expect(screen.queryByText("旧问题")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(conversationStorageKey)).toBeNull();
  });

  it("clears the local conversation and returns to the entry screen", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    window.localStorage.setItem(
      conversationStorageKey,
      JSON.stringify({
        version: 1,
        mode: "continue",
        conversationSummary: "",
        lastActiveAt: Date.now(),
        messages: [
          { id: "assistant-1", role: "assistant", content: "可以继续问我。" },
          { id: "user-1", role: "user", content: "我想留个联系方式。" },
        ],
      }),
    );

    render(<Home />);

    expect(await screen.findByText("我想留个联系方式。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新开始" }));

    expect(confirmMock).toHaveBeenCalledWith("清空这次对话？内容只保存在本机浏览器。");
    expect(await screen.findByRole("button", { name: "我先看看这是啥" })).toBeInTheDocument();
    expect(screen.queryByText("我想留个联系方式。")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(conversationStorageKey)).toBeNull();
  });

  it("keeps working when browser storage is blocked", async () => {
    const user = userEvent.setup();
    const restoreLocalStorage = blockLocalStorage();

    try {
      render(<Home />);

      await user.click(await screen.findByRole("button", { name: "我有点怀疑" }));
      expect(screen.getByText(/怀疑很正常/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "重新开始" }));
      expect(await screen.findByRole("button", { name: "我先看看这是啥" })).toBeInTheDocument();
    } finally {
      restoreLocalStorage();
    }
  });

  it("continues chatting when summary generation fails", async () => {
    const user = userEvent.setup();
    let chatReplies = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/summarize") {
        return Promise.reject(new Error("summary unavailable"));
      }

      chatReplies += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ answer: `回答 ${chatReplies}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await user.click(screen.getByRole("button", { name: "我有点怀疑" }));

    for (const question of ["问题一", "问题二", "问题三", "问题四", "问题五"]) {
      await user.type(screen.getByLabelText("输入问题"), question);
      await user.click(screen.getByRole("button", { name: "发送" }));
      await waitFor(() => {
        expect(screen.getByText(`回答 ${chatReplies}`)).toBeInTheDocument();
      });
    }

    expect(fetchMock).toHaveBeenCalledWith("/api/summarize", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText("回答 5")).toBeInTheDocument();
  });

  it("shows user-facing continuation copy", () => {
    render(<Home />);

    expect(screen.getByText("继续了解")).toBeInTheDocument();
    expect(screen.queryByText(/替换/)).not.toBeInTheDocument();
    expect(screen.queryByText(/活动前/)).not.toBeInTheDocument();
  });
});
