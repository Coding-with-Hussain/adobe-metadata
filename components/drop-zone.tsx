"use client";

import { useRef, useState } from "react";
import { ACCEPT_ATTRIBUTE, formatBytes, formatDuration, type AppLimits } from "@/lib/config/limits";
import { ShieldIcon, UploadIcon } from "./icons";
import { Button, cx } from "./ui";

export function DropZone({
  limits,
  onFiles,
  disabled,
  compact,
}: {
  limits: AppLimits;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const open = () => inputRef.current?.click();

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      className={cx(
        "relative rounded-xl border-2 border-dashed text-center transition-colors",
        compact ? "px-4 py-5" : "px-6 py-10",
        dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
        disabled && "opacity-60",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <div className={cx("mx-auto flex flex-col items-center", compact ? "gap-2" : "gap-3")}>
        {!compact && (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <UploadIcon size={22} />
          </span>
        )}
        <div>
          <p className="text-[15px] font-semibold text-ink">
            {dragging ? "Drop to add files" : compact ? "Add more files" : "Drop media files here"}
          </p>
          {!compact && <p className="mt-1 text-[13px] text-muted">or choose them from your computer</p>}
        </div>
        <Button variant={compact ? "secondary" : "primary"} size={compact ? "sm" : "md"} onClick={open} disabled={disabled}>
          <UploadIcon size={15} />
          Choose files
        </Button>
        <p className="max-w-xl text-[12px] leading-relaxed text-muted">
          JPEG, PNG, WEBP up to {formatBytes(limits.maxImageBytes)} · SVG up to {formatBytes(limits.maxSvgBytes)} · MP4,
          MOV up to {formatBytes(limits.maxVideoBytes)} and {formatDuration(limits.maxVideoSeconds)} · {limits.maxBatchFiles}{" "}
          files per batch
        </p>
      </div>
      {!compact && (
        <p className="mx-auto mt-5 flex max-w-xl items-start justify-center gap-1.5 text-left text-[12px] text-muted">
          <ShieldIcon size={14} className="mt-px shrink-0" />
          <span>
            Files stay in this browser tab until you click <strong className="font-semibold text-ink">Generate</strong>.
            Then each file (or an analysis-only preview of it), its filename and your settings are sent to Google Gemini.
          </span>
        </p>
      )}
    </div>
  );
}
