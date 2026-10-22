"use client";

import { useState } from "react";
import type { Asset } from "@/lib/queue/assets";
import { FileIcon, FilmIcon, ImageIcon, PenToolIcon } from "./icons";
import { cx } from "./ui";

/**
 * Local preview from an object URL. SVGs are shown through <img>, which never
 * runs scripts or loads external resources, so untrusted markup is never
 * injected into the page.
 */
export function Thumbnail({ asset, size = 56 }: { asset: Asset; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  const base = "shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2";

  if (asset.previewUrl && !failed) {
    if (asset.kind === "video") {
      return (
        <div className={cx(base, "relative")} style={style}>
          <video
            src={`${asset.previewUrl}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 p-0.5 text-white">
            <FilmIcon size={11} />
          </span>
        </div>
      );
    }
    return (
      <div className={cx(base, asset.kind === "svg" && "bg-white")} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        <img
          src={asset.previewUrl}
          alt=""
          onError={() => setFailed(true)}
          className={cx("h-full w-full", asset.kind === "svg" ? "object-contain p-1" : "object-cover")}
        />
      </div>
    );
  }

  const Icon = asset.kind === "video" ? FilmIcon : asset.kind === "svg" ? PenToolIcon : asset.kind === "image" ? ImageIcon : FileIcon;
  return (
    <div className={cx(base, "flex items-center justify-center text-faint")} style={style}>
      <Icon size={Math.round(size * 0.4)} />
    </div>
  );
}
