// Foundry v14 moved scene art from `Scene#background` into the embedded `levels`
// collection. The importer builds scenes in the legacy v13 shape
// ({ background: { src, offsetX, offsetY, ... } }). On v14 the data layer's
// cleanData() drops `background` (it is no longer in the schema) *before* core's
// own legacy conversion in Scene#_preCreate can read it, so scenes were created
// without a map and without any error. These helpers convert to / read from the
// v14 shape explicitly. See https://github.com/fryguy1013/pdftofoundry/issues/54

export function isV14(generation = globalThis.game?.release?.generation) {
  return Number(generation) >= 14;
}

function defaultLevelId(options) {
  if (options.defaultLevelId) return options.defaultLevelId;
  const fromMeta = globalThis.Scene?.metadata?.defaultLevelId;
  if (fromMeta) return fromMeta;
  return globalThis.foundry?.utils?.randomID?.() ?? "defaultLevel0000";
}

/**
 * Convert legacy-shaped scene data to the v14 shape. Returns the input untouched
 * when not running on v14 or when the data already carries `levels`.
 * Never mutates its argument.
 */
export function toV14SceneData(data, options = {}) {
  if (!isV14(options.generation)) return data;
  if (!data || Array.isArray(data.levels) || !data.background) return data;

  const { background, ...rest } = data;
  const { src = null, offsetX, offsetY } = background;
  const converted = {
    ...rest,
    // v14 validates the embedded Level: `name` is required (real v14.368 rejected it).
    levels: [{ _id: defaultLevelId(options), name: data.name || "Level", background: { src } }],
  };
  if (offsetX !== undefined) converted.shiftX = offsetX;
  if (offsetY !== undefined) converted.shiftY = offsetY;
  return converted;
}

/** Read the primary map art of an existing scene on either data model. */
export function getSceneArt(scene) {
  const level = scene?.initialLevel;
  if (level?.background) {
    return {
      src: level.background.src ?? null,
      offsetX: scene.shiftX ?? 0,
      offsetY: scene.shiftY ?? 0,
    };
  }
  const legacy = scene?.background;
  return {
    src: legacy?.src ?? null,
    offsetX: legacy?.offsetX ?? 0,
    offsetY: legacy?.offsetY ?? 0,
  };
}

/** Copy the art (and size) of an existing scene into legacy-shaped scene data. */
export function applyExistingArt(data, scene) {
  const art = getSceneArt(scene);
  data.background.src = art.src;
  data.width = scene.width;
  data.height = scene.height;
  data.background.offsetX = art.offsetX;
  data.background.offsetY = art.offsetY;
}

/** Replace the art of an existing scene with the art of legacy-shaped scene data. */
export async function updateSceneArt(scene, data, options = {}) {
  const bg = data.background;
  if (isV14(options.generation) && scene.initialLevel) {
    await scene.initialLevel.update({ background: { src: bg.src } });
    await scene.update({
      width: data.width,
      height: data.height,
      shiftX: bg.offsetX,
      shiftY: bg.offsetY,
    });
    return;
  }
  await scene.update({
    img: bg.src,
    width: data.width,
    height: data.height,
    "background.offsetX": bg.offsetX,
    "background.offsetY": bg.offsetY,
  });
}
