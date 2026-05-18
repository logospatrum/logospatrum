"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadTitle: string;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({
  open,
  onOpenChange,
  threadTitle,
  onConfirm,
}: Props) {
  const { s } = useStrings();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="logos-passage-modal-overlay" />
        <Dialog.Content className="logos-confirm-modal-content">
          <Dialog.Title
            style={{
              fontFamily: type.logo,
              fontSize: 20,
              fontWeight: 400,
              color: palette.text,
              margin: 0,
            }}
          >
            {s.sidebar.deleteTitle}
          </Dialog.Title>
          <Dialog.Description
            style={{
              fontFamily: type.ui,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: palette.muted,
              margin: 0,
            }}
          >
            {s.sidebar.deleteBody}
          </Dialog.Description>
          {threadTitle && (
            <div
              style={{
                fontFamily: type.quote,
                fontStyle: "italic",
                fontSize: 14,
                color: palette.text,
                padding: "10px 14px",
                borderLeft: `1px solid ${palette.hairline}`,
                background: "rgba(255,255,255,0.025)",
                borderRadius: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {threadTitle}
            </div>
          )}
          <div className="logos-confirm-modal-actions">
            <Dialog.Close asChild>
              <button type="button" className="logos-confirm-modal-btn">
                {s.sidebar.deleteCancel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              autoFocus
              className="logos-confirm-modal-btn logos-confirm-modal-btn--danger"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {s.sidebar.deleteConfirm}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
