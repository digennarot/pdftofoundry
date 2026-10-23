import { test } from "node:test";
import assert from "node:assert/strict";

// FoundryGui.mjs registers hooks and UI classes at import time
globalThis.Hooks = { on() {}, once() {} };
globalThis.game = { settings: { register() {}, get() {} } };
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c } }, utils: {} };
const { g: getAllAdventureModules, a: getAdventureModule, M: ModuleData } = await import("../pdftofoundry/FoundryGui.mjs");

/* ---- Synthetic text runs shaped like the parser output for the Vaultlines PDF (no book text) ---- */
const text = (page, x, y, fontId, str, color = "#000000") => {
  const [fontName, size] = fontId.split(":");
  return {
    text: str, fontId, fontName, fontSize: Number(size), color, isLeftAligned: false, isIndented: false,
    page, x, y, id: btoa(`${page}:${Math.round(x)}:${Math.round(y)}`).replace(/=/g, ""),
  };
};
const cover = () => [
  text(1, 634.1, 632.2, "GoodOT-Bold:28", "Vaultlines", "#ffffff"),
  text(1, 80.2, 180.8, "GoodOT-BoldItalic:14", "An Adventure Path for levels 11–20", "#ffffff"),
];
const pdfOf = (textDetails) => ({ textDetails, imageDetails: [], getTextById: (id) => textDetails.find((t) => t.id === id)?.text ?? "" });
const vaultlines = () => getAllAdventureModules().find((a) => a.prefix === "vaultlines");

function importPages(adventure, pdf, pageFns) {
  const moduleData = new ModuleData();
  adventure.preprocess(pdf.textDetails);
  const sections = {};
  for (const fn of pageFns) fn(pdf, (key, t) => (sections[key] ??= []).push(t));
  for (const key in sections) moduleData.journalEntries.push(...adventure.extractDetails(sections[key], moduleData, key));
  adventure.finalize(moduleData);
  return moduleData;
}

test("Vaultlines is registered and detected from its cover only", () => {
  assert.ok(vaultlines(), "vaultlines adventure missing from the registry");
  assert.equal(getAdventureModule(pdfOf(cover()))?.prefix, "vaultlines");
  // e.g. a player's guide with the same title on its cover
  assert.equal(vaultlines().detect(pdfOf([cover()[0]])), false);
  assert.equal(vaultlines().detect(pdfOf(cover().map((t) => ({ ...t, page: 2 })))), false);
});

test("Vaultlines page layouts only reference pages of the book", () => {
  const adventure = vaultlines();
  assert.ok(adventure.pages.length > 200);
  assert.ok(adventure.journals.every((j) => j.page >= 5 && j.page <= 254));
  const maps = adventure.journals.filter((j) => j.name.startsWith("map-"));
  assert.equal(maps.length, 27);
  assert.ok(maps.every((m) => adventure.imageNames[m.name].startsWith("Map: ")));
});

// even pdf page 12: columns at x=67.5 and x=294.8, chapter tabs right of x=528, a sidebar box at the top of column 2
const samplePage = () => [
  text(12, 545, 704.3, "GoodOT-Bold:8", "Campaign"),
  text(12, 67.6, 615, "GoodOT-CondBold:12", "Z1. TEST ROOM ", "#59a445"),
  text(12, 232.1, 615, "GoodOT-CondBold:12", "L", "#59a445"),
  text(12, 236.8, 615, "GoodOT-CondBold:12", "OW 11", "#59a445"),
  text(12, 67.5, 591, "GoodOT:9", "Boxed text.", "#1a1449"),
  text(12, 67.6, 375, "GoodOT-CondBold:12", "TEST BEAST "),
  text(12, 223.3, 375, "GoodOT-CondBold:12", "CREA"),
  text(12, 244.5, 375, "GoodOT-CondBold:12", "TURE 9"),
  text(12, 71.4, 363.1, "GoodOT-CondBold:7", "BEAST", "#ffffff"),
  text(12, 67.5, 351, "GoodOT-Bold:9", "Perception"),
  text(12, 110, 351, "GoodOT:9", " +17"),
  text(12, 267, 325.7, "GoodOT-Bold:12", "Portrait", "#1a1449"),
  text(12, 356.6, 675, "GoodOT-CondBold:12", "A TEST SIDEBAR"),
  text(12, 309.2, 663, "GoodOT:9", "Sidebar text."),
  text(12, 294.8, 351, "P22RuffcutPlain:20", "Second Section", "#7f3f98"),
  text(12, 294.8, 339, "SabonLTStd-Roman:9", "More text."),
  text(12, 569.5, 19.5, "GoodOT-Bold:14", "11", "#ffffff"),
];

