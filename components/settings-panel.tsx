"use client";

import { useId, useState } from "react";
import { parseTermList, SETTINGS_BOUNDS, type GenerationSettings, type KeywordStyle } from "@/lib/metadata/settings";
import { charCount, cleanInline } from "@/lib/metadata/text";
import { Checkbox, cx, FieldLabel, inputClass, Notice, Panel } from "./ui";
import { InfoIcon } from "./icons";

type Update = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => void;

function NumberField({
  id,
  label,
  value,
  min,
  max,
  hint,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Re-sync the draft when the committed value changes from outside (e.g. restored settings).
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setText(String(value));
  }
  const n = Number(text);
  const invalid = text.trim() === "" || !Number.isInteger(n) || n < min || n > max;
  const commit = () => {
    if (invalid) {
      const clamped = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : value;
      setText(String(clamped));
      onCommit(clamped);
    } else onCommit(n);
  };
  return (
    <div>
      <FieldLabel htmlFor={id} hint={hint}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        aria-invalid={invalid}
        aria-describedby={`${id}-range`}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (Number.isInteger(v) && v >= min && v <= max) onCommit(v);
        }}
        onBlur={commit}
        className={cx(inputClass, invalid && "border-danger")}
      />
      <p id={`${id}-range`} className={cx("mt-1 text-[11px]", invalid ? "text-danger" : "text-faint")}>
        {min}–{max}
      </p>
    </div>
  );
}

