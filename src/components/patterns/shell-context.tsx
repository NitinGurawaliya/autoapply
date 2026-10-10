"use client";

import { createContext, useContext, type ReactNode } from "react";

// What every page's top bar needs from the signed-in layout: who is signed in, and the sign-out form
// (a server action, so it is rendered by the server layout and handed down).
type Shell = { name: string | null; email: string; signOut: ReactNode };

const ShellContext = createContext<Shell | null>(null);

export function ShellProvider({ value, children }: { value: Shell; children: ReactNode }) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}