test("Vaultlines two-column page: areas, levels, stat blocks and sidebars", () => {
  const adventure = vaultlines();
  const { journalEntries } = importPages(adventure, pdfOf(samplePage()), [adventure.TwoColumn(12)]);
  assert.deepEqual(journalEntries.map((j) => j.name), ["Z1. Test Room (Low 11)", "Second Section", "A Test Sidebar"]);

  const area = journalEntries[0].text.content;
  assert.match(area, /^<blockquote title="12"><p>Boxed text\. ?<\/p><\/blockquote>/);
  assert.match(area, /<h4><span data-vl-npc="MTI6Njg6Mzc1">Test Beast<\/span> <span style="float:right">Creature 9<\/span><\/h4>/);
  assert.deepEqual(adventure.npcs.map((n) => [n.id, n.forIds]), [["vlc-testbeast-9", ["MTI6Njg6Mzc1"]]]);
  assert.match(area, /<span style="border:1px #000000 solid;padding:0.2em">BEAST<\/span>/);
  assert.match(area, /<p><strong>Perception<\/strong> \+17<\/p>/);
  assert.doesNotMatch(area, /Portrait|Sidebar text|Campaign/);
  assert.match(journalEntries[2].text.content, /Sidebar text\./);

  const ids = journalEntries.map((j) => j.flags.pdftofoundry.id);
  assert.deepEqual(adventure.journalPages.find((c) => c.name === "Chapter 1: Echoes in the Earth").pages.map((p) => p.id).sort(), [...ids].sort());
});

test("Vaultlines keeps same-line headings of different columns apart", () => {
  const adventure = vaultlines();
  const runs = [
    text(39, 99.1, 699, "GoodOT-CondBold:12", "Y1. LEFT", "#59a445"),
    text(39, 262.3, 699, "GoodOT-CondBold:12", "TRIVIAL 12", "#59a445"),
    text(39, 326.3, 699, "GoodOT-CondBold:12", "Y2. RIGHT", "#59a445"),
    text(39, 476.9, 699, "GoodOT-CondBold:12", "MODERATE 12", "#59a445"),
  ];
  adventure.preprocess(runs);
  assert.deepEqual(runs.map((t) => t.text), ["Y1. Left (Trivial 12)", "Y2. Right (Moderate 12)"]);
});

test("Vaultlines renders tables spanning both columns", () => {
  const adventure = vaultlines();
  const runs = [
    text(187, 99.1, 699, "GoodOT-CondBold:12", "TEST TABLE"),
    text(187, 103, 687, "GoodOT-Bold:9", "Name ", "#ffffff"),
    text(187, 141, 687, "GoodOT-Bold:9", "Effect", "#ffffff"),
    text(187, 103, 675, "GoodOT-Bold:9", "First"),
    text(187, 141, 675, "GoodOT:9", "Wraps onto"),
    text(187, 141, 663, "GoodOT:9", "a second line."),
    text(187, 103, 651, "GoodOT-Bold:9", "Second"),
    text(187, 141, 651, "GoodOT-Italic:9", "Italic"),
    text(187, 99, 447, "P22RuffcutPlain:20", "Column Section", "#7f3f98"),
    text(187, 99, 435, "SabonLTStd-Roman:9", "Column text."),
  ];
  const { journalEntries } = importPages(adventure, pdfOf(runs), [adventure.TwoColumn(187)]);
  const table = journalEntries.find((j) => j.name === "Test Table");
  assert.equal(table.text.content, "<table><thead><tr><th>Name</th><th>Effect</th></tr></thead><tbody>"
    + "<tr><td><strong>First</strong></td><td>Wraps onto a second line.</td></tr>"
    + "<tr><td><strong>Second</strong></td><td><em>Italic</em></td></tr></tbody></table>");
  assert.equal(journalEntries.find((j) => j.name === "Column Section").text.content, "<p>Column text.</p>");
});

