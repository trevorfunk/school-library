import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

// Words that usually stay lowercase unless first/last
const SMALL_WORDS = new Set([
  "and", "or", "the", "a", "an", "of", "to", "in", "on", "for", "with", "at", "by"
]);

function toTitleCase(title) {
  const words = title
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim());

  return words
    .map((word, i) => {
      if (!word) return word;

      // Keep punctuation
      const lead = word.match(/^[^a-z0-9]+/i)?.[0] || "";
      const tail = word.match(/[^a-z0-9]+$/i)?.[0] || "";
      const core = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");

      if (
        i !== 0 &&
        i !== words.length - 1 &&
        SMALL_WORDS.has(core)
      ) {
        return lead + core + tail;
      }

      return (
        lead +
        core.charAt(0).toUpperCase() +
        core.slice(1) +
        tail
      );
    })
    .join(" ");
}

async function main() {
  const { data: books, error } = await supabase
    .from("books")
    .select("id,title");

  if (error) throw error;

  let updated = 0;

  for (const b of books) {
    if (!b.title) continue;

    const fixed = toTitleCase(b.title);
    if (fixed === b.title) continue;

    await supabase
      .from("books")
      .update({ title: fixed })
      .eq("id", b.id);

    console.log(`✓ ${b.title} → ${fixed}`);
    updated++;
  }

  console.log(`Done. Updated ${updated} titles.`);
}

main().catch(console.error);
