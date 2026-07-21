import { useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  ranking,
  resolveAuction,
  resolveCustoms,
  resolveDeliveries,
  resolveInformant,
  resolveMarket,
  rotationOrder,
  startRound,
} from "./game/engine";
import { ALERT_LIMIT, INFORMANT_COST, RULE_VERSION, makeRng } from "./game/data";
import { residualValueAtPrice } from "./game/scoring";
import type {
  AuctionResult,
  Bid,
  CargoDef,
  Commodity,
  ContractInstance,
  CustomsEvent,
  DeliveryChoice,
  FillResult,
  GameState,
  InformantQuery,
  MarketOrder,
  Seat,
} from "./game/types";
import {
  AnchorIcon,
  CommodityIcon,
  CompassIcon,
  DiceIcon,
  EnvelopeIcon,
  EyeIcon,
  GavelIcon,
  GoldIcon,
  HandshakeIcon,
  LanternIcon,
  ScaleIcon,
  ScrollIcon,
  SuspicionIcon,
  SwordsIcon,
} from "./ui/icons";

type Phase =
  | "setup"
  | "news"
  | "informant"
  | "auction"
  | "auctionResult"
  | "market"
  | "marketResult"
  | "delivery"
  | "roundResult"
  | "final";

type Screen = "lobby" | "room" | "game";
type RoomMode = "practice" | "create" | "join";
type SheetKind = "settings" | "help" | "rules" | "log" | null;

const HUMAN: Seat = "A";

const AI_NAMES: Partial<Record<Seat, string>> = {
  B: "바다그림자",
  C: "파도사냥꾼",
  D: "검은상회",
};

const SEAT_LEVEL: Record<Seat, number> = { A: 17, B: 14, C: 15, D: 12 };

const STEPS = [
  { key: "news", label: "소식·화물", phases: ["news"] },
  { key: "informant", label: "정보상", phases: ["informant"] },
  { key: "auction", label: "경매", phases: ["auction", "auctionResult"] },
  { key: "market", label: "시장", phases: ["market", "marketResult"] },
  { key: "delivery", label: "배송", phases: ["delivery"] },
  { key: "customs", label: "세관", phases: ["roundResult", "final"] },
] as const;

const CONTRACT_FLAVOR: Record<string, string> = {
  "향신료 보급": "이국의 향신료를 들여와 높은 이익을 남깁니다.",
  "무기 제작": "대장간에 철과 향신료를 대어 무기를 벼립니다.",
  "귀족 의복": "동방의 비단으로 귀족의 옷을 짓습니다.",
  "고대 의식": "은밀한 의식에 쓰일 유물을 조달합니다.",
  "왕실 수집": "왕실 수집가에게 유물과 비단을 전합니다.",
  "대상단 주문": "대상단의 종합 주문을 빠짐없이 채웁니다.",
};

function josa(word: string, withBatchim: string, without: string) {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return without;
  return (code - 0xac00) % 28 > 0 ? withBatchim : without;
}

function goodsEntries(items: Partial<Record<Commodity, number>>) {
  return COMMODITIES.filter((c) => (items[c] ?? 0) > 0).map((c) => ({ commodity: c, qty: items[c]! }));
}

export default function App() {
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const gameRef = useRef<GameState | null>(null);
  const rngRef = useRef(makeRng(0));
  if (!gameRef.current) {
    gameRef.current = createGame(seed, AI_NAMES);
    rngRef.current = makeRng(seed ^ 0x9e3779b9);
  }
  const g = gameRef.current;
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [phase, setPhase] = useState<Phase>("setup");
  const [auctionResult, setAuctionResult] = useState<AuctionResult | null>(null);
  const [marketFills, setMarketFills] = useState<FillResult[]>([]);
  const [priceChanges, setPriceChanges] = useState<Partial<Record<Commodity, number>>>({});
  const [customsEvents, setCustomsEvents] = useState<CustomsEvent[]>([]);
  const [screen, setScreen] = useState<Screen>("lobby");
  const [roomMode, setRoomMode] = useState<RoomMode>("practice");
  const [roomName, setRoomName] = useState("야간 항구 #17");
  const [playerName, setPlayerName] = useState("검은해적");
  const [utility, setUtility] = useState<SheetKind>(null);

  function resetGame() {
    const nextSeed = Math.floor(Math.random() * 1e9);
    gameRef.current = createGame(nextSeed, AI_NAMES);
    rngRef.current = makeRng(nextSeed ^ 0x9e3779b9);
    gameRef.current.players[HUMAN].name = playerName.trim() || "검은해적";
    setAuctionResult(null);
    setMarketFills([]);
    setPriceChanges({});
    setCustomsEvents([]);
    setPhase("setup");
    force();
  }

  function openRoom(mode: RoomMode, code = "") {
    setRoomMode(mode);
    setRoomName(
      mode === "create" ? "새로 연 항구" : mode === "join" ? `초대 항구 ${code || "17"}` : "야간 항구 #17"
    );
    setUtility(null);
    setScreen("room");
  }

  function startGame() {
    resetGame();
    setUtility(null);
    setScreen("game");
  }

  function goLobby() {
    setUtility(null);
    setScreen("lobby");
  }

  function finishSetup(activeUids: number[]) {
    chooseContracts(g, HUMAN, activeUids);
    for (const s of SEATS) {
      if (s !== HUMAN) chooseContracts(g, s, aiChooseContracts(g.players[s]));
    }
    startRound(g);
    setPhase("news");
    force();
  }

  function finishInformant(myQuery: InformantQuery | null) {
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

  const utilitySheet = utility ? <UtilitySheet kind={utility} g={g} onClose={() => setUtility(null)} /> : null;

  if (screen === "lobby") {
    return (
      <>
        <LobbyScreen
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          onOpenRoom={openRoom}
          onUtility={setUtility}
        />
        {utilitySheet}
      </>
    );
  }

  if (screen === "room") {
    return (
      <>
        <RoomScreen
          g={g}
          roomName={roomName}
          roomMode={roomMode}
          playerName={playerName}
          onBack={goLobby}
          onStart={startGame}
          onUtility={setUtility}
        />
        {utilitySheet}
      </>
    );
  }

  return (
    <>
      <GameShell g={g} phase={phase} onLobby={goLobby} onUtility={setUtility}>
        {phase === "setup" && <SetupStage g={g} onDone={finishSetup} />}
        {phase === "news" && (
          <NewsStage
            g={g}
            onInformant={() => {
              setPhase("informant");
              force();
            }}
            onSkip={() => finishInformant(null)}
            onFlow={() => setUtility("help")}
          />
        )}
        {phase === "informant" && <InformantStage g={g} onDone={finishInformant} />}
        {phase === "auction" && <AuctionStage g={g} onDone={finishAuction} />}
        {phase === "auctionResult" && auctionResult && (
          <AuctionRevealStage
            g={g}
            result={auctionResult}
            onNext={() => {
              setPhase("market");
              force();
            }}
          />
        )}
        {phase === "market" && <MarketStage g={g} onDone={finishMarket} />}
        {phase === "marketResult" && (
          <MarketRevealStage
            g={g}
            fills={marketFills}
            priceChanges={priceChanges}
            onNext={() => {
              setPhase("delivery");
              force();
            }}
          />
        )}
        {phase === "delivery" && <DeliveryStage g={g} onDone={finishDelivery} />}
        {phase === "roundResult" && <CustomsStage g={g} events={customsEvents} onNext={nextRound} />}
        {phase === "final" && <FinalStage g={g} onReplay={resetGame} onLobby={goLobby} />}
      </GameShell>
      {utilitySheet}
    </>
  );
}

/* ═══════════ 공통 조각 ═══════════ */

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <span className="brand-mark">
        <AnchorIcon size={compact ? 22 : 28} />
      </span>
      <span className="brand-text">
        <strong>검은 항구</strong>
        <small>밀무역과 거래의 바다</small>
      </span>
    </div>
  );
}

function SeatBadge({ seat, size = "md" }: { seat: Seat; size?: "sm" | "md" | "lg" }) {
  return <span className={`seat-badge seat-${seat.toLowerCase()} size-${size}`}>{seat}</span>;
}

function Portrait({ seat, size = "md" }: { seat: Seat; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`portrait seat-${seat.toLowerCase()} size-${size}`}>
      <AnchorIcon size={size === "lg" ? 26 : size === "md" ? 20 : 15} />
    </span>
  );
}

function StageTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="stage-title">
      <h1>
        <span className="flourish" aria-hidden="true">
          ❧
        </span>
        {title}
        <span className="flourish mirror" aria-hidden="true">
          ❧
        </span>
      </h1>
      {desc && <p>{desc}</p>}
    </div>
  );
}

