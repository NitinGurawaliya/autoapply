import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-color,color] duration-120 ease-calm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-98 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // Direction B (Phase O3, design/craft-b2.html): one filled button per screen (primary, the accent); the rest are
        // quiet outlines or text. Disabled is a recessed grey, never mistaken for a secondary button. "default" is kept
        // only for the mock ATS form, which imitates another site.
        primary:
          "bg-primary font-semibold text-primary-foreground active:bg-brand-press disabled:bg-sunk disabled:text-faint disabled:opacity-100",
        line: "border-line-strong bg-surface font-semibold text-foreground active:bg-sunk disabled:border-transparent disabled:bg-sunk disabled:text-faint disabled:opacity-100",
        strong: "border-line-strong bg-surface font-semibold text-foreground active:bg-sunk disabled:border-transparent disabled:bg-sunk disabled:text-faint disabled:opacity-100",
        plain: "border-line-strong bg-transparent font-semibold text-foreground active:bg-sunk disabled:text-faint disabled:opacity-100",
        quiet: "border-0 bg-transparent font-semibold text-muted-foreground active:text-foreground",
        underline: "border-0 bg-transparent font-semibold text-foreground underline decoration-1 underline-offset-4",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // Direction B: 48 for the actions under a card or a form, 44 for rows and text links. Every label is type-body.
        xl: "h-12 gap-2 rounded-control px-5 type-body",
        lg: "h-12 gap-2 rounded-control px-5 type-body",
        md: "h-11 gap-2 rounded-control px-4 type-body",
        row: "h-11 gap-2 rounded-control px-4 type-body",
        text: "h-11 px-1 type-body",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
