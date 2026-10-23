// Babele integration. Babele (https://gitlab.com/riccisi/foundryvtt-babele) only translates compendium
// packs, while the importer creates journals, scenes and actors in the world. These helpers pack one
// imported book into an Adventure document in a world compendium, which Babele translates as a whole
// (journals with their pages, scenes, actors). Importing the translated Adventure back into the world
// keeps the document ids, so links between journals, pins and actors keep working.
//
// Translation files hold the book's text, so they never ship with the module: they live in the
// world's Babele translation directory (Data/<dir>/<lang>/world.<pack>.json).

export const PACK_PREFIX = "pdftofoundry-";
export const DEFAULT_TRANSLATION_DIR = "pdftofoundry-babele";

// Adventure content field -> document type of the folder the importer creates for it.
const CONTENT_TYPES = { journal: "JournalEntry", scenes: "Scene", actors: "Actor" };

export function packName(bookName) {
  const slug = String(bookName)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return PACK_PREFIX + (slug || "book");
}

export function translationFileName(bookName) {
  return `world.${packName(bookName)}.json`;
}

export function translationPath(dir, lang, bookName) {
  return `${dir.replace(/\/+$/, "")}/${lang}/${translationFileName(bookName)}`;
}

// Root folder names holding an imported book. Each import creates a "<book>" folder per document type.
export function bookNames(folders) {
  const names = new Set();
  for (const f of folders) {
    if (!f.folder && Object.values(CONTENT_TYPES).includes(f.type)) names.add(f.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// The book's folders (roots and subfolders) and the documents in them, grouped by Adventure field.
export function collectBook(folders, bookName) {
  const out = { folders: [], journal: [], scenes: [], actors: [] };
  for (const [field, type] of Object.entries(CONTENT_TYPES)) {
    const root = folders.find((f) => !f.folder && f.type === type && f.name === bookName);
    if (!root) continue;
    const tree = [root, ...root.getSubfolders(true)];
    out.folders.push(...tree);
    for (const f of tree) out[field].push(...f.contents);
  }
  return out;
}

// Check a translation file before it is written where Babele will load it.
export function parseTranslation(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`The translation file is not valid JSON: ${err.message}`);
  }
  if (!data || typeof data !== "object" || typeof data.entries !== "object" || data.entries === null) {
    throw new Error("The translation file has no \"entries\": export a template from the compendium and translate that.");
  }
  return data;
}

const babeleActive = () => !!(game.modules.get("babele")?.active && game.babele);

async function ensureDirectory(path) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  let built = "";
  for (const part of path.split("/").filter(Boolean)) {
    built = built ? `${built}/${part}` : part;
    try {
      await FilePicker.createDirectory("data", built, { notify: false });
    } catch (err) {
      if (!/EEXIST|already exists/i.test(err?.message ?? "")) throw err;
    }
  }
}

// Babele's translation directory, set to DEFAULT_TRANSLATION_DIR when the world has none yet.
async function translationDirectory() {
  let dir = game.settings.get("babele", "directory")?.trim();
  if (!dir) {
    dir = DEFAULT_TRANSLATION_DIR;
    await ensureDirectory(dir);
    await game.settings.set("babele", "directory", dir);
    ui.notifications.info(`PDFToFoundry | Babele translation directory set to "${dir}".`);
  }
  return dir;
}

async function ensurePack(bookName) {
  const name = packName(bookName);
  const existing = game.packs.get(`world.${name}`);
  if (existing) return existing;
  const CompendiumCollection = foundry.documents.collections.CompendiumCollection;
  // Adventures holding actors must belong to the system (see AdventureExporter).
  return CompendiumCollection.createCompendium({ type: "Adventure", label: bookName, name, system: game.system.id });
}

export async function createAdventure(bookName) {
  const content = collectBook(game.folders.contents, bookName);
  if (!content.journal.length && !content.scenes.length && !content.actors.length) {
    throw new Error(`No imported folders named "${bookName}" were found.`);
  }

  const isNew = !game.packs.get(`world.${packName(bookName)}`);
  const pack = await ensurePack(bookName);
  const toCompendium = (doc) => doc.toCompendium(pack, {
    clearSort: false, clearFolder: false, clearFlags: false, clearSource: false,
    clearOwnership: true, clearState: true, keepId: true,
  });
  const data = {
    name: bookName,
    img: content.scenes.find((s) => s.thumb)?.thumb ?? null,
    folders: content.folders.map(toCompendium),
    journal: content.journal.map(toCompendium),
    scenes: content.scenes.map(toCompendium),
    actors: content.actors.map(toCompendium),
  };

  const index = await pack.getIndex();
  const current = index.find((e) => e.name === bookName);
  const operation = { pack: pack.collection, keepId: true, keepEmbeddedIds: true };
  let adventure;
  if (current) {
    adventure = await pack.getDocument(current._id);
    await adventure.update(data, { ...operation, diff: false, recursive: false });
  } else {
    adventure = await Adventure.implementation.create(data, operation);
  }

  if (babeleActive()) {
    await translationDirectory();
    // Babele maps the packs it knows at startup; a new pack needs a reload to be exportable.
    if (isNew) await game.babele.reinitialize();
  }
  ui.notifications.info(`PDFToFoundry | "${bookName}" saved to the "${pack.metadata.label}" compendium `
    + `(${data.journal.length} journals, ${data.scenes.length} scenes, ${data.actors.length} actors).`);
  return { pack, adventure };
}

