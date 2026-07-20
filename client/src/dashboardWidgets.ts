import { ArrowLeftRight, CreditCard, Landmark, PieChart, PiggyBank, Receipt, Target, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import type { WidgetMode, WidgetSize } from "./components/dashboard/SortableCard.js";

export const WIDGET_IDS = ["netWorth", "accounts", "balances", "cashflow", "transactions", "category", "budgets", "debts", "savings"] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export interface WidgetMeta {
  title: string;
  module: string;
  icon: LucideIcon;
  defaultEnabled: boolean;
  defaultSize: WidgetSize;
  defaultMode?: WidgetMode;
}

export const WIDGET_META: Record<WidgetId, WidgetMeta> = {
  netWorth: { title: "Net worth", module: "Dashboard", icon: TrendingUp, defaultEnabled: true, defaultSize: 2, defaultMode: "chart" },
  accounts: { title: "Accounts", module: "Accounts", icon: Landmark, defaultEnabled: true, defaultSize: 1 },
  balances: { title: "Account balances", module: "Accounts", icon: Wallet, defaultEnabled: true, defaultSize: 1 },
  cashflow: { title: "Monthly cash flow", module: "Dashboard", icon: ArrowLeftRight, defaultEnabled: true, defaultSize: 2, defaultMode: "chart" },
  transactions: { title: "Recent transactions", module: "Transactions", icon: Receipt, defaultEnabled: true, defaultSize: 1 },
  category: { title: "Spending by category", module: "Analytics", icon: PieChart, defaultEnabled: true, defaultSize: 1, defaultMode: "chart" },
  budgets: { title: "Budgets", module: "Budgets", icon: Target, defaultEnabled: true, defaultSize: 1 },
  debts: { title: "Debt overview", module: "Debt Planner", icon: CreditCard, defaultEnabled: false, defaultSize: 1 },
  savings: { title: "Savings goals", module: "Savings", icon: PiggyBank, defaultEnabled: false, defaultSize: 1 },
};

// Fixed registry order (not display order) -> deterministic widget identity
// regardless of how the user has arranged/added widgets, same reasoning as
// avatarColorVar's fixed categorical assignment.
const ACCENT_VARS = ["--accent", "--accent-2", "--accent-3", "--accent-4"];
export function widgetAccentVar(id: WidgetId): string {
  return ACCENT_VARS[WIDGET_IDS.indexOf(id) % ACCENT_VARS.length];
}
