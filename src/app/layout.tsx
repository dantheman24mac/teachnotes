import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const description =
  "Lesson notes, attendance, scheduling and invoicing for independent tutors.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const metadataBase = new URL(
    host && /^[a-z0-9.:-]+$/i.test(host)
      ? `${protocol === "http" ? "http" : "https"}://${host}`
      : "https://teachnotes.fyi",
  );

  return {
    metadataBase,
    title: { default: "TeachNotes", template: "%s · TeachNotes" },
    description,
    applicationName: "TeachNotes",
    openGraph: {
      title: "TeachNotes",
      description,
      type: "website",
      siteName: "TeachNotes",
      images: [
        {
          url: "/og.png",
          width: 1731,
          height: 909,
          alt: "TeachNotes lesson agenda, notes and invoicing dashboard",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "TeachNotes",
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
