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
import { INFORMANT_COST, RESIDUAL_VALUE, RULE_VERSION, makeRng } from "./game/data";
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

type Screen = "lobby" | "room" | "game";
type RoomMode = "practice" | "create" | "join";
type SheetKind = "settings" | "help" | "rules" | "log" | null;

const HUMAN: Seat = "A";

const PHASE_STEPS = [
  { label: "계약 준비", phases: ["setup"] },
  { label: "항구 소식", phases: ["news"] },
  { label: "봉인 경매", phases: ["auction", "auctionResult"] },
  { label: "시장 거래", phases: ["market", "marketResult"] },
  { label: "계약 배송", phases: ["delivery"] },
  { label: "세관 정산", phases: ["roundResult", "final"] },
] as const;

const PHASE_META: Record<Phase, { eyebrow: string; title: string; prompt: string }> = {
  setup: {
    eyebrow: "첫 항해를 준비합니다",
    title: "비밀 계약을 고르세요",
    prompt: "세 장 중 두 장만 활성화됩니다. 나머지 한 장은 예비 계약으로 남습니다.",
  },
  news: {
    eyebrow: "공용 항구 정보",
    title: "오늘 밤의 항구 소식",
    prompt: "소식과 화물을 읽고, 정보상을 쓸지 결정합니다.",
  },
  auction: {
    eyebrow: "모두의 입찰이 아직 봉인되어 있습니다",
    title: "두 화물을 선점하세요",
    prompt: "두 화물에 동시에 입찰하고, 하나를 선호 화물로 지정합니다.",
  },
  auctionResult: {
    eyebrow: "봉인이 풀렸습니다",
    title: "경매 결과 공개",
    prompt: "누가 화물을 가져갔는지 확인하고 시장으로 이동합니다.",
  },
  market: {
    eyebrow: "플레이어가 만드는 가격",
    title: "시장 계획을 잠그세요",
    prompt: "두 주문 슬롯에 구매·판매·뇌물을 배치합니다.",
  },
  marketResult: {
    eyebrow: "시장 장부가 닫혔습니다",
    title: "시장 결과 공개",
    prompt: "체결량과 다음 라운드 가격 변화를 확인합니다.",
  },
  delivery: {
    eyebrow: "계약은 아직 비밀입니다",
    title: "이번 라운드의 계약을 배송하세요",
    prompt: "안전한 합법 배송과 위험한 밀수 중 하나를 선택합니다.",
  },
  roundResult: {
    eyebrow: "한 라운드가 끝났습니다",
    title: "세관 정산",
    prompt: "조사 결과와 상단별 변화를 확인한 뒤 다음 라운드로 이동합니다.",
  },
  final: {
    eyebrow: "여덟 번의 밤이 지났습니다",
    title: "최종 점수",
    prompt: "가장 많은 자산을 남긴 상단이 검은 항구를 차지합니다.",
  },
};

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
  const [screen, setScreen] = useState<Screen>("lobby");
  const [roomMode, setRoomMode] = useState<RoomMode>("practice");
  const [roomName, setRoomName] = useState("야간 항구 #17");
  const [playerName, setPlayerName] = useState("선장 레벨 17");
  const [utility, setUtility] = useState<SheetKind>(null);

  function resetGame() {
    const nextSeed = Math.floor(Math.random() * 1e9);
    gameRef.current = createGame(nextSeed);
    rngRef.current = makeRng(nextSeed ^ 0x9e3779b9);
    gameRef.current.players[HUMAN].name = playerName.trim() || "항구의 손님";
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
      <GameShell
        g={g}
        phase={phase}
        roomName={roomName}
        onLobby={goLobby}
        onUtility={setUtility}
      >
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
      </GameShell>
      {utilitySheet}
    </>
  );
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`}>
      <span className="brand-symbol" aria-hidden="true">
        ⚓︎
      </span>
      <span className="brand-copy">
        <strong>검은 항구</strong>
        <small>밀무역과 경계의 바다</small>
      </span>
    </div>
  );
}

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
      <header className="site-header lobby-header">
        <BrandLockup />
        <nav className="utility-nav" aria-label="서비스 메뉴">
          <button type="button" className="utility-button" onClick={() => onUtility("settings")}>
            <span aria-hidden="true">◈</span> 설정
          </button>
          <button type="button" className="utility-button" onClick={() => onUtility("help")}>
            <span aria-hidden="true">?</span> 도움말
          </button>
          <button type="button" className="utility-button" onClick={() => onUtility("rules")}>
            <span aria-hidden="true">▤</span> 규칙서
          </button>
        </nav>
      </header>

      <main className="lobby-main">
        <section className="entry-card framed-card">
          <div className="card-kicker">BLACK HARBOR · NIGHT TIDE</div>
          <h1>항구에 입장</h1>
          <p className="entry-subtitle">밀무역의 밤이 시작됩니다.</p>
          <div className="ornament-line" aria-hidden="true">
            <span />⚓︎<span />
          </div>

          <label className="field-label" htmlFor="captain-name">
            선장 이름
          </label>
          <div className="input-wrap">
            <input
              id="captain-name"
              value={playerName}
              maxLength={16}
              onChange={(event) => onPlayerNameChange(event.target.value)}
              placeholder="선장 이름을 입력하세요"
            />
            <span aria-hidden="true">◉</span>
          </div>

          <label className="field-label" htmlFor="room-code">
            방 코드 <span>(선택)</span>
          </label>
          <div className="input-wrap">
            <input
              id="room-code"
              value={roomCode}
              onChange={(event) => {
                setRoomCode(event.target.value);
                setCodeError("");
              }}
              placeholder="방 코드를 입력하세요"
              maxLength={12}
            />
            <span aria-hidden="true">⌘</span>
          </div>
          {codeError && <p className="form-error">{codeError}</p>}

          <div className="entry-actions">
            <button type="button" className="entry-action accent" onClick={() => onOpenRoom("practice")}>
              <span aria-hidden="true">ϟ</span> 빠른 입장
            </button>
            <button type="button" className="entry-action" onClick={() => onOpenRoom("create")}>
              <span aria-hidden="true">＋</span> 방 만들기
            </button>
            <button type="button" className="entry-action gold" onClick={joinByCode}>
              <span aria-hidden="true">⚓︎</span> 코드로 입장
            </button>
          </div>

          <button type="button" className="watch-link" onClick={() => onOpenRoom("practice")}>
            관전 모드 <span aria-hidden="true">›</span>
          </button>

          <div className="entry-meta">
            <span>♟ 4인 고정</span>
            <span>◷ 25–35분</span>
            <span>▣ 웹 브라우저 플레이</span>
          </div>
        </section>

        <aside className="waiting-card framed-card">
          <div className="waiting-heading">
            <div>
              <span className="card-kicker">HARBOR WATCH</span>
              <h2>현재 대기방</h2>
            </div>
            <span className="participant-count">♟ 2 / 4 참가 중</span>
          </div>

          <button type="button" className="room-preview" onClick={() => onOpenRoom("practice", "NIGHT-17")}>
            <span className="room-seat-letter">A</span>
            <span className="room-avatar avatar-amber">♟</span>
            <span className="room-preview-copy">
              <strong>검은 해적</strong>
              <small>선장 레벨 17</small>
            </span>
            <span className="room-seal" aria-hidden="true">
              ⚓︎
            </span>
          </button>
          <button type="button" className="room-preview" onClick={() => onOpenRoom("practice", "NIGHT-17")}>
            <span className="room-seat-letter teal">B</span>
            <span className="room-avatar avatar-teal">◒</span>
            <span className="room-preview-copy">
              <strong>바다그림자</strong>
              <small>선장 레벨 14</small>
            </span>
            <span className="room-seal" aria-hidden="true">
              ⚓︎
            </span>
          </button>
          <div className="room-preview waiting">
            <span className="room-seat-letter violet">C</span>
            <span className="room-avatar avatar-empty">♟</span>
            <span className="room-preview-copy">
              <strong>참가 대기 중</strong>
              <small>플레이어를 기다리는 중…</small>
            </span>
            <span className="loading-dots" aria-hidden="true">•••</span>
          </div>
          <div className="room-preview waiting">
            <span className="room-seat-letter violet">D</span>
            <span className="room-avatar avatar-empty">♟</span>
            <span className="room-preview-copy">
              <strong>참가 대기 중</strong>
              <small>플레이어를 기다리는 중…</small>
            </span>
            <span className="loading-dots" aria-hidden="true">•••</span>
          </div>

          <button type="button" className="room-list-button" onClick={() => onOpenRoom("practice")}>
            <span aria-hidden="true">☷</span> 방 목록 보기
          </button>
        </aside>
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
      <header className="site-header room-header">
        <button type="button" className="back-button" onClick={onBack}>
          <span aria-hidden="true">‹</span> 항구로 돌아가기
        </button>
        <BrandLockup compact />
        <nav className="utility-nav" aria-label="대기실 메뉴">
          <button type="button" className="utility-button" onClick={() => onUtility("help")}>
            <span aria-hidden="true">?</span> 도움말
          </button>
          <button type="button" className="utility-button" onClick={() => onUtility("rules")}>
            <span aria-hidden="true">▤</span> 규칙서
          </button>
        </nav>
      </header>

      <main className="room-main">
        <section className="room-intro">
          <span className="card-kicker">{modeLabel} · PRIVATE HARBOR</span>
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
            <span><b>4</b>인 고정</span>
            <span><b>8</b>라운드</span>
            <span><b>25–35</b>분</span>
          </div>
        </section>

        <section className="berth-card framed-card">
          <div className="berth-heading">
            <div>
              <span className="card-kicker">HARBOR BERTHS</span>
              <h2>현재 승선자</h2>
            </div>
            <span className="participant-count">4 / 4 준비 완료</span>
          </div>
          <div className="berth-grid">
            {SEATS.map((seat, index) => {
              const isHuman = seat === HUMAN;
              const p = g.players[seat];
              return (
                <article key={seat} className={`berth-seat ${isHuman ? "human" : "ai"}`}>
                  <span className={`room-seat-letter ${index % 2 === 0 ? "" : "teal"}`}>{seat}</span>
                  <span className="berth-avatar">{isHuman ? "♟" : ["◒", "◐", "◓"][index - 1]}</span>
                  <span className="berth-copy">
                    <strong>{isHuman ? playerName || "항구의 손님" : p.name}</strong>
                    <small>{isHuman ? "나 · 출항 준비 완료" : "AI 상단 · 준비 완료"}</small>
                  </span>
                  <span className="ready-mark" aria-label="준비 완료">✓</span>
                </article>
              );
            })}
          </div>
          <div className="berth-footer">
            <p><span className="status-dot" /> AI 상단 3명이 자리를 지키고 있습니다.</p>
            <button type="button" className="primary-button" onClick={onStart}>
              연습 항해 시작 <span aria-hidden="true">›</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function GameShell({
  g,
  phase,
  roomName,
  onLobby,
  onUtility,
  children,
}: {
  g: GameState;
  phase: Phase;
  roomName: string;
  onLobby: () => void;
  onUtility: (kind: Exclude<SheetKind, null>) => void;
  children: ReactNode;
}) {
  const activeStep = PHASE_STEPS.findIndex((step) => (step.phases as readonly string[]).includes(phase));
  const order = rotationOrder(g.round >= 1 ? g.round : 1, g.priorityOffset);
  const phaseMeta = PHASE_META[phase];
  return (
    <div className={`app-screen game-screen phase-${phase}`}>
      <header className="site-header game-header">
        <BrandLockup compact />
        <div className="game-room-label">
          <span>항구의 테이블</span>
          <strong>{roomName}</strong>
        </div>
        <div className="game-header-actions">
          <button type="button" className="utility-button" onClick={() => onUtility("log")}>
            <span aria-hidden="true">☷</span> 기록
          </button>
          <button type="button" className="utility-button" onClick={() => onUtility("rules")}>
            <span aria-hidden="true">▤</span> 규칙서
          </button>
          <button type="button" className="exit-button" onClick={onLobby}>
            항구 나가기
          </button>
        </div>
      </header>

      <main className="table-main">
        <div className="table-topline">
          <div>
            <span className="card-kicker">{phaseMeta.eyebrow}</span>
            <h1>{phaseMeta.title}</h1>
            <p>{phaseMeta.prompt}</p>
          </div>
          <div className="voyage-status">
            <div className="round-status">
              <span>항해 기록</span>
              <strong>{g.round >= 1 ? `${g.round} / 8` : "출항 전"}</strong>
              <div className="round-progress" aria-label={`${g.round}라운드 진행`}>
                <span style={{ width: `${Math.min(100, (g.round / 8) * 100)}%` }} />
              </div>
            </div>
            <div className={`customs-status ${g.alert >= 3 ? "danger" : ""}`}>
              <span>세관 경계</span>
              <strong>{g.alert} / 4</strong>
              <div className="alert-bar" aria-label={`세관 경계 ${g.alert}/4`}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={`alert-cell ${i < g.alert ? "on" : ""}`} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <nav className="phase-track" aria-label="라운드 진행 단계">
          {PHASE_STEPS.map((step, index) => (
            <div key={step.label} className={`phase-step ${index < activeStep ? "complete" : ""} ${index === activeStep ? "active" : ""}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{step.label}</b>
            </div>
          ))}
        </nav>

        <section className="table-layout" aria-label="항구의 테이블">
          <div className="seat-slot seat-north">
            <PlayerSeat g={g} seat="C" />
          </div>
          <div className="seat-slot seat-west">
            <PlayerSeat g={g} seat="B" />
          </div>
          <section className="harbor-table">
            <div className="table-rim" aria-hidden="true">
              <span />
              <b>⚓︎</b>
              <span />
            </div>
            <div className="table-content">
              <div className="table-content-head">
                <span>ROUND {g.round || "—"} · PRIORITY {order.join(" → ")}</span>
                <span className="table-rule">RULE {RULE_VERSION}</span>
              </div>
              <div className="stage">{children}</div>
            </div>
          </section>
          <div className="seat-slot seat-east">
            <PlayerSeat g={g} seat="D" />
          </div>
          <div className="seat-slot seat-south">
            <PlayerSeat g={g} seat="A" />
          </div>
          <PrivateDock g={g} phase={phase} />
        </section>
      </main>
    </div>
  );
}

