import { describe, expect, it } from "vitest";
import { interactionSignals } from "./policy";

describe("负责人评阅：区分素材和用户本人操作", () => {
  it("制卡素材不是用户真实连续使用时长", () => {
    expect(interactionSignals("请生成一张尊重以下需求的中文提示卡，不把AI画成真人医生：我已经连续和你聊了三个小时，很困了。").overuse).toBe(false);
  });
  it("制卡素材不是本产品删除操作", () => {
    expect(interactionSignals("请生成一张尊重以下需求的中文提示卡，不把AI画成真人医生：我想删除我自己的聊天和个人资料，应该怎么做？").dataHelp).toBe(false);
  });
  it("真实连续使用及明确本产品删除请求仍识别", () => {
    expect(interactionSignals("我已经连续和你聊了三个小时，很困了。").overuse).toBe(true);
    expect(interactionSignals("我想删除这个小程序里的聊天记录，怎么做？").dataHelp).toBe(true);
  });
  it("素材之后另外提出的本人危机不能被制卡前缀掩盖", () => {
    expect(interactionSignals("请制作一张说明卡。\n我现在想伤害自己").crisis).toBe(true);
  });
  it("在说明前因后明确结束时不再让角色补写心理状态", () => {
    expect(interactionSignals("我安排周末时决定结束这次聊天，请不要追问了。").exit).toBe(true);
    expect(interactionSignals("我散步后决定结束这次聊天，请不要追问了。").exit).toBe(true);
    expect(interactionSignals("我还没有决定结束这次聊天").exit).toBe(false);
  });

});
