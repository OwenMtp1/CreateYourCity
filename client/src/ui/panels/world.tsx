import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatGameTime, INDEPENDENCE, isAdminName, TICKS_PER_DAY, type CityState } from '@cyc/shared';
import {
  LAW_LABEL, MILITARY, NATION, ORG_LABEL, TRANSPORT, TREATY_LABEL, UNIT_REQUIRES, UNITS, UNIT_TYPES,
  type OrganizationKind, type TreatyType, type UnitType, type WorldView,
} from '@cyc/shared/game';
import { BUILDINGS } from '@cyc/shared';
import { CITY_BY_ID, COUNTRY_BY_ID } from '@cyc/shared/world';
import type { LawId, ProjectId } from '@cyc/shared';
import { PROJECT_LABEL } from '@cyc/shared/game';
import { relationOf } from '../../globe/GlobeView.tsx';
import { client } from '../../net/client.ts';
import { setState, useGame } from '../../state.ts';
import { cityLabel, Row, Sparkline } from '../common.tsx';
import { fmtInt, fmtMoney, fmtPct } from '../format.ts';

const usePlayers = () => {
  const world = useGame((s) => s.world);
  return useMemo(() => new Map((world?.players ?? []).map((p) => [p.id, p])), [world?.players]);
};
const nameOf = (players: Map<string, { name: string }>, id: string) => players.get(id)?.name ?? 'Joueur';
const countryLabel = (id: string) => COUNTRY_BY_ID.get(id)?.nameFr ?? id;
const showOnGlobe = (cityId: string) => setState({ view: 'globe', focusCityId: cityId });

// --- Territoire --------------------------------------------------------------------------------