test("Vaultlines names map images and groups them with their chapter", () => {
  const adventure = vaultlines();
  const moduleData = new ModuleData();
  moduleData.journalEntries.push({ name: "map-13-1", type: "image", flags: { pdftofoundry: { id: "map-13-1" } }, text: { content: "" } });
  moduleData.journalEntries.push({ name: "art-227-1", type: "image", flags: { pdftofoundry: { id: "art-227-1" } }, text: { content: "" } });
  adventure.finalize(moduleData);
  assert.deepEqual(moduleData.journalEntries.map((j) => j.name), ["Map: Lattiskar Harbor & Shiv Solitary", "Corundumite"]);
  assert.deepEqual(adventure.journalPages.find((c) => c.name === "Chapter 1: Echoes in the Earth").pages, [{ id: "map-13-1" }]);
  assert.deepEqual(adventure.journalPages.find((c) => c.name === "Adventure Toolbox").pages, [{ id: "art-227-1" }]);
});

/* ---- Actors: the stat block helpers, extracted from the bundle and run against stubs ---- */
const src = (await import("node:fs")).readFileSync(new URL("../pdftofoundry/FoundryGui.mjs", import.meta.url), "utf8");
const helpers = src.slice(src.indexOf("const VL_SIZES="), src.indexOf("const _Feybound=class"));
const pfsHelpers = src.slice(src.indexOf("let _pfsNpcClass,_pfsActorIndex;"), src.indexOf("\n", src.indexOf("function pfsCollectNpcs")));
function loadActors(packs = [], fromUuid = async () => undefined) {
  class ModuleNpc { constructor(init) { Object.assign(this, init); } }
  const game = { packs: Object.assign(packs, { get: (k) => packs.find((p) => p.collection === k) }) };
  const foundry = { utils: { deepClone: structuredClone, randomID: () => Math.random().toString(36).slice(2, 18).padEnd(16, "0") } };
  return new Function("ModuleNpc", "game", "foundry", "fromUuid", `${pfsHelpers};${helpers}; return {vlParseBlock, vlBuildCreature, vlBuildHazard, vlBuildActor, vlPlanNpcs, vlNpcClass, vlPatchImporter, vlPlaceTokens};`)(ModuleNpc, game, foundry, fromUuid);
}
const itemPack = (name, docs) => ({
  documentName: "Item", metadata: { packageName: "pf2e", name }, collection: `pf2e.${name}`,
  getIndex: async () => docs.map(({ _id, name }) => ({ _id, name })),
  getDocument: async (id) => ({ toObject: () => structuredClone(docs.find((d) => d._id === id)) }),
});
const statBlock = (name, kind, level, ...lines) => `<h4>${name} <span style="float:right">${kind} ${level}</span></h4>` + lines.map((l) => `<p>${l}</p>`).join("");
const fullBlock = statBlock("Test Guards (2)", "Creature", 12,
  '<span style="border:1px #000000 solid;padding:0.2em">RARE</span> <span style="border:1px #000000 solid;padding:0.2em">LARGE</span> <span style="border:1px #000000 solid;padding:0.2em">ELEMENTAL</span>',
  "<strong>Perception </strong>+24; darkvision, tremorsense (imprecise) 60 feet",
  "<strong>Languages </strong>Common, Petran; telepathy 100 feet",
  "<strong>Skills </strong>Athletics +25, Stealth +20, Vault Lore +22",
  "<strong>Str</strong> +7, <strong>Dex</strong> +3, <strong>Con</strong> +5, <strong>Int</strong> +0, <strong>Wis</strong> +2, <strong>Cha</strong> −1",
  "<strong>AC </strong>33; <strong>Fort </strong>+25, <strong>Ref </strong>+19, <strong>Will </strong>+21; +1 status to all saves vs. magic",
  "<strong>HP </strong>215; <strong>Immunities </strong>poison, sleep; <strong>Weaknesses </strong>cold iron 10; <strong>Resistances </strong>physical 10 (except adamantine)",
  "<strong>Reactive Strike </strong>[reaction]",
  "<strong>Speed </strong>30 feet, burrow 20 feet; earth glide",
  "<strong>Melee </strong>[one-action] fist +26 (magical, reach 10 feet), <strong>Damage </strong>3d8+12 bludgeoning plus 1d6 fire plus Grab",
  "<strong>Ranged </strong>[one-action] rock +24 (range increment 60 feet),",
  "<strong>Damage</strong> 3d6+12 bludgeoning",
  "<strong>Grab </strong>[one-action] (attack) <strong>Requirements</strong> The guard’s last action was a hit; <strong>Effect</strong> The target is grabbed (DC 31 basic Reflex save).",
  "<strong>Arcane Innate Spells</strong> DC 30, attack +22; <strong>4th</strong> <em>fly</em>; <strong>Cantrips (6th)</strong> <em>shield</em>");

