import {
  ALERT_LIMIT,
  BASE_EXPORT,
  BASE_IMPORT,
  BASE_PRICE,
  COMMODITIES,
  COMMODITY_KO,
  INFORMANT_COST,
  MAX_CONTRACTS_DONE,
  RESIDUAL_VALUE,
  SEATS,
  START_GOLD,
  buildCargoDeck,
  buildContractDeck,
  goodsLabel,
  makeRng,
  rotationOrder,
  shuffle,
  zeroGoods,
  NEWS_CARDS,
} from "./data";
import type {
  AuctionResult,
  Bid,
  CargoDef,
  Commodity,
  CustomsEvent,
  DeliveryChoice,
  FillResult,
  GameState,
  Goods,
  InformantQuery,
  MarketOrder,
  Player,
  Seat,
} from "./types";

let contractUidSeq = 1;

export function createGame(seed: number, humanNames: Partial<Record<Seat, string>> = {}): GameState {
  const rng = makeRng(seed);
  const cargoDeck = shuffle(buildCargoDeck(), rng);
  const newsDeck = shuffle(NEWS_CARDS, rng);
  const contractDeck = shuffle(buildContractDeck(), rng);

  const players = {} as Record<Seat, Player>;
  SEATS.forEach((seat, i) => {
    const dealt = contractDeck.slice(i * 3, i * 3 + 3);
    players[seat] = {
      seat,
      name: humanNames[seat] ?? (seat === "A" ? "나 (좌석 A)" : `상단 ${seat}`),
      isHuman: seat === "A",
      gold: START_GOLD,
      goods: zeroGoods(),
      contracts: dealt.map((def) => ({ uid: contractUidSeq++, def, status: "active" as const })),
      informantUsed: false,
      suspicion: 0,
      penalty: 0,
    };
  });

  const state: GameState = {
    round: 0,
    players,
    prices: { ...BASE_PRICE },
    importCap: zeroGoods(),
    exportCap: zeroGoods(),
    alert: 0,
    news: newsDeck[0],
    cargos: [cargoDeck[0], cargoDeck[1]],
    carryover: zeroGoods(),
    cargoDeck,
    newsDeck,
    log: [],
    informantAnswers: [],
  };
  return state;
}

// 활성 계약 2장 + 예비 1장 선택 (setup 9~10단계)
export function chooseContracts(state: GameState, seat: Seat, activeUids: number[]) {
  for (const c of state.players[seat].contracts) {
    c.status = activeUids.includes(c.uid) ? "active" : "reserve";
  }
}

export function log(state: GameState, msg: string) {
  state.log.push(msg);
}

// 6.1 라운드 시작: 소식 공개 → 용량 설정 → 유찰 이월 → 소식 효과 → 화물 공개
export function startRound(state: GameState) {
  state.round += 1;
  const r = state.round;
  state.news = state.newsDeck[r - 1];
  state.cargos = [state.cargoDeck[(r - 1) * 2], state.cargoDeck[(r - 1) * 2 + 1]];

  const imp = { ...BASE_IMPORT };
  const exp = { ...BASE_EXPORT };
  for (const c of COMMODITIES) imp[c] += state.carryover[c];
  state.carryover = zeroGoods();

  switch (state.news.id) {
    case "storm":
      for (const c of COMMODITIES) imp[c] -= 1;
      break;
    case "banquet":
      exp.SILK += 2;
      break;
    case "mine":
      imp.IRON -= 2;
      break;
    case "eastship":
      imp.SPICE += 2;
      imp.SILK += 2;
      break;
    case "edict":
      exp.RELIC += 2;
      break;
    case "festival":
      for (const c of COMMODITIES) exp[c] += 1;
      break;
  }
  for (const c of COMMODITIES) {
    imp[c] = Math.max(0, imp[c]);
    exp[c] = Math.max(0, exp[c]);
  }
  state.importCap = imp;
  state.exportCap = exp;
  log(state, `── ${r}라운드 시작 · 항구 소식: ${state.news.name}`);
}

