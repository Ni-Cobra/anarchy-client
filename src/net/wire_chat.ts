/**
 * `ChatHistory` handler (task 100). Decodes the wire payload (a list of
 * `ChatMessage`s in oldest → newest order) into a `ChatLine[]` and hands
 * it to the chat HUD's `replaceHistory` entry point. Server→client only;
 * the server owns the rolling buffer (max 20) and re-broadcasts a fresh
 * snapshot on every change, so the client never appends — it always
 * replaces from the latest snapshot it sees.
 */
import { anarchy } from "../gen/anarchy.js";

import type { ChatLine } from "../ui/chat_hud.js";

/**
 * Sink the wire bridge writes received chat history into. The bootstrap
 * mounts a `ChatHudHandle.replaceHistory`-bound sink here; tests can
 * mount anything that implements the shape.
 */
export interface ChatSink {
  replaceHistory(messages: readonly ChatLine[]): void;
}

export function applyChatHistory(
  wire: anarchy.v1.IChatHistory,
  sink: ChatSink | undefined,
): void {
  if (!sink) return;
  const messages = (wire.messages ?? [])
    .map(chatLineFromWire)
    .filter((line): line is ChatLine => line !== null);
  sink.replaceHistory(messages);
}

/**
 * Decode a wire `ChatMessage` into a client-side `ChatLine`. Returns
 * `null` for the proto3 `UNSPECIFIED = 0` sentinel — the server never
 * emits it, but a defensive drop keeps a malformed frame from rendering
 * as an un-styled line.
 *
 * Task 110: `sender_color_index` and `sender_registered` travel per-message
 * (frozen at send time on the server). Wire decode follows proto3 defaults
 * — a missing `sender_color_index` lands as `0` (palette slot 0) and a
 * missing `sender_registered` lands as `false`. The current server always
 * stamps both fields, so the only path that hits the bare defaults is a
 * malformed / hypothetical older wire frame; the HUD treats the result
 * the same as an explicit guest with colorIndex 0, which is a safe
 * downgrade.
 */
export function chatLineFromWire(
  wire: anarchy.v1.IChatMessage,
): ChatLine | null {
  const kindNum = wire.kind ?? 0;
  let kind: ChatLine["kind"];
  switch (kindNum) {
    case anarchy.v1.ChatMessage.Kind.CHAT_MESSAGE_KIND_PLAYER:
      kind = "player";
      break;
    case anarchy.v1.ChatMessage.Kind.CHAT_MESSAGE_KIND_ADMIN:
      kind = "admin";
      break;
    default:
      return null;
  }
  return {
    kind,
    sender: wire.sender ?? "",
    body: wire.body ?? "",
    colorIndex: wire.senderColorIndex ?? 0,
    registered: wire.senderRegistered ?? false,
  };
}