test("Vaultlines builds a PF2e npc from a full stat block", () => {
  const { vlParseBlock, vlBuildCreature } = loadActors();
  const block = vlParseBlock(fullBlock, { id: "B1", page: 40 });
  assert.deepEqual([block.name, block.qty, block.kind, block.level, block.full], ["Test Guards", 2, "creature", 12, true]);
  const { system: s, items } = vlBuildCreature(block);
  assert.deepEqual([s.traits.rarity, s.traits.size.value, s.traits.value], ["rare", "lg", ["elemental"]]);
  assert.equal(s.perception.mod, 24);
  assert.deepEqual(s.perception.senses, [{ type: "darkvision" }, { type: "tremorsense", acuity: "imprecise", range: 60 }]);
  assert.deepEqual([s.details.languages.value, s.details.languages.details], [["common", "petran"], "telepathy 100 feet"]);
  assert.deepEqual(s.skills, { athletics: { base: 25 }, stealth: { base: 20 } });
  assert.deepEqual(Object.fromEntries(Object.entries(s.abilities).map(([k, v]) => [k, v.mod])), { str: 7, dex: 3, con: 5, int: 0, wis: 2, cha: -1 });
  assert.deepEqual([s.attributes.ac.value, s.saves.fortitude.value, s.saves.reflex.value, s.saves.will.value, s.attributes.allSaves.value], [33, 25, 19, 21, "+1 status to all saves vs. magic"]);
  assert.deepEqual([s.attributes.hp.max, s.attributes.immunities, s.attributes.weaknesses, s.attributes.resistances],
    [215, [{ type: "poison" }, { type: "sleep" }], [{ type: "cold-iron", value: 10 }], [{ type: "physical", value: 10, exceptions: ["adamantine"] }]]);
  assert.deepEqual([s.attributes.speed.value, s.attributes.speed.otherSpeeds, s.attributes.speed.details], [30, [{ type: "burrow", value: 20 }], "earth glide"]);

  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(byName["Vault Lore"].system.mod.value, 22);
  assert.deepEqual([byName["Reactive Strike"].system.actionType.value, byName["Reactive Strike"].system.category], ["reaction", "defensive"]);
  const fist = byName.Fist.system;
  assert.deepEqual([fist.bonus.value, fist.traits.value, fist.range, fist.attackEffects.value], [26, ["magical", "reach-10"], null, ["grab"]]);
  assert.deepEqual(Object.values(fist.damageRolls).map((d) => [d.damage, d.damageType]), [["3d8+12", "bludgeoning"], ["1d6", "fire"]]);
  assert.deepEqual([byName.Rock.system.range, Object.values(byName.Rock.system.damageRolls)[0].damage], [{ increment: 60, max: null }, "3d6+12"]);
  const grab = byName.Grab.system;
  assert.deepEqual([grab.actionType.value, grab.actions.value, grab.traits.value], ["action", 1, ["attack"]]);
  assert.match(grab.description.value, /<strong>Requirements<\/strong> The guard’s last action was a hit<\/p><hr \/><p><strong>Effect<\/strong> The target is grabbed \(@Check\[reflex\|dc:31\|basic\]\)/);
});

