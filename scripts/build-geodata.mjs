// Génère les données géographiques compactes du jeu à partir de Natural Earth (domaine public).
// Usage : node scripts/build-geodata.mjs  (nécessite un accès réseau ; les sorties sont versionnées)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

async function fetchJson(name) {
  const res = await fetch(NE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const topo = JSON.parse(await readFile(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const countriesGeo = feature(topo, topo.objects.countries).features;

const admin0 = await fetchJson('ne_50m_admin_0_countries.geojson');
const byIsoN3 = new Map();
const byName = new Map();
for (const f of admin0.features) {
  const p = f.properties;
  const n3 = p.ISO_N3 !== '-99' ? p.ISO_N3 : p.ISO_N3_EH;
  const entry = { nameFr: p.NAME_FR, iso2: p.ISO_A2 !== '-99' ? p.ISO_A2 : p.ISO_A2_EH };
  if (n3 && n3 !== '-99') byIsoN3.set(n3.padStart(3, '0'), entry);
  byName.set(p.NAME, entry);
  byName.set(p.ADMIN, entry);
}

// Identifiant de pays stable : code ISO numérique de world-atlas, sinon nom normalisé.
const countryId = (f) => (f.id ? `N${f.id}` : `X-${f.properties.name.replace(/[^A-Za-z]/g, '')}`);
const countries = countriesGeo.map((f) => {
  const meta = (f.id && byIsoN3.get(f.id)) || byName.get(f.properties.name) || {};
  return { id: countryId(f), name: f.properties.name, nameFr: meta.nameFr ?? f.properties.name, iso2: meta.iso2 ?? null, feature: f };
});

const places = await fetchJson('ne_10m_populated_places_simple.geojson');
const cities = [];
let unassigned = 0;
for (const f of places.features) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  let country = countries.find((c) => geoContains(c.feature, [lon, lat]));
  if (!country) {
    // Villes côtières hors du contour simplifié : pays le plus proche par nom puis par distance au centroïde.
    country = countries.find((c) => c.name === p.adm0name || c.iso2 === p.iso_a2);
  }
  if (!country) { unassigned++; continue; }
  cities.push({
    id: `c${p.ne_id ?? cities.length}`,
    name: p.name,
    countryId: country.id,
    lat: round(lat, 4),
    lon: round(lon, 4),
    pop: p.pop_max ?? 0,
    rank: p.scalerank ?? 10,
    capital: /capital/i.test(p.featurecla ?? '') && !/Admin-1/i.test(p.featurecla ?? ''),
  });
}
cities.sort((a, b) => a.rank - b.rank || b.pop - a.pop);
const ids = new Set();
for (const c of cities) { if (ids.has(c.id)) throw new Error('duplicate id ' + c.id); ids.add(c.id); }

await mkdir('shared/data', { recursive: true });
await writeFile('shared/data/cities.json', JSON.stringify(cities));
await writeFile(
  'shared/data/countries.json',
  JSON.stringify(countries.map(({ id, name, nameFr, iso2 }) => ({ id, name, nameFr, iso2 }))),
);

// Régions (admin-1) : Natural Earth 50m ne couvre qu'une partie des pays ; coordonnées arrondies.
const admin1 = await fetchJson('ne_50m_admin_1_states_provinces.geojson');
const roundCoords = (c) => (typeof c[0] === 'number' ? [round(c[0], 2), round(c[1], 2)] : c.map(roundCoords));
const regions = {
  type: 'FeatureCollection',
  features: admin1.features.map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.name, admin: f.properties.admin },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  })),
};
await mkdir('client/public/geo', { recursive: true });
await writeFile('client/public/geo/regions-50m.json', JSON.stringify(regions));

console.log(`${countries.length} pays, ${cities.length} villes (${unassigned} non rattachées), ${regions.features.length} régions`);
