import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "TeachNotes", template: "%s · TeachNotes" },
  description: "Lesson notes, attendance, scheduling and invoicing for independent tutors.",
  applicationName: "TeachNotes",
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
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
