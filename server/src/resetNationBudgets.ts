// Remise à zéro unique du budget national des nations actives (qui ont au moins une ville tenue par un joueur
// du salon). Simulation par défaut ; ajouter --apply pour écrire. Arrêter le serveur avant : sa mémoire
// réécrirait les anciens budgets à la prochaine sauvegarde.
// Usage : npm run budget:reset --workspace server [-- --apply]
import { loadConfig } from './config.ts';
import { createStore } from './store/index.ts';

const apply = process.argv.includes('--apply');
const cfg = loadConfig();
const store = createStore(cfg);
await store.init();
let total = 0;
try {
  for (const record of await store.loadLobbies()) {
    if (!record.world) continue;
    const members = new Set(await store.loadMembers(record.id));
    const cities = await store.loadCities(record.id);
    const active = new Set(cities.filter((c) => members.has(c.ownerId)).map((c) => c.countryId));
    const meta = record.world;
    for (const countryId of active) {
      const nation = meta.nations[countryId];
      if (!nation || nation.treasury === 0) continue;
      console.log(`${record.name} · ${countryId} : budget ${Math.round(nation.treasury).toLocaleString('fr-FR')} cr → 0`);
      total += nation.treasury;
      nation.treasury = 0;
    }
    if (apply) await store.saveSnapshot(record.id, { tick: record.tick, lastSimulatedAt: record.lastSimulatedAt }, cities, meta);
  }
  console.log(`${apply ? 'Appliqué' : 'Simulation (rien écrit)'} : ${Math.round(total).toLocaleString('fr-FR')} cr remis à zéro.`);
} finally {
  await store.close();
}
