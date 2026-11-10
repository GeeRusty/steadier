import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LifeAreaPicker, { lifeAreaOptions } from "./LifeAreaPicker";

describe("LifeAreaPicker", () => {
  it("renders existing life areas as a native select rather than a datalist", () => {
    const html = renderToStaticMarkup(
      <LifeAreaPicker
        areas={["Home", "Business", "Home"]}
        value="Business"
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-label="Life area"');
    expect(html).toContain('<option value="Home">Home</option>');
    expect(html).toContain('<option value="Business" selected="">Business</option>');
    expect(html).toContain("Add a new life area…");
    expect(html).not.toContain("<datalist");
    expect(lifeAreaOptions(["Home", "Business", "Home"], "Travel")).toEqual([
      "Home",
      "Business",
      "Travel",
    ]);
  });
});
