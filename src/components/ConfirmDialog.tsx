interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50">
      <div className="max-w-sm w-full bg-neutral-900 rounded-lg border border-neutral-800 p-5">
        <h2 className="text-sm font-semibold mb-1.5">{title}</h2>
        <p className="text-sm text-neutral-400 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md hover:bg-neutral-800 px-3 py-1.5 text-sm text-neutral-400 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-600 hover:bg-red-500 px-3 py-1.5 text-sm font-medium transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
