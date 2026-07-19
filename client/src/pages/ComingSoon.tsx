import type { LucideIcon } from "lucide-react";

export default function ComingSoon({ title, icon: Icon, description }: { title: string; icon: LucideIcon; description: string }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-header__subtitle">{description}</p>
        </div>
      </div>
      <div className="card coming-soon">
        <Icon size={32} className="coming-soon__icon" />
        <strong>Coming soon</strong>
        <p className="empty-state">This module isn't built yet.</p>
      </div>
    </div>
  );
}
