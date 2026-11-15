import { describe, expect, it } from "vitest";
import type { AgeStatus } from "@cfp/a-j-oker-contracts";
import { ageGateStep, declarationForBirthday, todayInChina } from "../src/chat/age-onboarding";

const loggedIn: AgeStatus = {
  loggedIn: true, state: "unverified", allowed: false, verifiedAt: null, expiresAt: null, source: null,
  assurance: null, additionalVerification: "not_requested", notice: { version: "test", paragraphs: [] },
  configuration: { wechat: true, provider: true },
};
describe("生日申报", () => {
  it("按生日当天切换14岁和18岁年龄段，不把年份差直接当年龄", () => {
    expect(declarationForBirthday("2012-10-14", "2026-10-13")).toBe("under14");
    expect(declarationForBirthday("2012-10-13", "2026-10-13")).toBe("14to17");
    expect(declarationForBirthday("2008-10-14", "2026-10-13")).toBe("14to17");
    expect(declarationForBirthday("2008-10-13", "2026-10-13")).toBe("adult");
  });
  it("拒绝空值、未来日期、无效日期及非约定格式", () => {
    for (const birthday of ["", "2026-10-14", "2024-02-30", "2023-02-29", "2000-13-01", "2000-00-00", "2000-2-01", "1899-12-31", "x"]) {
      expect(declarationForBirthday(birthday, "2026-10-13")).toBeUndefined();
    }
    expect(declarationForBirthday("2026-10-13", "2026-10-13")).toBe("under14");
  });
  it("闰日出生在非闰年3月1日进入下一个年龄段", () => {
    expect(declarationForBirthday("2008-02-29", "2026-02-28")).toBe("14to17");
    expect(declarationForBirthday("2008-02-29", "2026-03-01")).toBe("adult");
  });
  it("以北京时间换日，不依赖设备时区", () => {
    expect(todayInChina(new Date("2026-10-12T15:59:59Z"))).toBe("2026-10-12");
    expect(todayInChina(new Date("2026-10-12T16:00:00Z"))).toBe("2026-10-13");
  });
});
describe("逐步显示的小窗口", () => {
  it("先登录再问生日，已有年龄申报时不重复询问", () => {
    expect(ageGateStep()).toBe("loading");
    expect(ageGateStep({ ...loggedIn, loggedIn: false })).toBe("login");
    expect(ageGateStep(loggedIn)).toBe("birthday");
    expect(ageGateStep({ ...loggedIn, declaration: "unknown" })).toBe("birthday");
    expect(ageGateStep({ ...loggedIn, declaration: "adult" })).toBe("verify");
  });
  it("生日只产生申报，成年申报不跳过真实核验", () => {
    expect(ageGateStep(loggedIn, declarationForBirthday("2000-01-01", "2026-10-13"))).toBe("verify");
    expect(ageGateStep({ ...loggedIn, state: "expired", declaration: "adult" })).toBe("verify");
    expect(ageGateStep({ ...loggedIn, state: "adult", allowed: true })).toBe("ready");
  });
  it("未成年、待复核和处理中状态优先于生日选择", () => {
    expect(ageGateStep(loggedIn, "under14")).toBe("blocked");
    expect(ageGateStep({ ...loggedIn, declaration: "14to17" })).toBe("blocked");
    expect(ageGateStep({ ...loggedIn, state: "minor" }, "adult")).toBe("blocked");
    expect(ageGateStep({ ...loggedIn, state: "needs_review" }, "adult")).toBe("blocked");
    expect(ageGateStep({ ...loggedIn, state: "pending" }, "adult")).toBe("pending");
  });
  it("预览核验成年后显示完成提示，不开放对话", () => {
    expect(ageGateStep({ ...loggedIn, state: "adult", declaration: "adult", configuration: { ...loggedIn.configuration, previewOnly: true } })).toBe("preview-ready");
  });
});
