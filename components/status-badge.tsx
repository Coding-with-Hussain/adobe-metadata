import type { DisplayStatus, ProcessingStage } from "@/lib/queue/assets";
import { AlertIcon, BanIcon, CheckCircleIcon, ClockIcon, ErrorIcon, LoaderIcon, RefreshIcon, XIcon } from "./icons";
import { cx } from "./ui";

const STAGE_LABEL: Record<ProcessingStage, string> = {
  preparing: "Preparing",
  uploading: "Uploading",
  analyzing: "Analyzing",
  validating: "Validating",
};

const CONFIG: Record<DisplayStatus, { label: string; className: string; icon: React.ReactNode }> = {
  idle: { label: "Not started", className: "bg-surface-2 text-muted border-line", icon: <ClockIcon size={13} /> },
  queued: { label: "Queued", className: "bg-surface-2 text-muted border-line", icon: <ClockIcon size={13} /> },
  processing: { label: "Processing", className: "bg-info-soft text-info border-info/25", icon: <LoaderIcon size={13} /> },
  retrying: { label: "Retrying", className: "bg-warning-soft text-warning border-warning/25", icon: <RefreshIcon size={13} /> },
  ready: { label: "Ready", className: "bg-success-soft text-success border-success/25", icon: <CheckCircleIcon size={13} /> },
  needs_review: { label: "Needs review", className: "bg-warning-soft text-warning border-warning/25", icon: <AlertIcon size={13} /> },
  failed: { label: "Failed", className: "bg-danger-soft text-danger border-danger/25", icon: <ErrorIcon size={13} /> },
  cancelled: { label: "Cancelled", className: "bg-surface-2 text-muted border-line", icon: <BanIcon size={13} /> },
  rejected: { label: "Rejected", className: "bg-danger-soft text-danger border-danger/25", icon: <XIcon size={13} /> },
};

export function statusLabel(status: DisplayStatus, stage?: ProcessingStage, attempt?: number): string {
  if (status === "processing" && stage) return `${STAGE_LABEL[stage]}…`;
  if (status === "retrying" && attempt) return `Retrying (attempt ${attempt})`;
  return CONFIG[status].label;
}

export function StatusBadge({
  status,
  stage,
  attempt,
  className,
}: {
  status: DisplayStatus;
  stage?: ProcessingStage;
  attempt?: number;
  className?: string;
}) {
  const c = CONFIG[status];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium",
        c.className,
        className,
      )}
    >
      {c.icon}
      {statusLabel(status, stage, attempt)}
    </span>
  );
}
