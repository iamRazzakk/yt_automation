import type { FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const layoutSchema = z.object({
  id: z.string(),
  canvas: z.object({ width: z.number(), height: z.number() }),
  background: z.object({
    type: z.enum(["blur", "color"]),
    color: z.string().optional(),
  }),
  slot: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    fit: z.enum(["cover", "contain"]),
  }),
  overlay: z.string(),
  caption: z.object({
    font: z.string(),
    fontSize: z.number(),
    bold: z.boolean(),
    primaryColor: z.string(),
    outlineColor: z.string(),
    outline: z.number(),
    x: z.number(),
    y: z.number(),
    alignment: z.number(),
    maxCharsPerLine: z.number(),
    maxLines: z.number(),
    wordsPerChunk: z.number(),
  }),
  thumbnail: z.object({
    width: z.number(),
    height: z.number(),
    overlay: z.string(),
    titleBox: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      fontSize: z.number(),
    }),
  }),
});

export type TemplateLayout = z.infer<typeof layoutSchema>;

export function templatesRoot(): string {
  return join(process.cwd(), "..", "assets", "templates");
}

export async function loadTemplate(id: string): Promise<TemplateLayout> {
  const raw = await readFile(join(templatesRoot(), id, "layout.json"), "utf8");
  return layoutSchema.parse(JSON.parse(raw));
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/templates", async () => {
    const root = templatesRoot();
    let dirs: string[] = [];
    try {
      dirs = await readdir(root);
    } catch {
      return { items: [] };
    }
    const items = [];
    for (const id of dirs) {
      try {
        const layout = await loadTemplate(id);
        items.push(layout);
      } catch {
        // skip invalid
      }
    }
    return { items };
  });
}