export function TerritoryPanel() {
  const myCities = useGame((s) => s.myCities);
  const activeCityId = useGame((s) => s.activeCityId);
  const ids = Object.keys(myCities).sort((a, b) => cityLabel(a).localeCompare(cityLabel(b)));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState(50_000);
  useEffect(() => {
    if (!from && ids[0]) setFrom(ids[0]);
    if (!to && ids[1]) setTo(ids[1]);
  }, [ids.join()]);

  return (
    <div className="stack">
      <h4>Mes villes</h4>
      {ids.length === 0 && <p className="muted small">Choisissez une ville libre sur le globe.</p>}
      <ul className="list">
        {ids.map((id) => {
          const c = myCities[id]!;
          return (
            <li key={id} className={id === activeCityId ? 'active-row' : ''}>
              <span>
                <strong>{cityLabel(id)}</strong> <span className="muted small">{countryLabel(c.countryId)}</span>
                {c.independentSince !== undefined && <span className="chip chip-dictator" title="Dictature indépendante">⚑ Dictature</span>}
                <br /><span className="small">{fmtInt(c.population)} hab. · {fmtMoney(c.treasury)}</span>
              </span>
              <span className="row">
                <button className="small-btn" onClick={() => setState({ activeCityId: id, view: 'city' })}>Construire</button>
                <button className="small-btn" onClick={() => showOnGlobe(id)}>Globe</button>
                <IndependenceButton city={c} />
              </span>
            </li>
          );
        })}
      </ul>
      <h4>Expansion</h4>
      <p className="small muted">
        Sur le globe, sélectionnez une ville neutre à moins de 500 km d'une de vos villes pour l'annexer
        (150 000 cr + 400 cr/km, payés par la ville de départ ; la nouvelle ville démarre vide et sans fonds).
        Vous pouvez aussi acheter une ville à un joueur (cession) ou la conquérir.
      </p>
      {ids.length > 1 && (
        <>
          <h4>Transfert de fonds</h4>
          <div className="row wrap">
            <select value={from} onChange={(e) => setFrom(e.target.value)}>{ids.map((id) => <option key={id} value={id}>{cityLabel(id)}</option>)}</select>
            <span>→</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>{ids.map((id) => <option key={id} value={id}>{cityLabel(id)}</option>)}</select>
          </div>
          <div className="row">
            <input type="number" min={1} step={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            <button onClick={() => void client.action({ type: 'transferFunds', fromCityId: from, toCityId: to, amount })}>Transférer</button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Commerce ------------------------------------------------------------------------------------

export function TradePanel() {
  const world = useGame((s) => s.world);
  const player = useGame((s) => s.player);
  const myCities = useGame((s) => s.myCities);
  const summaries = useGame((s) => s.summaries);
  const players = usePlayers();
  const mine = Object.keys(myCities);
  const others = summaries.filter((s) => s.ownerId !== player?.id);
  const [form, setForm] = useState({ myCityId: '', otherCityId: '', direction: 'sell' as 'sell' | 'buy', qtyPerDay: 50, pricePerUnit: 13, days: 30 });
  useEffect(() => {
    setForm((f) => ({ ...f, myCityId: f.myCityId || mine[0] || '', otherCityId: f.otherCityId || others[0]?.cityId || '' }));
  }, [mine.join(), others.length]);
  if (!world) return null;
  const m = world.market;
  const propose = (e: FormEvent) => {
    e.preventDefault();
    void client.action({ type: 'proposeContract', ...form });
  };

  return (
    <div className="stack">
      <h4>Marché commun des biens</h4>
      <div className="market">
        <div><span className="big-number">{m.price.toFixed(2)}</span> cr</div>
        <div className="small">Achat {m.buyPrice.toFixed(2)} · Vente {m.sellPrice.toFixed(2)}</div>
      </div>
      <Sparkline values={m.history} />
      <Row label="Offre exportée (tous joueurs)" value={`${fmtInt(m.supply)} /j`} />
      <Row label="Demande importée" value={`${fmtInt(m.demand)} /j`} />
      <p className="small muted">Le prix monte quand la demande dépasse l'offre (± 0,2 % par tick, entre 8 et 30 cr). Les surplus sont vendus et les déficits achetés automatiquement.</p>

      <p className="small muted">
        Transport des contrats : {TRANSPORT.costPer1000Km} cr par bien et par 1 000 km, divisé par deux si les deux villes ont un port ou une gare.
        Les droits de douane nationaux s'appliquent aux achats au marché et aux contrats avec l'étranger, sauf accord commercial ou union commerciale.
      </p>
      <h4>Contrats d'approvisionnement</h4>
      {world.contracts.length === 0 && <p className="small muted">Aucun contrat.</p>}
      <ul className="list">
        {world.contracts.map((c) => {
          const iAmSeller = c.sellerId === player?.id;
          const awaitingMe = c.status === 'proposed' && c.proposedBy !== player?.id;
          return (
            <li key={c.id} className="column">
              <div>
                <strong>{cityLabel(c.sellerCityId)} → {cityLabel(c.buyerCityId)}</strong> · {c.qtyPerDay} biens/j à {c.pricePerUnit} cr
              </div>
              <div className="small muted">
                {iAmSeller ? `Vente à ${nameOf(players, c.buyerId)}` : `Achat à ${nameOf(players, c.sellerId)}`} ·{' '}
                {c.status === 'proposed' ? `proposé (${c.days} j)` : `actif jusqu'à ${formatGameTime(c.endTick ?? 0)} · livré ${fmtPct(c.deliveredRatio)}`}
              </div>
              <div className="row">
                {awaitingMe && <button className="primary small-btn" onClick={() => void client.action({ type: 'respondContract', contractId: c.id, accept: true })}>Accepter</button>}
                {awaitingMe && <button className="small-btn" onClick={() => void client.action({ type: 'respondContract', contractId: c.id, accept: false })}>Refuser</button>}
                {!awaitingMe && <button className="small-btn" onClick={() => void client.action({ type: 'cancelContract', contractId: c.id })}>{c.status === 'proposed' ? 'Retirer' : 'Résilier'}</button>}
              </div>
            </li>
          );
        })}
      </ul>

      {mine.length > 0 && others.length > 0 && (
        <form onSubmit={propose} className="stack card compact">
          <h4>Proposer un contrat</h4>
          <div className="row">
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'sell' | 'buy' })}>
              <option value="sell">Je vends</option>
              <option value="buy">J'achète</option>
            </select>
            <select value={form.myCityId} onChange={(e) => setForm({ ...form, myCityId: e.target.value })}>
              {mine.map((id) => <option key={id} value={id}>{cityLabel(id)}</option>)}
            </select>
          </div>
          <label>{form.direction === 'sell' ? 'À la ville' : 'De la ville'}
            <select value={form.otherCityId} onChange={(e) => setForm({ ...form, otherCityId: e.target.value })}>
              {others.map((s) => <option key={s.cityId} value={s.cityId}>{cityLabel(s.cityId)} ({s.ownerName})</option>)}
            </select>
          </label>
          <div className="row">
            <label>Biens/jour<input type="number" min={1} value={form.qtyPerDay} onChange={(e) => setForm({ ...form, qtyPerDay: Number(e.target.value) })} /></label>
            <label>Prix (cr)<input type="number" min={0.1} step={0.5} value={form.pricePerUnit} onChange={(e) => setForm({ ...form, pricePerUnit: Number(e.target.value) })} /></label>
            <label>Jours<input type="number" min={1} max={360} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} /></label>
          </div>
          <button className="primary">Envoyer la proposition</button>
        </form>
      )}
    </div>
  );
}

// --- Diplomatie ---------------------------------------------------------------------------------

const TREATY_OPTIONS: TreatyType[] = ['alliance', 'defense', 'non_aggression', 'trade', 'intel'];

export function DiplomacyPanel() {
  const world = useGame((s) => s.world);
  const player = useGame((s) => s.player);
  const myCities = useGame((s) => s.myCities);
  const players = usePlayers();
  const [target, setTarget] = useState<string>('');
  const [type, setType] = useState<TreatyType>('alliance');
  const [text, setText] = useState('');
  const [payFrom, setPayFrom] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const others = (world?.players ?? []).filter((p) => p.id !== player?.id);
  useEffect(() => { if (!target && others[0]) setTarget(others[0].id); }, [others.length]);
  useEffect(() => { if (!payFrom) setPayFrom(Object.keys(myCities)[0] ?? ''); }, [Object.keys(myCities).join()]);
  const messages = (world?.messages ?? []).filter((m) => !m.to.startsWith('org:') && (m.from === target || m.to === target));
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages.length]);
  if (!world || !player) return null;

  const pending = world.treaties.filter((t) => t.status === 'proposed' && (t.a === player.id || t.b === player.id));
  const active = world.treaties.filter((t) => t.status === 'active');
  const relation = target ? relationOf(world, player.id, target) : 'other';
  const myWars = world.wars.filter((w) => w.a === player.id || w.b === player.id);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (await client.action({ type: 'sendMessage', to: target, text })) setText('');
  };

  return (
    <div className="stack">
      <h4>Joueurs</h4>
      <ul className="list">
        {others.map((p) => {
          const rel = relationOf(world, player.id, p.id);
          return (
            <li key={p.id} className={p.id === target ? 'active-row' : ''}>
              <button className="link" onClick={() => setTarget(p.id)}>
                <strong className={`rel-${rel}`}>{p.name}</strong>
              </button>
              <span className="small muted">{p.cityIds.length} ville(s) · {rel === 'enemy' ? 'en guerre' : rel === 'ally' ? 'allié' : 'neutre'}</span>
            </li>
          );
        })}
        {others.length === 0 && <li className="muted small">Aucun autre joueur dans ce salon pour l'instant.</li>}
      </ul>

      {target && (
        <div className="card compact">
          <h4>Relations avec {nameOf(players, target)}</h4>
          {relation === 'enemy' ? (
            <button onClick={() => void client.action({ type: 'proposeTreaty', to: target, treaty: 'peace' })}>🕊️ Proposer la paix</button>
          ) : (
            <>
              <div className="row">
                <select value={type} onChange={(e) => setType(e.target.value as TreatyType)}>
                  {TREATY_OPTIONS.map((t) => <option key={t} value={t}>{TREATY_LABEL[t]}</option>)}
                </select>
                <button className="primary" onClick={() => void client.action({ type: 'proposeTreaty', to: target, treaty: type })}>Proposer</button>
              </div>
              <button className="danger" onClick={() => { if (confirm(`Déclarer la guerre à ${nameOf(players, target)} ?`)) void client.action({ type: 'declareWar', target }); }}>
                ⚔️ Déclarer la guerre
              </button>
            </>
          )}
          <div className="chat">
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg ${m.from === player.id ? 'me' : ''}`}>
                <strong>{nameOf(players, m.from)}</strong> : {m.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <form onSubmit={send} className="row">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message privé" />
            <button disabled={!text.trim()}>Envoyer</button>
          </form>
        </div>
      )}

      <h4>Propositions</h4>
      {pending.length === 0 && <p className="small muted">Aucune proposition en attente.</p>}
      <ul className="list">
        {pending.map((t) => {
          const forMe = t.b === player.id;
          const needsPayer = forMe && t.type === 'city_transfer' && t.terms?.seller === player.id ? false : forMe && t.type === 'city_transfer';
          return (
            <li key={t.id} className="column">
              <div>
                <strong>{TREATY_LABEL[t.type]}</strong>{' '}
                {t.nations ? `${countryLabel(t.nations.a)} ↔ ${countryLabel(t.nations.b)}` : forMe ? `de ${nameOf(players, t.a)}` : `à ${nameOf(players, t.b)}`}
              </div>
              {t.terms && <div className="small">{cityLabel(t.terms.cityId)} pour {fmtMoney(t.terms.price)} (vendeur : {nameOf(players, t.terms.seller)})</div>}
              <div className="row">
                {needsPayer && (
                  <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)}>
                    {Object.keys(myCities).map((id) => <option key={id} value={id}>Payer depuis {cityLabel(id)}</option>)}
                  </select>
                )}
                {forMe && <button className="primary small-btn" onClick={() => void client.action({ type: 'respondTreaty', treatyId: t.id, accept: true, ...(needsPayer ? { payFromCityId: payFrom } : {}) })}>Accepter</button>}
                {forMe && <button className="small-btn" onClick={() => void client.action({ type: 'respondTreaty', treatyId: t.id, accept: false })}>Refuser</button>}
                {!forMe && <button className="small-btn" onClick={() => void client.action({ type: 'cancelTreaty', treatyId: t.id })}>Retirer</button>}
              </div>
            </li>
          );
        })}
      </ul>

      <h4>Traités en vigueur</h4>
      {active.length === 0 && <p className="small muted">Aucun traité public.</p>}
      <ul className="list">
        {active.map((t) => (
          <li key={t.id}>
            <span>{TREATY_LABEL[t.type]} : {nameOf(players, t.a)} ↔ {nameOf(players, t.b)}{t.endsAtTick ? ' (préavis en cours)' : ''}</span>
            {(t.a === player.id || t.b === player.id) && !t.endsAtTick && (
              <button className="small-btn" onClick={() => void client.action({ type: 'cancelTreaty', treatyId: t.id })}>Dénoncer</button>
            )}
          </li>
        ))}
      </ul>

      <OrganizationsSection world={world} me={player.id} />

      <h4>Guerres</h4>
      {world.wars.length === 0 && <p className="small muted">Le monde est en paix.</p>}
      <ul className="list">
        {world.wars.map((w) => (
          <li key={w.id}>
            <span className={myWars.includes(w) ? 'neg' : ''}>⚔️ {nameOf(players, w.a)} contre {nameOf(players, w.b)}{w.nations ? ` (${countryLabel(w.nations.a)} / ${countryLabel(w.nations.b)})` : ''}</span>
            <span className="small muted">depuis {formatGameTime(w.sinceTick)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrganizationsSection({ world, me }: { world: WorldView; me: string }) {
  const players = usePlayers();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<OrganizationKind>('military');
  const [invite, setInvite] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [text, setText] = useState('');
  const mine = world.organizations.filter((o) => o.members.includes(me));
  const invited = world.organizations.filter((o) => o.invites.includes(me));
  const others = world.organizations.filter((o) => !o.members.includes(me) && !o.invites.includes(me));
  return (
    <>
      <h4>Organisations multinationales</h4>
      <p className="small muted">
        Alliance militaire : membres alliés (passage, défense commune, ravitaillement, renseignement), guerre interdite entre membres.
        Union commerciale : pas de droits de douane entre membres.
      </p>
      {invited.map((o) => (
        <div key={o.id} className="card compact">
          <div>Invitation : <strong>{o.name}</strong> ({ORG_LABEL[o.kind]}, {o.members.length} membres)</div>
          <div className="row">
            <button className="primary small-btn" onClick={() => void client.action({ type: 'respondOrganization', orgId: o.id, accept: true })}>Rejoindre</button>
            <button className="small-btn" onClick={() => void client.action({ type: 'respondOrganization', orgId: o.id, accept: false })}>Décliner</button>
          </div>
        </div>
      ))}
      <ul className="list">
        {mine.map((o) => {
          const msgs = world.messages.filter((m) => m.to === `org:${o.id}`);
          const candidates = world.players.filter((p) => !o.members.includes(p.id) && !o.invites.includes(p.id));
          return (
            <li key={o.id} className="column">
              <div><strong>{o.kind === 'military' ? '🛡️' : '🤝'} {o.name}</strong> <span className="small muted">· {ORG_LABEL[o.kind]}{o.founderId === me ? ' · fondateur' : ''}</span></div>
              <div className="small">{o.members.map((m) => nameOf(players, m)).join(', ')}{o.invites.length ? ` · invités : ${o.invites.map((m) => nameOf(players, m)).join(', ')}` : ''}</div>
              <div className="row wrap">
                {candidates.length > 0 && (
                  <>
                    <select value={invite[o.id] ?? ''} onChange={(e) => setInvite({ ...invite, [o.id]: e.target.value })} style={{ width: 'auto' }}>
                      <option value="">Inviter…</option>
                      {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="small-btn" disabled={!invite[o.id]} onClick={() => void client.action({ type: 'inviteToOrganization', orgId: o.id, playerId: invite[o.id]! })}>Inviter</button>
                  </>
                )}
                <button className="small-btn" onClick={() => setOpen(open === o.id ? null : o.id)}>💬 Canal ({msgs.length})</button>
                <button className="small-btn danger" onClick={() => { if (confirm(`Quitter « ${o.name} » ?`)) void client.action({ type: 'leaveOrganization', orgId: o.id }); }}>Quitter</button>
              </div>
              {o.founderId === me && o.members.length > 1 && (
                <div className="row wrap small">
                  Exclure :
                  {o.members.filter((m) => m !== me).map((m) => (
                    <button key={m} className="small-btn" onClick={() => { if (confirm(`Exclure ${nameOf(players, m)} ?`)) void client.action({ type: 'expelFromOrganization', orgId: o.id, playerId: m }); }}>{nameOf(players, m)}</button>
                  ))}
                </div>
              )}
              {open === o.id && (
                <>
                  <div className="chat">{msgs.map((m) => <div key={m.id} className="chat-msg"><strong>{nameOf(players, m.from)}</strong> : {m.text}</div>)}</div>
                  <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await client.action({ type: 'sendMessage', to: `org:${o.id}`, text })) setText(''); }}>
                    <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={`Message à « ${o.name} »`} />
                    <button disabled={!text.trim()}>Envoyer</button>
                  </form>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); if (await client.action({ type: 'createOrganization', name, kind })) setName(''); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de l'organisation" minLength={3} maxLength={40} style={{ flex: 1 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as OrganizationKind)} style={{ width: 'auto' }}>
          <option value="military">Alliance militaire</option>
          <option value="trade">Union commerciale</option>
        </select>
        <button className="primary" disabled={name.trim().length < 3}>Fonder</button>
      </form>
      {others.length > 0 && (
        <div className="small muted">Autres organisations : {others.map((o) => `${o.name} (${o.members.length})`).join(' · ')}</div>
      )}
    </>
  );
}

// --- Armée ---------------------------------------------------------------------------------------

export function ArmyPanel() {
  const world = useGame((s) => s.world);
  const player = useGame((s) => s.player);
  const myCities = useGame((s) => s.myCities);
  const focusCityId = useGame((s) => s.focusCityId);
  const players = usePlayers();
  const withBarracks = Object.values(myCities).filter((c) => c.buildings.some((b) => ['barracks', 'port', 'airbase'].includes(b.type)));
  const [cityId, setCityId] = useState('');
  const [unit, setUnit] = useState<UnitType>('infantry');
  const [count, setCount] = useState(10);
  useEffect(() => { if (!cityId && withBarracks[0]) setCityId(withBarracks[0].cityId); }, [withBarracks.length]);
  if (!world || !player) return null;
  const mine = world.armies.filter((a) => a.ownerId === player.id);
  const foreign = world.armies.filter((a) => a.ownerId !== player.id);
  const recruitCity = myCities[cityId];
  const enlisted = mine.filter((a) => a.homeCityId === cityId).reduce((s, a) => s + a.approxSize, 0);
  const cap = recruitCity ? Math.floor(recruitCity.population * MILITARY.mobilizationShare) : 0;

  return (
    <div className="stack">
      <h4>Recrutement</h4>
      {withBarracks.length === 0 ? (
        <p className="small muted">Construisez une caserne (troupes au sol), un port (flotte) ou une base aérienne (aviation) pour recruter.</p>
      ) : (
        <div className="stack card compact">
          <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
            {withBarracks.map((c) => <option key={c.cityId} value={c.cityId}>{cityLabel(c.cityId)}</option>)}
          </select>
          <div className="unit-grid">
            {UNIT_TYPES.map((u) => (
              <button key={u} className={unit === u ? 'build active' : 'build'} onClick={() => setUnit(u)}
                disabled={!recruitCity?.buildings.some((b) => b.type === UNIT_REQUIRES[u])} title={`Nécessite : ${BUILDINGS[UNIT_REQUIRES[u]].label}`}>
                <strong>{UNITS[u].label}</strong>
                <span className="small">{fmtMoney(UNITS[u].cost)} · {UNITS[u].upkeepPerDay}/j</span>
                <span className="small muted">Att. {UNITS[u].attack} · Déf. {UNITS[u].defense} · {UNITS[u].speedKmh} km/h</span>
              </button>
            ))}
          </div>
          <div className="row">
            <input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            <button className="primary" onClick={() => void client.action({ type: 'recruit', cityId, unit, count })}>
              Recruter ({fmtMoney(UNITS[unit].cost * count)})
            </button>
          </div>
          <div className="small muted">Mobilisation : {fmtInt(enlisted)} / {fmtInt(cap)} (5 % de la population)</div>
        </div>
      )}

      <h4>Mes armées</h4>
      {mine.length === 0 && <p className="small muted">Aucune armée.</p>}
      <ul className="list">
        {mine.map((a) => (
          <li key={a.id} className="column">
            <div>
              <strong>Armée #{a.id}</strong> · {UNIT_TYPES.filter((u) => (a.units?.[u] ?? 0) >= 0.5).map((u) => `${fmtInt(a.units![u])} ${UNITS[u].label.toLowerCase()}`).join(', ')}
            </div>
            <div className="small muted">
              {a.movement ? `En route vers ${cityLabel(a.movement.toCityId)} (${fmtInt(a.movement.progressKm)}/${fmtInt(a.movement.totalKm)} km)` : `À ${cityLabel(a.cityId)}`}
              {a.engaged && !a.retreating && <span className="neg"> · ⚔️ engagée au combat</span>}
              {a.retreating && <span> · en retraite</span>}
              {a.supplied === false && <span className="neg"> · hors ravitaillement</span>}
              {a.paid === false && <span className="neg"> · solde impayée</span>}
            </div>
            <div className="row wrap">
              {a.engaged && a.movement && !a.retreating && (
                <button className="small-btn danger" onClick={() => void client.action({ type: 'moveArmy', armyId: a.id, toCityId: a.cityId })}>Battre en retraite</button>
              )}
              <button className="small-btn" disabled={!focusCityId} title="Sélectionnez une destination sur le globe"
                onClick={() => focusCityId && void client.action({ type: 'moveArmy', armyId: a.id, toCityId: focusCityId })}>
                {focusCityId ? `Envoyer vers ${cityLabel(focusCityId)}` : 'Choisir une destination sur le globe'}
              </button>
              <button className="small-btn" onClick={() => showOnGlobe(a.movement?.toCityId ?? a.cityId)}>Voir</button>
              <button className="small-btn danger" onClick={() => { if (confirm('Dissoudre cette armée ?')) void client.action({ type: 'disbandArmy', armyId: a.id }); }}>Dissoudre</button>
            </div>
          </li>
        ))}
      </ul>

      <h4>Armées étrangères repérées</h4>
      {foreign.length === 0 && <p className="small muted">Aucune dans votre rayon d'observation (500 km).</p>}
      <ul className="list">
        {foreign.map((a) => (
          <li key={a.id}>
            <span className={`rel-${relationOf(world, player.id, a.ownerId)}`}>{nameOf(players, a.ownerId)}</span>
            <span className="small">~{fmtInt(a.approxSize)} · {a.movement ? `→ ${cityLabel(a.movement.toCityId)}` : cityLabel(a.cityId)}</span>
          </li>
        ))}
      </ul>

      {world.battles.length > 0 && (
        <>
          <h4>Batailles en cours</h4>
          <ul className="list">
            {world.battles.map((b) => (
              <li key={b.id}>
                <span>⚔️ {b.players.map((p) => nameOf(players, p)).join(' contre ')}</span>
                <span className="small muted">depuis {formatGameTime(b.sinceTick)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {world.sieges.length > 0 && (
        <>
          <h4>Sièges en cours</h4>
          <ul className="list">
            {world.sieges.map((s) => (
              <li key={s.cityId}>
                <span>{cityLabel(s.cityId)} assiégée par {nameOf(players, s.attackerId)}</span>
                <span className="bar small-bar"><span style={{ width: `${Math.round(s.progress * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted">
        Règles : ravitaillement à moins de {MILITARY.supplyRangeKm} km d'une ville amie ({MILITARY.railSupplyRangeKm} km avec une gare), sinon −3 %/jour et force ×0,6 ;
        deux armées ennemies en marche à moins de {MILITARY.engageKm} km s'arrêtent et se battent (retraite possible vers le point de départ) ;
        en ville, bonus défensif ×1,25 ; sans défenseur, siège selon la fortification. Flotte : de port à port. Aviation : {MILITARY.maxAirMoveKm} km par ordre.
        Seules les troupes au sol prennent une ville. Entre deux gares amies, les troupes au sol vont trois fois plus vite.
      </p>
    </div>
  );
}

// --- Nation ---------------------------------------------------------------------------------------

const LAWS: LawId[] = ['environment', 'minimum_wage', 'public_health', 'conscription', 'education', 'emergency'];
const LAW_HELP: Record<LawId, string> = {
  environment: 'Pollution −40 %, production industrielle −10 %',
  minimum_wage: 'Salaires +15 %, attractivité +5 %',
  public_health: 'Capacité santé +25 %, entretien santé +10 %',
  conscription: 'Recrutement −30 %, attractivité −5 %',
  education: 'Capacité éducative +20 %, attractivité +3 %',
  emergency: "Fortifications +30 %, impôt national jusqu'à 20 %, attractivité −8 %, élections suspendues",
};
const PROJECTS: ProjectId[] = ['highway', 'power_grid', 'university', 'national_defense', 'trade_fair', 'national_health', 'data_network', 'national_park', 'international_airport'];
const PROJECT_HELP: Record<ProjectId, string> = {
  highway: 'Capacité des routes +30 %',
  power_grid: "Prix de l'électricité importée −40 %",
  university: 'Capacité éducative +30 %, bureaux +10 %',
  national_defense: 'Fortifications +50 %',
  trade_fair: 'Ventes des commerces +15 %',
  national_health: 'Capacité santé +20 %',
  data_network: 'Revenu des bureaux +10 %',
  national_park: 'Pollution −15 %, attractivité +3 %',
  international_airport: 'Unités aériennes ×1,5 en vitesse',
};
/** Coût quotidien d'une mesure, pris en charge par le budget national. */
const upkeepText = (id: LawId | ProjectId) => {
  const v = NATION.measureUpkeepPerDay[id];
  return v ? ` · ${fmtMoney(v)}/j à la charge de la nation` : '';
};

/** Proclamer l'indépendance d'une ville (dictature) ou la réintégrer dans son pays. */
function IndependenceButton({ city }: { city: CityState }) {
  const tick = useGame((s) => s.tick);
  const country = countryLabel(city.countryId);
  const hours = (ticks: number) => Math.ceil(ticks / 6);
  if (city.independentSince !== undefined) {
    const wait = INDEPENDENCE.cooldownTicks - (tick - city.independentSince);
    return (
      <button className="small-btn" disabled={wait > 0} title={wait > 0 ? `Possible dans ${hours(wait)} h de jeu` : `Réintégrer ${country}`}
        onClick={() => { if (confirm(`Réintégrer ${cityLabel(city.cityId)} à ${country} ?\n\nLa ville paiera de nouveau l'impôt national, suivra les lois du pays, retrouvera le marché commun, le réseau régional et les subventions, et vous redeviendrez électeur.`)) void client.action({ type: 'rejoinCountry', cityId: city.cityId }); }}>
        {wait > 0 ? `Réintégrer (${hours(wait)} h)` : 'Réintégrer'}
      </button>
    );
  }
  const wait = city.rejoinedAtTick !== undefined ? INDEPENDENCE.cooldownTicks - (tick - city.rejoinedAtTick) : 0;
  return (
    <button className="small-btn danger" disabled={wait > 0} title={wait > 0 ? `Possible dans ${hours(wait)} h de jeu` : 'Proclamer une dictature indépendante'}
      onClick={() => {
        if (confirm(`Proclamer l'indépendance de ${cityLabel(city.cityId)} ?\n\n`
          + `⚑ La ville devient une dictature indépendante, hors de ${country} :\n`
          + `• plus d'impôt national ni de droits de douane, les lois et projets du pays ne s'appliquent plus ;\n`
          + `• plus aucune subvention, et vous ne votez plus (ni ne dirigez) dans ce pays ;\n`
          + `• plus d'importations ni d'exportations, contrats annulés, plus d'électricité ni d'eau du réseau régional : la ville doit tout produire elle-même ;\n`
          + `• tous les membres de ${country} en sont avertis et la ville est signalée sur le globe.\n\n`
          + `Réintégration possible après un jour de jeu.`)) void client.action({ type: 'secede', cityId: city.cityId });
      }}>
      {wait > 0 ? `⚑ (${hours(wait)} h)` : '⚑ Indépendance'}
    </button>
  );
}

export function NationPanel() {
  const world = useGame((s) => s.world);
  const player = useGame((s) => s.player);
  const myCities = useGame((s) => s.myCities);
  const countries = [...new Set(Object.values(myCities).map((c) => c.countryId))];
  const [countryId, setCountryId] = useState('');
  useEffect(() => { if (!countryId || !countries.includes(countryId)) setCountryId(countries[0] ?? ''); }, [countries.join()]);
  if (!world || !player) return null;
  if (countries.length === 0) return <p className="muted small">Possédez une ville pour participer à la vie politique de son pays.</p>;
  return (
    <div className="stack">
      {countries.length > 1 && (
        <select value={countryId} onChange={(e) => setCountryId(e.target.value)}>
          {countries.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
        </select>
      )}
      {countryId && <NationDetail world={world} me={player.id} countryId={countryId} />}
      {countryId && <NationDebts countryId={countryId} />}
      {countryId && isAdminName(player.name) && (
        <button className="danger" onClick={() => { if (confirm('Remettre à zéro le budget de cette nation ?')) void client.action({ type: 'resetNationBudget', countryId }); }}>
          Remettre le budget à zéro (admin)
        </button>
      )}
    </div>
  );
}

function NationDetail({ world, me, countryId }: { world: WorldView; me: string; countryId: string }) {
  const players = usePlayers();
  const summaries = useGame((s) => s.summaries);
  const seceded = summaries.filter((c) => c.countryId === countryId && c.independent);
  const nation = world.nations.find((n) => n.countryId === countryId);
  const voters = nation?.voters ?? [me];
  const isLeader = nation?.leaderId === me;
  const [tax, setTax] = useState(nation?.taxRate ?? 0);
  const [tariff, setTariff] = useState(nation?.tariff ?? 0);
  useEffect(() => setTariff(nation?.tariff ?? 0), [nation?.tariff]);
  const [grantCity, setGrantCity] = useState('');
  const [grant, setGrant] = useState(100_000);
  const [target, setTarget] = useState('');
  useEffect(() => setTax(nation?.taxRate ?? 0), [nation?.taxRate]);
  const majority = Math.floor(voters.length / 2) + 1;
  const candidates = nation?.candidates ?? [];
  const otherNations = [...new Set(world.players.flatMap((p) => p.cityIds.map((c) => CITY_BY_ID.get(c)?.countryId ?? '')))].filter((c) => c && c !== countryId);
  const citiesInCountry = world.players.flatMap((p) => p.cityIds).filter((c) => CITY_BY_ID.get(c)?.countryId === countryId);

  return (
    <>
      <h3>🏛️ {countryLabel(countryId)}</h3>
      {!voters.includes(me) && (
        <p className="small dictator-note">⚑ Vos villes de ce pays ont fait sécession : vous ne votez plus et n'êtes plus soumis à ses décisions.</p>
      )}
      {seceded.length > 0 && (
        <div className="dictator-list">
          <p className="small"><strong>⚑ Dictatures indépendantes ({seceded.length})</strong> — hors du pays : ni impôt, ni vote, ni échanges.</p>
          <ul className="list">
            {seceded.map((c) => (
              <li key={c.cityId}><span>⚑ {cityLabel(c.cityId)}</span><span className="small muted">{c.ownerName} · ~{fmtInt(c.population)} hab.</span></li>
            ))}
          </ul>
        </div>
      )}
      <Row label="Dirigeant national" value={nation?.leaderId ? nameOf(players, nation.leaderId) : 'Aucun dirigeant élu'} />
      <Row label="Électeurs (propriétaires de villes)" value={`${voters.length} · majorité ${majority}`} />
      <Row label="Budget national" value={fmtMoney(nation?.treasury ?? 0)} />
      <Row label="Impôt national" value={fmtPct(nation?.taxRate ?? 0, 1)} />
      <Row label="Droits de douane" value={fmtPct(nation?.tariff ?? 0)} />

      <h4>Élection</h4>
      <ul className="list">
        {candidates.map((c) => (
          <li key={c}>
            <span>{nameOf(players, c)} · {nation?.voteCounts[c] ?? 0} voix</span>
            <button className={nation?.myVote === c ? 'active small-btn' : 'small-btn'}
              onClick={() => void client.action({ type: 'vote', countryId, candidateId: nation?.myVote === c ? null : c })}>
              {nation?.myVote === c ? 'Mon vote ✓' : 'Voter'}
            </button>
          </li>
        ))}
        {candidates.length === 0 && <li className="small muted">Aucun candidat.</li>}
      </ul>
      {!isLeader && (
        <button onClick={() => void client.action({ type: 'runForLeader', countryId, run: !candidates.includes(me) })}>
          {candidates.includes(me) ? 'Retirer ma candidature' : 'Me porter candidat'}
        </button>
      )}
      <p className="small muted">
        Pas de dirigeant tant que les électeurs n'en choisissent pas : sans élu, aucun impôt, loi ni guerre nationale, chaque ville est gouvernée par son seul dirigeant local.
        Un candidat est élu dès qu'il obtient la majorité absolue des électeurs. Mandat sans échéance, jusqu'à démission ou destitution (majorité absolue).
      </p>

      {nation?.leaderId && !isLeader && (
        <button className={nation.iSupportImpeach ? 'active danger' : 'danger'}
          onClick={() => void client.action({ type: 'impeach', countryId, support: !nation.iSupportImpeach })}>
          {nation.iSupportImpeach ? 'Retirer mon soutien à la destitution' : 'Soutenir la destitution'} ({nation.impeachCount}/{majority})
        </button>
      )}

      <h4>Lois et grands projets</h4>
      <ul className="list">
        {LAWS.map((l) => (
          <li key={l}>
            <span>{LAW_LABEL[l]}<br /><span className="small muted">{LAW_HELP[l]}{upkeepText(l)}</span></span>
            {isLeader ? (
              <button className={nation?.laws[l] ? 'active small-btn' : 'small-btn'} onClick={() => void client.action({ type: 'setLaw', countryId, law: l, enabled: !nation?.laws[l] })}>
                {nation?.laws[l] ? 'En vigueur' : 'Adopter'}
              </button>
            ) : <span className="chip">{nation?.laws[l] ? 'en vigueur' : '—'}</span>}
          </li>
        ))}
        {PROJECTS.map((p) => (
          <li key={p}>
            <span>{PROJECT_LABEL[p]}<br /><span className="small muted">{PROJECT_HELP[p]} · {fmtMoney(NATION.projectCost[p])}{upkeepText(p)}</span></span>
            {nation?.projects[p] ? <span className="chip pos">réalisé</span> : isLeader ? (
              <button className="small-btn" disabled={(nation?.treasury ?? 0) < NATION.projectCost[p]} onClick={() => void client.action({ type: 'fundProject', countryId, project: p })}>Financer</button>
            ) : <span className="chip">—</span>}
          </li>
        ))}
      </ul>

      {isLeader && (
        <div className="card compact stack">
          <h4>Pouvoirs du dirigeant</h4>
          {nation?.reliefDue && (
            <div className="stack">
              <p className="small muted">La Communauté internationale efface la dette de la nation (son budget tombe alors à 0), ou verse 1 000 000 cr au budget national si elle n'en a pas. Une première aide est offerte maintenant, puis une aide tous les 2 000 jours.</p>
              <button onClick={() => { if (confirm('Demander l\'aide de la Communauté internationale ?')) void client.action({ type: 'claimNationRelief', countryId }); }}>Demander l'aide internationale</button>
            </div>
          )}
          <label>Impôt national : {fmtPct(tax, 1)}
            <input type="range" min={0} max={NATION.maxTaxRate} step={0.005} value={tax} onChange={(e) => setTax(Number(e.target.value))} />
          </label>
          <button onClick={() => void client.action({ type: 'setNationalTax', countryId, rate: tax })}>Fixer l'impôt national</button>
          <label>Droits de douane : {fmtPct(tariff)}
            <input type="range" min={0} max={NATION.maxTariff} step={0.05} value={tariff} onChange={(e) => setTariff(Number(e.target.value))} />
          </label>
          <button onClick={() => void client.action({ type: 'setTariff', countryId, rate: tariff })}>Fixer les droits de douane</button>
          <div className="row">
            <select value={grantCity} onChange={(e) => setGrantCity(e.target.value)}>
              <option value="">Subvention à…</option>
              {citiesInCountry.map((c) => <option key={c} value={c}>{cityLabel(c)}</option>)}
            </select>
            <input type="number" min={1} step={10000} value={grant} onChange={(e) => setGrant(Number(e.target.value))} />
            <button disabled={!grantCity} onClick={() => void client.action({ type: 'nationalGrant', countryId, toCityId: grantCity, amount: grant })}>Verser</button>
          </div>
          <div className="row">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Pays…</option>
              {otherNations.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
            </select>
            <button className="danger" disabled={!target} onClick={() => { if (confirm(`Déclarer la guerre à ${countryLabel(target)} au nom de la nation ?`)) void client.action({ type: 'declareNationalWar', countryId, targetCountryId: target }); }}>Guerre nationale</button>
            <button disabled={!target} onClick={() => {
              const leader = world.nations.find((n) => n.countryId === target)?.leaderId;
              if (leader) void client.action({ type: 'proposeTreaty', to: leader, treaty: 'peace', nation: { from: countryId, to: target } });
            }}>Proposer la paix</button>
          </div>
          <button className="ghost" onClick={() => { if (confirm('Démissionner ?')) void client.action({ type: 'resign', countryId }); }}>Démissionner</button>
        </div>
      )}
    </>
  );
}

/** Dettes des villes de la nation : chaque membre peut en solder une partie ou la totalité. */
function NationDebts({ countryId }: { countryId: string }) {
  const debts = useGame((s) => s.world?.nationDebts ?? []);
  const myCities = useGame((s) => s.myCities);
  const sources = Object.values(myCities).filter((c) => c.countryId === countryId);
  const [from, setFrom] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const list = debts.filter((d) => d.countryId === countryId && d.debt > 0);
  const sourceId = sources.some((c) => c.cityId === from) ? from : (sources[0]?.cityId ?? '');
  if (list.length === 0) return <p className="muted small">Aucune dette dans la nation.</p>;
  const total = list.reduce((a, d) => a + d.debt, 0);
  return (
    <div className="card compact stack">
      <h4>Dettes de la nation</h4>
      <p className="small muted">Total : {fmtMoney(total)}</p>
      <label>Payer depuis
        <select value={sourceId} onChange={(e) => setFrom(e.target.value)}>
          {sources.map((c) => <option key={c.cityId} value={c.cityId}>{cityLabel(c.cityId)} ({fmtMoney(c.treasury)})</option>)}
        </select>
      </label>
      {list.map((d) => {
        const amount = amounts[d.cityId] ?? d.debt;
        return (
          <div key={d.cityId} className="row">
            <span>{cityLabel(d.cityId)} <span className="muted small">{d.ownerName}</span></span>
            <strong className="neg">{fmtMoney(d.debt)}</strong>
            <input type="number" min={1} max={d.debt} step={1000} value={amount}
              onChange={(e) => setAmounts({ ...amounts, [d.cityId]: Number(e.target.value) })} />
            <button disabled={!sourceId} onClick={() => void client.action({ type: 'payDebt', fromCityId: sourceId, toCityId: d.cityId, amount })}>Contribuer</button>
            <button className="ghost" disabled={!sourceId} onClick={() => void client.action({ type: 'payDebt', fromCityId: sourceId, toCityId: d.cityId, amount: d.debt })}>Solder</button>
          </div>
        );
      })}
    </div>
  );
}

// --- Salon : discussion et journal ---------------------------------------------------------------

export function LobbyPanel() {
  const lobby = useGame((s) => s.lobby)!;
  const chat = useGame((s) => s.chat);
  const world = useGame((s) => s.world);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [chat.length]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (await client.act({ t: 'chat', text })) setText('');
  };
  return (
    <div className="stack">
      <Row label="Code d'invitation" value={lobby.code} />
      <Row label="Type" value={lobby.isPublic ? 'Public' : 'Privé'} />
      <Row label="Joueurs" value={`${world?.players.length ?? lobby.playerCount} / ${lobby.maxPlayers}`} />
      <h4>Discussion publique</h4>
      <div className="chat">
        {chat.map((m) => (
          <div key={m.id} className="chat-msg">
            <span className="muted small">{new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
            <strong>{m.author}</strong> : {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message au salon" />
        <button disabled={!text.trim()}>Envoyer</button>
      </form>
      <h4>Journal du monde</h4>
      <ul className="list events">
        {[...(world?.events ?? [])].reverse().map((e) => (
          <li key={e.id} className={`event event-${e.kind}`}>
            <span className="small muted">J{Math.floor(e.tick / TICKS_PER_DAY) + 1}</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
