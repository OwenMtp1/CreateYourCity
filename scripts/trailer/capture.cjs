// Capture image par image des plans de la bande-annonce (horloge du navigateur contrôlée :
// 30 images/s régulières même si le rendu est lent). Le canevas 3D est relu directement ; les
// noms de villes du globe sont exportés à part pour être incrustés au montage.
// Usage : node capture.cjs <dossier-sortie> <plan> [<plan>…]   (NODE_PATH doit contenir playwright et ws)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const WebSocket = require('ws');

const [outDir, ...wanted] = process.argv.slice(2);
const DATA = process.env.TRAILER_DIR;
const TOKEN = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim();
const TOKEN_G = fs.readFileSync(path.join(DATA, 'token-gabriel'), 'utf8').trim();
const FPS = 30;
const W = 1280, H = 720;
const PARIS = 'c1159151613';
const REIMS = 'c1159142043';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

async function openPage(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem('cyc.devToken', t); localStorage.setItem('cyc.lobby', 'TRAILR');
    localStorage.setItem('cyc.tutorialDone', '1'); localStorage.setItem('cyc.capture', '1'); localStorage.setItem('cyc.quality', 'high');
  }, [token]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.clock.install();
  await page.goto('http://localhost:8787/', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 300; i++) {
    await page.clock.runFor(30);
    if (await page.evaluate(() => !!window.__cyc?.state?.().lobby)) break;
    await sleep(150);
  }
  await page.clock.runFor(500);
  return page;
}

async function waitFor(page, fn, arg) {
  for (let i = 0; i < 300; i++) {
    await page.clock.runFor(30);
    if (await page.evaluate(fn, arg)) return;
    await sleep(150);
  }
  throw new Error('attente expirée');
}

