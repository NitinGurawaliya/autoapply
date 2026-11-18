"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";

// The bottom sheet: rounded top, a soft lift, a handle, and a dimmed page behind it (Direction B, Phase O3).
// It is a dialog underneath (role="dialog", focus trap). Whether it can be dismissed is the caller's choice:
// a controlled sheet with no onOpenChange cannot be closed by Escape or a tap outside.

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export function SheetContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <DialogPrimitive.Popup
        className={cn(
          "fixed inset-x-0 bottom-0 z-[60] mx-auto box-border flex max-h-[92dvh] w-full max-w-120 flex-col overflow-y-auto rounded-t-card bg-surface px-5 pt-2.5 pb-8 text-foreground shadow-pop outline-none duration-300 ease-calm data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          className,
        )}
        {...props}
      >
        <span aria-hidden="true" className="block h-1 w-9 flex-none self-center rounded-xs bg-line-strong" />
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}
