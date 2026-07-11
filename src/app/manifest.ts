import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TeachNotes",
    short_name: "TeachNotes",
    description: "Lesson notes, attendance, scheduling and invoicing for tutors.",
    start_url: "/today",
    display: "standalone",
    background_color: "#f5f4ee",
    theme_color: "#143f39",
  };
}