test("Vaultlines builds hazards and plans one actor per creature, resolving short blocks", () => {
  const { vlParseBlock, vlBuildHazard, vlPlanNpcs } = loadActors();
  const trap = vlParseBlock(statBlock("Test Trap", "Hazard", 11,
    "<strong>Stealth </strong>DC 33 (expert) to notice the rune",
    "<strong>Description </strong>A rune flares.",
    "<strong>Disable </strong>DC 31 Thievery",
    "<strong>AC</strong> 30; <strong>Fort</strong> +20, <strong>Ref</strong> +17",
    "<strong>Hardness</strong> 10, <strong>HP</strong> 40 (BT 20); <strong>Immunities</strong> critical hits, object immunities",
    "<strong>Flare </strong>[reaction] <strong>Trigger</strong> A creature touches the rune; <strong>Effect</strong> 6d6 fire damage (DC 30 basic Reflex save)"), { id: "H1", page: 20 });
  const h = vlBuildHazard(trap).system;
  assert.deepEqual([h.attributes.stealth.value, h.attributes.ac.value, h.attributes.hardness, h.attributes.hp.max, h.saves.reflex.value], [23, 30, 10, 40, 17]);
  assert.match(h.details.description, /A rune flares/);
  assert.match(h.details.disable, /DC 31 Thievery/);

  const blocks = [
    vlParseBlock(fullBlock, { id: "B1", page: 226 }),
    vlParseBlock(statBlock("Test Guards (3)", "Creature", 12, "Page 225", "<strong>Initiative</strong> Perception +24"), { id: "B2", page: 30 }),
    vlParseBlock(statBlock("Test Guard Captain", "Creature", 13, "Elite test guard (page 225)", "<strong>Initiative</strong> Perception +26",
      "<strong>Rally </strong>[one-action] The captain shouts."), { id: "B3", page: 31 }),
    vlParseBlock(statBlock("Elite Cave Worms (2)", "Creature", 14, "<em>Pathfinder Monster Core</em> 6, 58", "<strong>Initiative</strong> Perception +22"), { id: "B4", page: 32 }),
    trap,
  ];
  const specs = Object.fromEntries(vlPlanNpcs(blocks).map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(specs), ["vlc-testguard-12", "vlc-testguardcaptain-13", "vlc-elitecaveworm-14", "vlh-testtrap-11"]);
  assert.deepEqual([specs["vlc-testguard-12"].forIds, specs["vlc-testguard-12"].book.id], [["B1", "B2"], "B1"]);
  const captain = specs["vlc-testguardcaptain-13"];
  assert.deepEqual([captain.book.id, captain.elite, captain.extras.map((e) => e.id)], ["B1", true, ["B3"]]);
  const worm = specs["vlc-elitecaveworm-14"];
  assert.deepEqual([worm.book, worm.compendium[0]], [undefined, { name: "Cave Worms", level: 14, elite: true, weak: false, rename: true }]);
});

test("Vaultlines resolves compendium creatures and builds the rest", async () => {
  const pack = (name, docs) => ({
    documentName: "Actor", metadata: { packageName: "pf2e", name }, collection: `pf2e.${name}`,
    getIndex: async () => docs.map((d) => ({ ...d, system: { details: { level: { value: d.level } } } })),
  });
  const { vlParseBlock, vlPlanNpcs, vlNpcClass, vlPlaceTokens } = loadActors([pack("pathfinder-monster-core", [{ _id: "WORM", name: "Cave Worm", level: 13, img: "worm.webp" }])]);
  const blocks = [
    vlParseBlock(fullBlock, { id: "B1", page: 226 }),
    vlParseBlock(statBlock("Elite Cave Worms (2)", "Creature", 14, "<em>Pathfinder Monster Core</em> 6, 58", "<strong>Initiative</strong> Perception +22"), { id: "B4", page: 32 }),
  ];
  const output = {
    fromUuid: async (uuid) => ({ name: "Cave Worm", img: "worm.webp", prototypeToken: { texture: { src: "worm-token.webp" } }, items: [], uuid }),
    fixupJournal: (j) => j,
  };
  const Npc = vlNpcClass();
  const npcs = vlPlanNpcs(blocks).map((spec) => Object.assign(new Npc({ id: spec.id, forIds: spec.forIds }), { spec }));
  const [guard, worm] = await Promise.all(npcs.map((n) => n.generate({}, output)));
  assert.equal(guard[0], "vaultlines.vlc-testguard-12");
  const built = await output.fromUuid(guard[0]);
  assert.deepEqual([built.type, built.name, built.system.attributes.hp.max], ["npc", "Test Guards", 215]);
  assert.ok(built.items.some((i) => i.type === "spellcastingEntry" && i.name === "Arcane Innate Spells"));
  assert.deepEqual([worm[0], worm[1].name, worm[1].elite, worm[1].token], ["Compendium.pf2e.pathfinder-monster-core.Actor.WORM", "Elite Cave Worm", true, "worm-token.webp"]);

  // stat block headings become actor links, unknown ones fall back to their name
  const journal = { text: { content: '<h4><span data-vl-npc="B1">Test Guards</span> x</h4><h4><span data-vl-npc="ZZ">Other</span></h4>' } };
  output.fixupJournal(journal, new Map([["B1", "actor1"]]));
  assert.equal(journal.text.content, "<h4>@UUID[Actor.actor1]{Test Guards} x</h4><h4>Other</h4>");

  // hidden tokens go next to the first pin of the area whose journal prints the stat block
  const scene = { journals: [{ x: 1000, y: 800, name: "Z1." }, { x: 5, y: 5, name: "Z1." }], tokens: [] };
  const moduleData = { journalEntries: [{ type: "text", name: "Z1. Test Room", text: { content: '<span data-vl-npc="B1">' } }] };
  vlPlaceTokens({ scenes: [scene] }, moduleData, new Map(npcs.map((n) => [n.forIds[0], n])));
  assert.deepEqual(scene.tokens, [{ id: "vlc-testguard-12", x: 1000, y: 900 }, { id: "vlc-testguard-12", x: 1100, y: 900 }]);
});