export async function exportTemplate(bookName) {
  if (!babeleActive()) throw new Error("Babele is not active in this world.");
  const pack = game.packs.get(`world.${packName(bookName)}`);
  if (!pack) throw new Error(`Create the "${bookName}" compendium first.`);
  return game.babele.exportTranslationsFile(pack);
}

export async function uploadTranslation(bookName, lang, file) {
  if (!babeleActive()) throw new Error("Babele is not active in this world.");
  parseTranslation(await file.text());
  const dir = await translationDirectory();
  const target = translationPath(dir, lang, bookName);
  const folder = target.slice(0, target.lastIndexOf("/"));
  await ensureDirectory(folder);
  const renamed = new File([file], translationFileName(bookName), { type: "application/json" });
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  await FilePicker.upload("data", folder, renamed, {}, { notify: false });
  await game.babele.refreshTranslationSources();
  ui.notifications.info(`PDFToFoundry | Translation saved to ${target}. `
    + "Open the compendium and import the adventure to replace the world documents.");
  return target;
}

function dialogContent(books) {
  const options = books.map((b) => `<option value="${foundry.utils.escapeHTML(b)}">${foundry.utils.escapeHTML(b)}</option>`).join("");
  const lang = game.i18n.lang === "en" ? "it" : game.i18n.lang;
  return `<form autocomplete="off" onsubmit="event.preventDefault();">
    <p>Babele translates compendia, not world documents. Save an imported book to a world Adventure compendium,
      export the Babele template from it, translate the template, then load the translation here. Importing the
      translated adventure from the compendium replaces the book's journals, scenes and actors in this world.</p>
    <div class="form-group"><label>Book</label><select name="book">${options}</select></div>
    <div class="form-group"><label>Language</label><input type="text" name="lang" value="${lang}" maxlength="10"></div>
    <div class="form-group"><label>Translation file</label><input type="file" name="translation" accept=".json,application/json"></div>
  </form>`;
}

export async function openBabeleDialog() {
  const books = bookNames(game.folders.contents);
  if (!books.length) return ui.notifications.warn("PDFToFoundry | Import a PDF first: there are no book folders to translate.");
  const run = (fn) => async (_event, _button, dialog) => {
    const form = dialog.element.querySelector("form");
    try {
      await fn(form);
    } catch (err) {
      console.error(err);
      ui.notifications.error(`PDFToFoundry | ${err.message}`);
    }
  };
  const buttons = [{
    action: "compendium", icon: "fas fa-book-atlas", label: "Save to Compendium",
    callback: run((form) => createAdventure(form.book.value)),
  }];
  if (babeleActive()) {
    buttons.push({
      action: "template", icon: "fas fa-file-export", label: "Export Template",
      callback: run((form) => exportTemplate(form.book.value)),
    }, {
      action: "upload", icon: "fas fa-language", label: "Load Translation",
      callback: run((form) => {
        const file = form.translation.files[0];
        if (!file) throw new Error("Choose the translated JSON file first.");
        const lang = form.lang.value.trim() || game.i18n.lang;
        return uploadTranslation(form.book.value, lang, file);
      }),
    });
  }
  return foundry.applications.api.DialogV2.wait({
    window: { title: "Translate with Babele" },
    id: "pdftofoundry-babele",
    position: { width: 520, height: "auto" },
    content: dialogContent(books),
    buttons,
    rejectClose: false,
  });
}

globalThis.Hooks?.once("init", () => {
  Hooks.on("renderSettings", (_app, html) => {
    if (!game.user.isGM) return;
    const importButton = html.querySelector("button.bestiary-browser-btn");
    if (!importButton || html.querySelector("button.pdftofoundry-babele-btn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pdftofoundry-babele-btn";
    button.innerHTML = '<i class="fas fa-language"></i> Translate with Babele';
    button.addEventListener("click", () => openBabeleDialog());
    importButton.after(button);
  });
});

globalThis.Hooks?.once("ready", () => {
  if (game.pdftofoundry) {
    game.pdftofoundry.babele = { createAdventure, exportTemplate, uploadTranslation, openDialog: openBabeleDialog };
  }
});
