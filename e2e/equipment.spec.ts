import { test, expect } from "@playwright/test";
import protobuf from "protobufjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// BACKLOG task 100: pickaxe / axe equipment slots. End-to-end test that
// the wire round-trip works (`EquipTool` lands an `InventoryUpdate` with
// the equipped tool field populated) and that the equipped state survives
// a reconnect (the dormant record carries the equipment slots forward
// across the disconnect → re-Hello flow).

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = resolve(__dirname, "../proto/anarchy/v1/anarchy.proto");

const root = await protobuf.load(PROTO_PATH);
const ClientMessage = root.lookupType("anarchy.v1.ClientMessage");
const ServerMessage = root.lookupType("anarchy.v1.ServerMessage");

const WS_URL = "ws://localhost:8080/ws";

const HOTBAR_SLOTS = 9;
const ITEM_ID_WOOD_PICKAXE = 5;
const ITEM_ID_WOOD_AXE = 10;
// Wire numeric for `ToolKind`. UNSPECIFIED = 0, PICKAXE = 1, AXE = 2.
const TOOL_KIND_PICKAXE = 1;
const TOOL_KIND_AXE = 2;
// Starter loadout panel slots from `STARTER_TOOL_LOADOUT` (see
// `anarchy-server/src/network/hub.rs`). Wood pickaxe lives at panel slot
// 26 (flat 35); wood axe at panel slot 31 (flat 40).
const WOOD_PICKAXE_SLOT = HOTBAR_SLOTS + 26;
const WOOD_AXE_SLOT = HOTBAR_SLOTS + 31;

type Frame =
  | { kind: "open" }
  | { kind: "msg"; data: Uint8Array }
  | { kind: "close"; code: number };

async function openSocket(timeoutMs = 5_000) {
  const ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  // Frames buffer + monotonic cursor: each `next()` resolves with the
  // first frame at or after `cursor` matching the predicate, then
  // advances the cursor past it. This makes `next` strictly forward —
  // important for tests that wait for the *next* inventory frame after
  // a wire action, not the one the welcome handshake already shipped.
  const frames: Frame[] = [];
  let cursor = 0;
  const waiters: Array<{
    predicate: (f: Frame) => boolean;
    resolve: (f: Frame) => void;
  }> = [];

  const push = (f: Frame) => {
    frames.push(f);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(f)) {
        waiters[i].resolve(f);
        waiters.splice(i, 1);
      }
    }
  };

  ws.addEventListener("open", () => push({ kind: "open" }));
  ws.addEventListener("message", (ev) => {
    if (ev.data instanceof ArrayBuffer)
      push({ kind: "msg", data: new Uint8Array(ev.data) });
  });
  ws.addEventListener("close", (ev) => push({ kind: "close", code: ev.code }));

  function next(
    predicate: (f: Frame) => boolean,
    timeout = timeoutMs,
  ): Promise<Frame> {
    for (let i = cursor; i < frames.length; i++) {
      if (predicate(frames[i])) {
        cursor = i + 1;
        return Promise.resolve(frames[i]);
      }
    }
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timeout waiting for frame")),
        timeout,
      );
      waiters.push({
        predicate: (f) => {
          if (predicate(f)) {
            clearTimeout(timer);
            cursor = frames.length; // we just consumed the last frame
            return true;
          }
          return false;
        },
        resolve,
      });
    });
  }

  await next((f) => f.kind === "open");
  return { ws, frames, next };
}

let helloSeq = 2000;

async function sendHello(
  ws: WebSocket,
  username: string,
  reconnect = false,
): Promise<void> {
  const bytes = ClientMessage.encode(
    ClientMessage.create({
      seq: helloSeq++,
      hello: {
        clientVersion: "anarchy-e2e",
        username,
        colorIndex: 0,
        reconnect,
      },
    }),
  ).finish();
  ws.send(bytes);
}

async function sendEquipTool(
  ws: WebSocket,
  sourceSlot: number,
  toolKind: number,
): Promise<void> {
  const bytes = ClientMessage.encode(
    ClientMessage.create({
      seq: helloSeq++,
      equipTool: { sourceSlot, toolKind, clientSeq: 1 },
    }),
  ).finish();
  ws.send(bytes);
}

interface InventoryFrame {
  slots: { item: number; count: number }[];
  equippedPickaxe: { item: number; count: number };
  equippedAxe: { item: number; count: number };
}

function decodeInventory(
  frame: Extract<Frame, { kind: "msg" }>,
): InventoryFrame | null {
  const msg = ServerMessage.decode(frame.data).toJSON() as {
    inventoryUpdate?: {
      slots?: { item?: string | number; count?: number }[];
      equippedPickaxe?: { item?: string | number; count?: number };
      equippedAxe?: { item?: string | number; count?: number };
    };
  };
  if (!msg.inventoryUpdate) return null;
  const decodeSlot = (s: {
    item?: string | number;
    count?: number;
  }): { item: number; count: number } => ({
    item: typeof s.item === "string" ? itemNameToInt(s.item) : Number(s.item ?? 0),
    count: Number(s.count ?? 0),
  });
  return {
    slots: (msg.inventoryUpdate.slots ?? []).map(decodeSlot),
    equippedPickaxe: decodeSlot(msg.inventoryUpdate.equippedPickaxe ?? {}),
    equippedAxe: decodeSlot(msg.inventoryUpdate.equippedAxe ?? {}),
  };
}

