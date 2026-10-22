import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 border border-transparent shadow-sm",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-ink",
  danger: "bg-surface text-danger border border-line-strong hover:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/** Square icon-only button; `label` is required for screen readers. */
export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors",
        "hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} aria-labelledby={id && title ? `${id}-title` : undefined} className={cx("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-semibold text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Notice({
  tone = "info",
  icon,
  title,
  children,
  className,
  role,
}: {
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const tones = {
    info: "bg-info-soft text-info border-info/25",
    warning: "bg-warning-soft text-warning border-warning/25",
    danger: "bg-danger-soft text-danger border-danger/25",
    success: "bg-success-soft text-success border-success/25",
    neutral: "bg-surface-2 text-muted border-line",
  } as const;
  return (
    <div role={role} className={cx("flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]", tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title ? "mt-0.5" : "", "text-ink/85 [&_a]:underline")}>{children}</div>}
      </div>
    </div>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {children}
      </label>
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export function Checkbox({
  id,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-[var(--accent)]"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-[12px] leading-snug text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-muted">{children}</kbd>;
}
