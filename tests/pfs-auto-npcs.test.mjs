import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Extract the helper block from the shipped bundle and run it against stubs.
const src = fs.readFileSync(new URL('../pdftofoundry/FoundryGui.mjs', import.meta.url), 'utf8');
const start = src.indexOf('let _pfsNpcClass,_pfsActorIndex;');
const end = src.indexOf('\n', src.indexOf('function pfsCollectNpcs'));
assert.ok(start > 0 && end > start, 'helper block not found');
const helpers = src.slice(start, end);

function load(packs) {
  class ModuleNpc {
    constructor(init) { Object.assign(this, init); }
    async generate() { return [this.actorUuid, { id: this.id }]; }
  }
  const game = { packs };
  const fn = new Function('ModuleNpc', 'game', `${helpers}; return {pfsCollectNpcs, pfsNpcClass};`);
  return fn(ModuleNpc, game);
}

const pack = (name, entries) => ({
  documentName: 'Actor',
  metadata: { packageName: 'pf2e', name },
  collection: `pf2e.${name}`,
  getIndex: async () => entries,
});

test('collects monster headings and groups duplicates by name', () => {
  const { pfsCollectNpcs } = load([]);
  const adv = { npcs: [] };
  pfsCollectNpcs(adv, { text: { content:
    '<h4 data-monster-id="a1">Raven swarm - Creature 2</h4><p>x</p>' +
    '<h4 data-monster-id="a2">Raven Swarm - Creature 2</h4>' +
    '<h4 data-monster-id="a3">Goblin warrior (3) - Creature -1</h4>' } });
  assert.equal(adv.npcs.length, 2);
  assert.deepEqual(adv.npcs[0].forIds, ['a1', 'a2']);
  assert.equal(adv.npcs[1].pfsName, 'Goblin warrior');
});

test('resolves uuid from pf2e compendia, preferring PFS packs', async () => {
  const { pfsCollectNpcs } = load([
    pack('pathfinder-bestiary', [{ name: 'Raven Swarm', _id: 'BEST' }]),
    pack('pfs-season-1-bestiary', [{ name: 'Raven Swarm', _id: 'PFS1' }]),
  ]);
  const adv = { npcs: [] };
  pfsCollectNpcs(adv, { text: { content: '<h4 data-monster-id="a1">Raven swarm - Creature 2</h4>' } });
  const res = await adv.npcs[0].generate({}, {});
  assert.equal(res[0], 'Compendium.pf2e.pfs-season-1-bestiary.Actor.PFS1');
});

test('skips creatures with no compendium match without throwing', async () => {
  const { pfsCollectNpcs } = load([pack('pfs-season-1-bestiary', [])]);
  const adv = { npcs: [] };
  pfsCollectNpcs(adv, { text: { content: '<h4 data-monster-id="a1">Nobody - Creature 1</h4>' } });
  assert.equal(await adv.npcs[0].generate({}, {}), undefined);
});
