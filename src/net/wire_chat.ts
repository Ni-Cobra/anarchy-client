/**
 * `ChatMessage` handler (task 080). Decodes the wire payload (kind,
 * sender, body) into a `ChatLine` and pushes it onto the chat HUD via
 * the supplied sink. Server→client only; ephemeral — no ring buffer, no
 * replay on join.
 */
import { anarchy } from "../gen/anarchy.js";

import type { ChatLine } from "../ui/chat_hud.js";

/**
 * Sink the wire bridge writes received chat lines into. The bootstrap
 * mounts a `ChatHudHandle.append` here; tests can mount anything.
 */
export interface ChatSink {
  append(line: ChatLine): void;
}

export function applyChatMessage(
  wire: anarchy.v1.IChatMessage,
  sink: ChatSink | undefined,
): void {
  if (!sink) return;
  const line = chatLineFromWire(wire);
  if (!line) return;
  sink.append(line);
}

/**
 * Decode a wire `ChatMessage` into a client-side `ChatLine`. Returns
 * `null` for the proto3 `UNSPECIFIED = 0` sentinel — the server never
 * emits it, but a defensive drop keeps a malformed frame from rendering
 * as an un-styled line.
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
  };
}
