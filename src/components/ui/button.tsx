import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // The design's buttons (design/*.html). "default" is kept only for the mock ATS form, which imitates another site.
        primary:
          "border-2 border-primary-edge bg-primary font-semibold text-primary-foreground shadow-button disabled:border-subtle disabled:bg-subtle disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none",
        line: "border-[1.5px] border-line bg-surface font-semibold text-foreground",
        strong: "border-2 border-edge bg-surface font-semibold text-foreground",
        plain: "border-[1.5px] border-line bg-transparent font-semibold text-foreground",
        quiet: "border-0 bg-transparent font-semibold text-muted-foreground",
        underline: "border-0 bg-transparent font-semibold text-foreground underline underline-offset-3",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // Design sizes: 56 main action, 52 second action, 48 small panel action, 44 row action, 44 text link.
        xl: "h-14 gap-2.5 rounded-control px-5 text-[17px]",
        lg: "h-13 gap-2 rounded-control px-5 text-base",
        md: "h-12 gap-2 rounded-field px-4 text-[15px]",
        row: "h-11 gap-2 rounded-tile px-4 text-[15px]",
        text: "h-11 px-1 text-[15px]",
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
