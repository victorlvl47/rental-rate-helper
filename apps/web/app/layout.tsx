import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RentalRateHelper",
  description:
    "A dashboard foundation for analyzing rental markets and planning competitive nightly rates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
