import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  BODY_LIT_MAT_USERDATA_KEY,
  BODY_UNLIT_MAT_USERDATA_KEY,
} from "./player_mesh.js";
import {
  clearAllMeshFlashesForTest,
  flashMeshWhite,
  meshFlashCount,
  MESH_FLASH_DURATION_MS,
  purgeMeshFlash,
  tickMeshFlashes,
} from "./mesh_flash.js";

function buildPlayerLikeMesh(litHex: number): {
  mesh: THREE.Mesh;
  lit: THREE.MeshLambertMaterial;
  unlit: THREE.MeshBasicMaterial;
} {
  const lit = new THREE.MeshLambertMaterial({ color: litHex });
  const unlit = new THREE.MeshBasicMaterial({ color: litHex });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5), lit);
  mesh.userData[BODY_LIT_MAT_USERDATA_KEY] = lit;
  mesh.userData[BODY_UNLIT_MAT_USERDATA_KEY] = unlit;
  return { mesh, lit, unlit };
}

afterEach(() => {
  clearAllMeshFlashesForTest();
});

describe("mesh_flash", () => {
  it("flashMeshWhite sets the body materials to white", () => {
    const { mesh, lit, unlit } = buildPlayerLikeMesh(0xff0000);
    flashMeshWhite(mesh, 0);
    expect(lit.color.getHex()).toBe(0xffffff);
    expect(unlit.color.getHex()).toBe(0xffffff);
    expect(meshFlashCount()).toBe(1);
  });

  it("tickMeshFlashes restores the original color after the duration", () => {
    const { mesh, lit, unlit } = buildPlayerLikeMesh(0x00ff00);
    flashMeshWhite(mesh, 0);
    tickMeshFlashes(50);
    expect(lit.color.getHex()).toBe(0xffffff);
    tickMeshFlashes(MESH_FLASH_DURATION_MS);
    expect(lit.color.getHex()).toBe(0x00ff00);
    expect(unlit.color.getHex()).toBe(0x00ff00);
    expect(meshFlashCount()).toBe(0);
  });

  it("overlapping flashes reset the timer; second call's window owns the restore", () => {
    const { mesh, lit } = buildPlayerLikeMesh(0x0000ff);
    flashMeshWhite(mesh, 0);
    // Second flash at 100 ms — original color still captured from the
    // first call, restore time is now 100 + 150 = 250 ms.
    flashMeshWhite(mesh, 100);
    tickMeshFlashes(MESH_FLASH_DURATION_MS); // 150 ms — would expire the first call.
    expect(lit.color.getHex()).toBe(0xffffff);
    tickMeshFlashes(100 + MESH_FLASH_DURATION_MS);
    expect(lit.color.getHex()).toBe(0x0000ff);
  });

  it("purgeMeshFlash drops the side-table entry for a disposed mesh", () => {
    const { mesh } = buildPlayerLikeMesh(0x123456);
    flashMeshWhite(mesh, 0);
    expect(meshFlashCount()).toBe(1);
    purgeMeshFlash(mesh);
    expect(meshFlashCount()).toBe(0);
    // Future ticks do not crash on a missing entry.
    tickMeshFlashes(MESH_FLASH_DURATION_MS);
  });

  it("flashes a mesh whose factory used `obj.material` directly (no userData keys)", () => {
    // Mirrors the entity-mesh shape pre-task: material stored on the mesh
    // itself with no userData key. The fallback path keeps damage feedback
    // working on those.
    const mat = new THREE.MeshBasicMaterial({ color: 0xabcdef });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), mat);
    flashMeshWhite(mesh, 0);
    expect(mat.color.getHex()).toBe(0xffffff);
    tickMeshFlashes(MESH_FLASH_DURATION_MS);
    expect(mat.color.getHex()).toBe(0xabcdef);
  });

  it("flashMeshWhite on a mesh with no body materials at all is a noop", () => {
    // A Group with no Mesh descendant and no userData material — defensive
    // for empty / placeholder objects. Should not throw, should not record.
    const group = new THREE.Group();
    flashMeshWhite(group, 0);
    expect(meshFlashCount()).toBe(0);
  });

  it("two simultaneous flashes on different meshes coexist", () => {
    const a = buildPlayerLikeMesh(0x111111);
    const b = buildPlayerLikeMesh(0x222222);
    flashMeshWhite(a.mesh, 0);
    flashMeshWhite(b.mesh, 0);
    expect(meshFlashCount()).toBe(2);
    expect(a.lit.color.getHex()).toBe(0xffffff);
    expect(b.lit.color.getHex()).toBe(0xffffff);
    tickMeshFlashes(MESH_FLASH_DURATION_MS);
    expect(a.lit.color.getHex()).toBe(0x111111);
    expect(b.lit.color.getHex()).toBe(0x222222);
  });
});