// 7.1 정보상: 활성 미완료 계약에 해당 상품이 필요한지 YES/NO
export function resolveInformant(state: GameState, queries: Partial<Record<Seat, InformantQuery>>) {
  for (const seat of rotationOrder(state.round)) {
    const q = queries[seat];
    if (!q) continue;
    const p = state.players[seat];
    if (p.informantUsed || p.gold < INFORMANT_COST) continue;
    p.informantUsed = true;
    p.gold -= INFORMANT_COST;
    const target = state.players[q.target];
    const answer = target.contracts.some(
      (c) => c.status === "active" && (c.def.needs[q.commodity] ?? 0) > 0
    );
    if (p.isHuman) {
      state.informantAnswers.push({ round: state.round, target: q.target, commodity: q.commodity, answer });
    }
    log(state, `${p.name} 정보상 고용 → ${target.name} 조사 (질문 내용은 비공개)`);
  }
}

// 7.4~7.5 이중 봉인 경매
export function resolveAuction(state: GameState, bids: Record<Seat, Bid>): AuctionResult {
  const order = rotationOrder(state.round);
  const [cargoA, cargoB] = state.cargos;

  const rank = (key: "a" | "b", minBid: number): Seat[] =>
    order
      .filter((s) => (bids[s][key] ?? 0) >= minBid)
      .sort((s1, s2) => {
        const d = (bids[s2][key] ?? 0) - (bids[s1][key] ?? 0);
        if (d !== 0) return d;
        return order.indexOf(s1) - order.indexOf(s2); // 회전 우선순위
      });

  const rankA = rank("a", cargoA.minBid);
  const rankB = rank("b", cargoB.minBid);

  let winA: Seat | null = rankA[0] ?? null;
  let winB: Seat | null = rankB[0] ?? null;

  if (winA && winB && winA === winB) {
    const pref = bids[winA].pref;
    if (pref === "A") {
      winB = rankB.find((s) => s !== winA) ?? null;
    } else {
      winA = rankA.find((s) => s !== winB) ?? null;
    }
  }

  const unsold: CargoDef[] = [];
  const apply = (cargo: CargoDef, label: "A" | "B", winner: Seat | null, key: "a" | "b") => {
    if (!winner) {
      unsold.push(cargo);
      for (const c of COMMODITIES) state.carryover[c] += cargo.items[c] ?? 0;
      log(state, `화물 ${label} 「${cargo.name}」 유찰 → 다음 라운드 수입 공급 +`);
      return { cargo: label, seat: null, price: 0 };
    }
    const price = bids[winner][key]!;
    const p = state.players[winner];
    p.gold -= price;
    for (const c of COMMODITIES) p.goods[c] += cargo.items[c] ?? 0;
    log(state, `화물 ${label} 「${cargo.name}」 → ${p.name} ${price}골드 낙찰`);
    return { cargo: label, seat: winner, price };
  };

  const resA = apply(cargoA, "A", winA, "a");
  const resB = apply(cargoB, "B", winB, "b");
  return { bids, winners: [resA, resB], unsold };
}

// 8.6 비례 배분
function allocate(
  requests: { seat: Seat; qty: number }[],
  cap: number,
  order: Seat[]
): Map<Seat, number> {
  const filled = new Map<Seat, number>();
  const total = requests.reduce((s, r) => s + r.qty, 0);
  if (total <= cap) {
    for (const r of requests) filled.set(r.seat, r.qty);
    return filled;
  }
  let used = 0;
  for (const r of requests) {
    const base = Math.floor((r.qty * cap) / total);
    filled.set(r.seat, base);
    used += base;
  }
  let remain = cap - used;
  while (remain > 0) {
    let gave = false;
    for (const seat of order) {
      if (remain <= 0) break;
      const req = requests.find((r) => r.seat === seat);
      if (!req) continue;
      const cur = filled.get(seat) ?? 0;
      if (cur < req.qty) {
        filled.set(seat, cur + 1);
        remain -= 1;
        gave = true;
      }
    }
    if (!gave) break;
  }
  return filled;
}

