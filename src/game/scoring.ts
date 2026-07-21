export function residualValueAtPrice(price: number): number {
  return Math.floor(price / 2);
}

export function marketPriceAfterNet(price: number, net: number): number {
  let delta = 0;
  if (net >= 4) delta = 2;
  else if (net >= 1) delta = 1;
  else if (net <= -4) delta = -2;
  else if (net <= -1) delta = -1;
  return Math.min(12, Math.max(1, price + delta));
}

export type ScoringGoods = Record<"SPICE" | "IRON" | "SILK" | "RELIC", number>;

export function calculateFinalScore(
  gold: number,
  goods: ScoringGoods,
  prices: ScoringGoods,
  penalty: number,
): number {
  return (
    gold +
    Object.keys(goods).reduce(
      (score, commodity) =>
        score +
        goods[commodity as keyof ScoringGoods] * residualValueAtPrice(prices[commodity as keyof ScoringGoods]),
      0,
    ) -
    penalty
  );
}
