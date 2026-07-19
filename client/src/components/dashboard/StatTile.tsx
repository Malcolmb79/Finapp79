export default function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="stat-tile__label">{label}</p>
      <p className="stat-tile__value">{value}</p>
    </div>
  );
}
