// League history calendar (1976-2026 reported, 2027-2040 seeded possibilities) and era rules.
// Identity changes, relocations, expansions and realignments happen on the real calendar; everything that
// happens on the court is simulated. Teams keep their 1976 franchise id for life (BUF is the Clippers' franchise).
import { stream } from './rng';

export interface IdentityEvent {
  season: number; team: string; type: 'relocation' | 'rename' | 'rebrand';
  city?: string; name?: string; abbr?: string; logo?: string; colors?: string[]; arena?: string; note: string;
}
export interface ExpansionDef {
  season: number; id: string; city: string; name: string; abbr: string; conf: 'East' | 'West'; div: string; colors: string[]; logo: string;
  arena: string; owner: string; note: string; future?: boolean;
}

/** Logo files shipped in public/assets/logos (key -> exists). Identities without a file get a generated badge. */
export const LOGO_FILES = new Set([
  'ATL', 'BOS', 'BUF', 'CHI', 'CLE', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'KCK', 'LAL', 'MIL', 'NJN', 'NOJ', 'NYK', 'NYN', 'PHI', 'PHX', 'POR', 'SAS', 'SEA', 'WSB',
  'KEN', 'PIT', 'STL', 'VIR',
  'PHI-1977', 'DET-1978', 'NJN-1978', 'UTA-1979', 'CHH-1988', 'MIA-1988', 'MIN-1989', 'ORL-1989', 'TOR-1995', 'SEA-1995', 'MIA-1999', 'LAL-2001',
  'ORL-2001', 'CHA-2004', 'ATL-1995', 'ATL-2007', 'BOS-1996', 'NJN-1990', 'NJN-1997', 'CLE-1983', 'CLE-1994', 'CLE-2003', 'CLE-2010', 'DAL', 'DAL-1993', 'DAL-2001', 'MIN-2008', 'ORL-2011', 'CHA-2012', 'CHA-2014', 'MIL-2015', 'MIN-2017', 'GSW-2019', 'TOR-2020', 'ORL-2025', 'MIN-2026',
]);

