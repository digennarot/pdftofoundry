import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packName, translationFileName, translationPath, bookNames, collectBook, parseTranslation,
} from "../pdftofoundry/babele.mjs";

// Minimal Folder model: root folders have no parent; getSubfolders(true) returns every descendant.
function folder(name, type, contents = [], parent = null) {
  const f = { name, type, contents, folder: parent, children: [] };
  f.getSubfolders = (recursive) => f.children.flatMap((c) => (recursive ? [c, ...c.getSubfolders(true)] : [c]));
  if (parent) parent.children.push(f);
  return f;
}

test("packName slugs the book name with the module prefix", () => {
  assert.equal(packName("Vaultlines"), "pdftofoundry-vaultlines");
  assert.equal(packName("Pathfinder #145: Hellknight Hill"), "pdftofoundry-pathfinder-145-hellknight-hill");
  assert.equal(packName("Città Perduta"), "pdftofoundry-citta-perduta");
  assert.equal(packName("!!!"), "pdftofoundry-book");
});

test("translation files are named after the world pack, under the language folder", () => {
  assert.equal(translationFileName("Vaultlines"), "world.pdftofoundry-vaultlines.json");
  assert.equal(translationPath("pdftofoundry-babele/", "it", "Vaultlines"),
    "pdftofoundry-babele/it/world.pdftofoundry-vaultlines.json");
});

test("bookNames lists root folders of imported document types once", () => {
  const journals = folder("Vaultlines", "JournalEntry");
  const folders = [
    journals,
    folder("Chapter 1", "JournalEntry", [], journals),
    folder("Vaultlines", "Scene"),
    folder("Feybound", "JournalEntry"),
    folder("Loot", "Item"),
  ];
  assert.deepEqual(bookNames(folders), ["Feybound", "Vaultlines"]);
});

test("collectBook gathers the book's folders and documents by Adventure field", () => {
  const j1 = { id: "j1" }, j2 = { id: "j2" }, s1 = { id: "s1" }, a1 = { id: "a1" }, other = { id: "x" };
  const journals = folder("Vaultlines", "JournalEntry", [j1]);
  const chapter = folder("Chapter 1", "JournalEntry", [j2], journals);
  const scenes = folder("Vaultlines", "Scene", [s1]);
  const actors = folder("Vaultlines", "Actor", [a1]);
  const unrelated = folder("Feybound", "JournalEntry", [other]);
  const out = collectBook([journals, chapter, scenes, actors, unrelated], "Vaultlines");
  assert.deepEqual(out.journal, [j1, j2]);
  assert.deepEqual(out.scenes, [s1]);
  assert.deepEqual(out.actors, [a1]);
  assert.deepEqual(out.folders, [journals, chapter, scenes, actors]);
});

test("collectBook returns empty content for an unknown book", () => {
  const out = collectBook([folder("Vaultlines", "Scene", [{ id: "s1" }])], "Feybound");
  assert.deepEqual(out, { folders: [], journal: [], scenes: [], actors: [] });
});

test("parseTranslation accepts Babele files and rejects anything else", () => {
  const data = parseTranslation('{"label":"Vaultlines","entries":{"Vaultlines":{"name":"Vaultlines"}}}');
  assert.equal(data.label, "Vaultlines");
  assert.throws(() => parseTranslation("{not json"), /not valid JSON/);
  assert.throws(() => parseTranslation('{"label":"x"}'), /no "entries"/);
});