function GoldStat({ value, suffix = "" }: { value: ReactNode; suffix?: string }) {
  return (
    <span className="gold-stat">
      <GoldIcon size={18} />
      <b>{value}</b>
      {suffix && <i>{suffix}</i>}
    </span>
  );
}

function AlertGauge({ g, compact = false }: { g: GameState; compact?: boolean }) {
  const danger = g.alert >= ALERT_LIMIT - 1;
  return (
    <div className={`alert-gauge ${danger ? "danger" : ""} ${compact ? "compact" : ""}`}>
      <span className="alert-gauge-label">
        <LanternIcon size={18} />
        세관 경계
      </span>
      <strong>
        {g.alert} / {ALERT_LIMIT}
      </strong>
      <span className="alert-cells" aria-hidden="true">
        {Array.from({ length: ALERT_LIMIT }, (_, i) => (
          <i key={i} className={i < g.alert ? "on" : ""} />
        ))}
      </span>
      {!compact && <small>경계가 {ALERT_LIMIT}가 되면 세관 단속이 강화됩니다.</small>}
    </div>
  );
}

function GoodsChips({ items, size = 18 }: { items: Partial<Record<Commodity, number>>; size?: number }) {
  const entries = goodsEntries(items);
  if (entries.length === 0) return <span className="goods-empty">—</span>;
  return (
    <span className="goods-chips">
      {entries.map(({ commodity, qty }) => (
        <span key={commodity} className="goods-chip" title={`${COMMODITY_KO[commodity]} ${qty}`}>
          <CommodityIcon commodity={commodity} size={size} />
          <b>{qty}</b>
        </span>
      ))}
    </span>
  );
}

/* ═══════════ 게임 셸 ═══════════ */

function GameShell({
  g,
  phase,
  onLobby,
  onUtility,
  children,
}: {
  g: GameState;
  phase: Phase;
  onLobby: () => void;
  onUtility: (kind: Exclude<SheetKind, null>) => void;
  children: ReactNode;
}) {
  const activeStep = STEPS.findIndex((s) => (s.phases as readonly string[]).includes(phase));
  const isSetup = phase === "setup";
  const showMyPanel = !isSetup && phase !== "final";
  return (
    <div className={`app-screen game-screen phase-${phase}`}>
      <header className="topbar">
        <Brand compact />
        <nav className="topbar-nav" aria-label="게임 메뉴">
          <button type="button" className="top-btn" onClick={() => onUtility("rules")}>
            <ScrollIcon size={16} /> 규칙서
          </button>
          <button type="button" className="top-btn" onClick={() => onUtility("help")}>
            <CompassIcon size={16} /> 도움말
          </button>
          <button type="button" className="top-btn" onClick={() => onUtility("log")}>
            <EnvelopeIcon size={16} /> 기록
          </button>
          <button type="button" className="top-btn exit" onClick={onLobby}>
            나가기
          </button>
        </nav>
      </header>

      <div className="stepbar">
        <span className="round-chip">{isSetup ? "시작 준비" : `라운드 ${g.round} / 8`}</span>
        <nav className="steps" aria-label="라운드 진행 단계">
          {STEPS.map((step, i) => (
            <span
              key={step.key}
              className={`step ${i === activeStep ? "active" : ""} ${
                activeStep >= 0 && i < activeStep ? "done" : ""
              }`}
            >
              <i className="step-num">{i + 1}</i>
              <b>{step.label}</b>
            </span>
          ))}
        </nav>
      </div>

      <main className={`game-body ${showMyPanel ? "with-side" : "solo"}`}>
        {showMyPanel && <MyPanel g={g} />}
        <div className="stage">{children}</div>
      </main>
    </div>
  );
}

function MyPanel({ g }: { g: GameState }) {
  const me = g.players[HUMAN];
  const actives = me.contracts.filter((c) => c.status === "active");
  const reserve = me.contracts.find((c) => c.status === "reserve");
  const done = completedCount(me);
  return (
    <aside className="side-panel my-panel">
      <h2 className="panel-title">
        <AnchorIcon size={16} /> 나의 상단
      </h2>

      <div className="my-identity">
        <Portrait seat={HUMAN} size="lg" />
        <div>
          <strong>{me.name}</strong>
          <small>선장 레벨 {SEAT_LEVEL[HUMAN]}</small>
        </div>
      </div>

      <div className="panel-section">
        <span className="panel-label">보유 자원</span>
        <div className="resource-row">
          <span className="resource">
            <GoldIcon size={20} />
            <i>골드</i>
            <b>{me.gold}</b>
          </span>
          <span className="resource">
            <SuspicionIcon size={20} />
            <i>의심도</i>
            <b className={me.suspicion >= 3 ? "danger" : me.suspicion > 0 ? "warn" : ""}>{me.suspicion}</b>
          </span>
        </div>
        <div className="informant-line">
          <EyeIcon size={15} />
          <i>정보상</i>
          <b className={me.informantUsed ? "used" : "ok"}>{me.informantUsed ? "사용 완료" : "사용 가능"}</b>
        </div>
      </div>

      <div className="panel-section">
        <span className="panel-label">
          진행 중 계약 <em>{done} / 3 완료</em>
        </span>
        <div className="mini-contracts">
          {actives.map((c) => (
            <div key={c.uid} className="mini-contract">
              <b>{c.def.name}</b>
              <GoodsChips items={c.def.needs} size={15} />
              <span className="mini-reward">
                <GoldIcon size={13} /> {c.def.legalReward}
              </span>
            </div>
          ))}
          {actives.length === 0 && <p className="panel-hint">활성 계약이 없습니다.</p>}
        </div>
      </div>

      <div className="panel-section">
        <span className="panel-label">예비 계약 슬롯</span>
        {reserve ? (
          <div className="mini-contract reserve">
            <b>{reserve.def.name}</b>
            <GoodsChips items={reserve.def.needs} size={15} />
            <small>첫 계약 완료 시 활성화</small>
          </div>
        ) : (
          <div className="reserve-slot-empty">예비 계약 없음</div>
        )}
      </div>
    </aside>
  );
}

function PublicTable({ g }: { g: GameState }) {
  const order = rotationOrder(g.round >= 1 ? g.round : 1, g.priorityOffset);
  return (
    <aside className="side-panel public-table">
      <h2 className="panel-title">
        <ScaleIcon size={16} /> 공개 테이블 <em>4 / 4</em>
      </h2>
      <div className="pt-head">
        <span>상단</span>
        <span>골드</span>
        <span>공개 화물</span>
        <span>의심도</span>
        <span>순서</span>
      </div>
      {SEATS.map((seat) => {
        const p = g.players[seat];
        return (
          <div key={seat} className={`pt-row ${seat === HUMAN ? "me" : ""}`}>
            <span className="pt-name">
              <SeatBadge seat={seat} size="sm" />
              <b>{p.name}</b>
            </span>
            <span className="pt-gold">
              <GoldIcon size={15} />
              {p.gold}
            </span>
            <GoodsChips items={p.goods} size={15} />
            <span className={`pt-susp ${p.suspicion >= 3 ? "danger" : p.suspicion > 0 ? "warn" : ""}`}>
              {p.suspicion}
            </span>
            <span className="pt-order">{order.indexOf(seat) + 1}</span>
          </div>
        );
      })}
      <p className="panel-hint">※ 공개 화물은 모든 상단이 볼 수 있습니다.</p>
    </aside>
  );
}

/* ═══════════ 시작 준비 · 비밀 계약 선택 ═══════════ */

