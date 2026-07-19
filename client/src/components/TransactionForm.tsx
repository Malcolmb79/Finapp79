import { useState } from "react";
import { api, type Account } from "../api/client.js";

export default function TransactionForm({ accounts, onCreated }: { accounts: Account[]; onCreated: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !amount) return;

    await api.createTransaction({
      account_id: accountId,
      booking_date: date,
      amount: Number(amount),
      description,
    });
    setAmount("");
    setDescription("");
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <input
        type="number"
        step="0.01"
        placeholder="Amount (negative = spend)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button type="submit">Add</button>
    </form>
  );
}
