import { useStore, openModal, commit, toast } from '../store';
import { Panel, Btn, Meter, Headshot, Chip } from '../util';
import type { Coach } from '../../sim/types';

const STYLE: [keyof Coach, string][] = [['pace', 'Tempo'], ['post', 'Post-up offense'], ['motion', 'Motion offense'], ['iso', 'Isolation'], ['pressure', 'Defensive pressure'], ['depth', 'Bench depth'], ['devFocus', 'Plays young players'], ['experiment', 'Willing to experiment']];
const SKILL: [keyof Coach, string][] = [['tactics', 'Tactics'], ['development', 'Player development'], ['communication', 'Communication'], ['adaptability', 'Adaptability']];

export function CoachCard({ c, compact }: { c: Coach; compact?: boolean }) {
  return <div class={`coach ${compact ? 'compact' : ''}`}>
    <div class="coach-h"><div class="coach-ini">{c.name.split(' ').map(s => s[0]).join('')}</div><div><b>{c.name}</b><small>{c.role}</small></div></div>
    {!compact && c.note && <p class="coach-note">{c.note}</p>}
    <div class="coach-bars">
      {(compact ? SKILL : [...SKILL, ...STYLE]).map(([k, l]) => <div class="cb"><span>{l}</span><Meter v={c[k] as number} /></div>)}
    </div>
  </div>;
}

export function Staff() {
  const { world: w } = useStore();
  const t = w!.teams[w!.meta.userTeam];
  const c = w!.coaches[t.coach];
  const avail = Object.values(w!.coaches).filter(x => !x.team && x.id !== c.id);
  const reqs = Object.entries(t.minutesRequests ?? {});
  const hurt = t.roster.map(id => w!.players[id]).filter(p => p.injury && p.injury.daysLeft > 0);
  return <div class="screen">
    <div class="screen-h"><h2>Staff</h2><div class="screen-meta">The coach runs the floor. You hire, support and — if it comes to that — replace him.</div></div>
    <div class="staff-grid">
      <Panel title="Head coach" right={<span class="muted">Trust in you: {Math.round(c.trustGM ?? 55)}</span>}>
        <CoachCard c={c} />
        <div class="row-btns">
          <Btn kind="big" auto onClick={() => openModal('coachTalk')}>Talk to the coach</Btn>
        </div>
      </Panel>
      <div class="col">
        <Panel title="Your requests to the coach">
          {reqs.length ? reqs.map(([pid, r]) => <div class="li"><b>{w!.players[pid]?.name}</b><span>{r.kind === 'more' ? 'More minutes' : r.kind === 'protect' ? 'Manage his load' : 'Development focus'}</span><Chip kind={r.status === 'accepted' ? 'good' : r.status === 'refused' ? 'bad' : 'warn'}>{r.status}</Chip></div>)
            : <div class="muted">No requests yet. Open any player to ask the coach about his role.</div>}
        </Panel>
        <Panel title="Medical room">
          {hurt.length ? hurt.map(p => <div class="li"><Headshot p={p} size={30} /><b>{p.name}</b><span>{p.injury!.type}</span><Chip kind="bad">{p.injury!.daysLeft} days</Chip></div>) : <div class="muted">Everyone is healthy.</div>}
        </Panel>
        <Panel title="Scouting department">
          <div class="li"><span>Scouting budget</span>
            <div class="seg sm">{[1, 2, 3].map(n => <button data-nav class={w!.scoutBudget === n ? 'on' : ''} onClick={() => { w!.scoutBudget = n; w!.owner.satisfaction = Math.max(0, w!.owner.satisfaction - (n === 3 ? 0.5 : 0)); commit(); toast(n === 3 ? 'More scouts on the road — the owner noticed the bill.' : n === 1 ? 'Scouting cut back.' : 'Standard scouting budget.'); }}>{['', 'Lean', 'Standard', 'Aggressive'][n]}</button>)}</div></div>
          <div class="muted">More scouts means more reports each month, which narrows the ranges on prospects. Our department still has its own blind spots.</div>
        </Panel>
      </div>
      <Panel title="Coaches available" class="avail">
        {avail.map(x => <div class="avail-c">
          <CoachCard c={x} compact />
          <Btn kind="ghost sm" onClick={() => openModal('fireCoach', { id: x.id })}>Hire {x.name.split(' ').slice(-1)[0]}</Btn>
        </div>)}
      </Panel>
    </div>
  </div>;
}
