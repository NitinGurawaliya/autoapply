"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { Icon } from "@/components/ui/icons"

// Toasts (Direction B, Phase O3): the inverse fill, the control radius,
// floating shadow, under the top bar.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      offset={64}
      mobileOffset={{ top: 64, left: 16, right: 16 }}
      className="toaster group"
      icons={{
        success: <Icon name="check" size={18} />,
        info: <Icon name="info" size={18} />,
        warning: <Icon name="info" size={18} />,
        error: <Icon name="info" size={18} />,
      }}
      style={
        {
          "--normal-bg": "var(--inverse)",
          "--normal-text": "var(--inverse-foreground)",
          "--normal-border": "transparent",
          "--border-radius": "var(--r-control)",
          "--width": "448px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !gap-3 !px-3.5 !py-3 !shadow-float !font-sans",
          title: "!type-body !font-semibold",
          description: "!type-meta !text-inverse-foreground/75",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
