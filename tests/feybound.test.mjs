import { test } from "node:test";
import assert from "node:assert/strict";

// FoundryGui.mjs registers hooks and UI classes at import time
globalThis.Hooks = { on() {}, once() {} };
globalThis.game = { settings: { register() {}, get() {} } };
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c } }, utils: {} };
const { g: getAllAdventureModules, a: getAdventureModule, M: ModuleData } = await import("../pdftofoundry/FoundryGui.mjs");

/* ---- Synthetic text runs shaped like the parser output for the Feybound PDF (no book text) ---- */
const text = (page, x, y, fontId, str, color = "#000000") => {
  const [fontName, size] = fontId.split(":");
  return {
    text: str, fontId, fontName, fontSize: Number(size), color, isLeftAligned: false, isIndented: false,
    page, x, y, id: btoa(`${page}:${Math.round(x)}:${Math.round(y)}`).replace(/=/g, ""),
  };
};
const cover = () => text(1, 631.9, 620.8, "Taroca:36", "Feybound", "#002a17");
const pdfOf = (textDetails) => ({ textDetails, imageDetails: [], getTextById: (id) => textDetails.find((t) => t.id === id)?.text ?? "" });
const feybound = () => getAllAdventureModules().find((a) => a.prefix === "feybound");

// odd (right-hand) page 9: columns at x=86 and x=321.5, header band above them, purple sidebar, page number in the margin
const samplePage = () => [
  text(9, 196, 347, "Taroca:22", "WHO ARE THE FEY?", "#386079"),
  text(9, 86, 331, "TimesNewRomanPS-BoldItalicMT:12", "Flavor line.", "#386079"),
  text(9, 95, 207, "SabonLTStd-Roman:9", "First paragraph "),
  text(9, 86, 195, "SabonLTStd-Roman:9", "continues here."),
  text(9, 321.5, 207, "GoodOT-CondBold:12", "TEST FEAT"),
  text(9, 480, 207, "GoodOT-CondBold:12", "FEAT 2"),
  text(9, 325, 195, "GoodOT-CondBold:7", "FEY", "#ffffff"),
  text(9, 321.5, 183, "GoodOT-Bold:9", "Prerequisites"),
  text(9, 380, 183, "GoodOT:9", " trained in Nature."),
  text(9, 321.5, 171, "GoodOT:9", "You dance "),
  text(9, 360, 171, "Pathfinder-Icons:9", "[one-action]"),
  text(9, 372, 171, "GoodOT:9", " quickly."),
  text(9, 100, 600, "GoodOT-CondBold:12", "A SIDEBAR", "#544172"),
  text(9, 100, 588, "GoodOT:9", "Sidebar text.", "#544172"),
  text(9, 24, 18, "GoodOT-Bold:12", "8", "#ffffff"),
];

function importPages(adventure, pdf, pageFns) {
  const moduleData = new ModuleData();
  adventure.preprocess(pdf.textDetails);
  const sections = {};
  for (const fn of pageFns) fn(pdf, (key, t) => (sections[key] ??= []).push(t));
  for (const key in sections) moduleData.journalEntries.push(...adventure.extractDetails(sections[key], moduleData, key));
  adventure.finalize(moduleData);
  return moduleData;
}

test("Feybound is registered and detected from its cover", () => {
  assert.ok(feybound(), "feybound adventure missing from the registry");
  assert.equal(getAdventureModule(pdfOf([cover()]))?.prefix, "feybound");
  assert.equal(feybound().detect(pdfOf([{ ...cover(), page: 2 }])), false);
});

test("Feybound wins over detectors that match a common word in its text", () => {
  // the Strength of Thousands #4 detector matches any run reading "Secrets" (a Feybound gazetteer heading)
  const secrets = text(201, 86, 400, "Taroca:16", "Secrets", "#386079");
  assert.equal(getAdventureModule(pdfOf([secrets]))?.prefix, "strength-of-thousands-4");
  assert.equal(getAdventureModule(pdfOf([cover(), secrets]))?.prefix, "feybound");
});

test("Feybound page layouts only reference text pages of the book", () => {
  const adventure = feybound();
  assert.ok(adventure.pages.length > 150);
  assert.ok(adventure.journals.every((j) => j.page >= 5 && j.page <= 212));
});

test("Feybound two-column page: header first, stat block rendered, sidebar split out, chapters grouped", () => {
  const adventure = feybound();
  const { journalEntries } = importPages(adventure, pdfOf(samplePage()), [adventure.TwoColumn(9)]);
  assert.deepEqual(journalEntries.map((j) => j.name), ["Who Are The Fey?", "A Sidebar"]);

  const main = journalEntries[0].text.content;
  assert.ok(main.startsWith("<p><i>Flavor line.</i></p><p>First paragraph continues here.</p>"), main);
  assert.match(main, /<h4>Test Feat <span style="float:right">Feat 2<\/span><\/h4>/);
  assert.match(main, /<span style="border:1px #000000 solid;padding:0.2em">FEY<\/span>/);
  assert.match(main, /<p><strong>Prerequisites<\/strong> trained in Nature\.<\/p><p>You dance <span class="action-glyph">1<\/span> quickly\.<\/p>/);
  assert.doesNotMatch(main, /Sidebar text|>8</);
  assert.match(journalEntries[1].text.content, /Sidebar text\./);

  const ids = journalEntries.map((j) => j.flags.pdftofoundry.id);
  assert.deepEqual(adventure.journalPages.find((c) => c.name === "The Yestereve Revels").pages.map((p) => p.id), ids);
  assert.ok(adventure.journalPages.filter((c) => c.name !== "The Yestereve Revels").every((c) => c.pages.length === 0));
});

test("Feybound merges drop caps into the following word", () => {
  const adventure = feybound();
  const runs = [
    text(43, 320, 211, "P22CiviliteTitling:111.916", "O", "#544172"),
    text(43, 397, 267, "SabonLTStd-Roman:9", "nce upon a time"),
    text(5, 92, 568.5, "P22CiviliteTitling:183", "A", "#544172"),
    text(5, 212, 601, "P22CiviliteProNo9:20", "door shuts", "#544172"),
  ];
  adventure.preprocess(runs);
  assert.deepEqual(runs.map((t) => t.text), ["Once upon a time", "A door shuts"]);
});

test("Feybound bestiary pages use one wide column", () => {
  const adventure = feybound();
  const runs = [
    text(93, 243, 711, "Taroca:16", "Thing", "#386079"),
    text(93, 243, 699, "SabonLTStd-Roman:9", "Left part of a wide line "),
    text(93, 400, 699, "SabonLTStd-Italic:9", "right part"),
  ];
  const { journalEntries } = importPages(adventure, pdfOf(runs), [adventure.Wide(93)]);
  assert.equal(journalEntries.length, 1);
  assert.equal(journalEntries[0].text.content, "<p>Left part of a wide line <i>right part</i></p>");
  assert.equal(adventure.journalPages.find((c) => c.name === "The Fair Folk").pages.length, 1);
});
