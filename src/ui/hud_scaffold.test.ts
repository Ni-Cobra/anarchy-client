// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { mountHudScaffold } from "./hud_scaffold.js";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("mountHudScaffold", () => {
  it("injects the style block into <head> with the requested id", () => {
    mountHudScaffold({
      styleId: "test-style",
      styleContent: "#test-root { color: red; }",
      rootId: "test-root",
    });
    const style = document.getElementById("test-style");
    expect(style).not.toBeNull();
    expect(style?.parentElement).toBe(document.head);
    expect(style?.textContent).toBe("#test-root { color: red; }");
  });

  it("creates the root as a <div> by default and appends it to body", () => {
    const { root } = mountHudScaffold({
      styleId: "test-style",
      styleContent: "",
      rootId: "test-root",
    });
    expect(root.tagName).toBe("DIV");
    expect(root.id).toBe("test-root");
    expect(root.parentElement).toBe(document.body);
  });

  it("honors rootTag when overridden", () => {
    const { root } = mountHudScaffold({
      styleId: "test-style",
      styleContent: "",
      rootId: "test-root",
      rootTag: "section",
    });
    expect(root.tagName).toBe("SECTION");
  });

  it("appends to a custom parent when provided", () => {
    const parent = document.createElement("div");
    parent.id = "custom-parent";
    document.body.appendChild(parent);
    const { root } = mountHudScaffold({
      styleId: "test-style",
      styleContent: "",
      rootId: "test-root",
      parent,
    });
    expect(root.parentElement).toBe(parent);
  });

  it("does not duplicate the style block on a second call with the same styleId", () => {
    mountHudScaffold({
      styleId: "test-style",
      styleContent: "first",
      rootId: "test-root-a",
    });
    mountHudScaffold({
      styleId: "test-style",
      styleContent: "second",
      rootId: "test-root-b",
    });
    const styles = document.querySelectorAll("#test-style");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toBe("first");
  });

  it("returns the existing root if it is already in the DOM", () => {
    const first = mountHudScaffold({
      styleId: "test-style",
      styleContent: "",
      rootId: "test-root",
    });
    const second = mountHudScaffold({
      styleId: "test-style",
      styleContent: "",
      rootId: "test-root",
    });
    expect(second.root).toBe(first.root);
    expect(document.querySelectorAll("#test-root").length).toBe(1);
  });
});
