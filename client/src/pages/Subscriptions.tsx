import { Check, Loader2, Moon, Sparkles, Tag, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Account, type Category, type SubscriptionReview, type Transaction } from "../api/client.js";
import { visibleTransactions } from "../utils/accountBalance.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { inBase, useFxRates } from "../utils/fx.js";
import { detectPriceRises } from "../utils/priceRises.js";
import { checkedPhrase, reviewItems, REVIEW_GOOD_FOR_DAYS, type ReviewItem } from "../utils/subscriptionReview.js";
import { subscriptionCategories, taggedSubscriptions } from "../utils/taggedSubscriptions.js";
import { useAccountScope } from "../contexts/ViewFilterContext.js";

/**
 * The subscriptions — meaning the ones that have been tagged as such.
 *
 * Nothing on this page decides what a subscription is. Three attempts at
 * doing that got it wrong three different ways, and the lesson of the third
 * is that no fourth refinement would have worked: a loan instalment, a life
 * premium, a phone bill and the bins all come back on a rhythm for a
 * consistent amount, because that is what a standing commitment is. The
 * difference between one you signed up to and one you owe is not in the
 * transactions. It is in what you mean by them.
 *
 * So the list is the categories marked as holding subscriptions, and the
 * charges filed under them. What is still read from the charges is
 * description — how often, how much a year, whether the price moved — which
 * the data can genuinely support.
 *
 * The order is by neglect rather than cost. A subscription fails by never
 * being questioned, not by being expensive, and sorting by price means the €6
 * thing you forgot you had never reaches the screen.
 */

const CADENCE_LABEL: Record<string, string> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  yearly: "yearly",
};

