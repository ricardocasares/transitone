import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kraków · Tram Tones",
  description:
    "Listen to Kraków in motion. Each live snapshot of stopped trams becomes a musical phrase on an interactive map of the city.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
