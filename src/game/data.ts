import type { CargoDef, Commodity, ContractDef, Goods, NewsDef, Seat } from "./types";

export const COMMODITIES: Commodity[] = ["SPICE", "IRON", "SILK", "RELIC"];
export const SEATS: Seat[] = ["A", "B", "C", "D"];

export const COMMODITY_KO: Record<Commodity, string> = {
  SPICE: "향신료",
  IRON: "철광석",
  SILK: "비단",
  RELIC: "유물",
};

export const BASE_PRICE: Goods = { SPICE: 5, IRON: 4, SILK: 6, RELIC: 8 };
export const RESIDUAL_VALUE: Goods = { SPICE: 2, IRON: 2, SILK: 3, RELIC: 4 };
export const BASE_IMPORT: Goods = { SPICE: 5, IRON: 6, SILK: 4, RELIC: 0 };
export const BASE_EXPORT: Goods = { SPICE: 4, IRON: 5, SILK: 4, RELIC: 2 };

export const RULE_VERSION = "2.3-playtest";
export const TOTAL_ROUNDS = 8;
export const START_GOLD = 24;
export const ALERT_LIMIT = 4;
export const INFORMANT_COST = 2;
export const MAX_CONTRACTS_DONE = 3;

export const zeroGoods = (): Goods => ({ SPICE: 0, IRON: 0, SILK: 0, RELIC: 0 });

// 라운드별 회전 우선순위 (3.1, 규칙 2.3)
// 1라운드 시작 좌석은 게임 시드로 무작위 결정해 공개하고, 이후 라운드마다 한 칸씩 회전한다.
// 고정 스케줄은 어떤 배치든 특정 좌석이 구조적으로 유리해져(시뮬레이션 확인) 시드 오프셋으로 기대값을 균등화한다.
export function rotationOrder(round: number, offset = 0): Seat[] {
  const start = (offset + round - 1) % 4;
  return [0, 1, 2, 3].map((i) => SEATS[(start + i) % 4]);
}

const CARGO_TYPES: Omit<CargoDef, "id">[] = [
  { name: "향신료 상자", items: { SPICE: 2, IRON: 1 }, baseValue: 14, minBid: 7 },
  { name: "제련 보급품", items: { IRON: 2, SPICE: 1 }, baseValue: 13, minBid: 6 },
  { name: "비단 꾸러미", items: { SILK: 2 }, baseValue: 12, minBid: 6 },
  { name: "동방 혼합 화물", items: { SPICE: 1, SILK: 1 }, baseValue: 11, minBid: 5 },
  { name: "고대 탐사품", items: { RELIC: 1, SPICE: 1 }, baseValue: 13, minBid: 6 },
  { name: "난파선 인양품", items: { RELIC: 1, IRON: 1 }, baseValue: 12, minBid: 6 },
  { name: "대상단 종합 화물", items: { SPICE: 1, IRON: 1, SILK: 1 }, baseValue: 15, minBid: 7 },
  { name: "귀족 수집품", items: { RELIC: 1, SILK: 1 }, baseValue: 14, minBid: 7 },
];

export function buildCargoDeck(): CargoDef[] {
  return CARGO_TYPES.flatMap((c, i) => [
    { ...c, id: `cargo-${i}-1` },
    { ...c, id: `cargo-${i}-2` },
  ]);
}

export const NEWS_CARDS: NewsDef[] = [
  { id: "storm", name: "폭풍 경보", desc: "모든 상품의 이번 라운드 수입 공급량 -1" },
  { id: "banquet", name: "황실 연회", desc: "비단의 이번 라운드 수출 수요량 +2" },
  { id: "mine", name: "광산 붕괴", desc: "철광석의 이번 라운드 수입 공급량 -2" },
  { id: "crackdown", name: "밀수 단속", desc: "이번 라운드 밀수 배송은 세관 경계 +2" },
  { id: "corrupt", name: "부패한 세관", desc: "이번 라운드 뇌물 비용 3 → 2골드" },
  { id: "eastship", name: "동방 무역선", desc: "향신료·비단의 이번 라운드 수입 공급량 각각 +2" },
  { id: "edict", name: "유물 수집령", desc: "유물의 이번 라운드 수출 수요량 +2" },
  { id: "festival", name: "항구 축제", desc: "모든 상품의 이번 라운드 수출 수요량 +1" },
];

const CONTRACT_TYPES: Omit<ContractDef, "id">[] = [
  { name: "향신료 보급", needs: { SPICE: 2, IRON: 1 }, legalReward: 18, smuggleReward: 22 },
  { name: "무기 제작", needs: { IRON: 2, SPICE: 1 }, legalReward: 17, smuggleReward: 21 },
  { name: "귀족 의복", needs: { SILK: 2, SPICE: 1 }, legalReward: 21, smuggleReward: 25 },
  { name: "고대 의식", needs: { RELIC: 1, SPICE: 1 }, legalReward: 17, smuggleReward: 21 },
  { name: "왕실 수집", needs: { RELIC: 1, SILK: 1 }, legalReward: 18, smuggleReward: 22 },
  { name: "대상단 주문", needs: { SPICE: 1, IRON: 1, SILK: 1 }, legalReward: 19, smuggleReward: 23 },
];

export function buildContractDeck(): ContractDef[] {
  return CONTRACT_TYPES.flatMap((c, i) => [
    { ...c, id: `con-${i}-1` },
    { ...c, id: `con-${i}-2` },
  ]);
}

export function goodsLabel(items: Partial<Goods>): string {
  return COMMODITIES.filter((c) => (items[c] ?? 0) > 0)
    .map((c) => `${COMMODITY_KO[c]} ${items[c]}`)
    .join(" + ");
}

// 시드 고정 난수 (mulberry32)
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