export default function Subscriptions() {
  const [allTransactions, setTransactions] = useState<Transaction[]>([]);
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reviews, setReviews] = useState<SubscriptionReview[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tagging, setTagging] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const { scope } = useAccountScope();
  const rates = useFxRates("EUR");

  const refresh = useCallback(() => {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
    api.listSubscriptionReviews().then(setReviews).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const today = new Date().toISOString().slice(0, 10);
  const scoped = visibleTransactions(allTransactions, allAccounts, scope);
  // No period picker: a yearly subscription cannot be seen inside a
  // three-month window, and a page that reported you had none would be worse
  // than one that reports nothing at all. The account scope still applies.
  const { items } = inBase(scoped, rates);
  const currency = rates?.base ?? "EUR";
  const money = (value: number) => formatCurrency(value, currency);

  const tagged = subscriptionCategories(categories);
  const subs = taggedSubscriptions(items, categories);
  const rows = reviewItems(subs, reviews, detectPriceRises(items), today);

  async function confirm(item: ReviewItem) {
    setBusy(item.subscription.key);
    setFailed(null);
    try {
      await api.reviewSubscription({
        merchant_key: item.subscription.key,
        label: item.subscription.label,
        reviewed: true,
      });
      setReviews(await api.listSubscriptionReviews());
    } catch (err) {
      setFailed(errorMessage(err, "Couldn't record that."));
    } finally {
      setBusy(null);
    }
  }

  async function tag(category: Category, is_subscription: boolean) {
    setTagging(category.id);
    setFailed(null);
    try {
      await api.updateCategory(category.id, { is_subscription });
      setCategories(await api.listCategories());
    } catch (err) {
      setFailed(errorMessage(err, "Couldn't change that category."));
    } finally {
      setTagging(null);
    }
  }

  const live = rows.filter((row) => !row.flags.includes("dormant"));
  const yearly = live.reduce((sum, row) => sum + (row.annual ?? 0), 0);
  const unpriced = live.filter((row) => row.annual == null).length;
  const unchecked = rows.filter((row) => row.flags.includes("never-checked") || row.flags.includes("stale")).length;

  /**
   * Nothing tagged yet is a setup state, not an empty one.
   *
   * Offered rather than guessed: the categories are listed to be ticked, and
   * nothing is marked until one is. A page that silently picked whichever
   * category sounded like subscriptions would be the same mistake as the
   * detector it replaced, one layer further back.
   */
  if (tagged.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Subscriptions</h1>
            <p className="page-header__subtitle">Nothing is marked as holding subscriptions yet.</p>
          </div>
        </div>

        <p style={{ fontSize: "0.86rem", maxWidth: "44rem", lineHeight: 1.6 }}>
          This page lists what you have filed as a subscription, and nothing else — a loan repayment, a phone bill and
          a life policy all charge monthly for the same amount, so no amount of looking at the transactions tells them
          apart. Pick the categories you use for subscriptions:
        </p>

        {failed && <p style={{ color: "var(--critical)", fontSize: "0.82rem" }}>{failed}</p>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.8rem", maxWidth: "44rem" }}>
          {categories.length === 0 ? (
            <p className="empty-state">
              No categories yet — <Link to="/transactions">add some on the Transactions page</Link> first.
            </p>
          ) : (
            categories.map((category) => (
              <button key={category.id} type="button" onClick={() => tag(category, true)} disabled={tagging !== null}>
                {tagging === category.id ? <Loader2 size={12} className="spin" /> : <Tag size={12} />} {category.name}
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Subscriptions</h1>
          <p className="page-header__subtitle">
            {live.length === 0
              ? `Nothing filed under ${tagged.map((c) => c.name).join(" or ")} yet.`
              : `${live.length} running · ${money(yearly)} a year${
                  unpriced > 0 ? ` from the ${live.length - unpriced} with an established rhythm` : ""
                }${unchecked > 0 ? ` · ${unchecked} not confirmed in the last year` : " · all confirmed within the year"}`}
          </p>
        </div>
      </div>

      {failed && <p style={{ color: "var(--critical)", fontSize: "0.82rem" }}>{failed}</p>}

      {rows.length === 0 ? (
        <p className="empty-state">
          Nothing is filed under {tagged.map((c) => c.name).join(" or ")} yet. File a payment there on the Transactions
          page and it will appear here.
        </p>
      ) : (
        <div className="sub-list">
          {rows.map((row) => {
            const { subscription: sub } = row;
            return (
              <div key={sub.key} className="sub-row">
                <div className="sub-row__main">
                  <div className="sub-row__name">
                    {sub.label}
                    <span className="sub-row__kind">· {sub.categoryName}</span>
                  </div>

                  <div className="sub-row__facts">
                    {money(sub.amount)}
                    {sub.cadence ? ` ${CADENCE_LABEL[sub.cadence]}` : ` · ${sub.occurrences === 1 ? "one charge" : `${sub.occurrences} charges`} so far`}
                    {row.annual != null && (
                      <>
                        {" · "}
                        <strong>{money(row.annual)}</strong> a year
                      </>
                    )}
                    {" · last charged "}
                    {sub.lastCharged}
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

                  {row.flags.includes("dormant") && (
                    <div className="sub-row__flag" style={{ color: "var(--text-muted)" }}>
                      <Moon size={12} aria-hidden="true" />
                      Stopped charging — nothing since {sub.lastCharged}
                    </div>
                  )}

                  {/* Said rather than withheld. A subscription tagged last
                      week is still a subscription; it simply has no rhythm to
                      measure yet, and an annual cost from one charge would be
                      twelve times a guess. */}
                  {row.flags.includes("new") && (
                    <div className="sub-row__flag" style={{ color: "var(--text-muted)" }}>
                      <Sparkles size={12} aria-hidden="true" />
                      Not charged often enough yet to say how often it comes, or what it costs a year
                    </div>
                  )}
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
                  <button
                    type="button"
                    onClick={() => confirm(row)}
                    disabled={busy !== null}
                    title="Record that you have looked at this and still want it"
                  >
                    {busy === sub.key ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Looks right
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* What is on this page, and how to change it — stated here rather than
          assumed, since the whole point is that membership is a decision. */}
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "1rem", maxWidth: "52rem" }}>
        <p>
          Showing everything filed under{" "}
          {tagged.map((category, i) => (
            <span key={category.id}>
              {i > 0 && ", "}
              <strong>{category.name}</strong>
              <button
                type="button"
                onClick={() => tag(category, false)}
                disabled={tagging !== null}
                title={`Stop treating ${category.name} as subscriptions`}
                className="sub-untag"
              >
                remove
              </button>
            </span>
          ))}
          . Tag another on the Transactions page, or in the Categories card there.
        </p>
        <p>
          A confirmation is good for a year, which is the cycle these things actually move on — a price rise, a
          contract ending, a trial turning into a bill. Nothing here cancels anything: it records that you looked, so
          what you have not looked at in a long time rises to the top on its own.
        </p>
      </div>
    </div>
  );
}
