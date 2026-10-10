"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { Icon } from "@/components/ui/icons"

// Toasts as the design's dark card (the after-swipe card in design/feed.html): inverse fill, 20 px corners,
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
        success: <Icon name="check" size={18} strokeWidth={2.5} />,
        info: <Icon name="info" size={18} strokeWidth={2.25} />,
        warning: <Icon name="info" size={18} strokeWidth={2.25} />,
        error: <Icon name="info" size={18} strokeWidth={2.25} />,
      }}
      style={
        {
          "--normal-bg": "var(--inverse)",
          "--normal-text": "var(--inverse-foreground)",
          "--normal-border": "transparent",
          "--border-radius": "20px",
          "--width": "448px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !gap-3 !px-3.5 !py-3 !shadow-float !font-sans",
          title: "!text-[15px] !font-semibold",
          description: "!text-[13px] !text-inverse-foreground/80",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
