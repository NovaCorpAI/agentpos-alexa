import { describe, expect, it } from "vitest";
import { spokenText } from "./spoken.js";

describe("spokenText", () => {
  it("replaces em and en dashes and strips markdown emphasis", () => {
    expect(spokenText("Just checking — you already ordered **2 loaves** today.")).toBe("Just checking, you already ordered 2 loaves today.");
    expect(spokenText("Open 9–17")).toBe("Open 9, 17");
  });
});
