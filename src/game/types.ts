export type Commodity = "SPICE" | "IRON" | "SILK" | "RELIC";
export type Seat = "A" | "B" | "C" | "D";

export type Goods = Record<Commodity, number>;

export interface CargoDef {
  id: string;
  name: string;
  items: Partial<Goods>;
  baseValue: number;
  minBid: number;
}

export interface NewsDef {
  id: string;
  name: string;
  desc: string;
}

export interface ContractDef {
  id: string;
  name: string;
  needs: Partial<Goods>;
  legalReward: number;
  smuggleReward: number;
}

export type ContractStatus = "active" | "reserve" | "done";

export interface ContractInstance {
  uid: number;
  def: ContractDef;
  status: ContractStatus;
  deliveredVia?: "legal" | "smuggle";
  deliveredRound?: number;
}

export interface Player {
  seat: Seat;
  name: string;
  isHuman: boolean;
  gold: number;
  goods: Goods;
  contracts: ContractInstance[];
  informantUsed: boolean;
  suspicion: number;
  penalty: number;
}

export interface Bid {
  a: number | null; // 화물 A 입찰액 (null = 입찰 안 함)
  b: number | null;
  pref: "A" | "B";
}

export type MarketOrder =
  | { type: "BUY" | "SELL"; commodity: Commodity; qty: number }
  | { type: "BRIBE" }
  | { type: "HOLD" };

export interface InformantQuery {
  target: Seat;
  commodity: Commodity;
}

export interface DeliveryChoice {
  contractUid: number;
  method: "legal" | "smuggle";
}

export interface AuctionResult {
  bids: Record<Seat, Bid>;
  winners: { cargo: "A" | "B"; seat: Seat | null; price: number }[];
  unsold: CargoDef[];
}

export interface FillResult {
  seat: Seat;
  side: "BUY" | "SELL";
  commodity: Commodity;
  requested: number;
  filled: number;
}

export interface CustomsEvent {
  kind: "normal" | "final";
  target: Seat | null;
  suspicionAtCheck: number;
  penalty: number;
}

export interface GameState {
  round: number; // 1..8
  players: Record<Seat, Player>;
  prices: Goods;
  importCap: Goods;
  exportCap: Goods;
  alert: number; // 공용 세관 경계
  news: NewsDef;
  cargos: [CargoDef, CargoDef];
  carryover: Goods; // 유찰 화물 → 다음 라운드 수입 공급
  priorityOffset: number; // 1라운드 시작 좌석 (시드로 결정, 공개)
  cargoDeck: CargoDef[];
  newsDeck: NewsDef[];
  log: string[];
  informantAnswers: { round: number; target: Seat; commodity: Commodity; answer: boolean }[]; // 인간 플레이어 전용
}