function SetupStage({ g, onDone }: { g: GameState; onDone: (uids: number[]) => void }) {
  const me = g.players[HUMAN];
  const [selected, setSelected] = useState<number[]>([]);
  const toggle = (uid: number) =>
    setSelected((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : prev.length < 2 ? [...prev, uid] : prev
    );

  function autoPick() {
    setSelected(aiChooseContracts(me));
  }

  return (
    <div className="stage-grid">
      <section className="stage-center">
        <div className="setup-tabs">
          <span className="setup-tab done">✓ 선장 선택</span>
          <span className="setup-tab active">✦ 비밀 계약 선택</span>
          <span className="setup-tab">초기 물자 확인</span>
        </div>

        <StageTitle
          title="비밀 계약 선택"
          desc="3장 중 2장을 활성 계약으로 선택하고, 1장은 예비 계약으로 둡니다."
        />

        <div className="contract-row">
          {me.contracts.map((c) => {
            const isSel = selected.includes(c.uid);
            return (
              <div key={c.uid} className="contract-col">
                <button
                  type="button"
                  className={`contract-card ${isSel ? "selected" : ""}`}
                  onClick={() => toggle(c.uid)}
                  aria-pressed={isSel}
                >
                  <span className="contract-emblem">
                    <CommodityIcon
                      commodity={goodsEntries(c.def.needs)[0]?.commodity ?? "SPICE"}
                      size={34}
                    />
                  </span>
                  <h3>{c.def.name}</h3>
                  <p>{CONTRACT_FLAVOR[c.def.name] ?? "은밀한 의뢰가 도착했습니다."}</p>
                  <div className="contract-box">
                    <span className="contract-box-label">필요 물자</span>
                    <div className="contract-needs">
                      {goodsEntries(c.def.needs).map(({ commodity, qty }) => (
                        <span key={commodity} className="need-item">
                          <CommodityIcon commodity={commodity} size={22} />
                          <i>{COMMODITY_KO[commodity]}</i>
                          <b>{qty}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="contract-box">
                    <span className="contract-box-label">계약 보상</span>
                    <div className="contract-reward">
                      <GoldIcon size={22} />
                      <b>{c.def.legalReward}</b>
                      <i>골드</i>
                    </div>
                  </div>
                  <span className="wax-seal" aria-hidden="true">
                    <AnchorIcon size={15} />
                  </span>
                </button>
                <span className={`contract-verdict ${isSel ? "active" : ""}`}>
                  {isSel ? "활성 계약 ✓" : "예비 계약 ◇"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="stage-actions">
          <button
            type="button"
            className="btn-gold lg"
            disabled={selected.length !== 2}
            onClick={() => onDone(selected)}
          >
            <AnchorIcon size={18} /> 선택 완료
          </button>
          <button type="button" className="btn-dark" onClick={autoPick}>
            <DiceIcon size={17} /> 자동 추천
          </button>
        </div>
        <p className="stage-footnote">ⓘ 계약은 라운드 진행 중 변경할 수 없습니다.</p>
      </section>

      <aside className="side-panel start-resources">
        <h2 className="panel-title center">시작 자원</h2>
        <div className="start-stat">
          <GoldIcon size={30} />
          <div>
            <i>골드</i>
            <b>{me.gold}</b>
          </div>
        </div>
        <div className="start-stat">
          <EyeIcon size={26} />
          <div>
            <i>정보상</i>
            <b>1 회</b>
          </div>
        </div>
        <div className="start-stat">
          <SuspicionIcon size={30} />
          <div>
            <i>의심도</i>
            <b>{me.suspicion}</b>
          </div>
        </div>
        <p className="panel-note">
          <AnchorIcon size={13} /> 정보상은 거래 정보를 입수하고, 의심도는 세관의 감시 수준을 나타냅니다.
        </p>
      </aside>
    </div>
  );
}

/* ═══════════ ① 소식·화물 ═══════════ */

function CargoCard({ cargo, label, showMin = false }: { cargo: CargoDef; label: "A" | "B"; showMin?: boolean }) {
  return (
    <div className={`cargo-card cargo-${label.toLowerCase()}`}>
      <span className="cargo-banner">
        <AnchorIcon size={12} /> 화물 {label}
      </span>
      <div className="crate">
        {goodsEntries(cargo.items).map(({ commodity, qty }) => (
          <span key={commodity} className="crate-cell">
            <CommodityIcon commodity={commodity} size={30} />
            <i>
              {COMMODITY_KO[commodity]} {qty}
            </i>
          </span>
        ))}
      </div>
      {showMin && (
        <span className="cargo-min">
          최소 입찰액 <b>{cargo.minBid}</b> 골드 <GoldIcon size={14} />
        </span>
      )}
    </div>
  );
}

function NewsStage({
  g,
  onInformant,
  onSkip,
  onFlow,
}: {
  g: GameState;
  onInformant: () => void;
  onSkip: () => void;
  onFlow: () => void;
}) {
  const me = g.players[HUMAN];
  const canInformant = !me.informantUsed && me.gold >= INFORMANT_COST;
  return (
    <div className="stage-grid">
      <section className="stage-center">
        <StageTitle title="항구 소식" />

        <div className="news-sheet">
          <div className="news-visual" aria-hidden="true">
            <LanternIcon size={40} />
          </div>
          <div className="news-body">
            <h3>{g.news.name}</h3>
            <p>항구에 새로운 소문이 돌고 있습니다.</p>
            <p className="news-effect">{g.news.desc}</p>
            <span className="wax-seal small" aria-hidden="true">
              <AnchorIcon size={12} />
            </span>
          </div>
        </div>

        <h2 className="section-heading">
          <i aria-hidden="true">❧</i> 이번 라운드 화물 <i className="mirror" aria-hidden="true">❧</i>
        </h2>
        <div className="cargo-pair">
          <CargoCard cargo={g.cargos[0]} label="A" />
          <CargoCard cargo={g.cargos[1]} label="B" />
        </div>

        <AlertGauge g={g} />

        <div className="stage-actions triple">
          <button type="button" className="btn-gold" onClick={onInformant} disabled={!canInformant}>
            <HandshakeIcon size={20} />
            <span>
              <b>정보상으로 이동</b>
              <small>{canInformant ? "정보를 구매합니다." : "이미 사용했습니다."}</small>
            </span>
          </button>
          <button type="button" className="btn-dark tall" onClick={onSkip}>
            <GavelIcon size={20} />
            <span>
              <b>경매 준비</b>
              <small>화물 경매를 준비합니다.</small>
            </span>
          </button>
          <button type="button" className="btn-dark tall" onClick={onFlow}>
            <CompassIcon size={20} />
            <span>
              <b>라운드 흐름 보기</b>
              <small>다음 단계를 확인합니다.</small>
            </span>
          </button>
        </div>
      </section>

      <PublicTable g={g} />
    </div>
  );
}

/* ═══════════ ② 정보상 ═══════════ */

function InformantStage({ g, onDone }: { g: GameState; onDone: (q: InformantQuery | null) => void }) {
  const me = g.players[HUMAN];
  const [target, setTarget] = useState<Seat | null>(null);
  const [commodity, setCommodity] = useState<Commodity | null>(null);
  const others = SEATS.filter((s) => s !== HUMAN);
  const canRun = !!target && !!commodity && !me.informantUsed && me.gold >= INFORMANT_COST;

  return (
    <div className="stage-grid">
      <section className="stage-center">
        <StageTitle title="정보상 조사" desc={`게임당 1회 · ${INFORMANT_COST}골드`} />

        <div className="informant-grid">
          <div className="informant-col">
            <span className="col-label">조사할 대상을 선택하세요.</span>
            <div className="target-grid">
              {others.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`target-card ${target === s ? "selected" : ""}`}
                  onClick={() => setTarget(s)}
                  aria-pressed={target === s}
                >
                  <Portrait seat={s} size="lg" />
                  <b>{g.players[s].name}</b>
                  <small>선장 레벨 {SEAT_LEVEL[s]}</small>
                  {target === s && <span className="pick-check">✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="informant-col query-col">
            <span className="col-label">현재 조사 질의</span>
            <div className="query-sheet">
              <EyeIcon size={22} className="query-eye" />
              {target && commodity ? (
                <p>
                  <b>{g.players[target].name}</b>의
                  <br />
                  활성 계약에
                  <br />
                  <em>{COMMODITY_KO[commodity]}</em>
                  {josa(COMMODITY_KO[commodity], "이", "가")} 필요합니까?
                </p>
              ) : (
                <p className="query-empty">
                  대상과 품목을
                  <br />
                  선택하세요.
                </p>
              )}
            </div>
            <div className="query-lock">
              <span className="lock-glyph" aria-hidden="true">
                🔒
              </span>
              <b>YES / NO</b>
              <small>결과는 조사 후 나만 확인</small>
            </div>
            <p className="col-footnote">
              <EyeIcon size={13} /> 정보상 사용 여부는 공개되지만, 조사 대상과 질문·응답은 사용한 사람만 확인합니다.
            </p>
          </div>

          <div className="informant-col">
            <span className="col-label">조사할 품목을 선택하세요.</span>
            <div className="commodity-grid">
              {COMMODITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`commodity-pick ${commodity === c ? "selected" : ""}`}
                  onClick={() => setCommodity(c)}
                  aria-pressed={commodity === c}
                >
                  <b>{COMMODITY_KO[c]}</b>
                  <CommodityIcon commodity={c} size={34} />
                  {commodity === c && <span className="pick-check">✓</span>}
                </button>
              ))}
            </div>
            <p className="col-footnote">? 활성 계약에 명시된 품목만 조사할 수 있습니다.</p>
          </div>
        </div>

        <div className="stage-actions">
          <button type="button" className="btn-gold" disabled={!canRun} onClick={() => onDone({ target: target!, commodity: commodity! })}>
            <span>
              <b>조사 실행</b>
              <small>{INFORMANT_COST}골드 소모</small>
            </span>
          </button>
          <button type="button" className="btn-dark tall" onClick={() => onDone(null)}>
            <span>
              <b>건너뛰기</b>
              <small>이번 라운드 조사하지 않기</small>
            </span>
          </button>
        </div>

        <AlertGauge g={g} compact />
      </section>

      <aside className="side-panel">
        <h2 className="panel-title center">현재 상태</h2>
        <div className="start-stat">
          <GoldIcon size={28} />
          <div>
            <i>보유 골드</i>
            <b>{me.gold}</b>
          </div>
        </div>
        <div className="memo-sheet">
          <b>기억하세요</b>
          <p>
            정보상 사용 여부는 공개되지만,
            <br />
            조사 대상과 질문·결과는 나만 확인합니다.
          </p>
          <span className="wax-seal small" aria-hidden="true">
            <AnchorIcon size={12} />
          </span>
        </div>
      </aside>
    </div>
  );
}

/* ═══════════ ③ 경매 ═══════════ */

function Stepper({
  value,
  min,
  max,
  onChange,
  disabled = false,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`stepper ${disabled ? "disabled" : ""}`}>
      <button
        type="button"
        aria-label="감소"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <b>{value}</b>
      <button
        type="button"
        aria-label="증가"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

function AuctionStage({ g, onDone }: { g: GameState; onDone: (bid: Bid) => void }) {
  const me = g.players[HUMAN];
  const [cargoA, cargoB] = g.cargos;
  const [onA, setOnA] = useState(true);
  const [onB, setOnB] = useState(true);
  const [valA, setValA] = useState(cargoA.minBid);
  const [valB, setValB] = useState(cargoB.minBid);
  const [pref, setPref] = useState<"A" | "B">("A");
  const answer = g.informantAnswers.find((a) => a.round === g.round);

  const total = (onA ? valA : 0) + (onB ? valB : 0);
  const over = total > me.gold;

  return (
    <div className="stage-grid">
      <section className="stage-center">
        <StageTitle title="화물 2개 동시 입찰" desc="두 화물에 동시에 비공개 입찰하세요." />

        {answer && (
          <div className="informant-answer">
            <EyeIcon size={17} />
            <span>
              정보상 응답 — <b>{g.players[answer.target].name}</b>의 활성 계약에{" "}
              <b>{COMMODITY_KO[answer.commodity]}</b> 필요 여부:
            </span>
            <b className={answer.answer ? "yes" : "no"}>{answer.answer ? "YES" : "NO"}</b>
          </div>
        )}

        <div className="cargo-pair">
          <CargoCard cargo={cargoA} label="A" showMin />
          <CargoCard cargo={cargoB} label="B" showMin />
        </div>

        <div className="bid-pair">
          {([
            ["A", cargoA, onA, setOnA, valA, setValA],
            ["B", cargoB, onB, setOnB, valB, setValB],
          ] as const).map(([label, cargo, on, setOn, val, setVal]) => (
            <div key={label} className={`bid-dial-frame ${on ? "" : "off"}`}>
              <span className="bid-dial-title">화물 {label} 입찰액</span>
              <Stepper value={val} min={cargo.minBid} max={me.gold} onChange={setVal} disabled={!on} />
              <small>(최소 {cargo.minBid} 골드)</small>
              <button type="button" className={`bid-toggle ${on ? "" : "active"}`} onClick={() => setOn(!on)}>
                {on ? "입찰 안 함" : "입찰 안 함 ✓ — 다시 입찰하기"}
              </button>
            </div>
          ))}
        </div>

        <div className="seal-row">
          <span className="seal-note">
            <EnvelopeIcon size={22} />
            입찰은 비공개로 진행됩니다. 제출 후에는 변경할 수 없습니다.
          </span>
          <button type="button" className="btn-gold lg" disabled={over} onClick={() => onDone({ a: onA ? valA : null, b: onB ? valB : null, pref })}>
            입찰 제출 <AnchorIcon size={18} />
          </button>
        </div>
        {over && <p className="stage-error">두 입찰액의 합({total})이 보유 골드({me.gold})를 초과합니다.</p>}
      </section>

      <aside className="side-panel">
        <h2 className="panel-title center">선호 화물</h2>
        <p className="panel-desc">하나의 화물만 선점할 수 있습니다.</p>
        <div className="pref-pair">
          {(["A", "B"] as const).map((label) => (
            <button
              key={label}
              type="button"
              className={`pref-card pref-${label.toLowerCase()} ${pref === label ? "selected" : ""}`}
              onClick={() => setPref(label)}
              aria-pressed={pref === label}
            >
              <b>{label}</b>
              <span>화물 {label} 선호</span>
              <i className="pref-dot" aria-hidden="true" />
            </button>
          ))}
        </div>

        <h2 className="panel-title center gap-top">입찰 예산</h2>
        <p className="panel-desc">두 입찰액의 합은 보유 골드 이하</p>
        <div className="budget-row">
          <span>보유 골드</span>
          <GoldStat value={me.gold} />
        </div>
        <div className={`budget-row ${over ? "over" : ""}`}>
          <span>
            <ScaleIcon size={15} /> 입찰 합계
          </span>
          <b>
            {total} / {me.gold}
          </b>
        </div>
      </aside>
    </div>
  );
}

function AuctionRevealStage({
  g,
  result,
  onNext,
}: {
  g: GameState;
  result: AuctionResult;
  onNext: () => void;
}) {
  const order = rotationOrder(g.round, g.priorityOffset);
  const [cargoA, cargoB] = g.cargos;

  const rank = (key: "a" | "b", minBid: number): Seat[] =>
    order
      .filter((s) => (result.bids[s][key] ?? 0) >= minBid)
      .sort((s1, s2) => {
        const d = (result.bids[s2][key] ?? 0) - (result.bids[s1][key] ?? 0);
        if (d !== 0) return d;
        return order.indexOf(s1) - order.indexOf(s2);
      });

  const winA = result.winners.find((w) => w.cargo === "A")!;
  const winB = result.winners.find((w) => w.cargo === "B")!;
  const rankA = rank("a", cargoA.minBid);
  const rankB = rank("b", cargoB.minBid);

  const logLines: string[] = [];
  const build = (label: "A" | "B", win: typeof winA, ranked: Seat[]) => {
    if (win.seat) {
      const transferred = ranked[0] !== win.seat;
      if (transferred) {
        logLines.push(
          `${g.players[ranked[0]]!.name}은 이미 다른 화물을 낙찰받아, 화물 ${label}는 차순위자에게 이관됩니다.`
        );
      }
      logLines.push(`${g.players[win.seat].name}이 화물 ${label}를 ${win.price}골드에 낙찰했습니다.`);
    } else if (ranked.length > 0) {
      logLines.push(`화물 ${label}는 이관할 차순위자가 없어 유찰되었습니다.`);
    } else {
      logLines.push(`화물 ${label}는 유효한 입찰이 없어 유찰되었습니다.`);
    }
  };
  build("A", winA, rankA);
  build("B", winB, rankB);

  const anyTransfer = (winA.seat && rankA[0] !== winA.seat) || (winB.seat && rankB[0] !== winB.seat);

  const renderCargo = (label: "A" | "B", cargo: CargoDef, win: typeof winA, ranked: Seat[], key: "a" | "b") => {
    const transferred = !!win.seat && ranked[0] !== win.seat;
    return (
      <div className="reveal-cargo">
        <div className="reveal-cargo-head">
          <span className="cargo-banner">
            <AnchorIcon size={12} /> 화물 {label}
          </span>
          <div className="reveal-verdict">
            {win.seat ? (
              transferred ? (
                <span className="verdict transfer">차순위 이관</span>
              ) : (
                <span className="verdict won">낙찰!</span>
              )
            ) : (
              <span className="verdict unsold">유찰</span>
            )}
            {win.seat && (
              <span className="verdict-who">
                <Portrait seat={win.seat} size="sm" />
                <b>{g.players[win.seat].name}</b>
                <i>{win.price} 골드</i>
              </span>
            )}
          </div>
          <div className="crate small">
            {goodsEntries(cargo.items).map(({ commodity, qty }) => (
              <span key={commodity} className="crate-cell">
                <CommodityIcon commodity={commodity} size={22} />
                <i>
                  {COMMODITY_KO[commodity]} {qty}
                </i>
              </span>
            ))}
          </div>
        </div>
        <div className="envelope-row">
          {SEATS.map((s) => {
            const bid = result.bids[s][key];
            const isWin = win.seat === s;
            return (
              <div key={s} className={`envelope ${isWin ? "win" : ""}`}>
                <small>{g.players[s].name}</small>
                <b>{bid ?? "—"}</b>
                <span className="wax-seal small" aria-hidden="true">
                  <AnchorIcon size={10} />
                </span>
              </div>
            );
          })}
        </div>
        <div className="reveal-footline">
          {ranked.length > 0 ? (
            transferred ? (
              <>
                차순위 낙찰: <b>{win.seat ? g.players[win.seat].name : "—"}</b>
                <GoldIcon size={14} /> {win.price} 골드
              </>
            ) : (
              <>
                최고 입찰가 <GoldIcon size={14} /> <b>{Math.max(...ranked.map((s) => result.bids[s][key] ?? 0))}</b> 골드
              </>
            )
          ) : (
            <>유효 입찰 없음 — 다음 라운드 수입 공급으로 이월</>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="stage-grid">
      <section className="stage-center">
        <StageTitle title="경매 결과 공개" desc="모든 선장의 입찰을 동시에 공개합니다." />
        <div className="reveal-pair">
          {renderCargo("A", cargoA, winA, rankA, "a")}
          {renderCargo("B", cargoB, winB, rankB, "b")}
        </div>

        {anyTransfer && (
          <div className="rule-note">
            <ScaleIcon size={20} />
            <div>
              <b>경매 규칙 효과</b>
              <p>동일 선장은 두 개의 화물을 동시에 낙찰받을 수 없습니다. 한 화물을 낙찰받으면 다른 화물은 차순위자에게 이관됩니다.</p>
            </div>
          </div>
        )}

        <div className="stage-actions">
          <button type="button" className="btn-gold lg" onClick={onNext}>
            다음 단계로 →
          </button>
        </div>
      </section>

      <aside className="side-panel">
        <h2 className="panel-title center">낙찰 결과 요약</h2>
        <div className="summary-head">
          <span>선장</span>
          <span>낙찰 화물</span>
          <span>지불</span>
          <span>보유 골드</span>
        </div>
        {SEATS.map((s) => {
          const won = result.winners.find((w) => w.seat === s);
          return (
            <div key={s} className="summary-row">
              <span className="pt-name">
                <Portrait seat={s} size="sm" />
                <b>{g.players[s].name}</b>
              </span>
              <span>{won ? `화물 ${won.cargo}` : "—"}</span>
              <span className={won ? "loss" : ""}>{won ? `-${won.price}` : "0"}</span>
              <span className="pt-gold">
                <GoldIcon size={14} />
                {g.players[s].gold}
              </span>
            </div>
          );
        })}

        <h2 className="panel-title center gap-top">경매 로그</h2>
        <div className="log-list">
          {logLines.map((line, i) => (
            <p key={i}>
              <AnchorIcon size={12} /> {line}
            </p>
          ))}
        </div>
      </aside>
    </div>
  );
}

/* ═══════════ ④ 시장 ═══════════ */

interface SlotState {
  type: "HOLD" | "BUY" | "SELL" | "BRIBE";
  commodity: Commodity;
  qty: number;
}

const SLOT_TABS: { key: SlotState["type"]; label: string }[] = [
  { key: "BUY", label: "구매" },
  { key: "SELL", label: "판매" },
  { key: "BRIBE", label: "뇌물" },
  { key: "HOLD", label: "패스" },
];

function MarketStage({ g, onDone }: { g: GameState; onDone: (orders: MarketOrder[]) => void }) {
  const me = g.players[HUMAN];
  const initial: SlotState[] = [
    { type: "HOLD", commodity: "SPICE", qty: 1 },
    { type: "HOLD", commodity: "SPICE", qty: 1 },
  ];
  const [slots, setSlots] = useState<SlotState[]>(initial);
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
  if (slots.filter((s) => s.type === "BRIBE").length > 1) errors.push("뇌물은 라운드당 한 번만 가능합니다.");
  const buyCost = slots
    .filter((s) => s.type === "BUY")
    .reduce((sum, s) => sum + s.qty * g.prices[s.commodity], 0);
  const bribeTotal = slots.some((s) => s.type === "BRIBE") ? bribeCost : 0;
  if (buyCost + bribeTotal > me.gold)
    errors.push(`구매 비용(${buyCost}) + 뇌물(${bribeTotal})이 보유 골드(${me.gold})를 초과합니다.`);
  for (const s of slots) {
    if (s.type === "BUY" && g.importCap[s.commodity] === 0)
      errors.push(`${COMMODITY_KO[s.commodity]}의 수입량이 0이므로 이번 라운드에는 구매할 수 없습니다.`);
    if (s.type === "SELL" && s.qty > me.goods[s.commodity])
      errors.push(`${COMMODITY_KO[s.commodity]} 보유량(${me.goods[s.commodity]})보다 많이 팔 수 없습니다.`);
  }

  const noImport = COMMODITIES.filter((c) => g.importCap[c] === 0);
  const update = (i: number, patch: Partial<SlotState>) =>
    setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const slotCost = (s: SlotState): ReactNode => {
    if (s.type === "BUY") return <>총 비용 <GoldIcon size={15} /> <b>{s.qty * g.prices[s.commodity]}</b></>;
    if (s.type === "SELL") return <>총 수익 <GoldIcon size={15} /> <b>+{s.qty * g.prices[s.commodity]}</b></>;
    if (s.type === "BRIBE") return <>총 비용 <GoldIcon size={15} /> <b>{bribeCost}</b></>;
    return <>행동 없음</>;
  };

  return (
    <div className="stage-grid">
      <section className="stage-center">
        <StageTitle title="시장" desc="시장은 수요와 공급에 따라 가격이 변동됩니다." />

        <div className="market-cards">
          {COMMODITIES.map((c) => (
            <div key={c} className="market-card">
              <b>{COMMODITY_KO[c]}</b>
              <CommodityIcon commodity={c} size={40} />
              <span className="price-chip">
                <GoldIcon size={15} /> {g.prices[c]}
              </span>
              <small className={g.importCap[c] === 0 ? "danger" : ""}>
                수입 {g.importCap[c]} · 수출 {g.exportCap[c]}
                {g.importCap[c] === 0 && (
                  <>
                    <br />
                    수입 불가
                  </>
                )}
              </small>
            </div>
          ))}
        </div>

        <h2 className="section-heading">
          <i aria-hidden="true">❧</i> 주문하기 <i className="mirror" aria-hidden="true">❧</i>
        </h2>
        <p className="section-sub">이번 라운드에 수행할 행동을 2개까지 선택하세요.</p>

        <div className="order-pair">
          {slots.map((s, i) => (
            <div key={i} className="order-slot">
              <div className="order-slot-head">
                <b>주문 {i + 1}</b>
                <button
                  type="button"
                  className="slot-reset"
                  aria-label={`주문 ${i + 1} 초기화`}
                  onClick={() => update(i, { type: "HOLD" })}
                >
                  ×
                </button>
              </div>
              <div className="order-tabs">
                {SLOT_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`order-tab ${s.type === tab.key ? "active" : ""}`}
                    onClick={() => update(i, { type: tab.key })}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {(s.type === "BUY" || s.type === "SELL") && (
                <div className="order-body">
                  <div className="order-commodities">
                    {COMMODITIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`order-commodity ${s.commodity === c ? "active" : ""}`}
                        onClick={() => update(i, { commodity: c })}
                        title={COMMODITY_KO[c]}
                      >
                        <CommodityIcon commodity={c} size={24} />
                      </button>
                    ))}
                  </div>
                  <div className="order-qty">
                    <span>
                      {COMMODITY_KO[s.commodity]} · 단가 <GoldIcon size={13} /> {g.prices[s.commodity]}
                    </span>
                    <Stepper value={s.qty} min={1} max={3} onChange={(v) => update(i, { qty: v })} />
                    <div className="qty-chips">
                      {[1, 2, 3].map((q) => (
                        <button
                          key={q}
                          type="button"
                          className={s.qty === q ? "active" : ""}
                          onClick={() => update(i, { qty: q })}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {s.type === "BRIBE" && (
                <div className="order-body bribe">
                  <p>
                    <b>뇌물</b> — 비용 <GoldIcon size={14} /> {bribeCost} · 효과 <em>의심도 −2</em>
                  </p>
                </div>
              )}

              {s.type === "HOLD" && (
                <div className="order-body hold">
                  <p>이번 주문은 사용하지 않습니다.</p>
                </div>
              )}

              <div className="order-cost">{slotCost(s)}</div>
            </div>
          ))}
        </div>

        {noImport.length > 0 && (
          <p className="market-warn">
            ⚠ {noImport.map((c) => COMMODITY_KO[c]).join(", ")}의 수입량이 0이므로 이번 라운드에는 구매할 수 없습니다.
          </p>
        )}
        {errors.map((e, i) => (
          <p key={i} className="stage-error">
            {e}
          </p>
        ))}

        <div className="stage-actions">
          <button type="button" className="btn-gold lg" disabled={errors.length > 0} onClick={() => onDone(orders)}>
            ✓ 주문 확정
          </button>
          <button type="button" className="btn-dark" onClick={() => setSlots(initial)}>
            ↺ 초기화
          </button>
        </div>
      </section>

      <PublicTable g={g} />
    </div>
  );
}

function MarketRevealStage({
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
    <div className="stage-grid">
      <section className="stage-center">
        <StageTitle title="시장 결과 공개" desc="모든 선장의 주문을 동시에 공개하고 체결합니다." />

        {fills.length === 0 ? (
          <p className="panel-hint center">이번 라운드에는 시장 주문이 없었습니다.</p>
        ) : (
          <div className="ledger">
            <div className="ledger-head">
              <span>선장</span>
              <span>주문</span>
              <span>요청</span>
              <span>체결</span>
            </div>
            {fills.map((f, i) => (
              <div key={i} className={`ledger-row ${f.filled < f.requested ? "short" : ""}`}>
                <span className="pt-name">
                  <Portrait seat={f.seat} size="sm" />
                  <b>{g.players[f.seat].name}</b>
                </span>
                <span className="ledger-order">
                  <CommodityIcon commodity={f.commodity} size={17} />
                  {COMMODITY_KO[f.commodity]} {f.side === "BUY" ? "구매" : "판매"}
                </span>
                <span>{f.requested}</span>
                <span>
                  {f.filled}
                  {f.filled < f.requested && <em> (한도 배분)</em>}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="stage-actions">
          <button type="button" className="btn-gold lg" onClick={onNext}>
            배송 단계로 →
          </button>
        </div>
      </section>

      <aside className="side-panel">
        <h2 className="panel-title center">{g.round >= 8 ? "최종 시장 가격" : "다음 라운드 가격 변화"}</h2>
        <div className="price-forecast">
          {COMMODITIES.map((c) => {
            const d = priceChanges[c] ?? 0;
            return (
              <div key={c} className="forecast-row">
                <span className="pt-name">
                  <CommodityIcon commodity={c} size={18} />
                  <b>{COMMODITY_KO[c]}</b>
                </span>
                <span className={`forecast-delta ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>
                  {d > 0 ? "↑" : d < 0 ? "↓" : "—"}
                </span>
                <b>{g.prices[c]}</b>
                <small>{d > 0 ? "수요 증가" : d < 0 ? "공급 증가" : "변동 없음"}</small>
              </div>
            );
          })}
        </div>
        <p className="panel-hint">
          {g.round >= 8
            ? "※ 이 가격이 남은 상품의 잔존 가치 계산에 사용됩니다."
            : "※ 가격은 다음 라운드 '시장' 단계에서 적용됩니다."}
        </p>
      </aside>
    </div>
  );
}

/* ═══════════ ⑤ 배송 ═══════════ */

function DeliveryStage({ g, onDone }: { g: GameState; onDone: (c: DeliveryChoice | null) => void }) {
  const me = g.players[HUMAN];
  const actives = me.contracts.filter((c) => c.status === "active");
  const deliverable = actives.filter((c) => canDeliver(g, me, c.uid));
  const [pickUid, setPickUid] = useState<number | null>(deliverable[0]?.uid ?? null);
  const pick: ContractInstance | null = actives.find((c) => c.uid === pickUid) ?? null;
  const alertGain = g.news.id === "crackdown" ? 2 : 1;
  const canGo = pick !== null && canDeliver(g, me, pick.uid);

  return (
    <div className="stage-grid">
      <section className="stage-center">
        <StageTitle
          title="계약 배송"
          desc="계약을 이행하고 보상을 받으십시오. 또는 더 큰 이익을 위해 위험을 감수할 수도 있습니다."
        />

        {actives.length > 1 && (
          <div className="delivery-picker">
            {actives.map((c) => (
              <button
                key={c.uid}
                type="button"
                className={`picker-chip ${pickUid === c.uid ? "active" : ""}`}
                disabled={!canDeliver(g, me, c.uid)}
                onClick={() => setPickUid(c.uid)}
              >
                {c.def.name}
                {!canDeliver(g, me, c.uid) && " (물자 부족)"}
              </button>
            ))}
          </div>
        )}

        {pick ? (
          <>
            <div className="delivery-sheet">
              <span className="cargo-banner dark">
                <AnchorIcon size={12} /> {pick.def.name}
              </span>
              <span className="delivery-sheet-label">요구 화물</span>
              <div className="delivery-needs">
                {goodsEntries(pick.def.needs).map(({ commodity, qty }) => (
                  <span key={commodity} className="need-item">
                    <CommodityIcon commodity={commodity} size={24} />
                    <i>
                      {COMMODITY_KO[commodity]} {qty}
                    </i>
                  </span>
                ))}
              </div>
              <span className="delivery-sheet-label">보상</span>
              <div className="contract-reward">
                <GoldIcon size={20} />
                <b>{pick.def.legalReward}</b>
                <i>골드</i>
              </div>
              <span className="wax-seal" aria-hidden="true">
                <AnchorIcon size={14} />
              </span>
            </div>

            <div className="stock-check">
              <span className="delivery-sheet-label">보유 화물</span>
              {goodsEntries(pick.def.needs).map(({ commodity, qty }) => {
                const ok = me.goods[commodity] >= qty;
                return (
                  <span key={commodity} className={`stock-item ${ok ? "ok" : "lack"}`}>
                    <CommodityIcon commodity={commodity} size={18} />
                    {COMMODITY_KO[commodity]} 보유 {me.goods[commodity]}
                    <b>{ok ? "✓" : "✗"}</b>
                  </span>
                );
              })}
            </div>

            <div className="delivery-pair">
              <div className="delivery-option legal">
                <h3>
                  <ScaleIcon size={20} /> 합법 배송
                </h3>
                <p>세관의 검사를 거쳐 안전하게 배송합니다.</p>
                <p className="option-line safe">안전한 항로로 계약을 이행합니다.</p>
                <div className="option-reward">
                  <span className="delivery-sheet-label">보상</span>
                  <GoldStat value={`${pick.def.legalReward}골드`} />
                </div>
                <button
                  type="button"
                  className="btn-legal"
                  disabled={!canGo}
                  onClick={() => onDone({ contractUid: pick.uid, method: "legal" })}
                >
                  합법 배송 실행
                </button>
              </div>

              <div className="delivery-option smuggle">
                <h3>
                  <SwordsIcon size={20} /> 밀수 배송
                </h3>
                <p>세관을 피해 은밀한 항로로 배송합니다.</p>
                <p className="option-line risky">위험은 크지만, 더 큰 이익이 기다립니다.</p>
                <div className="option-reward split">
                  <span>
                    <i>보상</i>
                    <b className="gain">
                      {pick.def.smuggleReward}골드
                      <em className="reward-diff">(+{pick.def.smuggleReward - pick.def.legalReward})</em>
                    </b>
                  </span>
                  <span>
                    <i>의심도</i>
                    <b className="risk">+2</b>
                  </span>
                  <span>
                    <i>세관 경계</i>
                    <b className="risk">+{alertGain}</b>
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-smuggle"
                  disabled={!canGo}
                  onClick={() => onDone({ contractUid: pick.uid, method: "smuggle" })}
                >
                  밀수 배송 실행
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="panel-hint center">이번 라운드에 배송 가능한 계약이 없습니다. 물자를 더 모아 보세요.</p>
        )}

        <div className="stage-actions">
          <button type="button" className="btn-dark" onClick={() => onDone(null)}>
            이번 라운드 배송하지 않기
          </button>
        </div>
        <p className="stage-footnote">
          <AnchorIcon size={13} /> 선택은 되돌릴 수 없습니다. 신중히 결정하십시오.
        </p>
      </section>

      <aside className="side-panel">
        <h2 className="panel-title center">상태 변화 미리보기</h2>
        <p className="panel-desc">선택에 따른 변경 사항을 확인하세요.</p>

        <div className="preview-block now">
          <b className="preview-head">현재 상태</b>
          <div className="preview-row">
            <span>
              <GoldIcon size={15} /> 골드
            </span>
            <b>{me.gold}</b>
          </div>
          <div className="preview-row">
            <span>
              <SuspicionIcon size={15} /> 의심도
            </span>
            <b>{me.suspicion}</b>
          </div>
          <div className="preview-row">
            <span>
              <LanternIcon size={15} /> 세관 경계
            </span>
            <b>
              {g.alert} / {ALERT_LIMIT}
            </b>
          </div>
        </div>

        {pick && (
          <>
            <div className="preview-block legal">
              <b className="preview-head">합법 배송 시</b>
              <div className="preview-row">
                <span>골드</span>
                <b>
                  {me.gold + pick.def.legalReward} <em className="gain">(+{pick.def.legalReward})</em>
                </b>
              </div>
              <div className="preview-row">
                <span>의심도</span>
                <b>
                  {me.suspicion} <em>(변화 없음)</em>
                </b>
              </div>
              <div className="preview-row">
                <span>세관 경계</span>
                <b>
                  {g.alert} / {ALERT_LIMIT} <em>(변화 없음)</em>
                </b>
              </div>
            </div>

            <div className="preview-block smuggle">
              <b className="preview-head">밀수 배송 시</b>
              <div className="preview-row">
                <span>골드</span>
                <b>
                  {me.gold + pick.def.smuggleReward} <em className="gain">(+{pick.def.smuggleReward})</em>
                </b>
              </div>
              <div className="preview-row">
                <span>의심도</span>
                <b>
                  {me.suspicion + 2} <em className="risk">(+2)</em>
                </b>
              </div>
              <div className="preview-row">
                <span>세관 경계</span>
                <b>
                  {Math.min(ALERT_LIMIT, g.alert + alertGain)} / {ALERT_LIMIT}{" "}
                  <em className="risk">(+{alertGain})</em>
                </b>
              </div>
              {g.alert + alertGain >= ALERT_LIMIT && (
                <p className="preview-warn">⚠ 세관 경계가 최대치에 도달합니다. 세관 단계에서 단속 위험이 커집니다.</p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/* ═══════════ ⑥ 세관 ═══════════ */

function CustomsStage({ g, events, onNext }: { g: GameState; events: CustomsEvent[]; onNext: () => void }) {
  const caught = events.filter((ev) => ev.target !== null);
  const suspicionRank = [...SEATS].sort((a, b) => g.players[b].suspicion - g.players[a].suspicion);

  return (
    <div className="stage-grid">
      <section className="stage-center">
        {caught.length > 0 ? (
          <>
            <div className="customs-alarm">
              <h1>
                <AnchorIcon size={22} /> 세관 단속 발생 <AnchorIcon size={22} />
              </h1>
              <p>경계가 최고조에 달했습니다. 세관이 항구를 샅샅이 뒤지고 있습니다.</p>
            </div>

            {caught.map((ev, i) => (
              <div key={i} className="customs-case">
                <div className="customs-brief">
                  <div className="customs-visual" aria-hidden="true">
                    <LanternIcon size={42} />
                  </div>
                  <div className="customs-rule">
                    <b>{ev.kind === "final" ? "최종 세관 조사 규칙" : "세관 조사 규칙"}</b>
                    <p>의심도 1위가 조사 대상</p>
                    <p className="formula">벌점 = 2 + 의심도 × 2</p>
                  </div>
                </div>
                <div className="customs-boxes">
                  <div className="customs-box">
                    <span className="delivery-sheet-label">조사 대상</span>
                    <Portrait seat={ev.target!} size="md" />
                    <b>{g.players[ev.target!].name}</b>
                    <small>의심도 {ev.suspicionAtCheck}</small>
                  </div>
                  <div className="customs-box">
                    <span className="delivery-sheet-label">벌점 계산</span>
                    <p className="formula big">
                      2 + ( {ev.suspicionAtCheck} × 2 ) = <em>{ev.penalty}</em>
                    </p>
                    <span className="penalty-stamp">{ev.penalty}점 벌점 부과</span>
                  </div>
                  <div className="customs-box">
                    <span className="delivery-sheet-label">조사 후 의심도 초기화</span>
                    <b>{g.players[ev.target!].name}</b>
                    <p className="formula">
                      의심도 {ev.suspicionAtCheck} → <em className="good">0</em>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <StageTitle
              title="세관 정산"
              desc={
                g.alert >= ALERT_LIMIT
                  ? "의심도 1 이상인 상단이 없어 조사가 발생하지 않았습니다. 경계는 유지됩니다."
                  : "이번 라운드에는 세관 조사가 발생하지 않았습니다."
              }
            />
            <AlertGauge g={g} />
          </>
        )}

        <div className="ledger round-summary">
          <div className="ledger-head">
            <span>선장</span>
            <span>골드</span>
            <span>의심도</span>
            <span>벌점</span>
            <span>완료 계약</span>
          </div>
          {SEATS.map((s) => {
            const p = g.players[s];
            return (
              <div key={s} className="ledger-row">
                <span className="pt-name">
                  <Portrait seat={s} size="sm" />
                  <b>{p.name}</b>
                </span>
                <span>
                  <GoldIcon size={14} /> {p.gold}
                </span>
                <span className={p.suspicion >= 3 ? "danger" : ""}>{p.suspicion}</span>
                <span className={p.penalty > 0 ? "danger" : ""}>{p.penalty > 0 ? `-${p.penalty}` : "0"}</span>
                <span>{completedCount(p)} / 3</span>
              </div>
            );
          })}
        </div>

        <div className="stage-actions">
          <button type="button" className="btn-gold lg" onClick={onNext}>
            {g.round >= 8 ? "최종 정산 보기" : "확인"}
          </button>
        </div>
        {caught.length > 0 && (
          <p className="stage-footnote">세관의 단속은 계속됩니다. 의심도를 관리하여 다음 단속에 대비하십시오.</p>
        )}
      </section>

      <aside className="side-panel">
        <h2 className="panel-title center">의심도 순위</h2>
        <p className="panel-desc">의심도가 높은 순으로 정렬됩니다.</p>
        <div className="susp-rank">
          {suspicionRank.map((s, i) => (
            <div key={s} className={`susp-row ${i === 0 && g.players[s].suspicion > 0 ? "top" : ""}`}>
              <i className="rank-num">{i + 1}</i>
              <Portrait seat={s} size="sm" />
              <b>{g.players[s].name}</b>
              <span className={g.players[s].suspicion >= 3 ? "danger" : ""}>{g.players[s].suspicion}</span>
            </div>
          ))}
        </div>
        <AlertGauge g={g} compact />
      </aside>
    </div>
  );
}

/* ═══════════ 최종 정산 ═══════════ */

function FinalStage({ g, onReplay, onLobby }: { g: GameState; onReplay: () => void; onLobby: () => void }) {
  const ranks = ranking(g);
  const winner = g.players[ranks[0]];
  return (
    <div className="stage-grid final-grid">
      <section className="stage-center">
        <StageTitle title="최종 정산" desc="점수 = 골드 + 남은 상품의 잔존 가치 − 세관 벌점" />

        <div className="final-board">
          {ranks.map((s, i) => {
            const p = g.players[s];
            const residual = COMMODITIES.reduce(
              (sum, c) => sum + p.goods[c] * residualValueAtPrice(g.prices[c]),
              0,
            );
            return (
              <div key={s} className={`final-row ${i === 0 ? "winner" : ""}`}>
                <span className={`final-rank rank-${i + 1}`}>{i + 1}</span>
                <span className="pt-name">
                  <Portrait seat={s} size="md" />
                  <span className="final-name">
                    <b>{p.name}</b>
                    <small>선장 레벨 {SEAT_LEVEL[s]}</small>
                  </span>
                </span>
                <span className="final-cell">
                  <GoldIcon size={16} /> {p.gold}
                </span>
                <span className="final-cell">
                  <ScrollIcon size={16} /> {residual}
                </span>
                <span className="final-cell penalty">
                  <AnchorIcon size={14} /> {p.penalty > 0 ? `-${p.penalty}` : "0"}
                </span>
                <span className="final-score">
                  <b>{finalScore(p, g.prices)}</b>
                  {i === 0 && <small>최종 승리</small>}
                </span>
              </div>
            );
          })}
        </div>

        <div className="final-footer">
          <div className="final-note">
            <SwordsIcon size={22} />
            <div>
              <b>8라운드 종료</b>
              <p>치열한 거래와 선택의 항해였습니다. 모든 선장님 수고하셨습니다!</p>
            </div>
          </div>
          <div className="stage-actions">
            <button type="button" className="btn-gold lg" onClick={onReplay}>
              ↻ 다시 플레이
            </button>
            <button type="button" className="btn-dark" onClick={onLobby}>
              ⌂ 로비로
            </button>
          </div>
          <div className="final-note">
            <LanternIcon size={22} />
            <div>
              <b>최종 요약</b>
              <p>
                {winner.name} 선장님의 탁월한 전략과 결단이 항구의 주인이 되게 하였습니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      <aside className="side-panel">
        <h2 className="panel-title center">최종 시장 가격·잔존 가치</h2>
        <div className="residual-list">
          {COMMODITIES.map((c) => (
            <div key={c} className="residual-row">
              <CommodityIcon commodity={c} size={24} />
              <b>{COMMODITY_KO[c]}</b>
              <span>
                시장 {g.prices[c]} → {residualValueAtPrice(g.prices[c])} <GoldIcon size={14} />
              </span>
            </div>
          ))}
        </div>
        <p className="panel-hint">최종 시장 가격의 절반(소수점 버림)이 잔존 가치로 반영됩니다.</p>
      </aside>
    </div>
  );
}

/* ═══════════ 로비 · 대기실 ═══════════ */

function LobbyScreen({
  playerName,
  onPlayerNameChange,
  onOpenRoom,
  onUtility,
}: {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  onOpenRoom: (mode: RoomMode, code?: string) => void;
  onUtility: (kind: Exclude<SheetKind, null>) => void;
}) {
  const [roomCode, setRoomCode] = useState("");
  const [codeError, setCodeError] = useState("");

  function joinByCode() {
    if (roomCode.trim().length < 3) {
      setCodeError("방 코드를 세 글자 이상 입력하세요.");
      return;
    }
    setCodeError("");
    onOpenRoom("join", roomCode.trim().toUpperCase());
  }

  return (
    <div className="app-screen lobby-screen">
      <header className="topbar">
        <Brand />
        <nav className="topbar-nav" aria-label="서비스 메뉴">
          <button type="button" className="top-btn" onClick={() => onUtility("settings")}>
            설정
          </button>
          <button type="button" className="top-btn" onClick={() => onUtility("help")}>
            도움말
          </button>
          <button type="button" className="top-btn" onClick={() => onUtility("rules")}>
            <ScrollIcon size={16} /> 규칙서
          </button>
        </nav>
      </header>

      <main className="lobby-main">
        <section className="entry-frame">
          <span className="entry-kicker">BLACK HARBOR · NIGHT TIDE</span>
          <h1>항구에 입장</h1>
          <p className="entry-sub">밀무역의 밤이 시작됩니다.</p>
          <div className="ornament-line" aria-hidden="true">
            <span />
            <AnchorIcon size={16} />
            <span />
          </div>

          <label className="field-label" htmlFor="captain-name">
            선장 이름
          </label>
          <input
            id="captain-name"
            className="field-input"
            value={playerName}
            maxLength={16}
            onChange={(event) => onPlayerNameChange(event.target.value)}
            placeholder="선장 이름을 입력하세요"
          />

          <label className="field-label" htmlFor="room-code">
            방 코드 <span>(선택)</span>
          </label>
          <input
            id="room-code"
            className="field-input"
            value={roomCode}
            onChange={(event) => {
              setRoomCode(event.target.value);
              setCodeError("");
            }}
            placeholder="방 코드를 입력하세요"
            maxLength={12}
          />
          {codeError && <p className="stage-error">{codeError}</p>}

          <div className="entry-actions">
            <button type="button" className="btn-gold" onClick={() => onOpenRoom("practice")}>
              ϟ 빠른 입장
            </button>
            <button type="button" className="btn-dark" onClick={() => onOpenRoom("create")}>
              ＋ 방 만들기
            </button>
            <button type="button" className="btn-dark" onClick={joinByCode}>
              <AnchorIcon size={15} /> 코드로 입장
            </button>
          </div>

          <div className="entry-meta">
            <span>4인 고정</span>
            <span>25–35분</span>
            <span>웹 브라우저 플레이</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function RoomScreen({
  g,
  roomName,
  roomMode,
  playerName,
  onBack,
  onStart,
  onUtility,
}: {
  g: GameState;
  roomName: string;
  roomMode: RoomMode;
  playerName: string;
  onBack: () => void;
  onStart: () => void;
  onUtility: (kind: Exclude<SheetKind, null>) => void;
}) {
  const modeLabel = roomMode === "create" ? "내가 연 항구" : roomMode === "join" ? "초대받은 항구" : "연습 항해";
  return (
    <div className="app-screen room-screen">
      <header className="topbar">
        <button type="button" className="top-btn" onClick={onBack}>
          ‹ 항구로 돌아가기
        </button>
        <Brand compact />
        <nav className="topbar-nav" aria-label="대기실 메뉴">
          <button type="button" className="top-btn" onClick={() => onUtility("help")}>
            도움말
          </button>
          <button type="button" className="top-btn" onClick={() => onUtility("rules")}>
            <ScrollIcon size={16} /> 규칙서
          </button>
        </nav>
      </header>

      <main className="room-main">
        <section className="room-intro">
          <span className="entry-kicker">{modeLabel} · PRIVATE HARBOR</span>
          <h1>항해 준비</h1>
          <p>네 명의 상단이 선석을 채우면 검은 항구의 첫 소식이 공개됩니다.</p>
          <span className="room-name-label">현재 항구 · {roomName}</span>
          <div className="room-code-block">
            <span>방 코드</span>
            <strong>BH-0417</strong>
            <button
              type="button"
              className="copy-button"
              onClick={() => void navigator.clipboard?.writeText("BH-0417")}
            >
              복사
            </button>
          </div>
          <div className="room-rules">
            <span>
              <b>4</b>인 고정
            </span>
            <span>
              <b>8</b>라운드
            </span>
            <span>
              <b>25–35</b>분
            </span>
          </div>
        </section>

        <section className="berth-frame">
          <h2 className="panel-title">
            <AnchorIcon size={16} /> 현재 승선자 <em>4 / 4 준비 완료</em>
          </h2>
          <div className="berth-grid">
            {SEATS.map((seat) => {
              const isHuman = seat === HUMAN;
              const p = g.players[seat];
              return (
                <article key={seat} className={`berth-seat ${isHuman ? "human" : ""}`}>
                  <SeatBadge seat={seat} />
                  <Portrait seat={seat} size="md" />
                  <span className="berth-copy">
                    <strong>{isHuman ? playerName || "검은해적" : p.name}</strong>
                    <small>{isHuman ? "나 · 출항 준비 완료" : "AI 상단 · 준비 완료"}</small>
                  </span>
                  <span className="ready-mark" aria-label="준비 완료">
                    ✓
                  </span>
                </article>
              );
            })}
          </div>
          <div className="berth-footer">
            <p>AI 상단 3명이 자리를 지키고 있습니다.</p>
            <button type="button" className="btn-gold lg" onClick={onStart}>
              연습 항해 시작 <AnchorIcon size={16} />
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ═══════════ 유틸리티 시트 ═══════════ */

function UtilitySheet({ kind, g, onClose }: { kind: Exclude<SheetKind, null>; g: GameState; onClose: () => void }) {
  const titles: Record<Exclude<SheetKind, null>, string> = {
    settings: "항구 설정",
    help: "라운드 흐름",
    rules: "검은 항구 규칙서",
    log: "항구 기록",
  };
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <aside className="utility-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-heading">
          <div>
            <span className="entry-kicker">BLACK HARBOR</span>
            <h2>{titles[kind]}</h2>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        {kind === "settings" && (
          <div className="sheet-body">
            <div className="sheet-setting">
              <span>플레이 모드</span>
              <strong>브라우저 데모</strong>
            </div>
            <div className="sheet-setting">
              <span>규칙 버전</span>
              <strong>{RULE_VERSION}</strong>
            </div>
            <p className="panel-hint">실시간 방 설정과 사운드는 온라인 항구가 연결되면 활성화됩니다.</p>
          </div>
        )}
        {kind === "help" && (
          <div className="sheet-body">
            <p className="sheet-lead">한 라운드는 여섯 단계로 진행됩니다.</p>
            <div className="help-list">
              {STEPS.map((s, i) => (
                <p key={s.key}>
                  <b>{i + 1}</b>
                  {s.label} —{" "}
                  {[
                    "항구 소식과 이번 라운드 화물을 확인합니다.",
                    "정보상을 고용해 상대의 계약을 조사합니다. (게임당 1회)",
                    "화물 2개에 동시에 비공개 입찰합니다.",
                    "구매·판매·뇌물 주문 두 개를 잠급니다.",
                    "계약을 합법 배송하거나 밀수합니다.",
                    "세관 경계가 가득 차면 의심도 1위가 조사받습니다.",
                  ][i]}
                </p>
              ))}
            </div>
          </div>
        )}
        {kind === "rules" && (
          <div className="sheet-body">
            <p className="sheet-lead">네 상단이 8라운드 동안 경매·시장·밀수의 균형을 겨룹니다.</p>
            <div className="help-list">
              <p>
                <b>승리</b>최종 점수 = 골드 + 잔존 상품 × (최종 시장 가격 ÷ 2, 버림) − 세관 벌점
              </p>
              <p>
                <b>경매</b>동일 선장은 두 화물을 동시에 낙찰받을 수 없습니다.
              </p>
              <p>
                <b>시장</b>체결량 차이가 다음 라운드 가격을 만듭니다. (한도 초과 시 비례 배분)
              </p>
              <p>
                <b>밀수</b>보상 +4골드, 의심도 +2, 세관 경계 +1. 경계 {ALERT_LIMIT} 도달 시 의심도 1위 조사.
              </p>
            </div>
          </div>
        )}
        {kind === "log" && (
          <div className="sheet-body sheet-log">
            {g.log.length === 0 ? (
              <p className="panel-hint">아직 기록된 항해가 없습니다.</p>
            ) : (
              g.log.slice(-30).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
