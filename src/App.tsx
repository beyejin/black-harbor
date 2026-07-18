import { useMemo, useReducer, useRef, useState } from "react";
import { aiBid, aiChooseContracts, aiDelivery, aiInformant, aiMarket } from "./game/ai";
import {
  COMMODITIES,
  COMMODITY_KO,
  SEATS,
  canDeliver,
  chooseContracts,
  completedCount,
  createGame,
  finalScore,
  goodsLabel,
  ranking,
  resolveAuction,
  resolveCustoms,
  resolveDeliveries,
  resolveInformant,
  resolveMarket,
  rotationOrder,
  startRound,
} from "./game/engine";
import { INFORMANT_COST, RESIDUAL_VALUE, makeRng } from "./game/data";
import type {
  AuctionResult,
  Bid,
  Commodity,
  CustomsEvent,
  DeliveryChoice,
  FillResult,
  GameState,
  InformantQuery,
  MarketOrder,
  Seat,
} from "./game/types";

type Phase =
  | "setup"
  | "news"
  | "auction"
  | "auctionResult"
  | "market"
  | "marketResult"
  | "delivery"
  | "roundResult"
  | "final";

const HUMAN: Seat = "A";

export default function App() {
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const gameRef = useRef<GameState | null>(null);
  const rngRef = useRef(makeRng(0));
  if (!gameRef.current) {
    gameRef.current = createGame(seed);
    rngRef.current = makeRng(seed ^ 0x9e3779b9);
  }
  const g = gameRef.current;
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [phase, setPhase] = useState<Phase>("setup");
  const [auctionResult, setAuctionResult] = useState<AuctionResult | null>(null);
  const [marketFills, setMarketFills] = useState<FillResult[]>([]);
  const [priceChanges, setPriceChanges] = useState<Partial<Record<Commodity, number>>>({});
  const [customsEvents, setCustomsEvents] = useState<CustomsEvent[]>([]);

  const me = g.players[HUMAN];

  function finishSetup(activeUids: number[]) {
    chooseContracts(g, HUMAN, activeUids);
    for (const s of SEATS) {
      if (s !== HUMAN) chooseContracts(g, s, aiChooseContracts(g.players[s]));
    }
    startRound(g);
    setPhase("news");
    force();
  }

  function finishNews(myQuery: InformantQuery | null) {
    const queries: Partial<Record<Seat, InformantQuery>> = {};
    if (myQuery) queries[HUMAN] = myQuery;
    for (const s of SEATS) {
      if (s === HUMAN) continue;
      const q = aiInformant(g, s, rngRef.current);
      if (q) queries[s] = q;
    }
    resolveInformant(g, queries);
    setPhase("auction");
    force();
  }

  function finishAuction(myBid: Bid) {
    const bids = {} as Record<Seat, Bid>;
    bids[HUMAN] = myBid;
    for (const s of SEATS) {
      if (s !== HUMAN) bids[s] = aiBid(g, s, rngRef.current);
    }
    setAuctionResult(resolveAuction(g, bids));
    setPhase("auctionResult");
    force();
  }

  function finishMarket(myOrders: MarketOrder[]) {
    const orders = {} as Record<Seat, MarketOrder[]>;
    orders[HUMAN] = myOrders;
    for (const s of SEATS) {
      if (s !== HUMAN) orders[s] = aiMarket(g, s);
    }
    const res = resolveMarket(g, orders);
    setMarketFills(res.fills);
    setPriceChanges(res.priceChanges);
    setPhase("marketResult");
    force();
  }

  function finishDelivery(myChoice: DeliveryChoice | null) {
    const choices: Partial<Record<Seat, DeliveryChoice>> = {};
    if (myChoice) choices[HUMAN] = myChoice;
    for (const s of SEATS) {
      if (s === HUMAN) continue;
      const c = aiDelivery(g, s);
      if (c) choices[s] = c;
    }
    resolveDeliveries(g, choices);
    setCustomsEvents(resolveCustoms(g));
    setPhase("roundResult");
    force();
  }

  function nextRound() {
    if (g.round >= 8) {
      setPhase("final");
    } else {
      startRound(g);
      setPhase("news");
    }
    force();
  }

  return (
    <div className="layout">
      <Sidebar g={g} phase={phase} />
      <main className="stage">
        {phase === "setup" && <SetupPanel g={g} onDone={finishSetup} />}
        {phase === "news" && <NewsPanel g={g} onDone={finishNews} />}
        {phase === "auction" && <AuctionPanel g={g} onDone={finishAuction} />}
        {phase === "auctionResult" && auctionResult && (
          <AuctionResultPanel g={g} result={auctionResult} onNext={() => setPhase("market")} />
        )}
        {phase === "market" && <MarketPanel g={g} onDone={finishMarket} />}
        {phase === "marketResult" && (
          <MarketResultPanel
            g={g}
            fills={marketFills}
            priceChanges={priceChanges}
            onNext={() => setPhase("delivery")}
          />
        )}
        {phase === "delivery" && <DeliveryPanel g={g} onDone={finishDelivery} />}
        {phase === "roundResult" && (
          <RoundResultPanel g={g} events={customsEvents} onNext={nextRound} />
        )}
        {phase === "final" && <FinalPanel g={g} />}
      </main>
    </div>
  );
}