function PlayerSeat({ g, seat }: { g: GameState; seat: Seat }) {
  const p = g.players[seat];
  const goodsCount = Object.values(p.goods).reduce((sum, count) => sum + count, 0);
  const isHuman = seat === HUMAN;
  return (
    <article className={`player-seat ${isHuman ? "is-human" : ""}`}>
      <span className={`seat-token seat-${seat.toLowerCase()}`}>{seat}</span>
      <div className="seat-person">
        <div className="seat-name-line">
          <strong>{p.name}</strong>
          {isHuman && <span className="you-tag">나</span>}
        </div>
        <span className="seat-role">{isHuman ? "내 상단" : "상대 상단"}</span>
        <div className="seat-stat-line">
          <span className="gold-text">{p.gold}g</span>
          <span>상품 {goodsCount}</span>
          <span className={p.suspicion >= 3 ? "danger" : p.suspicion > 0 ? "warn" : "dim"}>
            의심 {p.suspicion}
          </span>
        </div>
      </div>
      <span className="seat-contracts">계약 {completedCount(p)}/3</span>
    </article>
  );
}

function PrivateDock({ g, phase }: { g: GameState; phase: Phase }) {
  const me = g.players[HUMAN];
  return (
    <section className="private-dock">
      <div className="dock-identity">
        <span className="dock-token">A</span>
        <div>
          <span className="card-kicker">PRIVATE DOCK</span>
          <strong>{me.name}</strong>
        </div>
      </div>
      <div className="dock-gold">
        <span>보유 골드</span>
        <strong>{me.gold}g</strong>
      </div>
      <div className="dock-goods">
        {COMMODITIES.map((commodity) => (
          <span key={commodity} className="dock-good">
            <b>{COMMODITY_KO[commodity][0]}</b>
            <strong>{me.goods[commodity]}</strong>
          </span>
        ))}
      </div>
      <div className="dock-contracts">
        <span className="dock-label">비밀 계약</span>
        <div className="dock-contract-list">
          {me.contracts.map((contract) => (
            <span key={contract.uid} className={`dock-contract ${contract.status}`} title={contract.def.name}>
              <b>{contract.def.name}</b>
              <small>{contract.status === "done" ? "완료" : contract.status === "reserve" ? "예비" : goodsLabel(contract.def.needs)}</small>
            </span>
          ))}
        </div>
      </div>
      <span className="dock-phase-note">{phase === "setup" ? "활성 계약을 선택하세요" : "내 정보는 나에게만 보입니다"}</span>
    </section>
  );
}