test("Vaultlines reads PF2e keys from the book's IWR, language and HP wordings", () => {
  const { vlParseBlock, vlBuildCreature } = loadActors();
  const { system: s, items } = vlBuildCreature(vlParseBlock(statBlock("Test Wraith", "Creature", 15,
    "<strong>Perception </strong>+26; darkvision, light blindness",
    "<strong>Languages </strong>Necril (can’t speak any language); telepathy 100 feet",
    "<strong>AC </strong>36; <strong>Fort </strong>+24, <strong>Ref </strong>+27, <strong>Will </strong>+29",
    "<strong>HP </strong>330 (4 segments), rejuvenation, void healing (<em>Monster Core</em> 360); <strong>Thresholds </strong>210 (3 segments); regeneration 10 (deactivated by mental; Pathfinder Monster Core 360); " +
      "<strong>Immunities </strong>fear, paralysis, poisoned, precision damage; <strong>Resistances</strong> all damage 10 (except force, <em>ghost touch</em>, or vitality; double resistance vs. non-magical)"), { id: "W1", page: 50 }));
  assert.deepEqual([s.details.languages.value, s.details.languages.details], [["necril"], "telepathy 100 feet; (can’t speak any language)"]);
  assert.equal(s.attributes.hp.details, "(4 segments), rejuvenation, void healing; Thresholds 210 (3 segments); regeneration 10 (deactivated by mental)");
  assert.deepEqual(s.attributes.immunities.map((i) => i.type), ["fear-effects", "paralyzed", "poison", "precision"]);
  assert.deepEqual(s.attributes.resistances, [{ type: "all-damage", value: 10, exceptions: ["force", "ghost-touch", "vitality"], doubleVs: ["non-magical"] }]);
  // like Monster Core, these also get their glossary ability item
  assert.deepEqual(items.map((i) => [i.name, i.system.slug, i.system.category, i.system.description.value.match(/Glossary\.(\w+)/)?.[1]]), [
    ["Telepathy 100 feet", "telepathy", "interaction", "Telepathy"],
    ["Light Blindness", "light-blindness", "defensive", "LightBlindness"],
    ["Void Healing", "void-healing", "defensive", "NegativeHealing"],
    ["Regeneration 10 (Deactivated by Mental)", "regeneration", "defensive", "Regeneration"],
  ]);
  assert.deepEqual(items[0].system.traits.value, ["aura", "magical", "mental"]);
  assert.deepEqual(items[3].system.rules, [{ key: "FastHealing", type: "regeneration", value: 10, deactivatedBy: ["mental"] }]);
  assert.equal(items[3].system.deathNote, true);
});

