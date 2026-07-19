// 룰북 §15.3 확장 사례가 엔진 판정과 일치하는지 확인 (문서 작성용 임시 스크립트)
import { createGame, resolveMarket, startRound } from "../src/game/engine";
import type { MarketOrder, Seat } from "../src/game/types";

function run(label: string, buys: Partial<Record<Seat, number>>, cap: number) {
  const g = createGame(1);
  g.priorityOffset = 0; // 1라운드 시작 좌석 A → 4라운드 우선순위 D→A→B→C
  g.round = 3;
  startRound(g); // round = 4
  g.importCap.SILK = cap;
  for (const s of ["A", "B", "C", "D"] as Seat[]) g.players[s].gold = 50;
  const orders = {} as Record<Seat, MarketOrder[]>;
  for (const s of ["A", "B", "C", "D"] as Seat[]) {
    const q = buys[s] ?? 0;
    orders[s] = q > 0 ? [{ type: "BUY", commodity: "SILK", qty: q }, { type: "HOLD" }] : [{ type: "HOLD" }, { type: "HOLD" }];
  }
  const { fills } = resolveMarket(g, orders);
  const out = fills
    .filter((f) => f.commodity === "SILK" && f.side === "BUY")
    .map((f) => `${f.seat}:${f.filled}/${f.requested}`)
    .join(" ");
  console.log(`${label} (한도 ${cap}) → ${out || "체결 없음"}`);
}

run("사례1 B3 C3 D2", { B: 3, C: 3, D: 2 }, 4);
run("사례2 B2 C2 D2", { B: 2, C: 2, D: 2 }, 4);
run("사례3 A2 B2 C2 D2", { A: 2, B: 2, C: 2, D: 2 }, 4);
run("사례4 한도 0", { B: 2, C: 2 }, 0);
run("사례5 합계≤한도 B2 C1", { B: 2, C: 1 }, 4);