export const IDENTITY_EVENTS: IdentityEvent[] = [
  { season: 1983, team: 'CLE', type: 'rebrand', logo: 'CLE-1983', note: 'The Cavaliers switch to the "Cavs" wordmark logo.' },
  { season: 1990, team: 'NYN', type: 'rebrand', logo: 'NJN-1990', note: 'The Nets unveil a new red, white and blue logo.' },
  { season: 1993, team: 'DAL', type: 'rebrand', logo: 'DAL-1993', note: 'The Mavericks update their logo.' },
  { season: 1994, team: 'CLE', type: 'rebrand', logo: 'CLE-1994', note: 'The Cavaliers change colours and logo.' },
  { season: 1995, team: 'ATL', type: 'rebrand', logo: 'ATL-1995', note: 'The Hawks introduce a new logo.' },
  { season: 1996, team: 'BOS', type: 'rebrand', logo: 'BOS-1996', note: 'The Celtics refresh Lucky for the 50th anniversary.' },
  { season: 1997, team: 'NYN', type: 'rebrand', logo: 'NJN-1997', note: 'The Nets adopt a new navy and red logo.' },
  { season: 2001, team: 'DAL', type: 'rebrand', logo: 'DAL-2001', note: 'The Mavericks unveil the horse-head logo.' },
  { season: 2003, team: 'CLE', type: 'rebrand', logo: 'CLE-2003', note: 'The Cavaliers return to wine and gold.' },
  { season: 2007, team: 'ATL', type: 'rebrand', logo: 'ATL-2007', note: 'The Hawks update their logo.' },
  { season: 2010, team: 'CLE', type: 'rebrand', logo: 'CLE-2010', note: 'The Cavaliers refresh their logo.' },
  { season: 1977, team: 'NYN', type: 'relocation', city: 'New Jersey', name: 'Nets', abbr: 'NJN', logo: 'NJN', arena: 'Rutgers Athletic Center', note: 'The Nets leave Long Island for New Jersey.' },
  { season: 1977, team: 'PHI', type: 'rebrand', logo: 'PHI-1977', note: 'The 76ers unveil a new logo.' },
  { season: 1978, team: 'BUF', type: 'relocation', city: 'San Diego', name: 'Clippers', abbr: 'SDC', logo: 'SDC', colors: ['#E03A3E', '#1D428A', '#FFFFFF'], arena: 'San Diego Sports Arena', note: 'The Buffalo franchise moves west and becomes the San Diego Clippers.' },
  { season: 1978, team: 'DET', type: 'rebrand', logo: 'DET-1978', arena: 'Pontiac Silverdome', note: 'The Pistons move into the Silverdome with a new look.' },
  { season: 1978, team: 'NYN', type: 'rebrand', logo: 'NJN-1978', note: 'New Jersey adopts a new Nets logo.' },
  { season: 1979, team: 'NOJ', type: 'relocation', city: 'Utah', name: 'Jazz', abbr: 'UTA', logo: 'UTA-1979', arena: 'Salt Palace', note: 'The Jazz move from New Orleans to Salt Lake City and keep the name.' },
  { season: 1981, team: 'NYN', type: 'rebrand', arena: 'Brendan Byrne Arena', note: 'The Nets open the Meadowlands arena.' },
  { season: 1984, team: 'BUF', type: 'relocation', city: 'Los Angeles', name: 'Clippers', abbr: 'LAC', logo: 'LAC', colors: ['#C8102E', '#1D428A', '#FFFFFF'], arena: 'L.A. Memorial Sports Arena', note: 'The Clippers move from San Diego to Los Angeles.' },
  { season: 1985, team: 'KCK', type: 'relocation', city: 'Sacramento', name: 'Kings', abbr: 'SAC', logo: 'SAC', colors: ['#5A2D81', '#63727A', '#FFFFFF'], arena: 'ARCO Arena', note: 'The Kings move from Kansas City to Sacramento.' },
  { season: 1988, team: 'DET', type: 'rebrand', arena: 'The Palace of Auburn Hills', note: 'The Pistons open The Palace.' },
  { season: 1994, team: 'CHI', type: 'rebrand', arena: 'United Center', note: 'Chicago Stadium gives way to the United Center.' },
  { season: 1995, team: 'SEA', type: 'rebrand', logo: 'SEA-1995', note: 'The SuperSonics unveil a new logo.' },
  { season: 1995, team: 'BOS', type: 'rebrand', arena: 'FleetCenter', note: 'The Celtics leave Boston Garden.' },
  { season: 1997, team: 'WSB', type: 'rename', city: 'Washington', name: 'Wizards', abbr: 'WAS', logo: 'WAS', colors: ['#002B5C', '#E31837', '#C4CED4'], arena: 'MCI Center', note: 'The Bullets become the Wizards.' },
  { season: 1999, team: 'LAL', type: 'rebrand', arena: 'Staples Center', note: 'The Lakers move into Staples Center.' },
  { season: 1999, team: 'MIA', type: 'rebrand', logo: 'MIA-1999', arena: 'American Airlines Arena', note: 'The Heat refresh their logo and open a new arena.' },
  { season: 2001, team: 'VAN', type: 'relocation', city: 'Memphis', name: 'Grizzlies', abbr: 'MEM', logo: 'MEM', colors: ['#5D76A9', '#12173F', '#F5B112'], arena: 'Pyramid Arena', note: 'The Grizzlies move from Vancouver to Memphis.' },
  { season: 2001, team: 'LAL', type: 'rebrand', logo: 'LAL-2001', note: 'The Lakers update their logo.' },
  { season: 2001, team: 'ORL', type: 'rebrand', logo: 'ORL-2001', note: 'Orlando introduces a new Magic logo.' },
  { season: 2002, team: 'CHH', type: 'relocation', city: 'New Orleans', name: 'Hornets', abbr: 'NOH', logo: 'NOH', colors: ['#00788C', '#1D1160', '#FFFFFF'], arena: 'New Orleans Arena', note: 'The Hornets move from Charlotte to New Orleans.' },
  { season: 2008, team: 'SEA', type: 'relocation', city: 'Oklahoma City', name: 'Thunder', abbr: 'OKC', logo: 'OKC', colors: ['#007AC1', '#EF3B24', '#FDBB30'], arena: 'Ford Center', note: 'The SuperSonics leave Seattle and become the Oklahoma City Thunder.' },
  { season: 2008, team: 'MIN', type: 'rebrand', logo: 'MIN-2008', note: 'Minnesota updates the Timberwolves logo.' },
  { season: 2011, team: 'ORL', type: 'rebrand', logo: 'ORL-2011', note: 'Orlando updates the Magic logo.' },
  { season: 2012, team: 'NYN', type: 'relocation', city: 'Brooklyn', name: 'Nets', abbr: 'BKN', logo: 'BKN', colors: ['#000000', '#FFFFFF', '#777D84'], arena: 'Barclays Center', note: 'The Nets move to Brooklyn.' },
  { season: 2012, team: 'CHA', type: 'rebrand', logo: 'CHA-2012', note: 'The Bobcats update their logo.' },
  { season: 2013, team: 'CHH', type: 'rename', city: 'New Orleans', name: 'Pelicans', abbr: 'NOP', logo: 'NOP', colors: ['#0C2340', '#C8102E', '#85714D'], note: 'New Orleans renames its team the Pelicans.' },
  { season: 2014, team: 'CHA', type: 'rename', city: 'Charlotte', name: 'Hornets', abbr: 'CHA', logo: 'CHA-2014', colors: ['#1D1160', '#00788C', '#A1A1A4'], note: 'Charlotte reclaims the Hornets name.' },
  { season: 2015, team: 'MIL', type: 'rebrand', logo: 'MIL-2015', note: 'The Bucks unveil a new logo.' },
  { season: 2017, team: 'MIN', type: 'rebrand', logo: 'MIN-2017', note: 'The Timberwolves refresh their logo.' },
  { season: 2019, team: 'GSW', type: 'rebrand', logo: 'GSW-2019', arena: 'Chase Center', note: 'The Warriors return to San Francisco with a new logo.' },
  { season: 2020, team: 'TOR', type: 'rebrand', logo: 'TOR-2020', note: 'Toronto updates the Raptors logo.' },
  { season: 2025, team: 'ORL', type: 'rebrand', logo: 'ORL-2025', note: 'Orlando updates the Magic logo.' },
  { season: 2026, team: 'MIN', type: 'rebrand', logo: 'MIN-2026', note: 'The Timberwolves unveil a new logo.' },
  { season: 1988, team: 'MIL', type: 'rebrand', arena: 'Bradley Center', note: 'The Bucks move into the Bradley Center.' },
  { season: 1990, team: 'MIN', type: 'rebrand', arena: 'Target Center', note: 'The Timberwolves open the Target Center.' },
  { season: 1991, team: 'NOJ', type: 'rebrand', arena: 'Delta Center', note: 'The Jazz open the Delta Center.' },
  { season: 1992, team: 'PHX', type: 'rebrand', arena: 'America West Arena', note: 'The Suns move downtown to America West Arena.' },
  { season: 1994, team: 'CLE', type: 'rebrand', arena: 'Gund Arena', note: 'The Cavaliers return to downtown Cleveland.' },
  { season: 1995, team: 'POR', type: 'rebrand', arena: 'Rose Garden', note: 'The Trail Blazers open the Rose Garden.' },
  { season: 1995, team: 'SEA', type: 'rebrand', arena: 'KeyArena', note: 'The SuperSonics reopen a rebuilt KeyArena.' },
  { season: 1996, team: 'PHI', type: 'rebrand', arena: 'CoreStates Center', note: 'The 76ers move across the street to a new arena.' },
  { season: 1999, team: 'ATL', type: 'rebrand', arena: 'Philips Arena', note: 'The Hawks open Philips Arena.' },
  { season: 1999, team: 'TOR', type: 'rebrand', arena: 'Air Canada Centre', note: 'The Raptors move into the Air Canada Centre.' },
  { season: 1999, team: 'IND', type: 'rebrand', arena: 'Conseco Fieldhouse', note: 'The Pacers open Conseco Fieldhouse.' },
  { season: 1999, team: 'DEN', type: 'rebrand', arena: 'Pepsi Center', note: 'The Nuggets move into the Pepsi Center.' },
  { season: 2001, team: 'DAL', type: 'rebrand', arena: 'American Airlines Center', note: 'The Mavericks open the American Airlines Center.' },
  { season: 2002, team: 'SAS', type: 'rebrand', arena: 'SBC Center', note: 'The Spurs open their new arena.' },
  { season: 2003, team: 'HOU', type: 'rebrand', arena: 'Toyota Center', note: 'The Rockets move into the Toyota Center.' },
  { season: 2004, team: 'VAN', type: 'rebrand', arena: 'FedExForum', note: 'The Grizzlies open FedExForum.' },
  { season: 2005, team: 'CHA', type: 'rebrand', arena: 'Charlotte Bobcats Arena', note: 'Charlotte opens its new downtown arena.' },
  { season: 2010, team: 'ORL', type: 'rebrand', arena: 'Amway Center', note: 'The Magic open the Amway Center.' },
  { season: 2016, team: 'KCK', type: 'rebrand', arena: 'Golden 1 Center', note: 'The Kings open Golden 1 Center.' },
  { season: 2017, team: 'DET', type: 'rebrand', arena: 'Little Caesars Arena', note: 'The Pistons move back downtown.' },
  { season: 2018, team: 'MIL', type: 'rebrand', arena: 'Fiserv Forum', note: 'The Bucks open a new arena.' },
  { season: 2024, team: 'BUF', type: 'rebrand', arena: 'Intuit Dome', note: 'The Clippers open their own arena in Inglewood.' },
];