/** Capture `seconds` de plan ; `setup(t)` (exécuté dans la page) place la caméra à t ∈ [0,1]. */
async function shoot(page, name, seconds, setup, opts = {}) {
  const dir = path.join(outDir, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(seconds * FPS);
  const labels = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (opts.onFrame) await opts.onFrame(i, n);
    await page.evaluate(setup, { t: n > 1 ? i / (n - 1) : 0, ...(opts.arg ?? {}) });
    await page.clock.runFor(1000 / FPS);
    const res = await page.evaluate((withLabels) => {
      const canvas = document.querySelector('.globe-canvas canvas, .city3d canvas');
      const data = canvas.toDataURL('image/jpeg', 0.93);
      const out = { data, labels: [] };
      if (withLabels) {
        for (const e of document.querySelectorAll('.globe-label')) {
          if (e.style.display === 'none') continue;
          const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(e.style.transform);
          if (m) out.labels.push({ t: e.textContent, x: +m[1], y: +m[2], c: e.className.replace('globe-label', '').trim() });
        }
      }
      return out;
    }, !!opts.labels);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(res.data.split(',')[1], 'base64'));
    if (opts.labels) labels.push(res.labels);
    if (i % 30 === 0) log(name, `${i}/${n}`, `${((Date.now() - t0) / (i + 1) / 1000).toFixed(2)} s/image`);
  }
  if (opts.labels) fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify(labels));
  log(name, 'terminé', `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

/**
 * Variante pour la ville : les images sont rendues par lots dans la page (CityScene.step), car
 * avec le rendu logiciel la première image après chaque aller-retour coûte ~20 s contre ~1 s ensuite.
 * Entre deux lots, `between(i, n)` laisse passer les messages du serveur (constructions).
 */
async function shootCity(page, name, seconds, setup, opts = {}) {
  const dir = path.join(outDir, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(seconds * FPS);
  const batch = opts.batch ?? 30;
  const t0 = Date.now();
  for (let i0 = 0; i0 < n; i0 += batch) {
    if (opts.between) await opts.between(i0, n);
    const frames = await page.evaluate(({ src, i0, i1, n, arg, fps }) => {
      const setup = new Function(`return (${src})`)();
      const c = window.__cyc.city;
      const out = [];
      for (let i = i0; i < i1; i++) {
        setup({ t: n > 1 ? i / (n - 1) : 0, ...arg });
        c.step(1 / fps);
        out.push(c.renderer.domElement.toDataURL('image/jpeg', 0.93));
      }
      return out;
    }, { src: setup.toString(), i0, i1: Math.min(n, i0 + batch), n, arg: opts.arg ?? {}, fps: FPS });
    frames.forEach((d, k) => fs.writeFileSync(path.join(dir, `${String(i0 + k).padStart(5, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
    log(name, `${Math.min(n, i0 + batch)}/${n}`, `${((Date.now() - t0) / Math.min(n, i0 + batch) / 1000).toFixed(2)} s/image`);
  }
  log(name, 'terminé', `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// --- Réglages caméra exécutés dans la page --------------------------------------------------

const globeAt = ({ t, from, to }) => {
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const g = window.__cyc.globe;
  g.flight = null;
  g.autoRotate = false;
  const lat = from[0] + (to[0] - from[0]) * e;
  const lon = from[1] + (to[1] - from[1]) * e;
  const r = from[2] + (to[2] - from[2]) * e;
  const phi = ((lon + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  g.camera.position.set(-r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi));
  g.camera.lookAt(0, 0, 0);
};

const cityOrbit = ({ t, cx, cz, radius, height, a0, a1, hour, ease: useEase }) => {
  const c = window.__cyc.city;
  const e = useEase ? (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2) : t;
  c.controls.enableDamping = false;
  const a = ((a0 + (a1 - a0) * e) * Math.PI) / 180;
  c.camera.position.set(cx + radius * Math.cos(a), height, cz + radius * Math.sin(a));
  c.controls.target.set(cx, 0, cz);
  c.controls.update();
  c.timeOverride = hour === undefined ? 12 : typeof hour === 'number' ? hour : hour[0] + (hour[1] - hour[0]) * t;
  c.setTimeOfDay(0, true);
};

const cityTrack = ({ t, x0, x1, z, height, ahead, side }) => {
  const c = window.__cyc.city;
  c.controls.enableDamping = false;
  const x = x0 + (x1 - x0) * t;
  c.camera.position.set(x, height, z + side);
  c.controls.target.set(x + ahead, 0, z);
  c.controls.update();
  c.timeOverride = 10;
  c.setTimeOfDay(0, true);
};

// --- Plans ------------------------------------------------------------------------------------

const SCENES = {
  async globe(browser) {
    const page = await openPage(browser, TOKEN);
    await page.evaluate(() => window.__cyc.setState({ view: 'globe', focusCityId: null }));
    await waitFor(page, () => !!document.querySelector('.globe-canvas canvas'));
    await page.clock.runFor(3000); // chargement des contours
    await sleep(3000);
    await page.clock.runFor(1000);
    await shoot(page, 'g1-intro', 4.5, globeAt, { labels: true, arg: { from: [22, -60, 3.6], to: [30, -10, 3.3] } });
    await shoot(page, 'g2-europe', 4.5, globeAt, { labels: true, arg: { from: [30, -10, 3.3], to: [48, 9, 1.55] } });
    await shoot(page, 'g3-war', 4.5, globeAt, { labels: true, arg: { from: [48, 9, 1.55], to: [46.4, 3.8, 1.16] } });
    await shoot(page, 'g9-outro', 5, globeAt, { labels: true, arg: { from: [46, 4, 1.4], to: [20, 60, 3.8] } });
    await page.context().close();
  },

  async city(browser) {
    const page = await openPage(browser, TOKEN);
    await page.evaluate((id) => window.__cyc.setState({ activeCityId: id, view: 'city' }), PARIS);
    await waitFor(page, () => !!window.__cyc.city && !!document.querySelector('.city3d canvas'));
    await page.clock.runFor(2000);
    await sleep(2000);
    await page.clock.runFor(1000);
    await shootCity(page, 'c1-paris', 5.5, cityOrbit, { arg: { cx: -330, cz: 0, radius: 720, height: 420, a0: 200, a1: 255, ease: true } });
    await SCENES.avenueShot(page);
    const station = await page.evaluate((id) => {
      const city = window.__cyc.state().myCities[id];
      const s = city.buildings.filter((b) => b.type === 'metro_station' || b.type === 'tram_station');
      return s.length ? { x: s[0].x - 1000, z: s[0].y - 1000 } : { x: -400, z: 0 };
    }, PARIS);
    await shootCity(page, 'c3-transit', 4, cityOrbit, { arg: { cx: station.x, cz: station.z, radius: 160, height: 70, a0: 120, a1: 175 } });
    await shootCity(page, 'c4-night', 6, cityOrbit, { arg: { cx: -330, cz: 0, radius: 600, height: 300, a0: 300, a1: 340, hour: [15.5, 23.5] } });
    await page.evaluate((id) => {
      const c = window.__cyc.city;
      const s = window.__cyc.state();
      c.layerOverride = 'traffic';
      c.setCity(s.myCities[id], s.layers[id], 'traffic', null);
    }, PARIS);
    await shootCity(page, 'c5-traffic', 3.5, cityOrbit, { arg: { cx: -360, cz: 0, radius: 520, height: 520, a0: 230, a1: 250 } });
    await page.evaluate((id) => {
      const c = window.__cyc.city;
      const s = window.__cyc.state();
      c.layerOverride = 'health';
      c.setCity(s.myCities[id], s.layers[id], 'health', null);
    }, PARIS);
    await shootCity(page, 'c6-coverage', 2.5, cityOrbit, { arg: { cx: -360, cz: 0, radius: 520, height: 520, a0: 250, a1: 262 } });
    await page.context().close();
  },

  async avenueShot(page) {
    // Travelling au-dessus de l'avenue principale (axe z = 0), légèrement décalé vers le sud.
    await shootCity(page, 'c2-avenue', 4.5, cityTrack, { arg: { x0: -900, x1: -520, z: 0, height: 20, ahead: 170, side: 6 } });
  },

  async avenue(browser) {
    const page = await openPage(browser, TOKEN);
    await page.evaluate((id) => window.__cyc.setState({ activeCityId: id, view: 'city' }), PARIS);
    await waitFor(page, () => !!window.__cyc.city && !!document.querySelector('.city3d canvas'));
    await page.clock.runFor(2000);
    await sleep(2000);
    await page.clock.runFor(1000);
    await SCENES.avenueShot(page);
    await page.context().close();
  },

  async build(browser) {
    const page = await openPage(browser, TOKEN_G);
    // Gabriel revendique Reims par une connexion WebSocket parallèle, puis construit pendant la prise de vue.
    const ws = new WebSocket('ws://localhost:8787/ws');
    await new Promise((r) => ws.on('open', r));
    let id = 0;
    const send = (msg) => ws.send(JSON.stringify({ ...msg, reqId: ++id }));
    send({ t: 'auth', token: TOKEN_G });
    await sleep(300);
    send({ t: 'joinLobby', code: 'TRAILR' });
    await sleep(300);
    send({ t: 'claimCity', cityId: REIMS });
    await sleep(800);
    send({ t: 'command', cityId: REIMS, cmd: { type: 'borrow', amount: 1000000 } });
    await waitFor(page, (cid) => !!window.__cyc.state().myCities[cid], REIMS);
    await page.evaluate((cid) => window.__cyc.setState({ activeCityId: cid, view: 'city' }), REIMS);
    await waitFor(page, () => !!window.__cyc.city && !!document.querySelector('.city3d canvas'));
    await page.clock.runFor(1500);
    const cmd = (c) => send({ t: 'command', cityId: REIMS, cmd: c });
    const plan = [
      { type: 'buildRoad', road: 'avenue', x1: 0, y1: 1000, x2: 420, y2: 1000 },
      { type: 'buildRoad', road: 'street', x1: 140, y1: 1000, x2: 140, y2: 860 },
      { type: 'buildRoad', road: 'street', x1: 280, y1: 1000, x2: 280, y2: 1140 },
      { type: 'buildRoadPath', road: 'street', points: Array.from({ length: 13 }, (_, i) => ({ x: 450 + 30 * Math.cos((i / 12) * 2 * Math.PI), y: 1000 + 30 * Math.sin((i / 12) * 2 * Math.PI) })) },
      ...[30, 62, 94].map((x) => ({ type: 'build', building: 'house', x, y: 1023, rotation: 0 })),
      ...[30, 62, 94].map((x) => ({ type: 'build', building: 'house', x, y: 977, rotation: 0 })),
      ...[880, 915, 950].map((y) => ({ type: 'build', building: 'apartment', x: 165, y, rotation: 0 })),
      ...[880, 915, 950].map((y) => ({ type: 'build', building: 'apartment', x: 115, y, rotation: 0 })),
      { type: 'build', building: 'shop', x: 190, y: 1021, rotation: 0 },
      { type: 'build', building: 'office', x: 230, y: 974, rotation: 0 },
      { type: 'build', building: 'tower', x: 320, y: 1031, rotation: 0 },
      { type: 'build', building: 'park', x: 225, y: 1046, rotation: 0 },
      { type: 'build', building: 'school', x: 330, y: 975, rotation: 0 },
      { type: 'build', building: 'clinic', x: 260, y: 1105, rotation: 0 },
      { type: 'build', building: 'office', x: 305, y: 1105, rotation: 0 },
    ];
    let k = 0;
    await shootCity(page, 'c7-build', 7, cityOrbit, {
      arg: { cx: -790, cz: 0, radius: 300, height: 190, a0: 230, a1: 290 },
      batch: 7,
      between: async (i, n) => {
        const due = Math.floor((i / n) * (plan.length + 2));
        while (k < plan.length && k <= due) { cmd(plan[k]); k++; await sleep(160); }
        await sleep(600);
        await page.clock.runFor(300);
      },
    });
    ws.close();
    await page.context().close();
  },

  async ui(browser) {
    // Captures d'écran complètes (interface) pour les plans fixes animés au montage.
    const page = await openPage(browser, TOKEN);
    await page.evaluate((id) => window.__cyc.setState({ activeCityId: id, view: 'city' }), PARIS);
    await waitFor(page, () => !!window.__cyc.city);
    await page.evaluate(() => { const c = window.__cyc.city; c.controls.enableDamping = false; c.camera.position.set(-760, 300, 420); c.controls.target.set(-420, 0, 0); c.controls.update(); c.timeOverride = 11; c.setTimeOfDay(0, true); });
    await page.clock.runFor(2000);
    const dir = path.join(outDir, 'ui');
    fs.mkdirSync(dir, { recursive: true });
    const still = async (name, rail, after) => {
      await page.locator('.rail-btn', { hasText: rail }).first().dispatchEvent('click');
      await page.clock.runFor(800);
      if (after) await after();
      await page.clock.runFor(800);
      await page.screenshot({ path: path.join(dir, `${name}.png`), timeout: 300000 });
      log('ui', name);
    };
    await still('1-build', 'Construire');
    await still('2-advisors', 'Conseillers');
    await still('3-stats', 'Statistiques');
    await page.evaluate(() => window.__cyc.setState({ view: 'globe', focusCityId: 'c1159151613' }));
    await page.clock.runFor(3000);
    await sleep(3000);
    await page.evaluate(() => {
      const g = window.__cyc.globe;
      g.flight = null;
      const [lat, lon, r] = [47.5, 6, 1.32];
      const phi = ((lon + 180) * Math.PI) / 180, theta = ((90 - lat) * Math.PI) / 180;
      g.camera.position.set(-r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi));
      g.camera.lookAt(0, 0, 0);
    });
    await page.clock.runFor(1500);
    await still('4-diplomacy', 'Diplomatie', async () => {
      await page.locator('.drawer-body').evaluate((el) => { el.scrollTop = el.scrollHeight * 0.45; });
    });
    await still('5-army', 'Armée');
    await still('6-nation', 'Nation');
    await still('7-trade', 'Commerce');
    await page.context().close();
  },
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const name of wanted) {
    log('plan', name);
    await SCENES[name](browser);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

void ease; void lerp;
