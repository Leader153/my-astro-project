// @ts-check
import { defineConfig } from "astro/config";
import partytown from "@astrojs/partytown";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  //site: 'https://raspy-bar-48d5.pages.dev',
  integrations: [
    partytown({
      config: {
        forward: ["dataLayer.push", "gtag"],
      },
    }),
    sitemap(),
  ],
  // ══ SEO Redirects ══
  // /herzliya (правильное написание) → /hertzliya (основной файл)
  // /מרינה-הרצליה (старый URL с иврита) → /hertzliya
  redirects: {
    "/herzliya": "/hertzliya",
    "/מרינה-הרצליה": "/hertzliya",
  },
});
