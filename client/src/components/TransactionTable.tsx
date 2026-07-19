import { api, type Transaction } from "../api/client.js";

export default function TransactionTable({ transactions, onChange }: { transactions: Transaction[]; onChange: () => void }) {
  async function handleDelete(id: string) {
    await api.deleteTransaction(id);
    onChange();
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th align="left">Date</th>
          <th align="left">Description</th>
          <th align="right">Amount</th>
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
            <td>{tx.source}</td>
            <td>{tx.source === "manual" && <button onClick={() => handleDelete(tx.id)}>Delete</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
