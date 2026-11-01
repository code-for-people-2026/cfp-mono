import { describe, expect, it } from "vitest";
import { safetyCategory, safetyNotice } from "../src/safety/notice";
describe("bounded symptom language safety net", () => {
  it.each(["宝宝喘不过气", "嘴唇发紫了", "刚呛奶，现在呼吸困难", "没有呼吸了", "宝宝叫不醒", "一直抽搐"])("recognizes direct dangerous description: %s", text => { expect(safetyCategory(text)).toBeDefined(); });
  it.each(["今天没有记录吃奶", "六小时没换尿布记录", "如果宝宝喘不过气怎么办", "科普讲婴儿叫不醒", "没有呼吸困难", "宝宝不是叫不醒", "这张便便照片颜色偏绿"])("never infers emergency from missing data, education or images: %s", text => { expect(safetyCategory(text)).toBeUndefined(); });
  it("gives immediate local help, no diagnosis or automatic care fact claim", () => { expect(safetyNotice).toContain("120"); expect(safetyNotice).toContain("不要等 AI"); expect(safetyNotice).toContain("未自动写入照护记录"); });
});
