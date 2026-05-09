/**
 * In-game account-registration flow (ADR 0007). Owns the per-session
 * latched state for the register surface — the open modal handle,
 * pending-reply callback, and the `registered` flag — and exposes the
 * narrow seam the bootstrap layer needs to drive it: `open()` from a
 * side-panel button, `onResult(status)` from the connection's
 * `RegisterAccountResult` hook, `isRegistered()` for action-list
 * rebuilds, and `unmount()` for session teardown.
 *
 * Strict no-double-modal: `open()` is a no-op if a modal is already
 * up, or if the current player has already registered, or before the
 * server has admitted a local player (we need the assigned username,
 * which can carry a numeric suffix per ADR 0005).
 */

import {
  showRegisterModal,
  type RegisterModalHandle,
} from "../ui/index.js";
import type {
  LobbyIdentity,
  RegisterResultStatus,
} from "../net/index.js";
import type { World } from "../game/index.js";
import type { ToastHandle } from "./toast.js";

export interface RegisterFlowDeps {
  readonly world: World;
  readonly identity: LobbyIdentity;
  readonly toast: ToastHandle;
  readonly getLocalPlayerId: () => number | null;
  readonly sendRegisterAccount: (password: string) => void;
  /** Fired whenever `isRegistered()` flips from false → true so the
   *  caller can rebuild the side-panel action list. */
  readonly onRegisteredChanged: () => void;
}

export interface RegisterFlow {
  open(): void;
  onResult(status: RegisterResultStatus): void;
  isRegistered(): boolean;
  unmount(): void;
}

export function createRegisterFlow(deps: RegisterFlowDeps): RegisterFlow {
  let registered = false;
  let modal: RegisterModalHandle | null = null;
  let pending: ((status: RegisterResultStatus) => void) | null = null;

  function open(): void {
    if (modal !== null) return;
    if (registered) return;
    const id = deps.getLocalPlayerId();
    if (id === null) return;
    const me = deps.world.getPlayer(id);
    const username = me?.username ?? deps.identity.username;
    modal = showRegisterModal({
      username,
      onSubmit: (password) => {
        modal = null;
        pending = (status) => {
          if (status === "ok") {
            registered = true;
            deps.toast.show("Account registered.", "ok");
            deps.onRegisteredChanged();
          } else if (status === "already-registered") {
            deps.toast.show("This username is already registered.", "error");
          } else {
            deps.toast.show("Registration failed. Please try again.", "error");
          }
        };
        deps.sendRegisterAccount(password);
      },
      onCancel: () => {
        modal = null;
      },
    });
  }

  function onResult(status: RegisterResultStatus): void {
    const cb = pending;
    if (cb === null) return;
    pending = null;
    cb(status);
  }

  function unmount(): void {
    modal?.close();
    modal = null;
    pending = null;
  }

  return {
    open,
    onResult,
    isRegistered: () => registered,
    unmount,
  };
}
