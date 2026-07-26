import { ArrowLeftRight, CreditCard, Inbox, Landmark, PieChart, PiggyBank, Receipt, Target, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import type { WidgetMode } from "./components/dashboard/CanvasCard.js";

export const WIDGET_IDS = [
  "netWorth",
  "accounts",
  "balances",
  "cashflow",
  "pendingReview",
  "transactions",
  "category",
  "budgets",
  "debts",
  "savings",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

// Canvas sizing. Widgets are freely positioned and resized (see
// useCanvasItem), so these are only starting points and floors — a widget
// keeps whatever size the user drags it to. NARROW/WIDE are two columns'
// worth on the default layout grid, so the auto-layout below packs cleanly
// before anyone starts moving things around.
export const NARROW_WIDTH = 328;
export const WIDE_WIDTH = 672;
export const LAYOUT_GAP = 16;
export const MIN_WIDGET_WIDTH = 240;
export const MIN_WIDGET_HEIGHT = 160;

export interface WidgetMeta {
  title: string;
  module: string;
  icon: LucideIcon;
  defaultEnabled: boolean;
  defaultWidth: number;
  defaultHeight: number;
  defaultMode?: WidgetMode;
}

export const WIDGET_META: Record<WidgetId, WidgetMeta> = {
  netWorth: { title: "Net worth", module: "Dashboard", icon: TrendingUp, defaultEnabled: true, defaultWidth: WIDE_WIDTH, defaultHeight: 280, defaultMode: "chart" },
  accounts: { title: "Accounts", module: "Accounts", icon: Landmark, defaultEnabled: true, defaultWidth: NARROW_WIDTH, defaultHeight: 264 },
  balances: { title: "Account balances", module: "Accounts", icon: Wallet, defaultEnabled: true, defaultWidth: NARROW_WIDTH, defaultHeight: 264 },
  cashflow: { title: "Monthly cash flow", module: "Dashboard", icon: ArrowLeftRight, defaultEnabled: true, defaultWidth: WIDE_WIDTH, defaultHeight: 280, defaultMode: "chart" },
  // The review queue is a scrolling list that can hold a whole sync's worth
  // of transactions, so it starts taller than a stat widget.
  pendingReview: { title: "New transactions", module: "Dashboard", icon: Inbox, defaultEnabled: true, defaultWidth: NARROW_WIDTH, defaultHeight: 360 },
  transactions: { title: "Recent transactions", module: "Transactions", icon: Receipt, defaultEnabled: true, defaultWidth: NARROW_WIDTH, defaultHeight: 300 },
  category: { title: "Spending by category", module: "Analytics", icon: PieChart, defaultEnabled: true, defaultWidth: NARROW_WIDTH, defaultHeight: 300, defaultMode: "chart" },
  budgets: { title: "Budgets", module: "Budgets", icon: Target, defaultEnabled: true, defaultWidth: NARROW_WIDTH, defaultHeight: 264 },
  debts: { title: "Debt overview", module: "Debt Planner", icon: CreditCard, defaultEnabled: false, defaultWidth: NARROW_WIDTH, defaultHeight: 264 },
  savings: { title: "Savings goals", module: "Savings", icon: PiggyBank, defaultEnabled: false, defaultWidth: NARROW_WIDTH, defaultHeight: 264 },
};

// Fixed registry order (not display order) -> deterministic widget identity
// regardless of how the user has arranged/added widgets, same reasoning as
// avatarColorVar's fixed categorical assignment.
const ACCENT_VARS = ["--accent", "--accent-2", "--accent-3", "--accent-4"];
export function widgetAccentVar(id: WidgetId): string {
  return ACCENT_VARS[WIDGET_IDS.indexOf(id) % ACCENT_VARS.length];
}
