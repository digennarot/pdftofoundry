import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import {
  isV14, toV14SceneData, getSceneArt, applyExistingArt, updateSceneArt,
} from "../pdftofoundry/scene-compat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const importerSrc = readFileSync(path.join(here, "../pdftofoundry/importer.mjs"), "utf8");

const V14 = { generation: 14, defaultLevelId: "defaultLevel0000" };
const legacyScene = () => ({
  name: "map1", width: 2000, height: 3000, notes: [{ x: 1 }],
  grid: { size: 100 },
  background: { src: "maps/a.webp", offsetX: 12, offsetY: -4, scaleX: 1, scaleY: 1, rotation: 0, tint: "#FFFFFF" },
});

/* ---- Minimal model of the v14 behaviour described in issue #54 ---- */
function makeV14World() {
  const created = [];
  class Scene {
    static metadata = { defaultLevelId: "defaultLevel0000" };
    static async createDocuments(list) {
      return list.map((raw) => {
        const data = { ...raw };
        for (const l of data.levels ?? []) {
          if (!l.name) throw new Error("levels.0.name: may not be undefined"); // v14 schema validation
        }
        delete data.background; // cleanData: key not in v14 schema, dropped before _preCreate
        delete data.img;
        const level = data.levels?.find((l) => l._id === Scene.metadata.defaultLevelId);
        const doc = {
          id: `scene${created.length}`, ...data,
          initialLevel: { background: { src: level?.background?.src ?? null } },
          createEmbeddedDocuments: async () => [],
          update: async () => {},
          createThumbnail: async () => ({ thumb: "t" }),
        };
        created.push(doc);
        return doc;
      });
    }
  }
  return { Scene, created };
}

test("isV14", () => {
  assert.equal(isV14(13), false);
  assert.equal(isV14("14"), true);
  assert.equal(isV14(15), true);
  assert.equal(isV14(undefined), false);
});

test("toV14SceneData moves background into levels and offsets to shiftX/Y", () => {
  const out = toV14SceneData(legacyScene(), V14);
  assert.equal("background" in out, false);
  assert.deepEqual(out.levels, [{ _id: "defaultLevel0000", name: "map1", background: { src: "maps/a.webp" } }]);
  assert.equal(out.shiftX, 12);
  assert.equal(out.shiftY, -4);
  assert.equal(out.width, 2000);
  assert.equal(out.height, 3000);
  assert.deepEqual(out.notes, [{ x: 1 }]);
});

test("toV14SceneData gives the level a name (v14 requires it), with a fallback", () => {
  assert.equal(toV14SceneData(legacyScene(), V14).levels[0].name, "map1");
  const unnamed = legacyScene(); delete unnamed.name;
  assert.equal(toV14SceneData(unnamed, V14).levels[0].name, "Level");
});

test("toV14SceneData does not mutate its input", () => {
  const input = legacyScene();
  const snapshot = structuredClone(input);
  toV14SceneData(input, V14);
  assert.deepEqual(input, snapshot);
});

test("toV14SceneData leaves v13 data untouched", () => {
  const input = legacyScene();
  assert.equal(toV14SceneData(input, { generation: 13 }), input);
});

test("toV14SceneData leaves data that already has levels, or no art, untouched", () => {
  const withLevels = { ...legacyScene(), levels: [{ _id: "x" }] };
  assert.equal(toV14SceneData(withLevels, V14), withLevels);
  const noArt = { name: "n" };
  assert.equal(toV14SceneData(noArt, V14), noArt);
});

test("toV14SceneData omits shift when the legacy offsets are absent", () => {
  const d = legacyScene();
  delete d.background.offsetX; delete d.background.offsetY;
  const out = toV14SceneData(d, V14);
  assert.equal("shiftX" in out, false);
  assert.equal("shiftY" in out, false);
});

test("toV14SceneData uses Scene.metadata.defaultLevelId when not injected", () => {
  globalThis.game = { release: { generation: 14 } };
  globalThis.Scene = { metadata: { defaultLevelId: "fromMeta" } };
  try {
    assert.equal(toV14SceneData(legacyScene()).levels[0]._id, "fromMeta");
  } finally {
    delete globalThis.game; delete globalThis.Scene;
  }
});

test("BUG REPRO: legacy shape loses the map on v14, converted shape keeps it", async () => {
  const { Scene } = makeV14World();
  const [legacy] = await Scene.createDocuments([legacyScene()]);
  assert.equal(legacy.initialLevel.background.src, null, "documents the silent data loss");
  const [fixed] = await Scene.createDocuments([toV14SceneData(legacyScene(), V14)]);
  assert.equal(fixed.initialLevel.background.src, "maps/a.webp");
  assert.equal(fixed.shiftX, 12);
});