export const EXPANSIONS: ExpansionDef[] = [
  { season: 1980, id: 'DAL', city: 'Dallas', name: 'Mavericks', abbr: 'DAL', conf: 'West', div: 'Midwest', colors: ['#00538C', '#B8C4CA', '#FFFFFF'], logo: 'DAL', arena: 'Reunion Arena', owner: 'Don Carter', note: 'Expansion: the Dallas Mavericks join the NBA.' },
  { season: 1988, id: 'CHH', city: 'Charlotte', name: 'Hornets', abbr: 'CHH', conf: 'East', div: 'Atlantic', colors: ['#00788C', '#1D1160', '#FFFFFF'], logo: 'CHH-1988', arena: 'Charlotte Coliseum', owner: 'George Shinn', note: 'Expansion: the Charlotte Hornets join the NBA.' },
  { season: 1988, id: 'MIA', city: 'Miami', name: 'Heat', abbr: 'MIA', conf: 'West', div: 'Midwest', colors: ['#98002E', '#F9A01B', '#000000'], logo: 'MIA-1988', arena: 'Miami Arena', owner: 'Ted Arison', note: 'Expansion: the Miami Heat join the NBA.' },
  { season: 1989, id: 'MIN', city: 'Minnesota', name: 'Timberwolves', abbr: 'MIN', conf: 'West', div: 'Midwest', colors: ['#0C2340', '#236192', '#78BE20'], logo: 'MIN-1989', arena: 'Hubert H. Humphrey Metrodome', owner: 'Marv Wolfenson', note: 'Expansion: the Minnesota Timberwolves join the NBA.' },
  { season: 1989, id: 'ORL', city: 'Orlando', name: 'Magic', abbr: 'ORL', conf: 'East', div: 'Central', colors: ['#0077C0', '#000000', '#C4CED4'], logo: 'ORL-1989', arena: 'Orlando Arena', owner: 'Orlando Magic ownership group', note: 'Expansion: the Orlando Magic join the NBA.' },
  { season: 1995, id: 'TOR', city: 'Toronto', name: 'Raptors', abbr: 'TOR', conf: 'East', div: 'Central', colors: ['#CE1141', '#000000', '#A1A1A4'], logo: 'TOR-1995', arena: 'SkyDome', owner: 'John Bitove', note: 'Expansion: the NBA goes north as the Toronto Raptors join.' },
  { season: 1995, id: 'VAN', city: 'Vancouver', name: 'Grizzlies', abbr: 'VAN', conf: 'West', div: 'Midwest', colors: ['#00B2A9', '#E43C40', '#BC7844'], logo: 'VAN', arena: 'General Motors Place', owner: 'Arthur Griffiths', note: 'Expansion: the Vancouver Grizzlies join the NBA.' },
  { season: 2004, id: 'CHA', city: 'Charlotte', name: 'Bobcats', abbr: 'CHA', conf: 'East', div: 'Southeast', colors: ['#F26532', '#2A5CAA', '#A1A1A4'], logo: 'CHA-2004', arena: 'Charlotte Coliseum', owner: 'Robert L. Johnson', note: 'Expansion: basketball returns to Charlotte with the Bobcats.' },
];
/** Possible future expansion (seeded per save). The March 2026 decision only authorised exploration. */
export const FUTURE_EXPANSION: ExpansionDef[] = [
  { season: 0, id: 'SEA2', city: 'Seattle', name: 'SuperSonics', abbr: 'SEA', conf: 'West', div: 'Northwest', colors: ['#00653A', '#FFC200', '#FFFFFF'], logo: 'SEA-1995', arena: 'Climate Pledge Arena', owner: 'Seattle ownership group', note: 'Expansion (simulated future): the NBA returns to Seattle.', future: true },
  { season: 0, id: 'LVG', city: 'Las Vegas', name: 'Aces', abbr: 'LVA', conf: 'West', div: 'Pacific', colors: ['#000000', '#C8102E', '#BA9653'], logo: 'LVA', arena: 'Las Vegas arena', owner: 'Las Vegas ownership group', note: 'Expansion (simulated future): Las Vegas gets an NBA team.', future: true },
];

