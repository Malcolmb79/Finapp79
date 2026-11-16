import { AlertTriangle, Check, Loader2, Moon, Ban, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Account,
  type Category,
  type Policy,
  type SubscriptionReview,
  type Transaction,
} from "../api/client.js";
import { visibleTransactions } from "../utils/accountBalance.js";
import { classifyCommitments } from "../utils/commitments.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { inBase, useFxRates } from "../utils/fx.js";
import { detectPriceRises } from "../utils/priceRises.js";
import { subscriptions } from "../utils/recurring.js";
import { checkedPhrase, reviewItems, REVIEW_GOOD_FOR_DAYS, type ReviewItem } from "../utils/subscriptionReview.js";
import { excludeTransfers, transferCategoryIds } from "../utils/transfers.js";
import { useAccountScope } from "../contexts/ViewFilterContext.js";

/**
 * The subscriptions, in the order they have been neglected.
 *
 * Everything on this page is on the commitments card already, and that is the
 * point: the card answers what you pay, and no amount of staring at it
 * answers which of them you have actually decided about. A subscription does
 * not fail by being expensive — £9.99 is small enough that no month ever
 * forces the issue — it fails by never being questioned.
 *
 * So the ordering is by neglect, not by cost. The dearest one on the list may
 * be the one you are most certain about, and sorting by price means the £6
 * thing you forgot you had never reaches the screen.
 *
 * No period picker. A rhythm cannot be found inside a window shorter than the
 * rhythm, so this always works from the whole history — a three-month view
 * would report that you have no yearly subscriptions. The account scope still
 * applies, because looking at one account should show that account's
 * commitments.
 */

const FLAG_LABEL: Record<string, { text: string; icon: typeof Moon; tone: string }> = {
  "still-charging": { text: "Still charging", icon: AlertTriangle, tone: "var(--critical)" },
  dormant: { text: "Stopped charging", icon: Moon, tone: "var(--text-muted)" },
  rose: { text: "Price went up", icon: TrendingUp, tone: "var(--warning)" },
};

export default function Subscriptions() {
  const [allTransactions, setTransactions] = useState<Transaction[]>([]);
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [reviews, setReviews] = useState<SubscriptionReview[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const { scope } = useAccountScope();
  const rates = useFxRates("EUR");

  const refresh = useCallback(() => {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
    api.listPolicies().then(setPolicies).catch(() => {});
    api.listSubscriptionReviews().then(setReviews).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const today = new Date().toISOString().slice(0, 10);
  const scoped = visibleTransactions(allTransactions, allAccounts, scope);
  const { items } = inBase(scoped, rates);
  const currency = rates?.base ?? "EUR";
  const money = (value: number) => formatCurrency(value, currency);

  const history = excludeTransfers(items, transferCategoryIds(categories));
  const commitments = classifyCommitments(subscriptions(history), { policies, categories });
  const rows = reviewItems(commitments, reviews, detectPriceRises(history), today);

  async function mark(item: ReviewItem, patch: { reviewed?: boolean; cancelling?: boolean }) {
    setBusy(item.commitment.payment.key);
    setFailed(null);
    try {
      await api.reviewSubscription({
        merchant_key: item.commitment.payment.key,
        label: item.commitment.payment.label,
        ...patch,
      });
      setReviews(await api.listSubscriptionReviews());
    } catch (err) {
      setFailed(errorMessage(err, "Couldn't record that."));
    } finally {
      setBusy(null);
    }
  }

  const live = rows.filter((row) => !row.flags.includes("dormant"));
  const yearly = live.reduce((sum, row) => sum + row.annual, 0);
  const unchecked = rows.filter((row) => row.flags.includes("never-checked") || row.flags.includes("stale")).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Subscriptions</h1>
          <p className="page-header__subtitle">
            {live.length === 0
              ? "Nothing charging on a regular rhythm yet."
              : `${live.length} still charging · ${money(yearly)} a year${
                  unchecked > 0 ? ` · ${unchecked} not confirmed in the last year` : " · all confirmed within the year"
                }`}
          </p>
        </div>
      </div>

      {failed && <p style={{ color: "var(--critical)", fontSize: "0.82rem" }}>{failed}</p>}

      {rows.length === 0 ? (
        <p className="empty-state">
          Nothing repeats often enough to call a subscription yet. Three charges on a steady rhythm is the fewest that
          establishes one — two is just two payments.
        </p>
      ) : (
        <div className="sub-list">
          {rows.map((row) => {
            const { payment } = row.commitment;
            const flags = row.flags.filter((flag) => flag in FLAG_LABEL);
            return (
              <div key={payment.key} className="sub-row">
                <div className="sub-row__main">
                  <div className="sub-row__name">
                    {payment.label}
                    <span className="sub-row__kind">· {row.commitment.group}</span>
                  </div>

                  <div className="sub-row__facts">
                    {money(payment.amount)} {payment.cadence} · <strong>{money(row.annual)}</strong> a year · last charged{" "}
                    {payment.lastCharged}
                    {row.nextDue && ` · next due ${row.nextDue}`}
                  </div>

                  {/* The rise quoted with the year it costs, because "it went
                      up €2" and "that is €24 a year" are the same fact and
                      only one of them gets acted on. */}
                  {row.rise && (
                    <div className="sub-row__flag" style={{ color: "var(--warning)" }}>
                      <TrendingUp size={12} aria-hidden="true" />
                      Went from {money(row.rise.was)} to {money(row.rise.now)} in {row.rise.since.slice(0, 7)} —{" "}
                      {money(row.rise.annualIncrease)} a year
                    </div>
                  )}

                  {flags
                    .filter((flag) => flag !== "rose")
                    .map((flag) => {
                      const { text, icon: Icon, tone } = FLAG_LABEL[flag];
                      return (
                        <div key={flag} className="sub-row__flag" style={{ color: tone }}>
                          <Icon size={12} aria-hidden="true" />
                          {flag === "still-charging"
                            ? `Marked as cancelling on ${row.review?.cancelling_at}, and still charging`
                            : `${text} — nothing since ${payment.lastCharged}`}
                        </div>
                      );
                    })}
                </div>

                <div className="sub-row__actions">
                  <span
                    className="sub-row__checked"
                    style={{
                      color:
                        row.checkedDaysAgo == null || row.checkedDaysAgo >= REVIEW_GOOD_FOR_DAYS
                          ? "var(--warning)"
                          : "var(--text-muted)",
                    }}
                  >
                    {checkedPhrase(row.checkedDaysAgo)}
                  </span>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <button
                      type="button"
                      onClick={() => mark(row, { reviewed: true })}
                      disabled={busy !== null}
                      title="Record that you have looked at this and still want it"
                    >
                      {busy === payment.key ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Looks right
                    </button>
                    <button
                      type="button"
                      onClick={() => mark(row, { cancelling: !row.review?.cancelling_at })}
                      disabled={busy !== null}
                      title={
                        row.review?.cancelling_at
                          ? "Stop watching this one for charges that should have stopped"
                          : "Mark as on its way out — it stays on this list until the charges actually stop"
                      }
                      className={row.review?.cancelling_at ? "btn-accent" : undefined}
                    >
                      <Ban size={12} /> {row.review?.cancelling_at ? "Cancelling" : "Cancel it"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "1rem", maxWidth: "52rem" }}>
        A confirmation is good for a year, which is the cycle these things actually move on — a price rise, a contract
        ending, a trial turning into a bill. Marking one as cancelling does not remove it: it keeps charging until it
        doesn't, and a cancellation that failed looks exactly like one that worked until the next charge arrives.
      </p>
    </div>
  );
}
