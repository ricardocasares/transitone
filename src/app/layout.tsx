import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  variable: "--font-barlow",
});
const barlowCondensed = Barlow_Condensed({
  weight: ["400", "600"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-barlow-condensed",
});

export const metadata: Metadata = {
  title: "Kraków · Tram Tones",
  description:
    "Listen to Kraków in motion. Each live snapshot of stopped trams becomes a musical phrase on an interactive map of the city.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
