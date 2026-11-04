/** Public base URL for links in alerts, invites and exports. Render sets RENDER_EXTERNAL_URL automatically. */
export const appUrl = () =>
  (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
