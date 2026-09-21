import type { Metadata } from "next";
import { Barlow } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  weight: ["400", "600"],
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "TransiTone · Kraków",
  description:
    "Listen to Kraków in motion. Each live snapshot of stopped trams becomes a musical phrase on an interactive map of the city.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={barlow.className}>
      <body>{children}</body>
    </html>
  );
}
