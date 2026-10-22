import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MetadataGen Gemini — stock metadata in batches",
  description:
    "Generate editable titles, descriptions and keywords for stock photos, vectors and video with Google Gemini, then export CSV.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1013" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Browser extensions (password managers, translators, dark-mode tools) often add attributes to
  // <html>/<body> before React hydrates. suppressHydrationWarning ignores attribute differences on
  // these two elements only; mismatches inside the app are still reported.
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
