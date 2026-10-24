"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A company's logo laid over its initials tile (CompanyMark): the initials show until the image loads, and stay if it
 * fails. White behind the logo so transparent and dark logos read in both themes. No referrer goes to the logo's host.
 */
export function LogoImage({ src }: { src: string }) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  // A cached logo can finish loading before React attaches onLoad (24 Oct: Anthropic's stayed invisible): read it once.
  useEffect(() => {
    const element = image.current;
    if (element?.complete) setState(element.naturalWidth > 0 ? "ok" : "failed");
  }, [src]);
  if (state === "failed") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- logos come from many hosts; next/image would need each one listed
    <img
      ref={image}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => setState("ok")}
      onError={() => setState("failed")}
      className={`absolute inset-0 size-full rounded-[inherit] bg-white object-contain p-[12%] transition-opacity duration-200 ${state === "ok" ? "opacity-100" : "opacity-0"}`}
    />
  );
}
