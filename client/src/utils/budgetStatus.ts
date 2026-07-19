export type BudgetStatus = "good" | "warning" | "critical";

export function budgetStatus(spent: number, limit: number): BudgetStatus {
  const ratio = limit > 0 ? spent / limit : 0;
  if (ratio >= 1) return "critical";
  if (ratio >= 0.8) return "warning";
  return "good";
}