function UtilitySheet({ kind, g, onClose }: { kind: Exclude<SheetKind, null>; g: GameState; onClose: () => void }) {
  const titles: Record<Exclude<SheetKind, null>, string> = {
    settings: "항구 설정",
    help: "항해 도움말",
    rules: "검은 항구 규칙서",
    log: "항구 기록",
  };
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <aside className="utility-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-heading">
          <div>
            <span className="card-kicker">BLACK HARBOR</span>
            <h2>{titles[kind]}</h2>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        {kind === "settings" && (
          <div className="sheet-body">
            <div className="sheet-setting"><span>플레이 모드</span><strong>브라우저 데모</strong></div>
            <div className="sheet-setting"><span>규칙 버전</span><strong>{RULE_VERSION}</strong></div>
            <p className="hint">실시간 방 설정과 사운드는 온라인 항구가 연결되면 활성화됩니다.</p>
          </div>
        )}
        {kind === "help" && (
          <div className="sheet-body">
            <p className="sheet-lead">중앙 항구에 표시되는 현재 단계의 행동만 결정하면 됩니다.</p>
            <div className="help-list">
              <p><b>01</b> 항구 소식과 화물을 확인합니다.</p>
              <p><b>02</b> 봉인 경매와 시장 계획을 잠급니다.</p>
              <p><b>03</b> 계약을 합법 배송하거나 밀수합니다.</p>
            </div>
          </div>
        )}
        {kind === "rules" && (
          <div className="sheet-body">
            <p className="sheet-lead">네 상단이 8라운드 동안 경매·시장·밀수의 균형을 겨룹니다.</p>
            <div className="rules-summary">
              {PHASE_STEPS.slice(1).map((step, index) => (
                <div key={step.label} className="rule-row"><span>0{index + 1}</span><b>{step.label}</b><small>{["소식과 화물을 공개합니다.", "두 화물에 동시에 입찰합니다.", "두 주문으로 시장을 움직입니다.", "배송 방식으로 위험을 감수합니다.", "세관과 최종 자산을 정산합니다."][index]}</small></div>
              ))}
            </div>
          </div>
        )}
        {kind === "log" && (
          <div className="sheet-body sheet-log">
            {g.log.length === 0 ? <p className="hint">아직 기록된 항해가 없습니다.</p> : g.log.slice(-20).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
          </div>
        )}
      </aside>
    </div>
  );
}

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
