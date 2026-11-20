import {
  AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env,
} from "@huggingface/transformers";
import sharp from "sharp";
import { join } from "node:path";
import { ROOT } from "./db.ts";

const MODEL = "Xenova/clip-vit-base-patch32";
export const USER_AGENT = "logo-mcp/0.1 (personal noncommercial design reference; github.com/cdinnison)";
env.cacheDir = join(ROOT, "data", "models");

let models: Promise<{ processor: any; vision: any; tokenizer: any; text: any }> | undefined;
const load = () =>
  (models ??= (async () => ({
    processor: await AutoProcessor.from_pretrained(MODEL),
    vision: await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "fp32" }),
    tokenizer: await AutoTokenizer.from_pretrained(MODEL),
    text: await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "fp32" }),
  }))());

const normalize = (v: Float32Array) => {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s);
  return v.map((x) => x / s);
};

/** Fetch an image, flatten transparency onto white, embed it. The bytes live only in memory. */
export async function embedImageUrl(url: string): Promise<Float32Array> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const input = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(input, { density: 144 })
    .flatten({ background: "#ffffff" })
    .resize(256, 256, { fit: "contain", background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { processor, vision } = await load();
  const { image_embeds } = await vision(await processor(new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3)));
  return normalize(new Float32Array(image_embeds.data));
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const { tokenizer, text } = await load();
  const { text_embeds } = await text(tokenizer(texts, { padding: true, truncation: true }));
  const d = text_embeds.dims[1];
  return texts.map((_, i) => normalize(new Float32Array(text_embeds.data.slice(i * d, (i + 1) * d))));
}

export const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
