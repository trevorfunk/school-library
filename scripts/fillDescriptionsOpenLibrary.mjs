import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const BASE_DELAY_MS = Number(process.env.OPENLIB_DELAY_MS || 1200);
const MAX_BOOKS = Number(process.env.OPENLIB_LIMIT || 500);

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanText(t) {
  return String(t || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toShortBlurb(text) {
  const clean = cleanText(text);
  if (!clean) return "";

  const parts = clean.split(/(?<=[.!?])\s+/);
  return parts.slice(0, 2).join(" ").slice(0, 350);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenLibrary HTTP ${res.status}`);
  return await res.json();
}

async function openLibraryDescriptionLookup(title, author) {
  const q = author ? `"${title}" ${author}` : `"${title}"`;

  const searchUrl =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
    `&limit=5&fields=key,first_sentence,subtitle,text,edition_key`;

  const search = await fetchJson(searchUrl);
  const docs = Array.isArray(search?.docs) ? search.docs : [];

  for (const doc of docs) {
    // 1) SEARCH-LAYER BLURBS (best coverage)
    const searchBlurb =
      doc.first_sentence ||
      doc.subtitle ||
      doc.text;

    if (searchBlurb) {
      return {
        text: toShortBlurb(searchBlurb),
        source: "openlibrary:search",
      };
    }

    // 2) WORK DESCRIPTION
    if (doc.key && doc.key.startsWith("/works/")) {
      try {
        const work = await fetchJson(`https://openlibrary.org${doc.key}.json`);
        let d = work?.description;
        if (d && typeof d === "object") d = d.value;
        if (d) {
          return {
            text: toShortBlurb(d),
            source: `openlibrary:work:${doc.key}`,
          };
        }
      } catch {}
    }

    // 3) EDITION FALLBACK
    if (Array.isArray(doc.edition_key)) {
      for (const ed of doc.edition_key.slice(0, 2)) {
        try {
          const edition = await fetchJson(`https://openlibrary.org/books/${ed}.json`);
          const d = edition?.description || edition?.notes;
          if (d) {
            return {
              text: toShortBlurb(d),
              source: `openlibrary:edition:${ed}`,
            };
          }
        } catch {}
      }
    }
  }

  return null;
}

async function main() {
  console.log("Starting Open Library description fill…");

  const { data: books, error } = await supabase
    .from("books")
    .select("id,title,author,description")
    .or("description.is.null,description.eq.")
    .limit(MAX_BOOKS);

  if (error) throw error;

  console.log(`Found ${books.length} books missing descriptions.`);

  let added = 0;
  let missed = 0;

  for (const b of books) {
    const title = (b.title || "").trim();
    const author = (b.author || "").trim();
    if (!title) continue;

    const found = await openLibraryDescriptionLookup(title, author);

    if (!found?.text) {
      console.log(`- No description: ${title}`);
      missed++;
      await sleep(BASE_DELAY_MS);
      continue;
    }

    await supabase
      .from("books")
      .update({
        description: found.text,
        description_source: found.source,
        description_updated_at: new Date().toISOString(),
      })
      .eq("id", b.id);

    console.log(`✓ Description added: ${title}`);
    added++;
    await sleep(BASE_DELAY_MS);
  }

  console.log("Done.");
  console.log("Added:", added);
  console.log("No description:", missed);
}

main().catch(console.error);
