import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face for headings and big numbers (the design's Bricolage Grotesque 600-800, optical size axis).
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Direction B's one family (Phase O, design/craft-b2.html), used when the page runs in look "b".
const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
});

// Which look the app runs in (Phase O): "b" (Direction B, the default since every screen was rebuilt, 18 Nov) or
// "classic" (the old lime look, kept one release as a fallback). NEXT_PUBLIC_LOOK=classic sets the default back;
// "?look=b" or "?look=classic" on any page saves a cookie that wins. The script runs before first paint (Next guide:
// preventing flash).
const LOOK = process.env.NEXT_PUBLIC_LOOK === "classic" ? "classic" : "b";
const LOOK_SCRIPT =
  '(function(){try{var q=new URLSearchParams(location.search).get("look");' +
  'if(q==="b"||q==="classic")document.cookie="look="+q+";path=/;max-age=31536000;samesite=lax";' +
  'var m=document.cookie.match(/(?:^|; )look=(b|classic)/);' +
  'if(m)document.documentElement.setAttribute("data-look",m[1])}catch(e){}})()';

export const metadata: Metadata = {
  title: "SwipeApply",
  description: "Swipe right. A governed agent applies for you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets the "dark" class from the phone's setting before paint, hence suppressHydrationWarning.
    <html
      lang="en"
      suppressHydrationWarning
      data-look={LOOK}
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${schibsted.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOOK_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
