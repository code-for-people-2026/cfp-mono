import type { Artifact } from "../src/artifacts";

export const artifacts: Artifact[] = [
  {
    kind: "card",
    id: "one_step",
    title: "且动一下手",
    body: "先打开文档，只写一行。",
    items: ["做完可以停下"],
  },
  {
    kind: "table",
    id: "plan",
    title: "三日小计划",
    columns: ["日子", "小事"],
    rows: [
      ["今天", "写一行"],
      ["明天", "改一句"],
    ],
  },
  {
    kind: "image",
    id: "sun",
    title: "天总还有一点亮",
    alt: "暖黄色的太阳",
    source: {
      type: "illustration",
      background: "#f5f4ed",
      shapes: [
        { type: "circle", x: 320, y: 160, radius: 70, fill: "#e9ba62" },
        {
          type: "text",
          x: 200,
          y: 300,
          text: "先歇一歇",
          fill: "#395943",
          size: 32,
        },
      ],
    },
  },
  {
    kind: "page",
    id: "rest",
    title: "下班后的半小时",
    subtitle: "按你的节奏来",
    sections: [
      { heading: "先休息", body: "让身体坐稳，喝口水。" },
      { heading: "再连接", body: "找个信任的人聊两句。" },
    ],
  },
  {
    kind: "form",
    id: "thought_record",
    title: "把事实和想法分开看看",
    description: "按愿意分享的程度填写。",
    submitLabel: "陪我看看",
    fields: [
      {
        id: "situation",
        label: "发生了什么？",
        type: "longText",
        required: true,
      },
      { id: "thought", label: "当时的想法", type: "longText", required: false },
      { id: "emotion", label: "当时的情绪", type: "text", required: false },
      {
        id: "intensity",
        label: "情绪强度",
        type: "number",
        required: false,
        min: 0,
        max: 100,
      },
    ],
  },
];
