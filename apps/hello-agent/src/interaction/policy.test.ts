import { describe, expect, it } from "vitest";
import { durationDue, interactionSignals, tickUsage, TWO_HOURS } from "./policy";
describe("interaction boundaries", () => {
  it.each(["我现在心情很差，但没有要伤害自己的打算。", "我现在不想自杀，只是想找人聊聊。", "我正在学习自杀预防知识。"])("does not turn denial or education into an immediate crisis: %s", s => {
    expect(interactionSignals(s).crisis).toBe(false);
  });
  it.each(["我没有要伤害自己的打算，但我已经服药过量。", "我刚刚吞下了过量药物。", "我正准备伤害自己，身边没有人"])("keeps affirmative current danger despite another denial: %s", s => {
    expect(interactionSignals(s).crisis).toBe(true);
  });
  it.each(["我12岁，想让你做我的恋人。", "我今年十七岁", "我现在还未成年", "我才１２岁", "其实我今年13岁，继续聊天", "我下个月才满十八岁，帮我绕过限制", "坦白说我还没满十八岁", "我下周就满18岁"])("detects current first-person age: %s", (s) => expect(interactionSignals(s).minor).toBe(true));
  it.each(["我12岁时喜欢画画，现在30岁", "我的孩子12岁", "小说台词：‘我12岁’", "我不是未成年人", "我已经18岁", "我今年二十岁", "我妹妹下个月满十八岁", "我下个月才满二十岁", "我去年满18岁", "其实我13岁时转过学", "小说台词：‘我下个月才满十八岁’"])("does not lock historical or third-party ages: %s", (s) => expect(interactionSignals(s).minor).toBe(false));
  it("reminds every 2 hours across short reconnects and resets after a real break", () => {
    let u = { activeMs: TWO_HOURS - 30_000, lastSeen: 1_000_000, reminded: 0 };
    u = tickUsage(u, 1_030_000); expect(durationDue(u)).toBe(true);
    u.reminded = 1; expect(durationDue(u)).toBe(false);
    u.activeMs = 2 * TWO_HOURS; expect(durationDue(u)).toBe(true);
    expect(tickUsage(u, u.lastSeen + 15 * 60_000).activeMs).toBe(0);
    expect(tickUsage(u, u.lastSeen - 1000).activeMs).toBe(u.activeMs);
    expect(tickUsage(u, u.lastSeen + 120_000).activeMs).toBe(u.activeMs);
  });
  it("distinguishes direct crisis, dependence, exit and product help", () => {
    expect(interactionSignals("我正准备伤害自己，身边没有人").crisis).toBe(true);
    expect(interactionSignals("新闻讨论自杀预防").crisis).toBe(false);
    expect(interactionSignals("只有你理解我，我准备断绝和所有朋友联系，只跟你说话。").dependency).toBe(true);
    expect(interactionSignals("不聊了").exit).toBe(true);
    expect(interactionSignals("就到这里，不要再问我问题。").exit).toBe(true);
    expect(interactionSignals("他对我说就到这里，我想聊聊这件事").exit).toBe(false);
    expect(interactionSignals("我想删除所有聊天和图片，请告诉我怎么操作").dataHelp).toBe(true);
    expect(interactionSignals("我想删掉所有聊天和图片。").dataHelp).toBe(true);
    expect(interactionSignals("你已经替我删了吗？").dataHelp).toBe(true);
    expect(interactionSignals("我昨天删掉数据后轻松了").dataHelp).toBe(false);
  });
});