test("Vaultlines adds fast healing as a glossary item, unless the stat block prints the ability itself", () => {
  const { vlParseBlock, vlBuildCreature } = loadActors();
  const build = (...lines) => vlBuildCreature(vlParseBlock(statBlock("Test Troll", "Creature", 14, "<strong>Perception </strong>+24",
    "<strong>AC </strong>35; <strong>Fort </strong>+27, <strong>Ref </strong>+22, <strong>Will </strong>+24", ...lines), { id: "T1", page: 60 })).items;
  const [plain] = build("<strong>HP </strong>280, fast healing 20");
  assert.deepEqual([plain.name, plain.system.rules], ["Fast Healing 20", [{ key: "FastHealing", value: 20 }]]);
  const [wet] = build("<strong>HP </strong>280; fast healing 5 (while underwater)");
  assert.deepEqual([wet.name, wet.system.rules[0].predicate, wet.system.rules[1]], ["Fast Healing 5 (While underwater)", ["fast-healing"], { key: "RollOption", option: "fast-healing", toggleable: true }]);
  const printed = build("<strong>HP </strong>280, fast healing 20", "<strong>Fast Healing </strong>The troll regains 20 HP at the start of each of its turns.");
  assert.deepEqual(printed.map((i) => i.name), ["Fast Healing"]);
});

test("Vaultlines adds spells, focus spells and rituals from the compendium", async () => {
  const spell = (_id, name, level, traits = []) => ({ _id, name, type: "spell", system: { level: { value: level }, traits: { value: traits } } });
  const spells = itemPack("spells-srd", [spell("S1", "Vampiric Feast", 5), spell("S2", "Fly", 4), spell("S3", "Haste", 3), spell("S4", "Dispel Magic", 2),
    spell("S5", "Shield", 1, ["cantrip"]), spell("S6", "Qi Blast", 1), spell("S7", "Create Undead", 2, ["ritual"])]);
  const { vlParseBlock, vlBuildActor } = loadActors([spells]);
  const data = await vlBuildActor(vlParseBlock(statBlock("Test Magus", "Creature", 14,
    "<strong>AC </strong>35; <strong>Fort </strong>+24, <strong>Ref </strong>+27, <strong>Will </strong>+29",
    "<strong>Arcane Prepared Spells</strong> DC 36, attack +28; <strong>8th</strong><em>vampiric feast </em>(×2);<strong> 7th</strong><em>fly*</em>, <em>haste</em>; " +
      "<strong>2nd</strong><em>dispelmagic</em>, <em>unknown hex</em>; <strong>Cantrips (7th)</strong><em>shield </em>* This spell has already been cast.",
    "<strong>InnateDivineSpells</strong> DC 30; <strong>3rd</strong><em>haste</em>",
    "<strong>Monk Focus Spells</strong> DC 38, 3 Focus Points; <strong>7th </strong><em>qi blast</em>",
    "<strong>Rituals</strong> DC 36; <em>create undead </em>(<em>Player Core</em> 393), <em>forgotten rite</em>"), { id: "M1", page: 60 }));
  const entries = Object.fromEntries(data.items.filter((i) => i.type === "spellcastingEntry").map((e) => [e.name, e]));
  const prepared = entries["Arcane Prepared Spells"], inEntry = (e) => data.items.filter((i) => i.type === "spell" && i.system.location.value === e._id);
  assert.deepEqual(inEntry(prepared).map((s) => [s.name, s.system.location.heightenedLevel]), [["Vampiric Feast", 8], ["Fly", 7], ["Haste", 7], ["Dispel Magic", undefined], ["Shield", undefined]]);
  assert.deepEqual([prepared.system.slots.slot8.max, prepared.system.autoHeightenLevel.value], [2, 7]);
  assert.equal(prepared.system.description.value, "<p>2: unknown hex</p><p>* This spell has already been cast.</p>");
  assert.deepEqual([entries.InnateDivineSpells.system.tradition.value, entries.InnateDivineSpells.system.prepared.value], ["divine", "innate"]);
  assert.deepEqual([entries["Monk Focus Spells"].system.prepared.value, inEntry(entries["Monk Focus Spells"]).map((s) => s.name), data.system.resources.focus.max], ["focus", ["Qi Blast"], 3]);
  // rituals are plain ritual spells; the ability stays while one of them is unknown
  assert.deepEqual(data.items.filter((i) => i.type === "spell" && i.system.location.value === null).map((s) => s.name), ["Create Undead"]);
  assert.ok(data.items.some((i) => i.type === "action" && i.name === "Rituals"));
});

