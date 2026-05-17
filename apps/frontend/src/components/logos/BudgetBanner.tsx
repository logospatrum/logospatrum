"use client";

import { useStrings } from "./i18n";

/**
 * Soft warning banner shown when the user is at >=80% of their daily RUB
 * budget. Subscribed by LogosShell to `patristic:budget-warning` custom
 * events dispatched by useStatelessStream when an API response carries
 * the `X-Budget-Warning: used=...;limit=...` header.
 */
export interface BudgetBannerProps {
  used: number;
  limit: number;
  onClose?: () => void;
}

export function BudgetBanner({ used, limit, onClose }: BudgetBannerProps) {
  const { s } = useStrings();
  return (
    <div
      role="status"
      style={{
        padding: "8px 16px",
        background: "rgba(180,120,40,0.15)",
        borderBottom: "1px solid rgba(180,120,40,0.4)",
        color: "#d8a050",
        fontSize: 13,
        textAlign: "center",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {s.budget.warning(used, limit)}
      {onClose && (
        <button
          onClick={onClose}
          aria-label={s.budget.dismissAria}
          style={{
            marginLeft: 12,
            background: "transparent",
            border: 0,
            color: "inherit",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
