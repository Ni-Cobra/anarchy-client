import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = resolve(__dirname, "../proto/anarchy/v1/anarchy.proto");

let cached: Promise<{
  root: protobuf.Root;
  ClientMessage: protobuf.Type;
  ServerMessage: protobuf.Type;
}> | null = null;

export function loadAnarchyProto() {
  if (!cached) {
    cached = protobuf.load(PROTO_PATH).then((root) => ({
      root,
      ClientMessage: root.lookupType("anarchy.v1.ClientMessage"),
      ServerMessage: root.lookupType("anarchy.v1.ServerMessage"),
    }));
  }
  return cached;
}