// 8.8 시장 해결
export function resolveMarket(
  state: GameState,
  orders: Record<Seat, MarketOrder[]>
): { fills: FillResult[]; priceChanges: Partial<Record<Commodity, number>> } {
  const order = rotationOrder(state.round);
  const fills: FillResult[] = [];

  for (const commodity of COMMODITIES) {
    for (const side of ["BUY", "SELL"] as const) {
      const reqs = order
        .map((seat) => {
          const o = orders[seat].find(
            (o) => (o.type === "BUY" || o.type === "SELL") && o.type === side && o.commodity === commodity
          ) as { qty: number } | undefined;
          return o ? { seat, qty: o.qty } : null;
        })
        .filter((x): x is { seat: Seat; qty: number } => !!x);
      if (reqs.length === 0) continue;
      const cap = side === "BUY" ? state.importCap[commodity] : state.exportCap[commodity];
      const alloc = allocate(reqs, cap, order);
      for (const r of reqs) {
        const filled = alloc.get(r.seat) ?? 0;
        fills.push({ seat: r.seat, side, commodity, requested: r.qty, filled });
        const p = state.players[r.seat];
        const price = state.prices[commodity];
        if (side === "BUY") {
          p.gold -= filled * price;
          p.goods[commodity] += filled;
        } else {
          p.gold += filled * price;
          p.goods[commodity] -= filled;
        }
      }
    }
  }

  // 뇌물 (8.3)
  const bribeCost = state.news.id === "corrupt" ? 2 : 3;
  for (const seat of order) {
    if (orders[seat].some((o) => o.type === "BRIBE")) {
      const p = state.players[seat];
      p.gold -= bribeCost;
      p.suspicion = Math.max(0, p.suspicion - 2);
      log(state, `${p.name} 뇌물 사용 (-${bribeCost}골드, 의심도 -2)`);
    }
  }

  // 8.7 다음 라운드 가격
  const priceChanges: Partial<Record<Commodity, number>> = {};
  for (const commodity of COMMODITIES) {
    const net = fills
      .filter((f) => f.commodity === commodity)
      .reduce((s, f) => s + (f.side === "BUY" ? f.filled : -f.filled), 0);
    let delta = 0;
    if (net >= 4) delta = 2;
    else if (net >= 1) delta = 1;
    else if (net <= -4) delta = -2;
    else if (net <= -1) delta = -1;
    if (state.round < 8 && delta !== 0) {
      const next = Math.min(12, Math.max(1, state.prices[commodity] + delta));
      if (next !== state.prices[commodity]) {
        priceChanges[commodity] = next - state.prices[commodity];
        state.prices[commodity] = next;
      }
    }
  }
  return { fills, priceChanges };
}

export function completedCount(p: Player): number {
  return p.contracts.filter((c) => c.status === "done").length;
}

export function canDeliver(state: GameState, p: Player, uid: number): boolean {
  const c = p.contracts.find((c) => c.uid === uid);
  if (!c || c.status !== "active") return false;
  if (completedCount(p) >= MAX_CONTRACTS_DONE) return false;
  return COMMODITIES.every((g) => p.goods[g] >= (c.def.needs[g] ?? 0));
}

