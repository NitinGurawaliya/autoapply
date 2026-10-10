"use client";

import * as React from "react";
import { cn } from "cn";

type OtpInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Number of boxes. Greenhouse codes are 8 characters. */
  length?: number;
  label: string;
  disabled?: boolean;
};

/**
 * The design's code boxes: one real input stretched invisibly over the boxes, so typing, pasting and the phone's
 * one-time-code autofill all work. Letters and digits are kept (Greenhouse codes mix both); spaces are dropped.
 */
export function OtpInput({ id, value, onChange, length = 6, label, disabled }: OtpInputProps) {
  const chars = value.slice(0, length).split("");
  return (
    <div className="relative grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
      {Array.from({ length }, (_, index) => {
        const active = index === chars.length && chars.length < length;
        return (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              "box-border flex h-[58px] items-center justify-center rounded-field bg-background font-display text-[26px] font-extrabold uppercase tabular-nums",
              active ? "border-3 border-ring" : chars[index] ? "border-2 border-edge" : "border-2 border-input",
            )}
          >
            {chars[index] ?? ""}
          </span>
        );
      })}
      <input
        id={id}
        aria-label={label}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={length}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.replace(/\s+/g, "").slice(0, length))}
        className="absolute inset-0 box-border size-full cursor-text border-0 text-base opacity-[0.01]"
      />
    </div>
  );
}