test("Vaultlines takes 'As <creature>' abilities from the book or the compendium", async () => {
  const vaultBuilder = { name: "Vault Builder", items: [{ _id: "I1", name: "Constraining Crystal", type: "action", system: { actionType: { value: "passive" }, traits: { value: ["earth"] }, description: { value: "<p>@Check[fortitude|dc:38] or become clumsy.</p>" }, rules: [{ key: "Note" }] } }] };
  const actorPack = { documentName: "Actor", metadata: { packageName: "pf2e", name: "rage-of-elements-bestiary" }, collection: "pf2e.rage-of-elements-bestiary",
    getIndex: async () => [{ _id: "VB", name: "Vault Builder (Elite)", system: { details: { level: { value: 18 } } } }] };
  const { vlParseBlock, vlBuildActor } = loadActors([actorPack], async (uuid) => uuid.endsWith(".VB") && { toObject: () => structuredClone(vaultBuilder) });
  const sentinel = vlParseBlock(statBlock("Crystal Sentinel", "Creature", 10, "<strong>AC </strong>29",
    "<strong>Shard Burst</strong> [two-actions] (earth) Shards fly out; 4d6 piercing damage (DC 28 basic Reflex save)."), { id: "C1", page: 80 });
  const data = await vlBuildActor(vlParseBlock(statBlock("Test Builder", "Creature", 19, "<strong>AC </strong>43",
    "<strong>Constraining Crystal</strong> (earth) As vault builder, but DC 29.",
    "<strong>Shard Burst</strong> [two-actions] As crystal sentinels but 6d6 damage and DC 40.",
    "<strong>Shard Storm</strong> As crystal sentinel, except the shards also blind.",
    "<strong>Death Throes</strong> As the builder dies, it explodes."), { id: "T1", page: 81 }), [sentinel]);
  const byName = Object.fromEntries(data.items.map((i) => [i.name, i]));
  const crystal = byName["Constraining Crystal"];
  assert.deepEqual([crystal.system.description.value, crystal.system.rules], ["<p>@Check[fortitude|dc:29] or become clumsy.</p>", [{ key: "Note" }]]);
  const burst = byName["Shard Burst"].system;
  assert.deepEqual([burst.actions.value, burst.traits.value], [2, ["earth"]]);
  assert.match(burst.description.value, /^<p>Shards fly out; @Damage\[6d6\[piercing\]\] damage \(@Check\[reflex\|dc:40\|basic\]\)/);
  assert.match(byName["Shard Storm"].system.description.value, /^<p>As crystal sentinel, except/, "an ability the referenced creature doesn't have stays as printed");
  assert.match(byName["Death Throes"].system.description.value, /^<p>As the builder dies/);
});

test("Vaultlines turns each gridded map panel into a scene with area pins", () => {
  const adventure = vaultlines();
  assert.equal(adventure.noImport, false);
  assert.equal(adventure.scenes.length, 47);
  for (const s of adventure.scenes) {
    const map = adventure.journals.find((j) => j.name.startsWith("map-") && j.page === s.page);
    assert.ok(map && s.width === map.width && s.height === map.height, s.title);
    assert.ok(s.cropLeft >= 0 && s.cropTop >= 0 && s.cropRight <= s.width && s.cropBottom <= s.height, s.title);
    assert.ok(s.imageCols > 0 && s.imageRows > 0 && s.imageLeft >= s.cropLeft && s.imageRight <= s.cropRight, s.title);
    const [w, h] = s.calcFinalSize();
    const padX = Math.ceil(0.25 * w / 100) * 100, padY = Math.ceil(0.25 * h / 100) * 100;
    for (const pin of s.journals) assert.ok(pin.x >= padX - 100 && pin.x <= padX + w && pin.y >= padY - 100 && pin.y <= padY + h, `${s.title} ${pin.name}`);
    assert.match(s.name, /^vaultlines-\d+-\d+$/);
  }
  const hideout = adventure.scenes.find((s) => s.title === "Nuzial’s Hideout: Upper Level");
  assert.deepEqual(hideout.journals.map((j) => j.name).sort(), ["A1.", "A2.", "A3.", "A4.", "A5.", "A6."]);
  hideout.updateName();
  assert.equal(hideout.name, "Nuzial’s Hideout: Upper Level");
});