test("getSceneArt reads v14 and legacy scenes", () => {
  assert.deepEqual(
    getSceneArt({ initialLevel: { background: { src: "n.webp" } }, shiftX: 3, shiftY: 4 }),
    { src: "n.webp", offsetX: 3, offsetY: 4 });
  assert.deepEqual(
    getSceneArt({ background: { src: "o.webp", offsetX: 1, offsetY: 2 } }),
    { src: "o.webp", offsetX: 1, offsetY: 2 });
  assert.deepEqual(getSceneArt({}), { src: null, offsetX: 0, offsetY: 0 });
});

test("applyExistingArt copies art, size and both offsets (v14 scene)", () => {
  const data = legacyScene();
  applyExistingArt(data, { width: 10, height: 20, shiftX: 5, shiftY: 6, initialLevel: { background: { src: "e.webp" } } });
  assert.deepEqual(data.background, { ...legacyScene().background, src: "e.webp", offsetX: 5, offsetY: 6 });
  assert.equal(data.width, 10);
  assert.equal(data.height, 20);
});

test("updateSceneArt updates the level and scene on v14", async () => {
  const calls = [];
  const scene = {
    initialLevel: { update: async (d) => calls.push(["level", d]) },
    update: async (d) => calls.push(["scene", d]),
  };
  await updateSceneArt(scene, legacyScene(), V14);
  assert.deepEqual(calls, [
    ["level", { background: { src: "maps/a.webp" } }],
    ["scene", { width: 2000, height: 3000, shiftX: 12, shiftY: -4 }],
  ]);
});

test("updateSceneArt keeps the legacy update on v13", async () => {
  const calls = [];
  await updateSceneArt({ update: async (d) => calls.push(d) }, legacyScene(), { generation: 13 });
  assert.deepEqual(calls, [{
    img: "maps/a.webp", width: 2000, height: 3000,
    "background.offsetX": 12, "background.offsetY": -4,
  }]);
});

/* ---- Run the real (obfuscated) createScene from importer.mjs against the v14 model ---- */
function loadCreateScene() {
  const a = importerSrc.indexOf("const _0x4bb2d6=_0x5157;");
  const h = importerSrc.indexOf("}(_0x28fd,0x55931));") + "}(_0x28fd,0x55931));".length;
  const i = importerSrc.indexOf("function _0x28fd(){");
  const e = importerSrc.indexOf("return _0x28fd();}", i) + "return _0x28fd();}".length;
  const j = importerSrc.indexOf("function _0x5157(");
  const k = importerSrc.indexOf("__name(generateData", j);
  const m1 = importerSrc.indexOf("async[_0x4bb2d6(0x278)](_0x308823");
  const m2 = importerSrc.indexOf("async[_0x4bb2d6(0x1eb)](", m1);
  assert.ok([a, h, i, e, j, k, m1, m2].every((n) => n > 0), "importer layout changed");
  return `${importerSrc.slice(a, h)}\n${importerSrc.slice(i, e)}\n${importerSrc.slice(j, k)}
    class Importer { getCanonicalSceneMapping() { return this.mapping; } ${importerSrc.slice(m1, m2)} }
    Importer`;
}

function runCreateScene({ generation, existing = [], setting = false, priority = 1, canonical = "aoa1/map3", mapping = [] }) {
  const { Scene, created } = makeV14World();
  const sandbox = {
    Scene, __name: () => {}, ...{ toV14SceneData, getSceneArt, applyExistingArt, updateSceneArt },
    game: { release: { generation }, scenes: { contents: existing, get: (id) => created.find((c) => c.id === id) }, settings: { get: () => setting } },
    console,
  };
  // the module helpers read generation from the global game object
  globalThis.game = sandbox.game; globalThis.Scene = Scene;
  const Importer = vm.runInNewContext(loadCreateScene(), sandbox);
  const imp = new Importer();
  imp.mapping = mapping; imp.npcActors = {};
  return { run: (data) => imp.createScene(data, canonical, priority, []), created, cleanup() { delete globalThis.game; delete globalThis.Scene; } };
}

