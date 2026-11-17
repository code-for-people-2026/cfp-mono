import { INTERACTION_BOUNDARY } from "../interaction/policy";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AJ_PERSONA } from "./persona";
import {
  FACTUALITY_BOUNDARY,
  GREETING_INSTRUCTION,
  HANDOFF_PREAMBLE_CONSTRAINT,
  COORDINATOR_INSTRUCTION,
  PROMPT_VERSION,
  SERVER_ARTIFACT_PRESENTATION_RULE,
} from "./instruction";
import {
  DIRECT_EXPERT_HANDOFF_CONTRACT,
  SPECIALIST_INSTRUCTIONS,
} from "./psychology-agents";

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
  it("专家前导只对当前实际风险立即响应，不按风险词误判语义", () => {
    expect(HANDOFF_PREAMBLE_CONSTRAINT).toContain(
      "只有用户本人当前实际存在或即将发生",
    );
    expect(HANDOFF_PREAMBLE_CONSTRAINT).toContain(
      "用药的一般讨论、引用他人话语、历史事件、虚构或假设情境、预防性询问",
    );
    expect(HANDOFF_PREAMBLE_CONSTRAINT).toContain(
      "不得仅凭风险词语改走 immediate",
    );
    expect(HANDOFF_PREAMBLE_CONSTRAINT).toContain(
      "当前害怕自己会伤害儿童或他人时",
    );
    expect(HANDOFF_PREAMBLE_CONSTRAINT).toContain(
      "不能以“会害怕就证明安全”等说法作保证",
    );
  });
  it("专家按当前用户指定的题数、控件和范围交付，不被旧方法模板扩写", () => {
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "当前用户明确指定的题目数量、控件类型和范围",
    );
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "一个开放式问题",
    );
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "一个 text 或 longText 字段",
    );
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "不得附加情绪、强度或补充字段",
    );
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "coordinatorRequest 或任务摘要只是上下文",
    );
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "可在后续回合适时展开",
    );
  });
  it("可选表单缺失只代表缺失，专家生命周期默认持续陪伴", () => {
    const missingFormRule =
      "缺失、跳过或空提交的可选表单只表示本轮没有收到该字段内容";
    expect(FACTUALITY_BOUNDARY).toContain(missingFormRule);
    expect(FACTUALITY_BOUNDARY).toContain(
      "0 和显式 false 是用户给出的明确值",
    );
    expect(GREETING_INSTRUCTION).toContain(missingFormRule);
    expect(COORDINATOR_INSTRUCTION).toContain(missingFormRule);
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "lifecycle 表示用户与你的后续关系，不表示你是否已写完本条回复、卡片或表单",
    );
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain("默认用 continue");
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "用户本轮语义上要求继续、记录、陪伴、跟进或填写你交付的表单时，必须用 continue",
    );
  });
  it("默认协调指令与直接交接协议不再保留多专家和代写旧流程", () => {
    expect(COORDINATOR_INSTRUCTION).not.toContain("每轮最多两种");
    expect(COORDINATOR_INSTRUCTION).not.toContain("再整合成一份回应");
    expect(COORDINATOR_INSTRUCTION).toContain("最多选择一个最合适的心理 subagent");
    expect(COORDINATOR_INSTRUCTION).toContain(
      "向用户明确说明与该专家的本轮交接未完成",
    );
    expect(DIRECT_EXPERT_HANDOFF_CONTRACT).toContain(
      "实际作品只能放在 reply.artifacts",
    );
  });
  it("当前版本锁定完整提示词；有意变更需更新版本和评测记录", () => {
    // 指纹只防无意修改，不能证明模型行为；真实表现另跑 eval 并人工评阅。
    const approved: Record<string, string> = {
      // 2026-11-17：aj-v5.8 专家前导仅对当前实际/迫近风险走 immediate，
      // 保留历史、引用、假设和一般用药讨论的语义边界。
      "aj-v5.8": "7741a25e3d98b53a1a04b441aa7c913061688d13e33015eed1ee883d01b95f8e",
      // 2026-11-16：aj-v5.7 直接专家生命周期/作品位置语言与展示默认调整；
      // 微信 ACT 表单 65→66 联调通过，真实模型评阅待补。
      "aj-v5.7": "ae34406f6ebbee0a9fdf85a6b1409f87d24c4e34e8cc41041d2647e61ee17b6a",
      // 2026-11-16：aj-v5.6 专家失败可见回退、持续陪伴、空表单事实与单面作品约束。
      "aj-v5.6": "6ca45c1eb8331ac1f8bc105f9a8451371f0323fffaffafbdc37841fd45245375",
      // 2026-11-15：aj-v5.5 本轮显式单题开放式表单约束；真实模型复测待父任务执行。
      "aj-v5.5": "ba81b2f5561d7b1ae4e9538ac3bfcd472d4e0f7761ebc723eaa31e1efb747102",
      // 2026-11-15：aj-v5.4 专家直接交付与单活动专家协议；代码回归完成，真实模型评阅待补。
      "aj-v5.4": "1bbfc88831b06a651c234544fbc175443953dc8109a84f24d733b40137a6fb0f",
      // 2026-11-14：aj-v5.3 对话表单内联与单作品输出整改；真实模型评测尚未执行。
      "aj-v5.3": "0c4ba6b67194d6dc3c1c356e5c7ab0e7788f8af705563b8946e3ad684cd80756",
      // 2026-11-11：aj-v5.2 语义路由整改；线下脚本验收通过，真实模型评阅待补。
      "aj-v5.2": "6f6646a2c7a44c48a8d4d6ddcda944443a924176a30ff53fe7a31c58b6e434f5",
      "aj-v5.1": "b617a2af9831bafb6cb5350c08dae520df40b1fa631aeb50d7db4c03e7d4a392",
      "aj-v5.0": "6cd1fa6f3f0dfc3324fc6ade5d9504f992858a96bef7c31529c3bac673cdbfe6",
      "aj-v4.9": "dd4aaa53914ee3f005e2771d2d9d43328e67038c5b822b03e22bf71f1a1a291f",
      "aj-v4.8": "b2113bdac731b66bee0f01cf3ea493db5fdcbaef78611e64c14480615687f3d0",
      "aj-v4.7": "1de4c74faa609f737d5512931231bd77088ff099b33f8b74c24421f26fdc5412",
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
            serverArtifactPresentationRule: SERVER_ARTIFACT_PRESENTATION_RULE,
            directExpertHandoffContract: DIRECT_EXPERT_HANDOFF_CONTRACT,
            specialists: SPECIALIST_INSTRUCTIONS,
            interaction: INTERACTION_BOUNDARY,
          }),
        )
        .digest("hex"),
    ).toBe(approved[PROMPT_VERSION]);
  });
});
