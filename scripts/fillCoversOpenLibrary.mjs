import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const BASE_DELAY_MS = Number(process.env.OPENLIB_DELAY_MS || 900);
const MAX_BOOKS = Number(process.env.OPENLIB_LIMIT || 500);

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenLibrary HTTP ${res.status}`);
  return await res.json();
}

function coverUrlFromCoverId(coverId) {
  return `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
}

function coverUrlFromEditionOlid(editionOlid) {
  return `https://covers.openlibrary.org/b/olid/${editionOlid}-M.jpg`;
}

async function openLibraryCoverLookup(title, author) {
  const q = author ? `"${title}" ${author}` : `"${title}"`;
  const fields = "key,cover_i,edition_key,title,author_name";

  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
    `&limit=5&fields=${encodeURIComponent(fields)}`;

  const search = await fetchJson(url);
  const docs = Array.isArray(search?.docs) ? search.docs : [];

  for (const doc of docs) {
    // Best: cover_i
    if (typeof doc.cover_i === "number") {
      return { url: coverUrlFromCoverId(doc.cover_i), source: `openlibrary:cover_i:${doc.cover_i}` };
    }

    // Fallback: edition OLID (sometimes works even if cover_i missing)
    const eds = Array.isArray(doc.edition_key) ? doc.edition_key : [];
    if (eds.length) {
      return { url: coverUrlFromEditionOlid(eds[0]), source: `openlibrary:edition:${eds[0]}` };
    }
  }

  return null;
}

async function main() {
  console.log("Starting Open Library cover fill…");

  const { data: books, error } = await supabase
    .from("books")
    .select("id,title,author,cover_url")
    .or("cover_url.is.null,cover_url.eq.")
    .limit(MAX_BOOKS);

  if (error) throw error;

  console.log(`Found ${books.length} books missing covers.`);

  let added = 0;
  let missed = 0;

  for (const b of books) {
    const title = (b.title || "").trim();
    const author = (b.author || "").trim();
    if (!title) continue;

    const found = await openLibraryCoverLookup(title, author);

    if (!found?.url) {
      console.log(`- No cover: ${title}`);
      missed++;
      await sleep(BASE_DELAY_MS);
      continue;
    }

    const { error: upErr } = await supabase
      .from("books")
      .update({
        cover_url: found.url,
        cover_source: found.source,
        cover_updated_at: new Date().toISOString(),
      })
      .eq("id", b.id);

    if (upErr) {
      console.log(`! Update failed: ${title} -> ${upErr.message}`);
    } else {
      console.log(`✓ Cover added: ${title}`);
      added++;
    }

    await sleep(BASE_DELAY_MS);
  }

  console.log("Done.");
  console.log("Added:", added);
  console.log("No cover:", missed);
}

main().catch(console.error);
