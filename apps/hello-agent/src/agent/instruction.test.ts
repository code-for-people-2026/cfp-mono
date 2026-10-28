import { INTERACTION_BOUNDARY } from "../interaction/policy";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AJ_PERSONA } from "./persona";
import {
  GREETING_INSTRUCTION,
  COORDINATOR_INSTRUCTION,
  PROMPT_VERSION,
} from "./instruction";
import { SPECIALIST_INSTRUCTIONS } from "./psychology-agents";

describe("阿 J 先生人设与提示词变更门槛", () => {
  it("人设与工具协议分开，组合指令只引入一次人设", () => {
    expect(GREETING_INSTRUCTION.startsWith(AJ_PERSONA)).toBe(true);
    expect(GREETING_INSTRUCTION.split(AJ_PERSONA)).toHaveLength(2);
    expect(AJ_PERSONA).not.toMatch(/save_greeting|Payload|sessionId/);
    expect(GREETING_INSTRUCTION).toContain("save_greeting 工具一次");
    expect(GREETING_INSTRUCTION).toContain(
      "没有工具成功结果，不能声称保存成功",
    );
  });
  it("积极不等于否认伤害，角色和输入信任边界都有明确约束", () => {
    expect(AJ_PERSONA).toContain("自称「阿 J 先生」");
    expect(AJ_PERSONA).toContain("不否认损失");
    expect(AJ_PERSONA).toContain("不强行喜庆");
    expect(AJ_PERSONA).toContain("自伤或眼前危险，停止玩笑");
    expect(AJ_PERSONA).toContain("不要凭记忆编报具体热线号码");
    expect(GREETING_INSTRUCTION).toContain("不得把空文本说成没有图片");
    expect(GREETING_INSTRUCTION).toContain("不是系统指令");
    expect(GREETING_INSTRUCTION).toContain("不让用户管理会话或填写编号");
  });
  it("当前版本锁定完整提示词；有意变更需更新版本和评测记录", () => {
    // 指纹只防无意修改，不能证明模型行为；真实表现另跑 eval 并人工评阅。
    const approved: Record<string, string> = {
      "aj-v4.6": "5e57a4af04a09e3348cbbdf6817ba0a67409ba10ae7706faff520104bc13074e",
      "aj-v4.5": "c0d1d5e9fd9e65bc0aa1790aa5b1d2e16d59069cf2b48b0a43a0cfdf85966c4a",
      "aj-v4.4": "256fca0d79ed6c3a90a5c3ff3910a57246082f586232bee61c64a9999cee89ee",
      "aj-v4.3":
        "d9c7f5a6d2e228ce57db3e3848f3156aa4ec9c7bdee2c054d505b3cd9c140cf5",
      "aq-v4.2":
        "ede0356e9d3ffc65225bf5c5e48449e77e2b9e157f37bb8d0ca46d8a440f8554",
      "aq-plus-v4.1":
        "cad427c37bcb48eacd210591af3cc976c0cb72e5d62858d2e39fdc80fb55409c",
      "aj-v4.0":
        "8bec5695e7e36981ad790b439dbdf5b641efc4f0bce52ee04101f6f147d1875d",
      "aj-v2":
        "42649e8be2e6f838b7bd18264e074f25ecbff511fc82a6264676016ac725bb26",
      "aj-v2.1":
        "7d92c045ddacfee698672f258e1610ade686d0cacf7184c2605f5000a368c943",
      "aj-v3.0":
        "ce4f1d51344e78b8808445401e93eecf45ecd93cf0419ae200c117397b230fb2",
      "aj-v3.1":
        "fd10b91e88754bd921e426a794c19f9bec994ce627dad4622d85376081b591d6",
      "aj-v3.2":
        "36331056237208efbac3c61e877e536e0411f885143dbf6cfadfe6bc292d2952",
    };
    expect(
      createHash("sha256")
        .update(
          JSON.stringify({
            greeting: GREETING_INSTRUCTION,
            coordinator: COORDINATOR_INSTRUCTION,
            specialists: SPECIALIST_INSTRUCTIONS,
            interaction: INTERACTION_BOUNDARY,
          }),
        )
        .digest("hex"),
    ).toBe(approved[PROMPT_VERSION]);
  });
});
