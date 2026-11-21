// Deal presentation: trade cards (every piece visible), the staff's read, and coach-request projections.
import type { World } from '../sim/types';
import type { TradeOffer, PickRef } from '../sim/trade';
import type { SignTrade } from '../sim/signtrade';
import { staffRead } from '../sim/trade';
import { needDef, needMetric, openRequest, staffSd } from '../sim/needs';
import { fmt$ } from '../sim/gm';
import { Logo, PlayerTile, seenOvr } from './util';

export function PickChip({ pk, owner }: { pk: PickRef; owner: string }) {
  if (pk.no) return <span class="pick-chip live"><Logo t={pk.original} size={18} /><b>No. {pk.no} pick</b> tonight{pk.original !== owner ? <small> via {pk.original}</small> : null}</span>;
  return <span class="pick-chip"><Logo t={pk.original} size={18} /><b>{pk.season}</b> {pk.round === 1 ? '1st round' : pk.round === 2 ? '2nd round' : `Round ${pk.round}`}{pk.original !== owner ? <small> via {pk.original}</small> : null}</span>;
}

function Side({ w, tid, ids, picks, title, sat }: { w: World; tid: string; ids: string[]; picks: PickRef[]; title: string; sat?: SignTrade }) {
  const t = w.teams[tid];
  return <div class="deal-side">
    <div class="deal-h"><Logo t={t} size={30} /><span>{title}</span></div>
    {sat && (() => { const p = w.players[sat.pid]; const s = seenOvr(w, p);
      return <div class="sat-tile"><PlayerTile p={p} size={44} sub={<>Signs for {fmt$(sat.salary)} × {sat.years}{sat.raise ? `, ${(sat.raise * 100).toFixed(1)}% raises` : ''}</>} right={<span class="ovr-pill">{s.exact ? s.mid : `${s.lo}–${s.hi}`}</span>} /><em>Sign-and-trade</em></div>; })()}
    {ids.map(id => { const p = w.players[id]; const s = seenOvr(w, p);
      return <PlayerTile p={p} size={44} sub={<>{p.pos} · {p.age} yrs · {p.contract ? `${fmt$(p.contract.salary)} × ${p.contract.years}` : 'no contract'}</>} right={<span class="ovr-pill">{s.exact ? s.mid : `${s.lo}–${s.hi}`}</span>} />; })}
    {picks.map(pk => <PickChip pk={pk} owner={tid} />)}
    {!ids.length && !picks.length && !sat && <div class="muted">Nothing</div>}
  </div>;
}

/** A deal laid out as two columns: what we send, what we get. */
export function TradeCard({ w, offer, read = true }: { w: World; offer: TradeOffer; read?: boolean }) {
  const u = w.meta.userTeam;
  return <div class="deal">
    <div class="deal-cols">
      <Side w={w} tid={u} ids={offer.give} picks={offer.givePicks} title="We send" sat={offer.sat?.from === u ? offer.sat : undefined} />
      <div class="deal-swap">⇄</div>
      <Side w={w} tid={offer.other} ids={offer.get} picks={offer.getPicks} title="We get" sat={offer.sat && offer.sat.from !== u ? offer.sat : undefined} />
    </div>
    {read && <StaffRead w={w} offer={offer} />}
    <NeedImpact w={w} after={[...w.teams[u].roster.filter(id => !offer.give.includes(id)), ...offer.get, ...(offer.sat && offer.sat.from !== u ? [offer.sat.pid] : [])]} />
  </div>;
}

/** The staff's estimate of how good a deal is for us: a point, an uncertainty band, and a verdict. */
export function StaffRead({ w, offer }: { w: World; offer: TradeOffer }) {
  if (!offer.give.length && !offer.get.length && !offer.givePicks.length && !offer.getPicks.length && !offer.sat) return null;
  const r = staffRead(w, offer);
  const X = (v: number) => `${50 + Math.max(-48, Math.min(48, v * 100))}%`;
  const quality = r.sd <= 2.6 ? 'sharp' : r.sd <= 4 ? 'solid' : r.sd <= 5.5 ? 'rough' : 'shaky';
  return <div class="read">
    <div class="read-top"><b class={r.rel > 0.12 ? 'good' : r.rel < -0.12 ? 'bad' : ''}>{r.verdict}</b>{r.odds && <span class="read-odds">{r.odds}</span>}</div>
    <div class="read-bar">
      <span class="read-l">We overpay</span>
      <div class="read-track"><i class="zero" /><i class="band" style={{ left: X(r.relLo), width: `calc(${X(r.relHi)} - ${X(r.relLo)})` }} /><i class="pt" style={{ left: X(r.rel) }} /></div>
      <span class="read-r">We win</span>
    </div>
    <div class="read-note">Our staff's read is {quality}: the band shows how wrong they could be about players we don't coach. More scouts and a sharper coach narrow it.</div>
  </div>;
}

/** Does a roster move address the coach's open request? */
export function NeedImpact({ w, after, status }: { w: World; after: string[]; status?: boolean }) {
  const req = openRequest(w);
  if (!req) return null;
  const d = needDef(req.key);
  const ids = w.teams[w.meta.userTeam].roster;
  const now = needMetric(w, ids, req.key), next = needMetric(w, after, req.key);
  const max = Math.max(req.target + 6, next + 2, now + 2), min = Math.min(now, next, req.base) - 6;
  const P = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const met = next >= req.target - 0.25;
  const delta = next - now;
  const verdict = status ? (met ? 'Target reached — he will notice.' : `${Math.round(req.target - now)} short. He wants it by ${req.deadline}.`)
    : met ? 'This would satisfy the coach.' : delta > 0.4 ? `Helps, but still ${Math.round(req.target - next)} short of what he asked for.` : delta < -0.4 ? 'This makes his problem worse.' : "This doesn't touch what he asked for.";
  return <div class={`need ${met ? 'met' : delta > 0.4 ? 'up' : delta < -0.4 ? 'down' : ''}`}>
    <div class="need-t"><b>Coach's request: {d.label.toLowerCase()}</b>
      <span>{Math.round(now)}{Math.abs(delta) >= 0.5 ? <> → <b>{Math.round(next)}</b></> : ''} · target {req.target}</span></div>
    <div class="need-track"><i class="tgt" style={{ left: P(req.target) }} /><i class="now" style={{ left: P(now) }} />{Math.abs(delta) >= 0.5 && <i class="next" style={{ left: P(next) }} />}</div>
    <div class="need-v">{verdict}
      {staffSd(w) > 4.5 && after.some(id => w.players[id]?.team !== w.meta.userTeam) ? ' (Estimate — we have limited looks at incoming players.)' : ''}</div>
  </div>;
}

export function ReqPanel({ w }: { w: World }) {
  const req = openRequest(w);
  const last = (w as any).coachRequest;
  if (!req) return <div class="muted">{last ? `Last request (${needDef(last.key).label.toLowerCase()}): ${last.status === 'met' ? 'met — he noticed.' : 'went unmet.'}` : 'No open request. The coach will tell you when he needs something.'}</div>;
  return <NeedImpact w={w} after={w.teams[w.meta.userTeam].roster} status />;
}
