import { z } from "zod";

/** An icon is an emoji/short text (≤ 8 chars) or a small image as a data: URL (≤ 200 KB). null clears it. */
export const iconSchema = z
  .string()
  .max(280_000)
  .refine((s) => /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) || [...s].length <= 8, "Icon must be an emoji or a PNG/JPEG/WebP/GIF image")
  .nullable();
