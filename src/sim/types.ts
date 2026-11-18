// Core world types. One serializable World object is the save state.

export type Pos = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type Evidence = 'verified' | 'reported' | 'unverified' | 'reconstructed' | 'inferred' | 'projected' | 'simulated';

export interface Ratings {
  ins: number; post: number; mid: number; ft: number; three: number; pass: number; handle: number; drive: number;
  oreb: number; dreb: number; blk: number; stl: number; perD: number; intD: number; foulDraw: number; foulAvoid: number;
  usage: number; stamina: number; ath: number; iq: number; hgt: number;
}
export type SkillKey = Exclude<keyof Ratings, 'hgt'>;

export interface Contract { salary: number; years: number; known: number | null; provenance: string; signed?: string; rookie?: boolean; }

export interface Injury { type: string; daysLeft: number; severity: 'minor' | 'moderate' | 'serious'; since: string; }

export interface SeasonLine {
  season: number; team: string; g: number; gs: number; min: number; pts: number; fgm: number; fga: number; tpm: number; tpa: number;
  ftm: number; fta: number; oreb: number; dreb: number; ast: number; stl: number; blk: number; tov: number; pf: number; playoffs?: boolean;
}

export interface Player {
  id: string; nbaId: number | null; name: string; pos: Pos; age: number | null; born: string | null; hgt: number; wgt: number | null;
  college: string | null; team: string | null; rosterStatus: string; source: string; evidence: Evidence;
  r: Ratings; ceil: Record<string, { mu: number; sd: number }>; ovr: number;
  traits: Record<string, number>; traitsNote: string; draft: any; kind: string; sampleMin: number; headshot: boolean;
  contract: Contract | null; ask?: number; draftClass?: number;
  // dynamic
  injury?: Injury | null; fatigueSeason?: number; cond?: number; morale?: number; retired?: boolean; draftedBy?: string; draftPick?: number;
  stats?: SeasonLine[]; awards?: { season: number; award: string }[];
  scout?: Record<string, { lo: number; hi: number; mid: number; reports: number }>; // user-team belief (prospects)
  promise?: { kind: string; due: string; made: string } | null;
}

export interface Coach {
  id: string; name: string; team: string | null; role: string;
  pace: number; post: number; motion: number; iso: number; pnr: number; pressure: number; depth: number; devFocus: number; experiment: number;
  tactics: number; development: number; communication: number; adaptability: number; stubborn: number; ego: number; note: string; evidence: string;
  trustGM?: number; // 0-100 coach -> user GM trust
}

export interface Team {
  id: string; nbaTeamId: number; city: string; name: string; abbr: string; conf: 'East' | 'West'; div: string; colors: string[]; logo: string;
  coach: string; gm: string; owner: string; roster: string[]; evidence: string;
  w: number; l: number; homeW: number; homeL: number; streak: number; ptsFor: number; ptsAgainst: number;
  clock?: ClockState; payrollBudget?: number;
  logoKey?: string; arena?: string; founded?: number;
  depth?: Record<string, string[]>; // coach's depth chart by position (PG..C), most trusted first
  picks: DraftPick[];
  history: { season: number; w: number; l: number; result: string; abbr?: string; name?: string }[];
  minutesRequests?: Record<string, { kind: string; status: string }>;
}

export type ClockState = 'Rebuilding' | 'Building' | 'Contending' | 'Win Now';

export interface DraftPick { season: number; round: number; original: string; owner: string; }

export interface GameRec {
  id: string; date: string; home: string; away: string; hs?: number; as?: number; ot?: number; playoff?: { round: number; series: string; game: number };
  played?: boolean; box?: BoxScore; log?: GameEvent[];
}

export interface BoxLine { pid: string; name: string; min: number; pts: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  oreb: number; dreb: number; ast: number; stl: number; blk: number; tov: number; pf: number; pm: number; gs: boolean; }
export interface BoxScore { home: BoxLine[]; away: BoxLine[]; quarters: [number[], number[]]; possessions: number; actions: Record<string, number>; }

export interface GameEvent {
  q: number; clock: number; type: string; team: number; text: string; score: [number, number]; pid?: string;
}

export interface Message {
  id: string; date: string; from: string; role: 'Owner' | 'Coach' | 'Agent' | 'Scout' | 'Medical' | 'League' | 'GM' | 'Media' | 'Player';
  subject: string; body: string; read: boolean; urgent: number; // 0..3
  actions?: { label: string; cmd: string; arg?: any }[]; resolved?: boolean; deadline?: string; tag?: string;
}

export interface NewsItem { id: string; date: string; head: string; body: string; kind: string; }

export interface Season {
  year: number; phase: Phase; day: string; games: GameRec[]; playoffs: PlayoffState | null;
  awards?: Record<string, any>; champion?: string; draftOrder?: string[]; draft?: DraftState | null;
}
export type Phase = 'preseason' | 'regular' | 'playoffs' | 'draft' | 'freeagency' | 'offseason';

export interface Series { id: string; round: number; conf: string; hi: string; lo: string; wHi: number; wLo: number; bestOf: number; winner?: string; games: string[]; slot?: number; }
export interface PlayoffState { round: number; series: Series[]; seeds?: Record<string, string[]>; format?: { teams: number; byes: boolean; playIn: boolean; bestOf: number[] }; }

export interface DraftState { year: number; order: { pick: number; round: number; team: string; player?: string; jump?: number }[]; idx: number; pool: string[]; board: string[]; lottery?: { kind: string; text: string; results: { team: string; pick: number; pre: number; odds?: number }[] }; done?: boolean; }

export interface Owner { name: string; patience: number; wantsWins: number; budget: number; satisfaction: number; expectedWins: number; objective: string; }

export interface WorldEvent { seq: number; date: string; type: string; text: string; ids?: string[]; cause?: number[]; }

export interface World {
  meta: { saveId: string; title: string; seed: string; created: string; modelVersion: string; dataVersion: string; schema: number; mode: 'career' | 'sandbox'; gmName: string; userTeam: string; abaSurvivors: string[]; fired?: boolean; };
  rules: Record<string, any>;
  anchors: any;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  coaches: Record<string, Coach>;
  freeAgents: string[];
  draftClasses: Record<string, string[]>;
  schedules: Record<string, [string, string, string][]>;
  franchiseEvents: any[];
  season: Season;
  pastSeasons: { year: number; champion: string; runnerUp?: string; awards: Record<string, any>; standings: { team: string; w: number; l: number }[]; names?: Record<string, { abbr: string; city: string; name: string; logo: string }> }[];
  messages: Message[];
  news: NewsItem[];
  events: WorldEvent[];
  owner: Owner;
  clock: ClockState;
  gmRep: number;
  scoutBudget: number; // 1..3
  log: { seq: number };
  tradeHistory: { date: string; text: string }[];
  promises: { id: string; to: string; kind: string; made: string; due: string; status: string }[];
}
