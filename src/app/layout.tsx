import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FocusReader",
  description: "Lector de enfoque: PDF, EPUB y TXT con resaltado de palabra y párrafo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