function TermsField({
  id,
  label,
  description,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  description: string;
  value: string[];
  onCommit: (terms: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const key = value.join("\u0000");
  const [synced, setSynced] = useState(key);
  if (synced !== key) {
    setSynced(key);
    setText(value.join(", "));
  }
  return (
    <div>
      <FieldLabel htmlFor={id} hint={`${value.length}/${SETTINGS_BOUNDS.terms.maxItems}`}>
        {label}
      </FieldLabel>
      <textarea
        id={id}
        rows={2}
        value={text}
        placeholder="Comma-separated, e.g. vector, isolated"
        aria-describedby={`${id}-desc`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(parseTermList(text))}
        className={cx(inputClass, "resize-y")}
      />
      <p id={`${id}-desc`} className="mt-1 text-[11px] leading-snug text-faint">
        {description}
      </p>
    </div>
  );
}

function AffixPreview({ prefix, suffix, max, what }: { prefix: string; suffix: string; max: number; what: string }) {
  const p = cleanInline(prefix);
  const s = cleanInline(suffix);
  if (!p && !s) return null;
  const fixed = charCount(p) + charCount(s) + (p ? 1 : 0) + (s ? 1 : 0);
  const left = max - fixed;
  return (
    <p className={cx("mt-1.5 rounded-md bg-surface-2 px-2 py-1.5 text-[12px]", left < 1 ? "text-danger" : "text-muted")}>
      <span className="font-mono text-ink">
        {p && `${p} `}
        <span className="text-accent">[{what}]</span>
        {s && ` ${s}`}
      </span>
      <br />
      {left < 1 ? "Prefix and suffix leave no room — shorten them or raise the limit." : `${left} of ${max} characters left for the generated ${what}.`}
    </p>
  );
}

const STYLES: { value: KeywordStyle; label: string; help: string }[] = [
  { value: "auto", label: "Auto", help: "Mix of words and short phrases (up to 3 words)" },
  { value: "single", label: "Single", help: "One word per keyword" },
  { value: "double", label: "Double", help: "Exactly two words per keyword" },
];

export function SettingsPanel({ settings, update }: { settings: GenerationSettings; update: Update }) {
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;
  const b = SETTINGS_BOUNDS;

  return (
    <Panel id="settings" title="Generation settings" description="Applied to files generated after a change. Existing results and edits are kept and re-checked against new limits.">
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <NumberField id={id("title")} label="Title" hint="chars" value={settings.titleMaxChars} min={b.titleMaxChars.min} max={b.titleMaxChars.max} onCommit={(n) => update("titleMaxChars", n)} />
          <NumberField id={id("desc")} label="Description" hint="chars" value={settings.descriptionMaxChars} min={b.descriptionMaxChars.min} max={b.descriptionMaxChars.max} onCommit={(n) => update("descriptionMaxChars", n)} />
          <NumberField id={id("kw")} label="Keywords" hint="count" value={settings.keywordCount} min={b.keywordCount.min} max={b.keywordCount.max} onCommit={(n) => update("keywordCount", n)} />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Keyword format</legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface-2 p-1">
            {STYLES.map((s) => (
              <label
                key={s.value}
                className={cx(
                  "cursor-pointer rounded-md px-2 py-1.5 text-center text-[13px] font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]",
                  settings.keywordStyle === s.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                <input
                  type="radio"
                  name={id("style")}
                  value={s.value}
                  checked={settings.keywordStyle === s.value}
                  onChange={() => update("keywordStyle", s.value)}
                  className="sr-only"
                />
                {s.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-faint">{STYLES.find((s) => s.value === settings.keywordStyle)?.help}</p>
        </fieldset>

        <TermsField
          id={id("include")}
          label="Include terms"
          value={settings.includeTerms}
          onCommit={(t) => update("includeTerms", t)}
          description="Added when Gemini confirms they fit the asset; otherwise the row is flagged for review instead of adding a misleading term."
        />
        <TermsField
          id={id("exclude")}
          label="Exclude terms"
          value={settings.excludeTerms}
          onCommit={(t) => update("excludeTerms", t)}
          description="Removes any keyword containing the term as a whole word (“dog” removes “dog park”, not “hotdog”)."
        />

        <div className="space-y-3 rounded-lg border border-line p-3">
          <Checkbox
            id={id("fntitle")}
            checked={settings.filenameAsTitle}
            onChange={(v) => update("filenameAsTitle", v)}
            label="Use filename as title"
            description="Title comes from the cleaned-up filename; Gemini still writes the description and keywords."
          />
          <Checkbox
            id={id("fnonly")}
            checked={settings.filenameOnly}
            onChange={(v) => update("filenameOnly", v)}
            label="Filename-only mode (no AI)"
            description="Nothing is sent to Gemini. Title, description and keywords are derived from filename words only, so they can be generic or wrong. Takes precedence over the option above."
          />
        </div>

        <details className="group rounded-lg border border-line">
          <summary className="cursor-pointer select-none px-3 py-2.5 text-[13px] font-medium text-ink marker:text-faint">
            Advanced: prefixes, suffixes and media options
          </summary>
          <div className="space-y-4 border-t border-line px-3 py-3">
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["titlePrefix", "Title prefix"],
                  ["titleSuffix", "Title suffix"],
                  ["descriptionPrefix", "Description prefix"],
                  ["descriptionSuffix", "Description suffix"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <FieldLabel htmlFor={id(key)}>{label}</FieldLabel>
                  <input
                    id={id(key)}
                    type="text"
                    maxLength={b.affix.maxLength}
                    value={settings[key]}
                    onChange={(e) => update(key, e.target.value)}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
            <AffixPreview prefix={settings.titlePrefix} suffix={settings.titleSuffix} max={settings.titleMaxChars} what="title" />
            <AffixPreview prefix={settings.descriptionPrefix} suffix={settings.descriptionSuffix} max={settings.descriptionMaxChars} what="description" />

            <div>
              <FieldLabel htmlFor={id("svg")}>SVG analysis</FieldLabel>
              <select id={id("svg")} value={settings.svgMode} onChange={(e) => update("svgMode", e.target.value as GenerationSettings["svgMode"])} className={inputClass}>
                <option value="standard">Standard — render in colour on white</option>
                <option value="silhouette">Silhouette — black shape on white (lossy)</option>
              </select>
              {settings.svgMode === "silhouette" && (
                <Notice tone="warning" className="mt-2" icon={<InfoIcon size={14} />}>
                  Silhouette mode hides colours and inner detail from Gemini. It only changes the analysis preview — your SVG file is never modified.
                </Notice>
              )}
            </div>
            <div>
              <FieldLabel htmlFor={id("png")}>PNG transparency for analysis</FieldLabel>
              <select id={id("png")} value={settings.pngBackground} onChange={(e) => update("pngBackground", e.target.value as GenerationSettings["pngBackground"])} className={inputClass}>
                <option value="white">Place on white</option>
                <option value="black">Place on black</option>
                <option value="transparent">Keep transparency</option>
              </select>
              <p className="mt-1 text-[11px] text-faint">Affects only the copy Gemini sees. Original PNG bytes are untouched.</p>
            </div>
          </div>
        </details>
      </div>
    </Panel>
  );
}
