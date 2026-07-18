import { COMMODITIES, INFORMANT_COST, SEATS } from "./data";
import { canDeliver, completedCount } from "./engine";
import type {
  Bid,
  Commodity,
  DeliveryChoice,
  GameState,
  Goods,
  InformantQuery,
  MarketOrder,
  Player,
  Seat,
} from "./types";

// AI가 활성 계약을 완료하기 위해 아직 모자란 상품 수량
function missingGoods(p: Player): Goods {
  const missing: Goods = { SPICE: 0, IRON: 0, SILK: 0, RELIC: 0 };
  const have = { ...p.goods };
  for (const c of p.contracts.filter((c) => c.status === "active")) {
    for (const g of COMMODITIES) {
      const need = c.def.needs[g] ?? 0;
      const used = Math.min(have[g], need);
      have[g] -= used;
      missing[g] += need - used;
    }
  }
  return missing;
}

export function aiChooseContracts(p: Player): number[] {
  // 보상 높은 2장을 활성으로
  const sorted = [...p.contracts].sort((a, b) => b.def.legalReward - a.def.legalReward);
  return sorted.slice(0, 2).map((c) => c.uid);
}

export function aiInformant(state: GameState, seat: Seat, rng: () => number): InformantQuery | null {
  const p = state.players[seat];
  if (p.informantUsed || p.gold < INFORMANT_COST + 6) return null;
  if (state.round < 2 || rng() > 0.25) return null;
  const targets = SEATS.filter(
    (s) => s !== seat && state.players[s].contracts.some((c) => c.status === "active")
  );
  if (targets.length === 0) return null;
  // 골드가 가장 많은 상대를 조사
  const target = targets.sort((a, b) => state.players[b].gold - state.players[a].gold)[0];
  const commodity = COMMODITIES[Math.floor(rng() * 4)];
  return { target, commodity };
}

export function aiBid(state: GameState, seat: Seat, rng: () => number): Bid {
  const p = state.players[seat];
  const missing = missingGoods(p);
  const value = (idx: 0 | 1): number => {
    const cargo = state.cargos[idx];
    let v = 0;
    for (const g of COMMODITIES) {
      const n = cargo.items[g] ?? 0;
      if (n === 0) continue;
      // 계약에 필요한 상품이면 시장가 + 프리미엄, 아니면 시장가보다 약간 낮게
      v += n * (missing[g] > 0 ? state.prices[g] + 3 : state.prices[g] - 1);
    }
    return v;
  };
  const budget = Math.max(0, p.gold - 6); // 시장 거래 자금은 남긴다
  const vA = value(0);
  const vB = value(1);
  const jitter = () => Math.floor(rng() * 3) - 1;
  const mk = (v: number, minBid: number): number | null => {
    const bid = Math.min(v + jitter(), budget);
    return bid >= minBid ? bid : null;
  };
  let a = mk(vA, state.cargos[0].minBid);
  let b = mk(vB, state.cargos[1].minBid);
  // 두 입찰 합이 골드를 넘으면 가치 낮은 쪽 포기
  if (a !== null && b !== null && a + b > p.gold) {
    if (vA >= vB) b = null;
    else a = null;
  }
  return { a, b, pref: vA >= vB ? "A" : "B" };
}

export function aiMarket(state: GameState, seat: Seat): MarketOrder[] {
  const p = state.players[seat];
  const orders: MarketOrder[] = [];
  let goldLeft = p.gold;

  // 의심도가 높고 세관 경계가 임박하면 뇌물
  const bribeCost = state.news.id === "corrupt" ? 2 : 3;
  if (p.suspicion >= 4 && state.alert >= 2 && goldLeft >= bribeCost + 5) {
    orders.push({ type: "BRIBE" });
    goldLeft -= bribeCost;
  }

  const missing = missingGoods(p);
  // 계약에 필요한 상품 구매 (싼 것부터)
  const toBuy = COMMODITIES.filter((g) => missing[g] > 0 && state.importCap[g] > 0).sort(
    (x, y) => state.prices[x] - state.prices[y]
  );
  for (const g of toBuy) {
    if (orders.length >= 2) break;
    const qty = Math.min(3, missing[g], Math.floor(goldLeft / state.prices[g]));
    if (qty >= 1) {
      orders.push({ type: "BUY", commodity: g, qty });
      goldLeft -= qty * state.prices[g];
    }
  }

  // 계약에 안 쓰는 잉여 상품은 가격이 잔존 가치보다 높으면 판매
  if (orders.length < 2) {
    const surplus = COMMODITIES.filter(
      (g) =>
        p.goods[g] - missing[g] > 0 &&
        p.goods[g] > 0 &&
        missing[g] === 0 &&
        state.exportCap[g] > 0 &&
        !orders.some((o) => (o.type === "BUY" || o.type === "SELL") && o.commodity === g)
    ).sort((x, y) => state.prices[y] - state.prices[x]);
    for (const g of surplus) {
      if (orders.length >= 2) break;
      const qty = Math.min(3, p.goods[g]);
      orders.push({ type: "SELL", commodity: g, qty });
    }
  }
  while (orders.length < 2) orders.push({ type: "HOLD" });
  return orders;
}

export function aiDelivery(state: GameState, seat: Seat): DeliveryChoice | null {
  const p = state.players[seat];
  if (completedCount(p) >= 3) return null;
  const deliverable = p.contracts.filter((c) => c.status === "active" && canDeliver(state, p, c.uid));
  if (deliverable.length === 0) return null;
  const best = deliverable.sort((a, b) => b.def.legalReward - a.def.legalReward)[0];
  // 밀수 판단: 내 의심도가 낮고, 밀수해도 최고 의심자가 되지 않으면 밀수
  const afterSusp = p.suspicion + 2;
  const maxOther = Math.max(
    ...SEATS.filter((s) => s !== seat).map((s) => state.players[s].suspicion)
  );
  const willAlert = state.alert + (state.news.id === "crackdown" ? 2 : 1) >= 4;
  const smuggle = state.news.id !== "crackdown" && (afterSusp < maxOther || (!willAlert && p.suspicion === 0));
  return { contractUid: best.uid, method: smuggle ? "smuggle" : "legal" };
}