function itemNameToInt(name: string): number {
  switch (name) {
    case "ITEM_ID_STICK":
      return 1;
    case "ITEM_ID_WOOD":
      return 2;
    case "ITEM_ID_STONE":
      return 3;
    case "ITEM_ID_GOLD":
      return 4;
    case "ITEM_ID_WOOD_PICKAXE":
      return 5;
    case "ITEM_ID_STONE_PICKAXE":
      return 6;
    case "ITEM_ID_COPPER_PICKAXE":
      return 7;
    case "ITEM_ID_IRON_PICKAXE":
      return 8;
    case "ITEM_ID_TUNGSTEN_PICKAXE":
      return 9;
    case "ITEM_ID_WOOD_AXE":
      return 10;
    case "ITEM_ID_STONE_AXE":
      return 11;
    case "ITEM_ID_COPPER_AXE":
      return 12;
    case "ITEM_ID_IRON_AXE":
      return 13;
    case "ITEM_ID_TUNGSTEN_AXE":
      return 14;
    default:
      return 0;
  }
}

async function waitForInventory(socket: {
  next: (
    predicate: (f: Frame) => boolean,
    timeout?: number,
  ) => Promise<Frame>;
}): Promise<InventoryFrame> {
  const f = (await socket.next((f) => {
    if (f.kind !== "msg") return false;
    return decodeInventory(f as Extract<Frame, { kind: "msg" }>) !== null;
  })) as Extract<Frame, { kind: "msg" }>;
  return decodeInventory(f)!;
}

// Unique-enough suffix that fits inside the server's 16-char username
// cap. `Date.now() % 10000` is plenty against parallel runs of the same
// spec; collisions resolve via ADR 0005 `base{N}` disambiguation, which
// would surface only as a one-character mismatch on `assigned_username`,
// not the inventory we care about here.
function uniq(prefix: string): string {
  const tail = (Date.now() % 10000).toString();
  const allowed = 16 - prefix.length - 1;
  return `${prefix}-${tail.slice(-Math.max(1, allowed))}`;
}

test("equip wire round-trip: EquipTool lands populated equipped fields in InventoryUpdate", async () => {
  const username = uniq("equip-rt");
  const sock = await openSocket();
  await sendHello(sock.ws, username);

  // Initial inventory: equipment slots are empty.
  const initial = await waitForInventory(sock);
  expect(initial.equippedPickaxe.count).toBe(0);
  expect(initial.equippedAxe.count).toBe(0);
  expect(initial.slots[WOOD_PICKAXE_SLOT].item).toBe(ITEM_ID_WOOD_PICKAXE);

  // Equip the wood pickaxe. The starter loadout's first slot is fixed at
  // `WOOD_PICKAXE_SLOT`.
  await sendEquipTool(sock.ws, WOOD_PICKAXE_SLOT, TOOL_KIND_PICKAXE);

  // Next InventoryUpdate (next tick) carries the equipped tool field
  // populated and the source slot now empty.
  const after = await waitForInventory(sock);
  expect(after.equippedPickaxe.item).toBe(ITEM_ID_WOOD_PICKAXE);
  expect(after.equippedPickaxe.count).toBe(1);
  expect(after.slots[WOOD_PICKAXE_SLOT].count).toBe(0);

  sock.ws.close();
});

test("equipped tools survive a reconnect (dormant record carries them forward)", async () => {
  const username = uniq("equip-rec");

  // Session 1: connect, equip a wood axe, wait for confirmation, then
  // close the socket so the server parks the player into the dormant
  // pool.
  const session1 = await openSocket();
  await sendHello(session1.ws, username);
  const session1Inventory = await waitForInventory(session1);
  expect(session1Inventory.equippedAxe.count).toBe(0);
  await sendEquipTool(session1.ws, WOOD_AXE_SLOT, TOOL_KIND_AXE);
  const equipped = await waitForInventory(session1);
  expect(equipped.equippedAxe.item).toBe(ITEM_ID_WOOD_AXE);
  expect(equipped.equippedAxe.count).toBe(1);
  session1.ws.close();
  // Wait for the close to land server-side so end_session fires before the
  // reconnect Hello.
  await new Promise((r) => setTimeout(r, 200));

  // Session 2: reconnect under the same username. The dormant record
  // restored by the admission path must carry the equipped axe forward.
  const session2 = await openSocket();
  await sendHello(session2.ws, username, /* reconnect */ true);
  const restored = await waitForInventory(session2);
  expect(restored.equippedAxe.item).toBe(ITEM_ID_WOOD_AXE);
  expect(restored.equippedAxe.count).toBe(1);
  expect(restored.equippedPickaxe.count).toBe(0);
  session2.ws.close();
});