test("importer.mjs createScene: map is present on a fresh v14 import (regression for #54)", async () => {
  const t = runCreateScene({ generation: 14 });
  try {
    await t.run(legacyScene());
    assert.equal(t.created.length, 1);
    assert.equal(t.created[0].initialLevel.background.src, "maps/a.webp");
    assert.equal(t.created[0].shiftX, 12);
    assert.equal(t.created[0].width, 2000);
    assert.equal(t.created[0].notes.length, 1);
  } finally { t.cleanup(); }
});

test("importer.mjs createScene: v13 path still sends legacy background", async () => {
  const seen = [];
  const t = runCreateScene({ generation: 13 });
  const orig = globalThis.Scene.createDocuments;
  globalThis.Scene.createDocuments = async (l) => { seen.push(...l); return orig.call(globalThis.Scene, l); };
  try {
    await t.run(legacyScene());
    assert.equal(seen[0].background.src, "maps/a.webp");
    assert.equal("levels" in seen[0], false);
  } finally { t.cleanup(); }
});

test("importer.mjs createScene: lower-priority import inherits existing v14 scene art", async () => {
  const existing = {
    width: 111, height: 222, shiftX: 7, shiftY: 8,
    initialLevel: { background: { src: "old/hq.webp" } },
  };
  const t = runCreateScene({
    generation: 14, existing: [existing], priority: 0,
    mapping: [{ name: "aoa1/map3", path: "old/hq.webp", priority: 1 }],
  });
  try {
    await t.run(legacyScene());
    const c = t.created[0];
    assert.equal(c.initialLevel.background.src, "old/hq.webp");
    assert.equal(c.width, 111);
    assert.equal(c.shiftX, 7);
    assert.equal(c.shiftY, 8);
  } finally { t.cleanup(); }
});

test("importer.mjs createScene: higher-priority import updates the existing v14 scene in place", async () => {
  const calls = [];
  const existing = {
    width: 1, height: 1, shiftX: 0, shiftY: 0,
    initialLevel: { background: { src: "old/low.webp" }, update: async (d) => calls.push(["level", d]) },
    update: async (d) => calls.push(["scene", d]),
    createThumbnail: async () => ({ thumb: "t" }),
  };
  const t = runCreateScene({
    generation: 14, existing: [existing], priority: 2, setting: false,
    mapping: [{ name: "aoa1/map3", path: "old/low.webp", priority: 1 }],
  });
  try {
    const result = await t.run(legacyScene());
    assert.equal(result, undefined);
    assert.equal(t.created.length, 0);
    assert.deepEqual(calls[0], ["level", { background: { src: "maps/a.webp" } }]);
    assert.equal(calls[1][1].shiftX, 12);
  } finally { t.cleanup(); }
});

test("importer.mjs imports the compat helpers", () => {
  assert.match(importerSrc, /from'\.\/scene-compat\.mjs'/);
  assert.match(importerSrc, /createDocuments'\]\(\[toV14SceneData\(/);
});

/* ---- postChatMessage: v14 rejects the numeric `type` (it is now a string message type) ---- */
function loadPostChatMessage() {
  const a = importerSrc.indexOf("const _0x4bb2d6=_0x5157;");
  const h = importerSrc.indexOf("}(_0x28fd,0x55931));") + "}(_0x28fd,0x55931));".length;
  const i = importerSrc.indexOf("function _0x28fd(){");
  const e = importerSrc.indexOf("return _0x28fd();}", i) + "return _0x28fd();}".length;
  const j = importerSrc.indexOf("function _0x5157(");
  const k = importerSrc.indexOf("__name(generateData", j);
  const p1 = importerSrc.indexOf("function postChatMessage(");
  const p2 = importerSrc.indexOf("__name(postChatMessage", p1);
  assert.ok([a, h, i, e, j, k, p1, p2].every((n) => n > 0), "importer layout changed");
  return `${importerSrc.slice(a, h)}\n${importerSrc.slice(i, e)}\n${importerSrc.slice(j, k)}\n${importerSrc.slice(p1, p2)}\npostChatMessage`;
}

test("importer.mjs postChatMessage sends no numeric `type` (rejected by v14)", () => {
  const sent = [];
  const sandbox = { ChatMessage: { create: (d) => sent.push(d) }, game: { userId: "u1" } };
  vm.runInNewContext(loadPostChatMessage(), sandbox)("hello");
  assert.equal(sent.length, 1);
  assert.equal("type" in sent[0], false);
  assert.equal(sent[0].style, 0);
  assert.equal(sent[0].content, "hello");
  assert.deepEqual([...sent[0].whisper], ["u1"]);
  assert.equal(sent[0].blind, true);
});
