// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { MIN_PASSWORD_LEN, showRegisterModal } from "./register_modal.js";

describe("register modal (ADR 0007)", () => {
  afterEach(() => {
    document.getElementById("anarchy-register-modal-root")?.remove();
  });

  function root(): HTMLElement {
    const el = document.getElementById("anarchy-register-modal-root");
    if (!el) throw new Error("register modal DOM not mounted");
    return el;
  }

  it("displays the username being registered", () => {
    showRegisterModal({ username: "Alice", onSubmit: () => {} });
    const span = root().querySelector("#anarchy-register-username")!;
    expect(span.textContent).toBe("Alice");
  });

  it("shows the prototype password-reuse warning above the password field", () => {
    showRegisterModal({ username: "X", onSubmit: () => {} });
    const r = root();
    const warning = r.querySelector("#anarchy-register-warning");
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain("PROTOTYPE");
    expect(warning!.textContent).toContain(
      "Do not use a password you use somewhere else",
    );
    // Warning must come before the password input in DOM order so the
    // user reads it before typing.
    const pw = r.querySelector("#anarchy-register-pw")!;
    const order = warning!.compareDocumentPosition(pw);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("submit stays disabled until both fields are filled and match", () => {
    showRegisterModal({ username: "X", onSubmit: () => {} });
    const r = root();
    const pw = r.querySelector<HTMLInputElement>("#anarchy-register-pw")!;
    const pw2 = r.querySelector<HTMLInputElement>("#anarchy-register-pw2")!;
    const submit = r.querySelector<HTMLButtonElement>("#anarchy-register-submit")!;
    expect(submit.disabled).toBe(true);
    pw.value = "tooShort"; // length 8 — long enough
    pw.dispatchEvent(new Event("input"));
    // pw2 still empty → mismatch
    expect(submit.disabled).toBe(true);
    pw2.value = "tooShort";
    pw2.dispatchEvent(new Event("input"));
    expect(submit.disabled).toBe(false);
  });

  it("rejects passwords shorter than the min length", () => {
    showRegisterModal({ username: "X", onSubmit: () => {} });
    const r = root();
    const pw = r.querySelector<HTMLInputElement>("#anarchy-register-pw")!;
    const pw2 = r.querySelector<HTMLInputElement>("#anarchy-register-pw2")!;
    const submit = r.querySelector<HTMLButtonElement>("#anarchy-register-submit")!;
    const short = "a".repeat(MIN_PASSWORD_LEN - 1);
    pw.value = short;
    pw.dispatchEvent(new Event("input"));
    pw2.value = short;
    pw2.dispatchEvent(new Event("input"));
    expect(submit.disabled).toBe(true);
    const err = r.querySelector("#anarchy-register-error")!;
    expect(err.textContent).toContain("at least");
  });

  it("shows a 'don't match' error when the two fields differ", () => {
    showRegisterModal({ username: "X", onSubmit: () => {} });
    const r = root();
    const pw = r.querySelector<HTMLInputElement>("#anarchy-register-pw")!;
    const pw2 = r.querySelector<HTMLInputElement>("#anarchy-register-pw2")!;
    pw.value = "longenough";
    pw.dispatchEvent(new Event("input"));
    pw2.value = "different!!";
    pw2.dispatchEvent(new Event("input"));
    const err = r.querySelector("#anarchy-register-error")!;
    expect(err.textContent).toContain("don't match");
  });

  it("submit fires onSubmit with the typed password and removes the modal", () => {
    let received: string | null = null;
    showRegisterModal({
      username: "X",
      onSubmit: (pw) => {
        received = pw;
      },
    });
    const r = root();
    const pw = r.querySelector<HTMLInputElement>("#anarchy-register-pw")!;
    const pw2 = r.querySelector<HTMLInputElement>("#anarchy-register-pw2")!;
    const submit = r.querySelector<HTMLButtonElement>("#anarchy-register-submit")!;
    pw.value = "good_password";
    pw.dispatchEvent(new Event("input"));
    pw2.value = "good_password";
    pw2.dispatchEvent(new Event("input"));
    submit.click();
    expect(received).toBe("good_password");
    expect(document.getElementById("anarchy-register-modal-root")).toBeNull();
  });

  it("right-click inside the modal has its default prevented (task 210)", () => {
    showRegisterModal({ username: "X", onSubmit: () => {} });
    const r = root();
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    r.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("contextmenu guard is detached on close (task 210)", () => {
    showRegisterModal({ username: "X", onSubmit: () => {} });
    const r = root();
    const cancel = r.querySelector<HTMLButtonElement>("#anarchy-register-cancel")!;
    cancel.click();
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    r.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("cancel fires onCancel and removes the modal", () => {
    let cancelled = false;
    showRegisterModal({
      username: "X",
      onSubmit: () => {},
      onCancel: () => {
        cancelled = true;
      },
    });
    const r = root();
    const cancel = r.querySelector<HTMLButtonElement>("#anarchy-register-cancel")!;
    cancel.click();
    expect(cancelled).toBe(true);
    expect(document.getElementById("anarchy-register-modal-root")).toBeNull();
  });
});
