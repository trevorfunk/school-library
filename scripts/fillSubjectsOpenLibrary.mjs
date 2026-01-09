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

function normalizeSubject(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "");
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const k = x.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenLibrary HTTP ${res.status}`);
  return await res.json();
}

function getWorkKeyFromDoc(doc) {
  const k = doc?.key;
  if (typeof k === "string" && k.startsWith("/works/")) return k;
  return null;
}

async function openLibrarySubjectsLookup(title, author) {
 const q = author ? `"${title}" ${author}` : `"${title}"`;

 const searchUrl =
 `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
 `&limit=5&fields=key,title,author_name,subject,subject_facet,subject_key`;


 const search = await fetchJson(searchUrl);
 const docs = Array.isArray(search?.docs) ? search.docs : [];

 for (const doc of docs) {
   const raw =
     doc.subject ||
     doc.subject_facet ||
     doc.subject_key ||
     [];

   if (!Array.isArray(raw) || raw.length === 0) continue;

   const subjects = uniq(
     raw.map(normalizeSubject).filter(Boolean)
   );

   if (subjects.length) {
     return {
       subjects,
       workKey: doc.key || "search",
     };
   }
 }

 return null;
}



async function main() {
  console.log("Starting Open Library subjects fill…");

  const { data: books, error } = await supabase
    .from("books")
    .select("id,title,author,subjects")
    .or("subjects.is.null,subjects.eq.{}")
    .limit(MAX_BOOKS);

  if (error) throw error;

  console.log(`Found ${books.length} books missing subjects.`);

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const title = (b.title || "").trim();
    const author = (b.author || "").trim();
    if (!title) continue;

    const found = await openLibrarySubjectsLookup(title, author);
    if (!found?.subjects?.length) {
      console.log(`- No subjects: ${title}`);
      await sleep(BASE_DELAY_MS);
      continue;
    }

    await supabase
      .from("books")
      .update({
        subjects: found.subjects,
        subjects_source: `openlibrary:${found.workKey}`,
        subjects_updated_at: new Date().toISOString(),
      })
      .eq("id", b.id);

    console.log(`✓ Subjects added: ${title} (${found.subjects.length})`);
    await sleep(BASE_DELAY_MS);
  }

  console.log("Done.");
}

main().catch(console.error);
