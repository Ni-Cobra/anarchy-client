/**
 * DOM scaffold for the pre-game lobby. `mountLobbyDom()` builds the panel
 * and appends it to `document.body`, returning typed references so the
 * form-state machine in `lobby.ts` can wire listeners without `querySelector`
 * boilerplate. The IDs / class names are load-bearing — `lobby.test.ts`
 * (vitest) and `accounts.spec.ts` (Playwright) target them.
 */

import { MAX_PASSWORD_LEN, MAX_USERNAME_LEN } from "./game/index.js";

export interface LobbyDomRefs {
  /** The outer fixed-positioned overlay; remove from the DOM on resolve. */
  readonly root: HTMLDivElement;
  readonly tabNew: HTMLButtonElement;
  readonly tabReturning: HTMLButtonElement;
  readonly usernameInput: HTMLInputElement;
  readonly passwordInput: HTMLInputElement;
  readonly submit: HTMLButtonElement;
  readonly errorEl: HTMLDivElement;
  readonly rejectEl: HTMLDivElement;
  readonly swatches: HTMLDivElement;
  readonly colorSection: HTMLDivElement;
  readonly passwordSection: HTMLDivElement;
}

export function mountLobbyDom(): LobbyDomRefs {
  const root = document.createElement("div");
  root.id = "anarchy-lobby";
  root.innerHTML = `
    <div class="panel" role="dialog" aria-label="Project Anarchy lobby">
      <h1>Project Anarchy</h1>
      <div class="reject" id="anarchy-reject" role="alert"></div>
      <div class="tabs" role="tablist">
        <button class="tab" id="anarchy-tab-new" role="tab" type="button">New player</button>
        <button class="tab" id="anarchy-tab-returning" role="tab" type="button">Returning player</button>
      </div>
      <label for="anarchy-username">Username</label>
      <input id="anarchy-username" type="text" maxlength="${MAX_USERNAME_LEN}"
             autocomplete="off" autocapitalize="off" spellcheck="false"
             placeholder="Enter a name (1-${MAX_USERNAME_LEN} chars)" />
      <div class="error" id="anarchy-error"></div>
      <div id="anarchy-color-section" class="field-spacer">
        <label style="margin-top:18px;">Color</label>
        <div class="swatches" id="anarchy-swatches"></div>
      </div>
      <div id="anarchy-password-section" class="field-spacer" style="display:none;">
        <label for="anarchy-password" style="margin-top:18px;">Password</label>
        <input id="anarchy-password" type="password" autocomplete="current-password"
               maxlength="${MAX_PASSWORD_LEN}"
               placeholder="Password (or leave blank for unregistered)" />
      </div>
      <button class="submit" id="anarchy-submit" type="button" disabled>Enter world</button>
    </div>
  `;
  document.body.appendChild(root);

  return {
    root,
    tabNew: root.querySelector<HTMLButtonElement>("#anarchy-tab-new")!,
    tabReturning: root.querySelector<HTMLButtonElement>("#anarchy-tab-returning")!,
    usernameInput: root.querySelector<HTMLInputElement>("#anarchy-username")!,
    passwordInput: root.querySelector<HTMLInputElement>("#anarchy-password")!,
    submit: root.querySelector<HTMLButtonElement>("#anarchy-submit")!,
    errorEl: root.querySelector<HTMLDivElement>("#anarchy-error")!,
    rejectEl: root.querySelector<HTMLDivElement>("#anarchy-reject")!,
    swatches: root.querySelector<HTMLDivElement>("#anarchy-swatches")!,
    colorSection: root.querySelector<HTMLDivElement>("#anarchy-color-section")!,
    passwordSection: root.querySelector<HTMLDivElement>("#anarchy-password-section")!,
  };
}
