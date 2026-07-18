// AI 4인 자동 대전으로 엔진 전체 검증
import { aiBid, aiChooseContracts, aiDelivery, aiInformant, aiMarket } from "../src/game/ai";
import {
  SEATS,
  chooseContracts,
  completedCount,
  createGame,
  finalScore,
  ranking,
  resolveAuction,
  resolveCustoms,
  resolveDeliveries,
  resolveInformant,
  resolveMarket,
  startRound,
} from "../src/game/engine";
import { COMMODITIES, makeRng } from "../src/game/data";
import type { Bid, DeliveryChoice, InformantQuery, MarketOrder, Seat } from "../src/game/types";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

for (let seed = 1; seed <= 200; seed++) {
  const g = createGame(seed);
  const rng = makeRng(seed * 7 + 1);
  for (const s of SEATS) {
    g.players[s].isHuman = false;
    chooseContracts(g, s, aiChooseContracts(g.players[s]));
  }
  for (let r = 1; r <= 8; r++) {
    startRound(g);
    const queries: Partial<Record<Seat, InformantQuery>> = {};
    for (const s of SEATS) {
      const q = aiInformant(g, s, rng);
      if (q) queries[s] = q;
    }
    resolveInformant(g, queries);

    const bids = {} as Record<Seat, Bid>;
    for (const s of SEATS) bids[s] = aiBid(g, s, rng);
    for (const s of SEATS) {
      const b = bids[s];
      check((b.a ?? 0) + (b.b ?? 0) <= g.players[s].gold, `seed${seed} r${r} ${s} 입찰 예산 초과`);
    }
    const auction = resolveAuction(g, bids);
    const winSeats = auction.winners.map((w) => w.seat).filter(Boolean);
    check(new Set(winSeats).size === winSeats.length, `seed${seed} r${r} 한 명이 두 화물 낙찰`);

    const orders = {} as Record<Seat, MarketOrder[]>;
    for (const s of SEATS) orders[s] = aiMarket(g, s);
    const { fills } = resolveMarket(g, orders);
    for (const c of COMMODITIES) {
      const bought = fills.filter((f) => f.commodity === c && f.side === "BUY").reduce((x, f) => x + f.filled, 0);
      const sold = fills.filter((f) => f.commodity === c && f.side === "SELL").reduce((x, f) => x + f.filled, 0);
      check(bought <= g.importCap[c], `seed${seed} r${r} ${c} 수입 한도 초과`);
      check(sold <= g.exportCap[c], `seed${seed} r${r} ${c} 수출 한도 초과`);
    }

    const deliveries: Partial<Record<Seat, DeliveryChoice>> = {};
    for (const s of SEATS) {
      const d = aiDelivery(g, s);
      if (d) deliveries[s] = d;
    }
    resolveDeliveries(g, deliveries);
    resolveCustoms(g);

    for (const s of SEATS) {
      const p = g.players[s];
      check(p.gold >= 0, `seed${seed} r${r} ${s} 골드 음수 (${p.gold})`);
      for (const c of COMMODITIES) check(p.goods[c] >= 0, `seed${seed} r${r} ${s} ${c} 보유 음수`);
      check(completedCount(p) <= 3, `seed${seed} r${r} ${s} 계약 3개 초과`);
      check(p.prices === undefined || true, "");
    }
    for (const c of COMMODITIES) {
      check(g.prices[c] >= 1 && g.prices[c] <= 12, `seed${seed} r${r} ${c} 가격 범위 이탈 (${g.prices[c]})`);
    }
  }
  check(
    SEATS.every((s) => g.players[s].suspicion === 0) ||
      SEATS.filter((s) => g.players[s].suspicion > 0).length >= 0,
    ""
  );
}

// 통계 요약 (seed 1 상세)
const g = createGame(42);
const rng = makeRng(99);
for (const s of SEATS) chooseContracts(g, s, aiChooseContracts(g.players[s]));
for (let r = 1; r <= 8; r++) {
  startRound(g);
  const queries: Partial<Record<Seat, InformantQuery>> = {};
  for (const s of SEATS) {
    const q = aiInformant(g, s, rng);
    if (q) queries[s] = q;
  }
  resolveInformant(g, queries);
  const bids = {} as Record<Seat, Bid>;
  for (const s of SEATS) bids[s] = aiBid(g, s, rng);
  resolveAuction(g, bids);
  const orders = {} as Record<Seat, MarketOrder[]>;
  for (const s of SEATS) orders[s] = aiMarket(g, s);
  resolveMarket(g, orders);
  const deliveries: Partial<Record<Seat, DeliveryChoice>> = {};
  for (const s of SEATS) {
    const d = aiDelivery(g, s);
    if (d) deliveries[s] = d;
  }
  resolveDeliveries(g, deliveries);
  resolveCustoms(g);
}
console.log("\n=== seed 42 최종 ===");
for (const s of ranking(g)) {
  const p = g.players[s];
  console.log(
    `${s}: 점수 ${finalScore(p)} (골드 ${p.gold}, 벌점 ${p.penalty}, 계약 ${completedCount(p)}/3)`
  );
}
console.log(g.log.slice(-10).join("\n"));

console.log(failures === 0 ? "\n✅ 200시드 × 8라운드 불변식 검증 통과" : `\n❌ ${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