// 9. 비밀 계약 배송 (라운드당 1개)
export function resolveDeliveries(state: GameState, choices: Partial<Record<Seat, DeliveryChoice>>) {
  const order = rotationOrder(state.round);
  for (const seat of order) {
    const choice = choices[seat];
    if (!choice) continue;
    const p = state.players[seat];
    if (!canDeliver(state, p, choice.contractUid)) continue;
    const c = p.contracts.find((c) => c.uid === choice.contractUid)!;
    const wasFirst = completedCount(p) === 0;
    for (const g of COMMODITIES) p.goods[g] -= c.def.needs[g] ?? 0;
    c.status = "done";
    c.deliveredVia = choice.method;
    c.deliveredRound = state.round;
    if (choice.method === "legal") {
      p.gold += c.def.legalReward;
      log(state, `${p.name} 「${c.def.name}」 합법 배송 완료 (+${c.def.legalReward}골드)`);
    } else {
      p.gold += c.def.smuggleReward;
      p.suspicion += 2;
      state.alert += state.news.id === "crackdown" ? 2 : 1;
      log(
        state,
        `${p.name} 「${c.def.name}」 밀수 배송! (+${c.def.smuggleReward}골드, 의심도 +2, 세관 경계 ${state.alert})`
      );
    }
    if (wasFirst) {
      const reserve = p.contracts.find((x) => x.status === "reserve");
      if (reserve) {
        reserve.status = "active";
        log(state, `${p.name}의 예비 계약이 활성화됨`);
      }
    }
  }
}

// 10. 세관 조사
function runInvestigation(state: GameState, kind: "normal" | "final"): CustomsEvent {
  const order = rotationOrder(state.round);
  const suspects = order.filter((s) => state.players[s].suspicion >= 1);
  if (suspects.length === 0) {
    return { kind, target: null, suspicionAtCheck: 0, penalty: 0 };
  }
  const maxSusp = Math.max(...suspects.map((s) => state.players[s].suspicion));
  const target = suspects.find((s) => state.players[s].suspicion === maxSusp)!;
  const p = state.players[target];
  const penalty = 2 + p.suspicion * 2;
  p.penalty += penalty;
  const susp = p.suspicion;
  p.suspicion = 0;
  log(
    state,
    `${kind === "final" ? "최종 " : ""}세관 조사! ${p.name} 적발 (의심도 ${susp} → 벌점 ${penalty})`
  );
  return { kind, target, suspicionAtCheck: susp, penalty };
}

export function resolveCustoms(state: GameState): CustomsEvent[] {
  const events: CustomsEvent[] = [];
  if (state.alert >= ALERT_LIMIT) {
    const ev = runInvestigation(state, "normal");
    if (ev.target !== null) {
      state.alert -= ALERT_LIMIT;
      events.push(ev);
    }
    // 의심도 1 이상 플레이어가 없으면 조사 미발생, 경계 유지 (10.2)
  }
  if (state.round === 8) {
    const anySuspicion = SEATS.some((s) => state.players[s].suspicion >= 1);
    if (anySuspicion) events.push(runInvestigation(state, "final"));
  }
  return events;
}

// 4.1 최종 점수
export function finalScore(p: Player): number {
  return (
    p.gold +
    COMMODITIES.reduce((s, c) => s + p.goods[c] * RESIDUAL_VALUE[c], 0) -
    p.penalty
  );
}

// 4.2 동점 처리 포함 순위
export function ranking(state: GameState): Seat[] {
  const order8 = rotationOrder(8);
  return [...SEATS].sort((s1, s2) => {
    const p1 = state.players[s1];
    const p2 = state.players[s2];
    const d1 = finalScore(p2) - finalScore(p1);
    if (d1 !== 0) return d1;
    const d2 = completedCount(p2) - completedCount(p1);
    if (d2 !== 0) return d2;
    const d3 = p1.penalty - p2.penalty;
    if (d3 !== 0) return d3;
    const d4 = p2.gold - p1.gold;
    if (d4 !== 0) return d4;
    return order8.indexOf(s1) - order8.indexOf(s2);
  });
}

export function contractNeedsLabel(needs: Partial<Goods>): string {
  return goodsLabel(needs);
}

export { COMMODITY_KO, COMMODITIES, SEATS, rotationOrder, goodsLabel };
