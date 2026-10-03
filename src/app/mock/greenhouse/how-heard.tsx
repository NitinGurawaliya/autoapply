"use client";

import { useId, useState } from "react";

const OPTIONS = ["Job board", "Referral", "Company website", "Other"];

export function HowHeardCombobox() {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("Job board");

  return (
    <div className="relative">
      <input
        id="how_heard"
        name="how_heard"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setOpen(true)}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-sm"
        >
          {OPTIONS.map((option) => (
            <li key={option} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={value === option}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setValue(option);
                  setOpen(false);
                }}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
