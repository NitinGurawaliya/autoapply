"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";

// The design's bottom sheet: rounded top, ink top edge, a handle, and a dimmed page behind it.
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
          "fixed inset-x-0 bottom-0 z-[60] mx-auto box-border flex max-h-[92dvh] w-full max-w-[480px] flex-col overflow-y-auto rounded-t-card border-t-2 border-edge bg-surface px-5 pt-2.5 pb-[30px] text-foreground outline-none duration-300 ease-settle data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          className,
        )}
        {...props}
      >
        <span aria-hidden="true" className="block h-[5px] w-10 flex-none self-center rounded-full bg-line-strong" />
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}
