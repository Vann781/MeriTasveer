import { useEffect, useState } from 'react';

/**
 * One of the three selfie steps. A row, not a card — the three are a sequence,
 * and a numbered list reads as one.
 */
export function SelfieSlot({ index, label, hint, file, onOpenCamera }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);
    // Release the blob when the photo changes or the page closes.
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={onOpenCamera}
        className="row-hover flex w-full items-center gap-4 rounded-md px-3 py-4 text-left"
      >
        <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
          {preview ? (
            <img src={preview} alt={`${label} selfie`} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm text-muted">
              {index}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[17px]">{label}</span>
          <span className="mt-0.5 block text-sm text-muted">{hint}</span>
        </span>

        <span className="shrink-0 text-sm text-accent">{file ? 'Retake' : 'Take photo'}</span>
      </button>
    </li>
  );
}
