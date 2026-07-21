// 밸런스 계측: AI 4인 자동 대전을 다수 시드로 돌려 §16.2 목표 범위와 비교
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
import { residualValueAtPrice } from "../src/game/scoring";
import type { Bid, DeliveryChoice, Goods, InformantQuery, MarketOrder, Seat } from "../src/game/types";

const N_GAMES = 500;

interface Metrics {
  contractsPerPlayer: number[];
  smuggles: number;
  legals: number;
  investigations: number[];
  informantUses: number[];
  biddersPerRound: number[];
  holdOnlyPlans: number;
  totalPlans: number;
  unfilledOrders: number;
  totalOrders: number;
  boundStreakViolations: number;
  leaderR4Wins: number;
  seatWins: Record<Seat, number>;
  scores: number[];
  scoreSpreads: number[];
  winnerContracts: number[];
  auctionsSold: number;
  auctionsTotal: number;
}

function midScore(p: { gold: number; goods: Goods; penalty: number }, prices: Goods): number {
  return (
    p.gold + COMMODITIES.reduce((s, c) => s + p.goods[c] * residualValueAtPrice(prices[c]), 0) - p.penalty
  );
}

function runConfig(label: string, startGold: number, bonus: Partial<Record<Seat, number>> = {}) {
  const m: Metrics = {
    contractsPerPlayer: [],
    smuggles: 0,
    legals: 0,
    investigations: [],
    informantUses: [],
    biddersPerRound: [],
    holdOnlyPlans: 0,
    totalPlans: 0,
    unfilledOrders: 0,
    totalOrders: 0,
    boundStreakViolations: 0,
    leaderR4Wins: 0,
    seatWins: { A: 0, B: 0, C: 0, D: 0 },
    scores: [],
    scoreSpreads: [],
    winnerContracts: [],
    auctionsSold: 0,
    auctionsTotal: 0,
  };

  for (let seed = 1; seed <= N_GAMES; seed++) {
    const g = createGame(seed, {}, { startGold, startGoldBonus: bonus });
    const rng = makeRng(seed * 7 + 1);
    for (const s of SEATS) chooseContracts(g, s, aiChooseContracts(g.players[s]));

    let invCount = 0;
    let leaderR4: Seat | null = null;
    const boundStreak: Record<string, number> = { SPICE: 0, IRON: 0, SILK: 0, RELIC: 0 };

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
      m.biddersPerRound.push(SEATS.filter((s) => bids[s].a !== null || bids[s].b !== null).length);
      const auction = resolveAuction(g, bids);
      m.auctionsTotal += 2;
      m.auctionsSold += auction.winners.filter((w) => w.seat).length;

      const orders = {} as Record<Seat, MarketOrder[]>;
      for (const s of SEATS) {
        orders[s] = aiMarket(g, s);
        m.totalPlans++;
        if (orders[s].every((o) => o.type === "HOLD")) m.holdOnlyPlans++;
      }
      const { fills } = resolveMarket(g, orders);
      for (const f of fills) {
        m.totalOrders++;
        if (f.filled < f.requested) m.unfilledOrders++;
      }

      const deliveries: Partial<Record<Seat, DeliveryChoice>> = {};
      for (const s of SEATS) {
        const d = aiDelivery(g, s);
        if (d) deliveries[s] = d;
      }
      resolveDeliveries(g, deliveries);
      invCount += resolveCustoms(g).length;

      for (const c of COMMODITIES) {
        if (g.prices[c] <= 1 || g.prices[c] >= 12) {
          boundStreak[c]++;
          if (boundStreak[c] > 2) m.boundStreakViolations++;
        } else boundStreak[c] = 0;
      }
      if (r === 4) {
        leaderR4 = [...SEATS].sort((x, y) => midScore(g.players[y], g.prices) - midScore(g.players[x], g.prices))[0];
      }
    }

    const ranks = ranking(g);
    if (leaderR4 === ranks[0]) m.leaderR4Wins++;
    m.seatWins[ranks[0]]++;
    m.investigations.push(invCount);
    m.informantUses.push(SEATS.filter((s) => g.players[s].informantUsed).length);
    const scores = SEATS.map((s) => finalScore(g.players[s], g.prices));
    m.scores.push(...scores);
    m.scoreSpreads.push(Math.max(...scores) - Math.min(...scores));
    m.winnerContracts.push(completedCount(g.players[ranks[0]]));
    for (const s of SEATS) {
      const p = g.players[s];
      m.contractsPerPlayer.push(completedCount(p));
      for (const c of p.contracts) {
        if (c.status === "done") {
          if (c.deliveredVia === "smuggle") m.smuggles++;
          else m.legals++;
        }
      }
    }
  }

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const done = m.smuggles + m.legals;
  console.log(`\n═══ ${label} (시작 골드 ${startGold}, ${N_GAMES}판) ═══`);
  console.log(`계약 완료/인      : ${avg(m.contractsPerPlayer).toFixed(2)}  (목표 2~3)`);
  console.log(`밀수 비율         : ${((m.smuggles / done) * 100).toFixed(0)}%  (목표 30~70%)`);
  console.log(`조사 횟수/판      : ${avg(m.investigations).toFixed(2)}  (목표 1~3)`);
  console.log(`정보상 사용/판    : ${avg(m.informantUses).toFixed(2)}  (목표 2~4)`);
  console.log(`입찰 참여/라운드  : ${avg(m.biddersPerRound).toFixed(2)}명  (목표 3+)`);
  console.log(`무행동 시장 계획  : ${((m.holdOnlyPlans / m.totalPlans) * 100).toFixed(0)}%  (목표 ≤15%)`);
  console.log(`주문 미체결 비율  : ${((m.unfilledOrders / m.totalOrders) * 100).toFixed(0)}%`);
  console.log(`화물 낙찰률       : ${((m.auctionsSold / m.auctionsTotal) * 100).toFixed(0)}%`);
  console.log(`가격 상·하한 고착 : ${(m.boundStreakViolations / N_GAMES).toFixed(2)}회/판  (목표 0)`);
  console.log(`4R 선두 최종 승률 : ${((m.leaderR4Wins / N_GAMES) * 100).toFixed(0)}%  (목표 <60%)`);
  console.log(`좌석별 승률       : A ${m.seatWins.A} / B ${m.seatWins.B} / C ${m.seatWins.C} / D ${m.seatWins.D}`);
  console.log(`평균 점수         : ${avg(m.scores).toFixed(1)} / 1~4위 점수차 평균 ${avg(m.scoreSpreads).toFixed(1)}`);
  console.log(`우승자 평균 계약  : ${avg(m.winnerContracts).toFixed(2)}`);
}

if (process.argv[2] === "seatfix") {
  runConfig("24 균등", 24);
  runConfig("24 + 보정 A+1 D+2", 24, { A: 1, D: 2 });
  runConfig("24 + 보정 A+2 D+3", 24, { A: 2, D: 3 });
} else {
  const golds = process.argv[2] ? process.argv.slice(2).map(Number) : [16, 20, 24, 28];
  for (const gold of golds) runConfig(`START_GOLD=${gold}`, gold);
}