/** Division membership by franchise id; each entry applies from its season until the next. */
const ALIGN: { season: number; divs: Record<string, ['East' | 'West', string[]]> }[] = [
  { season: 1976, divs: { Atlantic: ['East', ['BOS', 'BUF', 'NYK', 'NYN', 'PHI']], Central: ['East', ['ATL', 'CLE', 'HOU', 'NOJ', 'SAS', 'WSB']],
    Midwest: ['West', ['CHI', 'DEN', 'DET', 'IND', 'KCK', 'MIL']], Pacific: ['West', ['GSW', 'LAL', 'PHX', 'POR', 'SEA']] } },
  { season: 1978, divs: { Atlantic: ['East', ['BOS', 'NYK', 'NYN', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CLE', 'DET', 'HOU', 'NOJ', 'SAS']],
    Midwest: ['West', ['CHI', 'DEN', 'IND', 'KCK', 'MIL']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'SEA']] } },
  { season: 1979, divs: { Atlantic: ['East', ['BOS', 'NYK', 'NYN', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CLE', 'DET', 'HOU', 'IND', 'SAS']],
    Midwest: ['West', ['CHI', 'DEN', 'KCK', 'MIL', 'NOJ']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'SEA']] } },
  { season: 1980, divs: { Atlantic: ['East', ['BOS', 'NYK', 'NYN', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CHI', 'CLE', 'DET', 'IND', 'MIL']],
    Midwest: ['West', ['DAL', 'DEN', 'HOU', 'KCK', 'SAS', 'NOJ']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'SEA']] } },
  { season: 1988, divs: { Atlantic: ['East', ['BOS', 'CHH', 'NYK', 'NYN', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CHI', 'CLE', 'DET', 'IND', 'MIL']],
    Midwest: ['West', ['DAL', 'DEN', 'HOU', 'MIA', 'SAS', 'NOJ']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'KCK', 'SEA']] } },
  { season: 1989, divs: { Atlantic: ['East', ['BOS', 'MIA', 'NYK', 'NYN', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CHI', 'CLE', 'DET', 'IND', 'MIL', 'ORL']],
    Midwest: ['West', ['CHH', 'DAL', 'DEN', 'HOU', 'MIN', 'SAS', 'NOJ']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'KCK', 'SEA']] } },
  { season: 1990, divs: { Atlantic: ['East', ['BOS', 'MIA', 'NYK', 'NYN', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CHH', 'CHI', 'CLE', 'DET', 'IND', 'MIL']],
    Midwest: ['West', ['DAL', 'DEN', 'HOU', 'MIN', 'ORL', 'SAS', 'NOJ']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'KCK', 'SEA']] } },
  { season: 1991, divs: { Atlantic: ['East', ['BOS', 'MIA', 'NYK', 'NYN', 'ORL', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CHH', 'CHI', 'CLE', 'DET', 'IND', 'MIL']],
    Midwest: ['West', ['DAL', 'DEN', 'HOU', 'MIN', 'SAS', 'NOJ']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'KCK', 'SEA']] } },
  { season: 1995, divs: { Atlantic: ['East', ['BOS', 'MIA', 'NYK', 'NYN', 'ORL', 'PHI', 'WSB']], Central: ['East', ['ATL', 'CHH', 'CHI', 'CLE', 'DET', 'IND', 'MIL', 'TOR']],
    Midwest: ['West', ['DAL', 'DEN', 'HOU', 'MIN', 'SAS', 'NOJ', 'VAN']], Pacific: ['West', ['BUF', 'GSW', 'LAL', 'PHX', 'POR', 'KCK', 'SEA']] } },
  { season: 2004, divs: { Atlantic: ['East', ['BOS', 'NYN', 'NYK', 'PHI', 'TOR']], Central: ['East', ['CHI', 'CLE', 'DET', 'IND', 'MIL']], Southeast: ['East', ['ATL', 'CHA', 'MIA', 'ORL', 'WSB']],
    Southwest: ['West', ['DAL', 'HOU', 'VAN', 'CHH', 'SAS']], Northwest: ['West', ['DEN', 'MIN', 'POR', 'SEA', 'NOJ']], Pacific: ['West', ['GSW', 'BUF', 'LAL', 'PHX', 'KCK']] } },
];
/** 32-team alignment used if the seeded future expansion happens (Memphis moves East). */
const ALIGN32: Record<string, ['East' | 'West', string[]]> = {
  Atlantic: ['East', ['BOS', 'NYN', 'NYK', 'PHI', 'TOR']], Central: ['East', ['CHI', 'CLE', 'DET', 'IND', 'MIL']], Southeast: ['East', ['ATL', 'CHA', 'MIA', 'ORL', 'WSB', 'VAN']],
  Southwest: ['West', ['DAL', 'HOU', 'CHH', 'SAS']], Northwest: ['West', ['DEN', 'MIN', 'POR', 'SEA', 'NOJ', 'SEA2']], Pacific: ['West', ['GSW', 'BUF', 'LAL', 'PHX', 'KCK', 'LVG']],
};

/** Seeded future: does expansion happen, and when? Which style scenario does the league drift toward after 2026? */
export function futureOf(seed: string) {
  const r = stream(seed, 'future');
  const expands = r.chance(0.72);
  const year = 2028 + r.int(0, 3);
  const scenarios = ['Total Basketball', 'Defensive Renaissance', 'Return of the Giant', 'Hyper-Spacing'] as const;
  const scenario = scenarios[r.weighted([0.34, 0.24, 0.2, 0.22])];
  return { expansionYear: expands ? year : null, scenario };
}

export function expansionsFor(seed: string, season: number): ExpansionDef[] {
  const f = futureOf(seed);
  const out = EXPANSIONS.filter(e => e.season === season);
  if (f.expansionYear === season) out.push(...FUTURE_EXPANSION.map(e => ({ ...e, season })));
  return out;
}

export function alignmentFor(seed: string, season: number, ids: string[]): Record<string, { conf: 'East' | 'West'; div: string }> {
  const f = futureOf(seed);
  let divs = ALIGN.filter(a => a.season <= season).slice(-1)[0].divs;
  if (f.expansionYear && season >= f.expansionYear) divs = ALIGN32;
  const out: Record<string, { conf: 'East' | 'West'; div: string }> = {};
  for (const [div, [conf, teams]] of Object.entries(divs)) for (const t of teams) if (ids.includes(t)) out[t] = { conf, div };
  return out;
}

// ------------------------------------------------------------------ era rules
export interface EraRules {
  games: number; start: string; three: boolean; threeShort: boolean; playoffTeams: number; byes: boolean; r1BestOf: number;
  playIn: boolean; finals232: boolean; draftRounds: number; lottery: 'coinflip' | 'equal-all' | 'equal-top3' | 'weighted-1990' | 'weighted-1994' | 'flat-2019' | '321-2027';
  divWinnerSeeds: number; rosterMax: number; label: string;
}
export function eraRules(season: number): EraRules {
  const draftYear = season + 1;
  const games = season === 1998 ? 50 : season === 2011 ? 66 : season === 2019 ? 72 : season === 2020 ? 72 : 82;
  const start = season === 1998 ? '1999-02-05' : season === 2011 ? '2011-12-25' : season === 2020 ? '2020-12-22' : `${season}-10-${season >= 2000 ? 27 : 21}`;
  const playoffTeams = season < 1983 ? 12 : 16;
  return {
    games, start, three: season >= 1979, threeShort: season >= 1994 && season <= 1996,
    playoffTeams, byes: playoffTeams === 12, r1BestOf: season < 1983 ? 3 : season < 2002 ? 5 : 7,
    playIn: season >= 2019 && season !== 2019, finals232: season >= 1984 && season <= 2013,
    draftRounds: draftYear === 1977 ? 8 : draftYear <= 1984 ? 10 : draftYear <= 1987 ? 7 : draftYear === 1988 ? 3 : 2,
    lottery: draftYear < 1985 ? 'coinflip' : draftYear <= 1986 ? 'equal-all' : draftYear <= 1989 ? 'equal-top3' : draftYear <= 1993 ? 'weighted-1990' : draftYear <= 2018 ? 'weighted-1994' : draftYear <= 2026 ? 'flat-2019' : '321-2027',
    divWinnerSeeds: season < 2004 ? 2 : season < 2006 ? 3 : season < 2015 ? 4 : 0,
    rosterMax: 12,
    label: `${season}–${String(season + 1).slice(2)}`,
  };
}

/** League-wide style targets per team-game (reported through 2025-26, seeded scenario after). */
const STYLE: [number, number, number][] = [ // season, pace, 3PA
  [1976, 106.5, 0], [1979, 103.1, 2.8], [1984, 102.1, 3.1], [1987, 100.8, 5.6], [1990, 97.8, 7.1], [1994, 92.3, 15.0], [1997, 90.3, 12.7], [2000, 91.3, 13.7],
  [2003, 90.1, 14.9], [2007, 91.9, 18.1], [2010, 92.1, 18.0], [2013, 93.9, 21.5], [2015, 95.8, 24.1], [2017, 97.3, 29.0], [2019, 100.3, 34.1], [2023, 98.5, 35.1], [2025, 99.4, 37.0],
];
const SCEN_2040: Record<string, [number, number]> = { 'Total Basketball': [100.5, 38], 'Defensive Renaissance': [99, 36.5], 'Return of the Giant': [98, 33.5], 'Hyper-Spacing': [102, 46] };
export function eraStyle(season: number, seed?: string): { pace: number; tpa: number; scenario?: string } {
  if (season > 2025 && seed) {
    const f = futureOf(seed);
    const [p40, t40] = SCEN_2040[f.scenario];
    const k = Math.min(1, (season - 2025) / 15);
    return { pace: 99.4 + (p40 - 99.4) * k, tpa: 37 + (t40 - 37) * k, scenario: f.scenario };
  }
  let a = STYLE[0], b = STYLE[STYLE.length - 1];
  for (let i = 0; i < STYLE.length - 1; i++) if (season >= STYLE[i][0] && season <= STYLE[i + 1][0]) { a = STYLE[i]; b = STYLE[i + 1]; break; }
  if (season >= STYLE[STYLE.length - 1][0]) a = b = STYLE[STYLE.length - 1];
  const k = b[0] === a[0] ? 0 : (season - a[0]) / (b[0] - a[0]);
  return { pace: a[1] + (b[1] - a[1]) * k, tpa: season < 1979 ? 0 : a[2] + (b[2] - a[2]) * k };
}

/** Average player salary relative to 1976-77 (approximate public averages; future grows ~4%/yr). */
const SAL: [number, number][] = [[1976, 1], [1980, 1.3], [1984, 2.2], [1988, 3.7], [1990, 5.5], [1993, 9], [1996, 14], [1999, 20], [2002, 28], [2005, 32], [2008, 37],
  [2011, 38], [2014, 36], [2016, 50], [2018, 55], [2020, 60], [2022, 68], [2024, 78], [2026, 86]];
export function salaryScale(season: number): number {
  if (season >= 2026) return 86 * Math.pow(1.04, season - 2026);
  for (let i = 0; i < SAL.length - 1; i++) if (season >= SAL[i][0] && season <= SAL[i + 1][0]) {
    const k = (season - SAL[i][0]) / (SAL[i + 1][0] - SAL[i][0]);
    return SAL[i][1] * Math.pow(SAL[i + 1][1] / SAL[i][1], k);
  }
  return 1;
}
/** Module-level era cursor so pure valuation helpers can scale money without threading the world through. */
export const ERA = { year: 1976, scale: 1 };
export function setEraYear(year: number) { ERA.year = year; ERA.scale = salaryScale(year); }
/** Scale a 1976-dollar amount to the current season, rounded to a sensible step. */
export function $y(n: number, year = ERA.year): number {
  const v = n * (year === ERA.year ? ERA.scale : salaryScale(year));
  const step = v >= 5e6 ? 50000 : v >= 1e6 ? 25000 : 5000;
  return Math.round(v / step) * step;
}
