interface UnsavedChangesDialogProps {
  /** Short phrase describing what's about to happen, e.g. "closing", "starting a new project". */
  actionLabel: string;
  saving: boolean;
  error: string | null;
  onSaveAndProceed: () => void;
  onDiscardAndProceed: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  actionLabel,
  saving,
  error,
  onSaveAndProceed,
  onDiscardAndProceed,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50">
      <div className="max-w-sm w-full bg-neutral-900 rounded-lg border border-neutral-800 p-5">
        <h2 className="text-sm font-semibold mb-1.5">Unsaved changes</h2>
        <p className="text-sm text-neutral-400 mb-4">
          This session has changes that haven't been saved. Save before {actionLabel}?
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-md bg-red-950 border border-red-800 text-red-300 text-xs">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={onSaveAndProceed}
            disabled={saving}
            className="rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-3 py-1.5 text-sm font-medium transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onDiscardAndProceed}
            disabled={saving}
            className="rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-60 px-3 py-1.5 text-sm transition-colors"
          >
            Don't save
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-md hover:bg-neutral-800 disabled:opacity-60 px-3 py-1.5 text-sm text-neutral-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
