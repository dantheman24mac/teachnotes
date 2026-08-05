import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { isStagingEnvironment } from "@/lib/runtime-environment";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const staging = isStagingEnvironment();

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: staging
    ? { default: "STAGING · TeachNotes", template: "%s · STAGING · TeachNotes" }
    : { default: "TeachNotes", template: "%s · TeachNotes" },
  description: "Lesson notes, attendance, scheduling and invoicing for independent tutors.",
  applicationName: staging ? "TeachNotes Staging" : "TeachNotes",
  robots: staging ? { index: false, follow: false, noarchive: true } : undefined,
  openGraph: {
    type: "website",
    title: "TeachNotes",
    description: "Offline-friendly lesson management and invoicing for independent tutors.",
  },
};

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
      <body>
        {staging ? (
          <div className="staging-banner" role="status">
            STAGING · FICTIONAL TEST DATA · NOT PRODUCTION
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