/* ── 사이드바: 공개 정보 ── */

function Sidebar({ g, phase }: { g: GameState; phase: Phase }) {
  const order = g.round >= 1 ? rotationOrder(g.round) : rotationOrder(1);
  const me = g.players[HUMAN];
  return (
    <aside className="sidebar">
      <h1 className="logo">⚓ 검은 항구</h1>
      <div className="round-chip">
        {g.round >= 1 ? `${g.round} / 8 라운드` : "게임 준비"}
        <span className="dim"> · 우선순위 {order.join("→")}</span>
      </div>

      <section>
        <h3>시장 (현재가 · 수입/수출 한도)</h3>
        <table className="mini">
          <tbody>
            {COMMODITIES.map((c) => (
              <tr key={c}>
                <td>{COMMODITY_KO[c]}</td>
                <td className="num gold-text">{g.prices[c]}</td>
                <td className="num dim">
                  {g.importCap[c]} / {g.exportCap[c]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>
          세관 경계 <span className={g.alert >= 3 ? "danger" : ""}>{g.alert} / 4</span>
        </h3>
        <div className="alert-bar">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`alert-cell ${i < g.alert ? "on" : ""}`} />
          ))}
        </div>
      </section>

      <section>
        <h3>플레이어</h3>
        {SEATS.map((s) => {
          const p = g.players[s];
          return (
            <div key={s} className={`player-row ${s === HUMAN ? "mine" : ""}`}>
              <div className="player-head">
                <b>{p.name}</b>
                <span className="gold-text">{p.gold}g</span>
              </div>
              <div className="player-sub">
                {COMMODITIES.map((c) => (
                  <span key={c} className="dim">
                    {COMMODITY_KO[c][0]}
                    {p.goods[c]}
                  </span>
                ))}
                <span className={p.suspicion >= 3 ? "danger" : p.suspicion > 0 ? "warn" : "dim"}>
                  의심 {p.suspicion}
                </span>
                {p.penalty > 0 && <span className="danger">벌점 {p.penalty}</span>}
                <span className="dim">계약 {completedCount(p)}/3</span>
                {p.informantUsed && <span className="dim">정보상✓</span>}
              </div>
            </div>
          );
        })}
      </section>

      {phase !== "setup" && (
        <section>
          <h3>내 비밀 계약 (비공개)</h3>
          {me.contracts.map((c) => (
            <div key={c.uid} className={`contract-chip ${c.status}`}>
              <b>{c.def.name}</b> <span className="dim">{goodsLabel(c.def.needs)}</span>
              <span className="tag">
                {c.status === "done"
                  ? c.deliveredVia === "smuggle"
                    ? "밀수 완료"
                    : "합법 완료"
                  : c.status === "reserve"
                    ? "예비"
                    : `합법 ${c.def.legalReward} / 밀수 ${c.def.smuggleReward}`}
              </span>
            </div>
          ))}
          {g.informantAnswers.length > 0 && (
            <div className="informant-memo">
              {g.informantAnswers.map((a, i) => (
                <div key={i} className="dim">
                  🔎 R{a.round} {g.players[a.target].name} · {COMMODITY_KO[a.commodity]} 필요?{" "}
                  <b className={a.answer ? "warn" : ""}>{a.answer ? "YES" : "NO"}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="log-section">
        <h3>기록</h3>
        <div className="log">
          {g.log.slice(-14).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </section>
    </aside>
  );
}

/* ── 준비: 활성 계약 선택 ── */

function SetupPanel({ g, onDone }: { g: GameState; onDone: (uids: number[]) => void }) {
  const me = g.players[HUMAN];
  const [selected, setSelected] = useState<number[]>([]);
  const toggle = (uid: number) =>
    setSelected((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : prev.length < 2 ? [...prev, uid] : prev
    );
  return (
    <div className="panel">
      <h2>비밀 계약 선택</h2>
      <p className="hint">
        받은 계약 3장 중 <b>활성 계약 2장</b>을 고르세요. 나머지 1장은 예비 계약이 되어, 첫 계약을
        완료하면 활성화됩니다. 계약은 상대에게 비공개입니다.
      </p>
      <div className="card-grid">
        {me.contracts.map((c) => (
          <button
            key={c.uid}
            className={`card contract ${selected.includes(c.uid) ? "selected" : ""}`}
            onClick={() => toggle(c.uid)}
          >
            <h4>{c.def.name}</h4>
            <div>{goodsLabel(c.def.needs)}</div>
            <div className="reward">
              합법 <b>{c.def.legalReward}g</b> · 밀수 <b>{c.def.smuggleReward}g</b>
            </div>
          </button>
        ))}
      </div>
      <button className="primary" disabled={selected.length !== 2} onClick={() => onDone(selected)}>
        이 2장을 활성 계약으로 확정
      </button>
    </div>
  );
}

/* ── 항구 소식 + 정보상 ── */

function NewsPanel({ g, onDone }: { g: GameState; onDone: (q: InformantQuery | null) => void }) {
  const me = g.players[HUMAN];
  const [useInf, setUseInf] = useState(false);
  const [target, setTarget] = useState<Seat>("B");
  const [commodity, setCommodity] = useState<Commodity>("SPICE");
  const canUse = !me.informantUsed && me.gold >= INFORMANT_COST;
  const validTargets = SEATS.filter(
    (s) => s !== HUMAN && g.players[s].contracts.some((c) => c.status === "active")
  );
  return (
    <div className="panel">
      <h2>{g.round}라운드 · 항구 소식</h2>
      <div className="news-card">
        <h3>📜 {g.news.name}</h3>
        <p>{g.news.desc}</p>
      </div>
      <h3>이번 라운드 경매 화물</h3>
      <div className="card-grid">
        {g.cargos.map((c, i) => (
          <div key={c.id} className="card">
            <h4>
              화물 {i === 0 ? "A" : "B"} · {c.name}
            </h4>
            <div>{goodsLabel(c.items)}</div>
            <div className="reward">
              기본 가치 {c.baseValue} · 최소 입찰가 <b>{c.minBid}g</b>
            </div>
          </div>
        ))}
      </div>

      {canUse && validTargets.length > 0 && (
        <div className="informant-box">
          <label className="row">
            <input type="checkbox" checked={useInf} onChange={(e) => setUseInf(e.target.checked)} />
            <b>정보상 고용</b> (게임당 1회 · {INFORMANT_COST}골드) — 상대의 활성 계약에 특정 상품이
            필요한지 YES/NO로 확인
          </label>
          {useInf && (
            <div className="row">
              <select value={target} onChange={(e) => setTarget(e.target.value as Seat)}>
                {validTargets.map((s) => (
                  <option key={s} value={s}>
                    {g.players[s].name}
                  </option>
                ))}
              </select>
              <select value={commodity} onChange={(e) => setCommodity(e.target.value as Commodity)}>
                {COMMODITIES.map((c) => (
                  <option key={c} value={c}>
                    {COMMODITY_KO[c]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <button
        className="primary"
        onClick={() => onDone(useInf && canUse ? { target, commodity } : null)}
      >
        {useInf ? "정보상 고용하고 경매로" : "경매로 진행"}
      </button>
    </div>
  );
}

/* ── 이중 봉인 경매 ── */

function AuctionPanel({ g, onDone }: { g: GameState; onDone: (bid: Bid) => void }) {
  const me = g.players[HUMAN];
  const [bidA, setBidA] = useState("");
  const [bidB, setBidB] = useState("");
  const [pref, setPref] = useState<"A" | "B">("A");
  const lastAnswer = g.informantAnswers.find((a) => a.round === g.round);

  const a = bidA === "" ? null : Number(bidA);
  const b = bidB === "" ? null : Number(bidB);
  const errors: string[] = [];
  if (a !== null && (!Number.isInteger(a) || a < g.cargos[0].minBid))
    errors.push(`화물 A는 최소 ${g.cargos[0].minBid}골드 이상 정수로 입찰해야 합니다.`);
  if (b !== null && (!Number.isInteger(b) || b < g.cargos[1].minBid))
    errors.push(`화물 B는 최소 ${g.cargos[1].minBid}골드 이상 정수로 입찰해야 합니다.`);
  if ((a ?? 0) + (b ?? 0) > me.gold)
    errors.push(`두 입찰 합계(${(a ?? 0) + (b ?? 0)})가 보유 골드(${me.gold})를 초과합니다.`);

  return (
    <div className="panel">
      <h2>{g.round}라운드 · 이중 봉인 경매</h2>
      {lastAnswer && (
        <p className="hint warn">
          🔎 정보상 응답: {g.players[lastAnswer.target].name}의 활성 계약에{" "}
          {COMMODITY_KO[lastAnswer.commodity]} 필요 여부 → <b>{lastAnswer.answer ? "YES" : "NO"}</b>
        </p>
      )}
      <p className="hint">
        두 화물에 동시에 비공개 입찰합니다. 입찰 합계는 보유 골드({me.gold}g)를 넘을 수 없고, 두
        화물 모두 1순위가 되면 <b>선호 화물</b>만 가져갑니다 (다른 화물은 차순위에게).
      </p>
      <div className="card-grid">
        {g.cargos.map((c, i) => {
          const val = i === 0 ? bidA : bidB;
          const set = i === 0 ? setBidA : setBidB;
          const label = i === 0 ? "A" : "B";
          return (
            <div key={c.id} className={`card ${pref === label ? "selected" : ""}`}>
              <h4>
                화물 {label} · {c.name}
              </h4>
              <div>{goodsLabel(c.items)}</div>
              <div className="reward">최소 입찰가 {c.minBid}g</div>
              <input
                type="number"
                placeholder="입찰 안 함"
                min={c.minBid}
                value={val}
                onChange={(e) => set(e.target.value)}
              />
              <label className="row">
                <input
                  type="radio"
                  name="pref"
                  checked={pref === label}
                  onChange={() => setPref(label as "A" | "B")}
                />
                선호 화물로 지정
              </label>
            </div>
          );
        })}
      </div>
      {errors.map((e, i) => (
        <p key={i} className="error">
          {e}
        </p>
      ))}
      <button
        className="primary"
        disabled={errors.length > 0}
        onClick={() => onDone({ a, b, pref })}
      >
        입찰 잠금 (동시 공개)
      </button>
    </div>
  );
}

function AuctionResultPanel({
  g,
  result,
  onNext,
}: {
  g: GameState;
  result: AuctionResult;
  onNext: () => void;
}) {
  return (
    <div className="panel">
      <h2>경매 결과 공개</h2>
      <table className="wide">
        <thead>
          <tr>
            <th>플레이어</th>
            <th>화물 A</th>
            <th>화물 B</th>
            <th>선호</th>
          </tr>
        </thead>
        <tbody>
          {SEATS.map((s) => {
            const b = result.bids[s];
            return (
              <tr key={s}>
                <td>{g.players[s].name}</td>
                <td className="num">{b.a ?? "—"}</td>
                <td className="num">{b.b ?? "—"}</td>
                <td>{b.pref}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result.winners.map((w) => (
        <p key={w.cargo} className="hint">
          화물 {w.cargo}:{" "}
          {w.seat ? (
            <>
              <b>{g.players[w.seat].name}</b> {w.price}골드 낙찰
            </>
          ) : (
            <>유찰 → 다음 라운드 수입 공급량에 추가</>
          )}
        </p>
      ))}
      <button className="primary" onClick={onNext}>
        시장 계획으로
      </button>
    </div>
  );
}

/* ── 동시 시장 계획 ── */

interface SlotState {
  type: "HOLD" | "BUY" | "SELL" | "BRIBE";
  commodity: Commodity;
  qty: number;
}

function MarketPanel({ g, onDone }: { g: GameState; onDone: (orders: MarketOrder[]) => void }) {
  const me = g.players[HUMAN];
  const [slots, setSlots] = useState<SlotState[]>([
    { type: "HOLD", commodity: "SPICE", qty: 1 },
    { type: "HOLD", commodity: "SPICE", qty: 1 },
  ]);
  const bribeCost = g.news.id === "corrupt" ? 2 : 3;

  const orders: MarketOrder[] = slots.map((s) =>
    s.type === "HOLD"
      ? { type: "HOLD" }
      : s.type === "BRIBE"
        ? { type: "BRIBE" }
        : { type: s.type, commodity: s.commodity, qty: s.qty }
  );

  const errors: string[] = [];
  const trades = slots.filter((s) => s.type === "BUY" || s.type === "SELL");
  if (trades.length === 2 && trades[0].commodity === trades[1].commodity)
    errors.push("한 상품에는 주문 하나만 제출할 수 있습니다.");
  if (slots.filter((s) => s.type === "BRIBE").length > 1)
    errors.push("뇌물은 라운드당 한 번만 가능합니다.");
  const buyCost = slots
    .filter((s) => s.type === "BUY")
    .reduce((sum, s) => sum + s.qty * g.prices[s.commodity], 0);
  const bribeTotal = slots.some((s) => s.type === "BRIBE") ? bribeCost : 0;
  if (buyCost + bribeTotal > me.gold)
    errors.push(`구매 비용(${buyCost}) + 뇌물(${bribeTotal})이 보유 골드(${me.gold})를 초과합니다.`);
  for (const s of slots) {
    if (s.type === "SELL" && s.qty > me.goods[s.commodity])
      errors.push(`${COMMODITY_KO[s.commodity]} 보유량(${me.goods[s.commodity]})보다 많이 팔 수 없습니다.`);
  }

  const update = (i: number, patch: Partial<SlotState>) =>
    setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="panel">
      <h2>{g.round}라운드 · 동시 시장 계획</h2>
      <p className="hint">
        주문 슬롯 2개. 현재 가격으로 체결되며, 수입/수출 한도를 넘으면 비례 배분됩니다. 이번
        라운드의 체결량 차이가 <b>다음 라운드 가격</b>을 만듭니다. 뇌물({bribeCost}g)은 의심도를 2
        낮춥니다.
      </p>
      {slots.map((s, i) => (
        <div key={i} className="slot-row">
          <span className="dim">슬롯 {i + 1}</span>
          <select value={s.type} onChange={(e) => update(i, { type: e.target.value as SlotState["type"] })}>
            <option value="HOLD">행동 없음</option>
            <option value="BUY">구매</option>
            <option value="SELL">판매</option>
            <option value="BRIBE">뇌물 (의심도 -2)</option>
          </select>
          {(s.type === "BUY" || s.type === "SELL") && (
            <>
              <select
                value={s.commodity}
                onChange={(e) => update(i, { commodity: e.target.value as Commodity })}
              >
                {COMMODITIES.map((c) => (
                  <option key={c} value={c}>
                    {COMMODITY_KO[c]} ({g.prices[c]}g · 한도 {s.type === "BUY" ? g.importCap[c] : g.exportCap[c]})
                  </option>
                ))}
              </select>
              <select value={s.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })}>
                {[1, 2, 3].map((q) => (
                  <option key={q} value={q}>
                    {q}개
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      ))}
      {errors.map((e, i) => (
        <p key={i} className="error">
          {e}
        </p>
      ))}
      <button className="primary" disabled={errors.length > 0} onClick={() => onDone(orders)}>
        시장 계획 잠금 (동시 공개)
      </button>
    </div>
  );
}

function MarketResultPanel({
  g,
  fills,
  priceChanges,
  onNext,
}: {
  g: GameState;
  fills: FillResult[];
  priceChanges: Partial<Record<Commodity, number>>;
  onNext: () => void;
}) {
  return (
    <div className="panel">
      <h2>시장 결과 공개</h2>
      {fills.length === 0 ? (
        <p className="hint">이번 라운드 시장 주문이 없었습니다.</p>
      ) : (
        <table className="wide">
          <thead>
            <tr>
              <th>플레이어</th>
              <th>주문</th>
              <th>요청</th>
              <th>체결</th>
            </tr>
          </thead>
          <tbody>
            {fills.map((f, i) => (
              <tr key={i} className={f.filled < f.requested ? "short" : ""}>
                <td>{g.players[f.seat].name}</td>
                <td>
                  {COMMODITY_KO[f.commodity]} {f.side === "BUY" ? "구매" : "판매"}
                </td>
                <td className="num">{f.requested}</td>
                <td className="num">{f.filled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">
        다음 라운드 가격 변화:{" "}
        {Object.keys(priceChanges).length === 0
          ? "없음"
          : COMMODITIES.filter((c) => priceChanges[c]).map((c) => (
              <span key={c} className={priceChanges[c]! > 0 ? "warn" : "cool"}>
                {COMMODITY_KO[c]} {priceChanges[c]! > 0 ? "+" : ""}
                {priceChanges[c]}{" "}
              </span>
            ))}
      </p>
      <button className="primary" onClick={onNext}>
        계약 배송으로
      </button>
    </div>
  );
}

/* ── 비밀 계약 배송 ── */

function DeliveryPanel({ g, onDone }: { g: GameState; onDone: (c: DeliveryChoice | null) => void }) {
  const me = g.players[HUMAN];
  const [pick, setPick] = useState<number | null>(null);
  const [method, setMethod] = useState<"legal" | "smuggle">("legal");
  const actives = me.contracts.filter((c) => c.status === "active");
  const done = completedCount(me);
  const alertGain = g.news.id === "crackdown" ? 2 : 1;
  return (
    <div className="panel">
      <h2>{g.round}라운드 · 비밀 계약 배송</h2>
      <p className="hint">
        라운드당 1개, 게임당 최대 3개까지 완료할 수 있습니다 (현재 {done}/3). 밀수는 +4골드지만
        의심도 +2, 세관 경계 +{alertGain}. 경계가 4에 도달하면 <b>의심도가 가장 높은 플레이어</b>가
        조사받습니다.
      </p>
      <div className="card-grid">
        {actives.map((c) => {
          const ok = canDeliver(g, me, c.uid);
          return (
            <button
              key={c.uid}
              className={`card contract ${pick === c.uid ? "selected" : ""}`}
              disabled={!ok}
              onClick={() => setPick(pick === c.uid ? null : c.uid)}
            >
              <h4>{c.def.name}</h4>
              <div>{goodsLabel(c.def.needs)}</div>
              <div className="reward">
                합법 <b>{c.def.legalReward}g</b> · 밀수 <b>{c.def.smuggleReward}g</b>
              </div>
              {!ok && <div className="error">상품 부족</div>}
            </button>
          );
        })}
        {actives.length === 0 && <p className="hint">활성 계약이 없습니다.</p>}
      </div>
      {pick !== null && (
        <div className="row">
          <label className="row">
            <input type="radio" checked={method === "legal"} onChange={() => setMethod("legal")} />
            합법 배송 (안전)
          </label>
          <label className="row">
            <input
              type="radio"
              checked={method === "smuggle"}
              onChange={() => setMethod("smuggle")}
            />
            밀수 배송 (+4g · 의심도 +2 · 경계 +{alertGain})
          </label>
        </div>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={pick === null}
          onClick={() => onDone(pick !== null ? { contractUid: pick, method } : null)}
        >
          배송 실행
        </button>
        <button onClick={() => onDone(null)}>이번 라운드는 배송 안 함</button>
      </div>
    </div>
  );
}

/* ── 라운드 결과 / 세관 ── */

function RoundResultPanel({
  g,
  events,
  onNext,
}: {
  g: GameState;
  events: CustomsEvent[];
  onNext: () => void;
}) {
  return (
    <div className="panel">
      <h2>{g.round}라운드 정산</h2>
      {events.length === 0 ? (
        <p className="hint">세관 조사 없음 (경계 {g.alert}/4)</p>
      ) : (
        events.map((ev, i) => (
          <div key={i} className="news-card danger-card">
            <h3>🚨 {ev.kind === "final" ? "최종 세관 조사" : "세관 조사 발생"}</h3>
            {ev.target ? (
              <p>
                <b>{g.players[ev.target].name}</b> 적발 — 의심도 {ev.suspicionAtCheck} → 벌점{" "}
                <b>{ev.penalty}점</b> (의심도 0으로 초기화)
              </p>
            ) : (
              <p>의심도 1 이상인 플레이어가 없어 조사가 발생하지 않았습니다.</p>
            )}
          </div>
        ))
      )}
      <table className="wide">
        <thead>
          <tr>
            <th>플레이어</th>
            <th>골드</th>
            <th>의심도</th>
            <th>벌점</th>
            <th>완료 계약</th>
          </tr>
        </thead>
        <tbody>
          {SEATS.map((s) => {
            const p = g.players[s];
            return (
              <tr key={s}>
                <td>{p.name}</td>
                <td className="num">{p.gold}</td>
                <td className="num">{p.suspicion}</td>
                <td className="num">{p.penalty}</td>
                <td className="num">{completedCount(p)}/3</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="primary" onClick={onNext}>
        {g.round >= 8 ? "최종 점수 보기" : `${g.round + 1}라운드 시작`}
      </button>
    </div>
  );
}

/* ── 최종 결과 ── */

function FinalPanel({ g }: { g: GameState }) {
  const ranks = ranking(g);
  return (
    <div className="panel">
      <h2>🏆 최종 결과</h2>
      <table className="wide">
        <thead>
          <tr>
            <th>순위</th>
            <th>플레이어</th>
            <th>골드</th>
            <th>잔존 상품</th>
            <th>벌점</th>
            <th>최종 점수</th>
          </tr>
        </thead>
        <tbody>
          {ranks.map((s, i) => {
            const p = g.players[s];
            const residual = COMMODITIES.reduce((sum, c) => sum + p.goods[c] * RESIDUAL_VALUE[c], 0);
            return (
              <tr key={s} className={i === 0 ? "winner" : ""}>
                <td>{i + 1}</td>
                <td>{p.name}</td>
                <td className="num">{p.gold}</td>
                <td className="num">+{residual}</td>
                <td className="num">-{p.penalty}</td>
                <td className="num">
                  <b>{finalScore(p)}</b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        최종 점수 = 골드 + 잔존 가치(향신료·철광석 2 / 비단 3 / 유물 4) − 세관 벌점. 완료하지 못한
        계약은 점수가 없습니다.
      </p>
      <button className="primary" onClick={() => window.location.reload()}>
        새 게임
      </button>
    </div>
  );
}
