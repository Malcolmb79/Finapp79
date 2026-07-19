import { api, type Category, type Transaction } from "../api/client.js";

export default function TransactionTable({
  transactions,
  categories,
  onChange,
}: {
  transactions: Transaction[];
  categories: Category[];
  onChange: () => void;
}) {
  async function handleDelete(id: string) {
    await api.deleteTransaction(id);
    onChange();
  }

  async function handleCategoryChange(id: string, value: string) {
    await api.updateTransaction(id, { category_id: value ? Number(value) : null });
    onChange();
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th align="left">Date</th>
          <th align="left">Description</th>
          <th align="right">Amount</th>
          <th align="left">Category</th>
          <th align="left">Source</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((tx) => (
          <tr key={tx.id}>
            <td>{tx.booking_date}</td>
            <td>{tx.description}</td>
            <td align="right">{tx.amount.toFixed(2)}</td>
            <td>
              <select value={tx.category_id ?? ""} onChange={(e) => handleCategoryChange(tx.id, e.target.value)}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </td>
            <td>{tx.source}</td>
            <td>{tx.source === "manual" && <button onClick={() => handleDelete(tx.id)}>Delete</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
