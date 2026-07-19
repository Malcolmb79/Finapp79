import { useState } from "react";
import { api } from "../api/client.js";

export default function CategoryManager({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createCategory(name.trim());
    setName("");
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
      <input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit">Add category</button>
    </form>
  );
}
