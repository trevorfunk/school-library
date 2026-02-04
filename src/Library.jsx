// src/Library.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

// Hardcoded admin fallback (works even if profiles table is missing)
const ADMIN_UID = "935b30a6-927e-4625-9cef-6e8a1581c33f";
const ADMIN_EMAIL = "trevorjonfunk@gmail.com";

export default function Library({ onSignOut, onHome }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [books, setBooks] = useState([]);
  const [themes, setThemes] = useState([]);
  const [categories, setCategories] = useState([]);

  // Role
  const [role, setRole] = useState("student");
  const isAdmin = role === "admin";

  // Admin-only: active checkout list (who has what right now)
  const [activeLoans, setActiveLoans] = useState([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansErr, setLoansErr] = useState("");
  const [loansOpen, setLoansOpen] = useState(false);
  const [loanActingCopyId, setLoanActingCopyId] = useState("");

  // Category dropdown filter
  const CAT_ALL = "__ALL__";
  const CAT_UNC = "__UNCATEGORIZED__";
  const [categoryFilter, setCategoryFilter] = useState(CAT_ALL);

  // Modals
  const [showDetailsBook, setShowDetailsBook] = useState(null);
  const [editingTagsBook, setEditingTagsBook] = useState(null);
  const [editingInfoBook, setEditingInfoBook] = useState(null);
  const [managingCopiesBook, setManagingCopiesBook] = useState(null);

  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  // Add book form (admin only)
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");

  // “Check out” from card opens Details and auto-focuses first available copy
  const [detailsAutoCheckout, setDetailsAutoCheckout] = useState(false);

  async function loadRole() {
    const { data: u } = await supabase.auth.getUser();
    const user = u?.user;
    if (!user) return;

    const hardAdmin =
      user.id === ADMIN_UID ||
      (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());

    // Preferred: read role from profiles (if it exists)
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!error && data?.role) {
        setRole(data.role);
        return;
      }
    } catch {
      // ignore
    }

    // Fallback
    setRole(hardAdmin ? "admin" : "student");
  }

  async function loadMeta() {
    const [{ data: themeData, error: tErr }, { data: catData, error: cErr }] =
      await Promise.all([
        supabase.from("themes").select("id,name").order("name"),
        supabase.from("categories").select("id,name").order("name"),
      ]);

    if (tErr) setErr(tErr.message);
    if (cErr) setErr(cErr.message);

    setThemes(themeData || []);
    setCategories(catData || []);
  }

  async function loadBooks() {
    setLoading(true);
    setErr("");

    const { data, error } = await supabase
      .from("books")
      .select(
        `
        id,title,author,description,subjects,cover_url,created_at,
        book_themes(theme_id, themes(name)),
        book_categories(category_id, categories(name))
      `
      )
      .order("title", { ascending: true });

    if (error) setErr(error.message);
    setBooks(data || []);
    setLoading(false);
  }

  async function loadActiveLoans() {
    // Only admins should load the active checkout list
    if (!isAdmin) {
      setActiveLoans([]);
      return;
    }

    setLoansLoading(true);
    setLoansErr("");

    try {
      // Active (not checked in) loans
      const { data: loans, error: loansError } = await supabase
        .from("circulation")
        .select("*")
        .is("checked_in_at", null)
        .order("checked_out_at", { ascending: false });

      if (loansError) throw loansError;

      const copyIds = [...new Set((loans || []).map((l) => l.copy_id).filter(Boolean))];

      if (!copyIds.length) {
        setActiveLoans([]);
        return;
      }

      // Copies -> book_id (+ copy_code if present)
      const { data: copies, error: copiesError } = await supabase
        .from("book_copies")
        .select("id, book_id, copy_code")
        .in("id", copyIds);

      if (copiesError) throw copiesError;

      const copyById = new Map((copies || []).map((c) => [c.id, c]));
      const bookIds = [...new Set((copies || []).map((c) => c.book_id).filter(Boolean))];

      // Books -> title/author/cover
      const { data: booksRows, error: booksError } = await supabase
        .from("books")
        .select("id, title, author, cover_url")
        .in("id", bookIds);

      if (booksError) throw booksError;

      const bookById = new Map((booksRows || []).map((b) => [b.id, b]));

      const merged = (loans || []).map((l) => {
        const copy = copyById.get(l.copy_id);
        const bookId = copy ? copy.book_id : null;
        const book = bookId ? bookById.get(bookId) : null;

        return {
          ...l,
          book_id: bookId,
          copy_code: copy?.copy_code || "",
          book_title: book?.title || "(Unknown book)",
          book_author: book?.author || "",
          book_cover_url: book?.cover_url || null,
          checked_out_time: l.checked_out_at || l.created_at || null,
        };
      });

      setActiveLoans(merged);
    } catch (e) {
      setLoansErr(e?.message || String(e));
    } finally {
      setLoansLoading(false);
    }
  }

  async function checkInFromCheckedOutList(copyId) {
    if (!isAdmin) return;

    setLoanActingCopyId(copyId);
    setLoansErr("");

    const { error } = await supabase.rpc("checkin_copy", { p_copy_id: copyId });

    setLoanActingCopyId("");

    if (error) {
      setLoansErr(error.message);
      return;
    }

    await loadActiveLoans();
    await loadBooks();
  }

  useEffect(() => {
    loadRole();
    loadMeta();
    loadBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAdmin) loadActiveLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const activeCopyIdsByBookId = useMemo(() => {
    const m = new Map();
    for (const r of activeLoans) {
      if (!r.book_id || !r.copy_id) continue;
      const arr = m.get(r.book_id) || [];
      arr.push(r.copy_id);
      m.set(r.book_id, arr);
    }
    return m;
  }, [activeLoans]);

  // ---- category counts + options (hide empty categories) ----
  const categoryCounts = useMemo(() => {
    const counts = new Map();
    let unc = 0;

    for (const b of books) {
      const names = (b.book_categories || [])
        .map((bc) => bc.categories?.name)
        .filter(Boolean);

      if (!names.length) {
        unc += 1;
        continue;
      }
      for (const n of names) {
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }

    return { counts, unc };
  }, [books]);

  const categoryOptions = useMemo(() => {
    const opts = [{ value: CAT_ALL, label: `All (${books.length})` }];

    const nonEmpty = Array.from(categoryCounts.counts.entries())
      .filter(([, c]) => c > 0)
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));

    for (const [name, count] of nonEmpty) {
      opts.push({ value: name, label: `${name} (${count})` });
    }

    if (categoryCounts.unc > 0) {
      opts.push({ value: CAT_UNC, label: `Uncategorized (${categoryCounts.unc})` });
    }

    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books.length, categoryCounts, CAT_ALL, CAT_UNC]);

  // If you’re on a category that becomes empty, bounce back to All
  useEffect(() => {
    if (categoryFilter === CAT_ALL) return;

    if (categoryFilter === CAT_UNC) {
      if (categoryCounts.unc === 0) setCategoryFilter(CAT_ALL);
      return;
    }

    const c = categoryCounts.counts.get(categoryFilter) || 0;
    if (c === 0) setCategoryFilter(CAT_ALL);
  }, [categoryFilter, categoryCounts, CAT_ALL, CAT_UNC]);

  // ---- filtered list (category dropdown + search) ----
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return books
      .filter((b) => {
        const themeNames = (b.book_themes || []).map((bt) => bt.themes?.name || "");
        const categoryNames = (b.book_categories || []).map((bc) => bc.categories?.name || "");
        const subjectsList = Array.isArray(b.subjects) ? b.subjects : [];

        // 1) category filter
        if (categoryFilter !== CAT_ALL) {
          if (categoryFilter === CAT_UNC) {
            if (categoryNames.filter(Boolean).length) return false;
          } else {
            if (!categoryNames.some((n) => n === categoryFilter)) return false;
          }
        }

        // 2) search filter
        if (!qq) return true;

        const haystack = [
          b.title || "",
          b.author || "",
          b.description || "",
          ...subjectsList,
          ...themeNames,
          ...categoryNames,
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(qq);
      })
      .sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" })
      );
  }, [books, q, categoryFilter, CAT_ALL, CAT_UNC]);

  async function addBook(e) {
    e.preventDefault();
    setErr("");

    const t = title.trim();
    if (!t) return setErr("Title is required.");

    const { error } = await supabase.from("books").insert({
      title: t,
      author: author.trim() || null,
      description: description.trim() || null,
    });

    if (error) return setErr(error.message);

    setTitle("");
    setAuthor("");
    setDescription("");
    await loadBooks();
  }

  async function updateBook(bookId, patch) {
    setErr("");
    const { error } = await supabase.from("books").update(patch).eq("id", bookId);
    if (error) return setErr(error.message);
    await loadBooks();
  }

  // Safe delete: blocks deletion if the book has any copies
  async function deleteBook(bookId, bookTitle) {
    setErr("");
    setDeletingId(bookId);

    const { count, error: countErr } = await supabase
      .from("book_copies")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId);

    if (countErr) {
      setDeletingId("");
      setErr(countErr.message);
      return false;
    }

    if ((count || 0) > 0) {
      setDeletingId("");
      setErr(`Can’t delete "${bookTitle}": it has copies. Remove copies first.`);
      return false;
    }

    const { error } = await supabase.from("books").delete().eq("id", bookId);
    setDeletingId("");

    if (error) {
      setErr(error.message);
      return false;
    }

    await loadBooks();
    return true;
  }

  async function saveLinks(bookId, selectedThemeIds, selectedCategoryIds) {
    setSaving(true);
    setErr("");

    const [{ data: curT, error: et }, { data: curC, error: ec }] =
      await Promise.all([
        supabase.from("book_themes").select("theme_id").eq("book_id", bookId),
        supabase.from("book_categories").select("category_id").eq("book_id", bookId),
      ]);

    if (et) {
      setSaving(false);
      return setErr(et.message);
    }
    if (ec) {
      setSaving(false);
      return setErr(ec.message);
    }

    const curThemeIds = new Set((curT || []).map((r) => r.theme_id));
    const curCategoryIds = new Set((curC || []).map((r) => r.category_id));

    const nextThemeIds = new Set(selectedThemeIds);
    const nextCategoryIds = new Set(selectedCategoryIds);

    const themesToAdd = [...nextThemeIds].filter((id) => !curThemeIds.has(id));
    const themesToRemove = [...curThemeIds].filter((id) => !nextThemeIds.has(id));

    const catsToAdd = [...nextCategoryIds].filter((id) => !curCategoryIds.has(id));
    const catsToRemove = [...curCategoryIds].filter((id) => !nextCategoryIds.has(id));

    if (themesToAdd.length) {
      const { error } = await supabase.from("book_themes").insert(
        themesToAdd.map((theme_id) => ({ book_id: bookId, theme_id }))
      );
      if (error) {
        setSaving(false);
        return setErr(error.message);
      }
    }

    if (catsToAdd.length) {
      const { error } = await supabase.from("book_categories").insert(
        catsToAdd.map((category_id) => ({ book_id: bookId, category_id }))
      );
      if (error) {
        setSaving(false);
        return setErr(error.message);
      }
    }

    if (themesToRemove.length) {
      const { error } = await supabase
        .from("book_themes")
        .delete()
        .eq("book_id", bookId)
        .in("theme_id", themesToRemove);
      if (error) {
        setSaving(false);
        return setErr(error.message);
      }
    }

    if (catsToRemove.length) {
      const { error } = await supabase
        .from("book_categories")
        .delete()
        .eq("book_id", bookId)
        .in("category_id", catsToRemove);
      if (error) {
        setSaving(false);
        return setErr(error.message);
      }
    }

    setSaving(false);
    await loadBooks();
  }

  function chipStyle() {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 10px",
      borderRadius: 999,
      border: "1px solid #ddd",
      fontSize: 12,
      opacity: 0.95,
      background: "white",
    };
  }

  return (
    <div style={{ minHeight: "100vh", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>Library Catalogue</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            Search by title, author, description, subject, category, or theme
            <span style={{ marginLeft: 10, fontWeight: 700 }}>
              ({isAdmin ? "Admin" : "Student"} mode)
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onHome ? (
            <button
              onClick={onHome}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ddd",
                cursor: "pointer",
                background: "white",
              }}
            >
              Home
            </button>
          ) : null}

          <button
            onClick={onSignOut}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ddd",
              cursor: "pointer",
              background: "white",
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Search + Category dropdown */}
      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          style={{
            flex: "1 1 320px",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
          }}
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
          }}
          title="Filter by category"
        >
          {categoryOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <button onClick={loadBooks} style={btn()}>
          Refresh
        </button>
      </div>

      {err ? (
        <div style={{ marginTop: 10, color: "crimson", fontSize: 13 }}>{err}</div>
      ) : null}

      {/* ADMIN: Checked out list */}
      {isAdmin ? (
        <section
          style={{
            marginTop: 16,
            border: "1px solid #ddd",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 900 }}>Checked Out</div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>Who has what right now (active loans)</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setLoansOpen((v) => !v)} style={btn()}>
                {loansOpen ? "Hide list" : `Show list (${activeLoans.length})`}
              </button>

              <button onClick={loadActiveLoans} style={btn()} disabled={loansLoading}>
                {loansLoading ? "Loading…" : "Refresh list"}
              </button>
            </div>
          </div>

          {loansOpen ? (
            <>
              {loansErr ? (
                <div style={{ marginTop: 10, color: "crimson", fontSize: 13 }}>{loansErr}</div>
              ) : null}

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {!loansLoading && activeLoans.length === 0 ? (
                  <div style={{ fontSize: 13, opacity: 0.75 }}>No books currently checked out.</div>
                ) : null}

                {activeLoans.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 12,
                      background: "white",
                    }}
                  >
                    <img
                      src={r.book_cover_url || "/placeholder-cover.png"}
                      alt=""
                      style={{
                        width: 44,
                        height: 66,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid #eee",
                      }}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, lineHeight: 1.2 }}>
                        {r.book_title}
                        {r.book_author ? (
                          <span style={{ fontWeight: 600, opacity: 0.8 }}> — {r.book_author}</span>
                        ) : null}
                      </div>

                      <div style={{ marginTop: 4, fontSize: 13 }}>
                        Borrower: <span style={{ fontWeight: 800 }}>{r.borrower_name || "—"}</span>
                        {r.borrower_class ? <span style={{ opacity: 0.8 }}> ({r.borrower_class})</span> : null}
                      </div>

                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                        Checked out: {r.checked_out_time ? new Date(r.checked_out_time).toLocaleString() : "—"}
                        {r.due_at ? ` • Due: ${new Date(r.due_at).toLocaleDateString()}` : ""}
                        {r.copy_code ? ` • Copy: ${r.copy_code}` : ""}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => checkInFromCheckedOutList(r.copy_id)}
                        disabled={loanActingCopyId === r.copy_id}
                        style={{ ...btn(), opacity: loanActingCopyId === r.copy_id ? 0.6 : 1 }}
                        title="Check this copy back in"
                      >
                        {loanActingCopyId === r.copy_id ? "Checking in…" : "Check in"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
              {activeLoans.length} active loan(s)
            </div>
          )}
        </section>
      ) : null}

      {/* Add Book (admin only) */}
      {isAdmin ? (
        <form
          onSubmit={addBook}
          style={{
            marginTop: 16,
            border: "1px solid #ddd",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 800 }}>Add a Book</div>

          <div
            style={{
              marginTop: 10,
              display: "grid",
              gap: 10,
              gridTemplateColumns: "1fr 1fr",
            }}
          >
            <input
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ddd",
                gridColumn: "1 / span 2",
              }}
              placeholder="Title *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
              placeholder="Author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
            <input
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
              placeholder="(later) ISBN / Level / Publisher"
              disabled
            />
            <textarea
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ddd",
                gridColumn: "1 / span 2",
              }}
              placeholder="Description / blurb (helps searches)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <button style={{ ...btn(), marginTop: 10 }}>Add book</button>
        </form>
      ) : null}

      {/* Results */}
      <div style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>
        {loading ? "Loading…" : `${filtered.length} book(s)`}
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        {filtered.map((b) => {
          const themeChips = (b.book_themes || [])
            .map((bt) => bt.themes?.name)
            .filter(Boolean);

          const categoryChips = (b.book_categories || [])
            .map((bc) => bc.categories?.name)
            .filter(Boolean);

          const subjectChips = Array.isArray(b.subjects) ? b.subjects : [];

          const bookActiveCopyIds = activeCopyIdsByBookId.get(b.id) || [];
          const bookHasActiveLoan = isAdmin && bookActiveCopyIds.length > 0;

          return (
            <div key={b.id} style={{ border: "1px solid #ddd", borderRadius: 16, padding: 16 }}>
              {/* Header row: cover + title + ONLY Details/Check out */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailsAutoCheckout(false);
                      setShowDetailsBook(b);
                    }}
                    style={linkBtn()}
                    title="Open details"
                  >
                    {b.cover_url ? (
                      <img
                        src={b.cover_url}
                        alt={`Cover: ${b.title}`}
                        style={{
                          width: 60,
                          height: 90,
                          objectFit: "cover",
                          borderRadius: 10,
                          border: "1px solid #eee",
                          background: "#fafafa",
                          display: "block",
                        }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        style={{
                          width: 60,
                          height: 90,
                          borderRadius: 10,
                          border: "1px solid #eee",
                          background: "#fafafa",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                          opacity: 0.6,
                          textAlign: "center",
                          padding: 6,
                        }}
                      >
                        No cover
                      </div>
                    )}
                  </button>

                  <div style={{ minWidth: 260 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setDetailsAutoCheckout(false);
                        setShowDetailsBook(b);
                      }}
                      style={{
                        ...linkBtn(),
                        fontWeight: 900,
                        fontSize: 16,
                        textAlign: "left",
                        padding: 0,
                      }}
                      title="Open details"
                    >
                      {b.title}
                    </button>
                    {b.author ? <div style={{ fontSize: 13, opacity: 0.8 }}>{b.author}</div> : null}
                  </div>
                </div>

                {/* ONLY TWO BUTTONS */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailsAutoCheckout(false);
                      setShowDetailsBook(b);
                    }}
                    style={btn()}
                  >
                    Details
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      // Admin: if this book is currently checked out, allow quick check-in (single copy),
                      // or open Details if multiple copies are out.
                      if (bookHasActiveLoan) {
                        if (bookActiveCopyIds.length === 1) {
                          checkInFromCheckedOutList(bookActiveCopyIds[0]);
                          return;
                        }
                        setDetailsAutoCheckout(false);
                        setShowDetailsBook(b);
                        return;
                      }

                      // Default: open Details and auto-select first available copy to check out
                      setDetailsAutoCheckout(true);
                      setShowDetailsBook(b);
                    }}
                    style={btn()}
                  >
                    {bookHasActiveLoan ? "Check in" : "Check out"}
                  </button>
                </div>
              </div>

              {b.description ? <div style={{ marginTop: 8, fontSize: 14 }}>{b.description}</div> : null}

              {/* Subjects */}
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {subjectChips.length ? (
                  subjectChips.slice(0, 10).map((name) => (
                    <span key={name} style={chipStyle()}>
                      {name}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>No subjects yet</span>
                )}
                {subjectChips.length > 10 ? (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>+{subjectChips.length - 10} more</span>
                ) : null}
              </div>

              {/* Categories */}
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {categoryChips.length ? (
                  categoryChips.map((name) => (
                    <span key={name} style={chipStyle()}>
                      <CategoryBadge name={name} />
                      {name}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>No categories yet</span>
                )}
              </div>

              {/* Themes */}
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {themeChips.length ? (
                  themeChips.map((name) => (
                    <span key={name} style={chipStyle()}>
                      {name}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>No themes yet</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* DETAILS */}
      {showDetailsBook ? (
        <BookDetailsModal
          book={showDetailsBook}
          isAdmin={isAdmin}
          autoCheckout={detailsAutoCheckout}
          onCirculationChanged={loadActiveLoans}
          deleting={deletingId === showDetailsBook.id}
          onClose={() => {
            setShowDetailsBook(null);
            setDetailsAutoCheckout(false);
          }}
          onEditInfo={() => {
            if (!isAdmin) return;
            setEditingInfoBook(showDetailsBook);
            setShowDetailsBook(null);
            setDetailsAutoCheckout(false);
          }}
          onEditTags={() => {
            if (!isAdmin) return;
            setEditingTagsBook(showDetailsBook);
            setShowDetailsBook(null);
            setDetailsAutoCheckout(false);
          }}
          onManageCopies={() => {
            if (!isAdmin) return;
            setManagingCopiesBook(showDetailsBook);
            setShowDetailsBook(null);
            setDetailsAutoCheckout(false);
          }}
          onDelete={async () => {
            if (!isAdmin) return;
            const ok = confirm(`Delete "${showDetailsBook.title}"? This cannot be undone.`);
            if (!ok) return;

            const success = await deleteBook(showDetailsBook.id, showDetailsBook.title);
            if (success) {
              setShowDetailsBook(null);
              setDetailsAutoCheckout(false);
            }
          }}
        />
      ) : null}

      {/* Admin-only modals */}
      {isAdmin && editingTagsBook ? (
        <EditTagsModal
          book={editingTagsBook}
          themes={themes}
          categories={categories}
          saving={saving}
          onClose={() => setEditingTagsBook(null)}
          onSave={async ({ themeIds, categoryIds }) => {
            await saveLinks(editingTagsBook.id, themeIds, categoryIds);
            setEditingTagsBook(null);
          }}
        />
      ) : null}

      {isAdmin && editingInfoBook ? (
        <EditInfoModal
          book={editingInfoBook}
          onClose={() => setEditingInfoBook(null)}
          onSave={async ({ title, author, description, subjects, cover_url }) => {
            await updateBook(editingInfoBook.id, {
              title: (title || "").trim(),
              author: (author || "").trim() || null,
              description: (description || "").trim() || null,
              subjects: Array.isArray(subjects) && subjects.length ? subjects : null,
              cover_url: (cover_url || "").trim() || null,
            });
            setEditingInfoBook(null);
          }}
        />
      ) : null}

      {isAdmin && managingCopiesBook ? (
        <ManageCopiesModal
          book={managingCopiesBook}
          onClose={() => setManagingCopiesBook(null)}
          onCirculationChanged={loadActiveLoans}
        />
      ) : null}
    </div>
  );
}

/* =========================
   BOOK DETAILS MODAL
========================= */
function BookDetailsModal({
  book,
  isAdmin,
  onClose,
  onEditInfo,
  onEditTags,
  onManageCopies,
  onDelete,
  deleting,
  autoCheckout,
  onCirculationChanged,
}) {
  const categoryChips = (book.book_categories || [])
    .map((bc) => bc.categories?.name)
    .filter(Boolean);

  const themeChips = (book.book_themes || [])
    .map((bt) => bt.themes?.name)
    .filter(Boolean);

  const subjectChips = Array.isArray(book.subjects) ? book.subjects : [];

  return (
    <Modal title="Book details" subtitle={book.title} onClose={onClose} zIndex={80}>
      <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Big cover */}
          <div style={{ width: 140 }}>
            {book.cover_url ? (
              <img
                src={book.cover_url}
                alt={`Cover: ${book.title}`}
                style={{
                  width: 140,
                  height: 210,
                  objectFit: "cover",
                  borderRadius: 14,
                  border: "1px solid #eee",
                  background: "#fafafa",
                  display: "block",
                }}
              />
            ) : (
              <div
                style={{
                  width: 140,
                  height: 210,
                  borderRadius: 14,
                  border: "1px solid #eee",
                  background: "#fafafa",
                  display: "grid",
                  placeItems: "center",
                  opacity: 0.7,
                }}
              >
                No cover
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: "1 1 520px", minWidth: 260 }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{book.title}</div>
            {book.author ? <div style={{ marginTop: 4, opacity: 0.8 }}>{book.author}</div> : null}

            {book.description ? (
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5 }}>{book.description}</div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.65 }}>No description yet.</div>
            )}

            {/* Admin actions only */}
            {isAdmin ? (
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={onEditInfo} style={btn()}>
                  Edit info
                </button>
                <button type="button" onClick={onEditTags} style={btn()}>
                  Edit tags
                </button>
                <button type="button" onClick={onManageCopies} style={btn()}>
                  Manage copies
                </button>

                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleting}
                  style={{
                    ...btn(),
                    borderColor: "#f3b2b2",
                    color: "crimson",
                    opacity: deleting ? 0.6 : 1,
                  }}
                >
                  {deleting ? "Deleting…" : "Delete book"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Subjects */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 900 }}>Subjects</div>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {subjectChips.length ? (
              subjectChips.slice(0, 60).map((s) => (
                <span key={s} style={chipMini()}>
                  {s}
                </span>
              ))
            ) : (
              <div style={{ fontSize: 13, opacity: 0.65 }}>No subjects yet.</div>
            )}
          </div>
        </div>

        {/* Categories + Themes */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 900 }}>Categories</div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {categoryChips.length ? (
                categoryChips.map((c) => (
                  <span key={c} style={chipMini()}>
                    <CategoryBadge name={c} />
                    {c}
                  </span>
                ))
              ) : (
                <div style={{ fontSize: 13, opacity: 0.65 }}>No categories yet.</div>
              )}
            </div>
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 900 }}>Themes</div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {themeChips.length ? (
                themeChips.map((t) => (
                  <span key={t} style={chipMini()}>
                    {t}
                  </span>
                ))
              ) : (
                <div style={{ fontSize: 13, opacity: 0.65 }}>No themes yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Copies + Checkout */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Copies</div>
          <CopiesSection
            book={book}
            allowInventory={false}
            autoCheckout={autoCheckout}
            canCheckin={isAdmin}
            showLoanInfo={isAdmin}
            onCirculationChanged={onCirculationChanged}
          />
        </div>
      </div>
    </Modal>
  );
}

function chipMini() {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #ddd",
    fontSize: 12,
    background: "white",
  };
}

/* =========================
   TAGS MODAL (admin only)
========================= */
function EditTagsModal({ book, themes, categories, saving, onClose, onSave }) {
  const initialThemeIds = (book.book_themes || []).map((bt) => bt.theme_id);
  const initialCategoryIds = (book.book_categories || []).map((bc) => bc.category_id);

  const [themeIds, setThemeIds] = useState(() => new Set(initialThemeIds));
  const [categoryIds, setCategoryIds] = useState(() => new Set(initialCategoryIds));

  function toggle(setter, currentSet, id) {
    const next = new Set(currentSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  return (
    <Modal title="Edit tags" subtitle={book.title} onClose={onClose} zIndex={50}>
      <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800 }}>Categories</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6, maxHeight: 340, overflow: "auto" }}>
            {categories.map((c) => (
              <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={categoryIds.has(c.id)}
                  onChange={() => toggle(setCategoryIds, categoryIds, c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800 }}>Themes</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6, maxHeight: 340, overflow: "auto" }}>
            {themes.map((t) => (
              <label key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={themeIds.has(t.id)}
                  onChange={() => toggle(setThemeIds, themeIds, t.id)}
                />
                {t.name}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose} style={btn()}>
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={() => onSave({ themeIds: [...themeIds], categoryIds: [...categoryIds] })}
          style={{ ...btn(), opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

/* =========================
   EDIT INFO MODAL (admin only)
========================= */
function parseSubjectsFromText(text) {
  const raw = String(text || "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const s of raw) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function EditInfoModal({ book, onClose, onSave }) {
  const [title, setTitle] = useState(book.title || "");
  const [author, setAuthor] = useState(book.author || "");
  const [description, setDescription] = useState(book.description || "");

  const initialSubjects = Array.isArray(book.subjects) ? book.subjects : [];
  const [subjectsText, setSubjectsText] = useState(initialSubjects.join("\n"));
  const [newSubject, setNewSubject] = useState("");

  const [coverUrl, setCoverUrl] = useState(book.cover_url || "");
  const [uploading, setUploading] = useState(false);
  const [localErr, setLocalErr] = useState("");

  const subjectsPreview = useMemo(() => parseSubjectsFromText(subjectsText), [subjectsText]);

  function addOneSubject() {
    const s = newSubject.trim();
    if (!s) return;
    const next = parseSubjectsFromText([subjectsText, s].filter(Boolean).join("\n"));
    setSubjectsText(next.join("\n"));
    setNewSubject("");
  }

  function removeSubject(name) {
    const next = subjectsPreview.filter((x) => x.toLowerCase() !== name.toLowerCase());
    setSubjectsText(next.join("\n"));
  }

  async function uploadCoverFile(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setLocalErr("Please upload an image file (jpg/png/webp).");
      return;
    }

    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setLocalErr("Image is too large. Please use a file under 5MB.");
      return;
    }

    setUploading(true);
    setLocalErr("");

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${book.id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage.from("book-covers").upload(path, file, {
      upsert: false,
      contentType: file.type,
    });

    if (upErr) {
      setUploading(false);
      setLocalErr(upErr?.message || "Upload failed.");
      return;
    }

    const { data } = supabase.storage.from("book-covers").getPublicUrl(path);
    setCoverUrl(data?.publicUrl || "");
    setUploading(false);
  }

  return (
    <Modal title="Edit book info" subtitle={book.title} onClose={onClose} zIndex={60}>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <input style={inp()} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title *" />
        <input style={inp()} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" />
        <textarea style={inp()} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={4} />

        {/* Cover */}
        <div style={{ marginTop: 6, border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Cover</div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            {coverUrl.trim() ? (
              <img
                src={coverUrl.trim()}
                alt="Cover preview"
                style={{
                  width: 70,
                  height: 105,
                  objectFit: "cover",
                  borderRadius: 10,
                  border: "1px solid #eee",
                  background: "#fafafa",
                }}
                onError={(e) => {
                  e.currentTarget.style.opacity = "0.35";
                }}
              />
            ) : (
              <div
                style={{
                  width: 70,
                  height: 105,
                  borderRadius: 10,
                  border: "1px solid #eee",
                  background: "#fafafa",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  opacity: 0.6,
                  padding: 6,
                  textAlign: "center",
                }}
              >
                No cover
              </div>
            )}

            <div style={{ flex: "1 1 420px", display: "grid", gap: 8 }}>
              <input
                style={inp()}
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="Cover URL (or upload below)"
                disabled={uploading}
              />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <input type="file" accept="image/*" disabled={uploading} onChange={(e) => uploadCoverFile(e.target.files?.[0])} />
                <button type="button" onClick={() => setCoverUrl("")} style={btn()} disabled={uploading}>
                  Remove cover
                </button>
                {uploading ? <span style={{ fontSize: 12, opacity: 0.7 }}>Uploading…</span> : null}
              </div>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Tip: Open Library cover URLs look like{" "}
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  https://covers.openlibrary.org/b/id/12345-M.jpg
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Subjects */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Subjects</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              style={{ ...inp(), flex: "1 1 260px" }}
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="Add a subject (e.g., Butterflies, fiction)"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOneSubject();
                }
              }}
            />
            <button type="button" onClick={addOneSubject} style={btn()}>
              Add subject
            </button>
            <button type="button" onClick={() => setSubjectsText("")} style={btn()}>
              Clear all
            </button>
          </div>

          <textarea
            style={{ ...inp(), marginTop: 10 }}
            value={subjectsText}
            onChange={(e) => setSubjectsText(e.target.value)}
            placeholder="Subjects (one per line, or comma-separated)"
            rows={6}
          />

          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {subjectsPreview.length ? (
              subjectsPreview.slice(0, 30).map((name) => (
                <span
                  key={name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    fontSize: 12,
                    background: "white",
                  }}
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeSubject(name)}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 14,
                      lineHeight: "14px",
                      opacity: 0.7,
                    }}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <div style={{ fontSize: 12, opacity: 0.65 }}>No subjects set.</div>
            )}
            {subjectsPreview.length > 30 ? (
              <div style={{ fontSize: 12, opacity: 0.65 }}>(+{subjectsPreview.length - 30} more)</div>
            ) : null}
          </div>
        </div>

        {localErr ? <div style={{ color: "crimson", fontSize: 13 }}>{localErr}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={btn()}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!title.trim()) return setLocalErr("Title is required.");
              setLocalErr("");
              onSave({
                title,
                author,
                description,
                subjects: subjectsPreview,
                cover_url: coverUrl,
              });
            }}
            style={{ ...btn(), opacity: uploading ? 0.6 : 1 }}
            disabled={uploading}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* =========================
   COPIES (shared) + ManageCopiesModal wrapper
========================= */
function ManageCopiesModal({ book, onClose, onCirculationChanged }) {
  return (
    <Modal title="Manage copies" subtitle={book.title} onClose={onClose} zIndex={70}>
      <CopiesSection
        book={book}
        allowInventory={true}
        autoCheckout={false}
        canCheckin={true}
        showLoanInfo={true}
        onCirculationChanged={onCirculationChanged}
      />
    </Modal>
  );
}

function CopiesSection({
  book,
  allowInventory,
  autoCheckout = false,
  canCheckin = true,
  showLoanInfo = true,
  onCirculationChanged,
}) {
  const [copies, setCopies] = useState([]);
  const [loanByCopyId, setLoanByCopyId] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [countToAdd, setCountToAdd] = useState(1);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [actingId, setActingId] = useState("");

  const [checkoutFor, setCheckoutFor] = useState(null);
  const [borrower, setBorrower] = useState("");
  const [dueDate, setDueDate] = useState("");

  const [autoUsed, setAutoUsed] = useState(false);

  async function loadCopies() {
    setLoading(true);
    setMsg("");

    const { data, error } = await supabase
      .from("book_copies")
      .select("id, copy_code, status, created_at")
      .eq("book_id", book.id)
      .order("created_at", { ascending: true });

    if (error) {
      setMsg(error.message);
      setCopies([]);
      setLoanByCopyId({});
      setLoading(false);
      return;
    }

    const list = data || [];
    setCopies(list);

    // Only admins see loan details (borrower/due); students still see status
    if (showLoanInfo) {
      const ids = list.map((c) => c.id);
      if (ids.length) {
        const { data: loans, error: loanErr } = await supabase
          .from("circulation")
          .select("*")
          .in("copy_id", ids)
          .is("checked_in_at", null);

        if (!loanErr && Array.isArray(loans)) {
          const map = {};
          for (const l of loans) map[l.copy_id] = l;
          setLoanByCopyId(map);
        } else {
          setLoanByCopyId({});
        }
      } else {
        setLoanByCopyId({});
      }
    } else {
      setLoanByCopyId({});
    }

    setLoading(false);
  }

  useEffect(() => {
    loadCopies();
    setAutoUsed(false);
    setCheckoutFor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  function nextCopyCode(i) {
    const short = String(book.id).replace(/-/g, "").slice(0, 8).toUpperCase();
    const n = String(i).padStart(3, "0");
    return `BK-${short}-${n}`;
  }

  useEffect(() => {
    if (!autoCheckout) return;
    if (autoUsed) return;
    if (!copies.length) return;

    const firstAvail = copies.find((c) => c.status === "available");
    if (firstAvail) {
      setCheckoutFor(firstAvail.id);
      setAutoUsed(true);
    }
  }, [autoCheckout, autoUsed, copies]);

  async function addCopies() {
    setAdding(true);
    setMsg("");

    const start = copies.length + 1;
    const end = start + Math.max(1, Math.min(50, Number(countToAdd) || 1)) - 1;

    const rows = [];
    for (let i = start; i <= end; i++) {
      rows.push({ book_id: book.id, copy_code: nextCopyCode(i), status: "available" });
    }

    const { error } = await supabase.from("book_copies").insert(rows);
    setAdding(false);
    if (error) return setMsg(error.message);

    await loadCopies();
    setCountToAdd(1);
  }

  async function removeCopy(copyId, code) {
    const ok = confirm(`Remove copy ${code}?`);
    if (!ok) return;

    setRemovingId(copyId);
    setMsg("");

    const copy = copies.find((c) => c.id === copyId);
    if (copy?.status === "checked_out") {
      setRemovingId("");
      return setMsg("Can’t remove a copy that is checked out. Check it in first.");
    }

    const { error } = await supabase.from("book_copies").delete().eq("id", copyId);
    setRemovingId("");
    if (error) return setMsg(error.message);

    await loadCopies();
  }

  function loanLabel(loan) {
    if (!loan) return "";
    const who = loan.borrower_name || loan.borrower || loan.student_name || "";
    const due = loan.due_date || loan.due_at || loan.due || "";
    const dueText = due ? String(due).slice(0, 10) : "";
    return [who ? `to ${who}` : "", dueText ? `due ${dueText}` : ""].filter(Boolean).join(" • ");
  }

  async function checkoutCopy(copyId) {
    const who = borrower.trim();
    if (!who) {
      setMsg("Borrower name is required to check out.");
      return;
    }

    setActingId(copyId);
    setMsg("");

    const { error } = await supabase.rpc("checkout_copy", {
      p_copy_id: copyId,
      p_borrower_name: who,
      p_borrower_class: null,
      p_due_at: dueDate ? new Date(dueDate + "T23:59:59").toISOString() : null,
    });

    setActingId("");
    if (error) {
      setMsg(
        `${error.message}\n\nIf this says “function … does not exist” or “missing parameter”, your RPC args may be named differently.`
      );
      return;
    }

    setCheckoutFor(null);
    setBorrower("");
    setDueDate("");
    await loadCopies();
    if (onCirculationChanged) await onCirculationChanged();
  }

  async function checkinCopy(copyId) {
    setActingId(copyId);
    setMsg("");

    const { error } = await supabase.rpc("checkin_copy", { p_copy_id: copyId });

    setActingId("");
    if (error) {
      setMsg(error.message);
      return;
    }

    await loadCopies();
    if (onCirculationChanged) await onCirculationChanged();
  }

  const availableCount = copies.filter((c) => c.status === "available").length;
  const checkedOutCount = copies.filter((c) => c.status === "checked_out").length;

  return (
    <div>
      <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          {loading ? "Loading…" : `${copies.length} copies • ${availableCount} available • ${checkedOutCount} out`}
        </div>

        {allowInventory ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="number"
              min={1}
              max={50}
              value={countToAdd}
              onChange={(e) => setCountToAdd(e.target.value)}
              style={{ ...inp(), width: 90 }}
            />
            <button onClick={addCopies} disabled={adding} style={{ ...btn(), opacity: adding ? 0.6 : 1 }}>
              {adding ? "Adding…" : "Add copies"}
            </button>
          </div>
        ) : null}

        <button onClick={loadCopies} style={btn()}>
          Refresh
        </button>
      </div>

      {msg ? (
        <div
          style={{
            marginTop: 10,
            color: msg.includes("Can’t") ? "crimson" : "#111",
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg}
        </div>
      ) : null}

      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: allowInventory ? "1.4fr 1fr 1.6fr 140px" : "1.4fr 1fr 1.8fr 140px",
            gap: 0,
            background: "#fafafa",
            borderBottom: "1px solid #eee",
          }}
        >
          <div style={{ padding: 10, fontWeight: 800, fontSize: 13 }}>Copy code</div>
          <div style={{ padding: 10, fontWeight: 800, fontSize: 13 }}>Status</div>
          <div style={{ padding: 10, fontWeight: 800, fontSize: 13 }}>Loan</div>
          <div style={{ padding: 10, fontWeight: 800, fontSize: 13 }} />
        </div>

        {copies.map((c) => {
          const loan = loanByCopyId[c.id];
          const loanText = c.status === "checked_out" && showLoanInfo ? loanLabel(loan) : "";

          return (
            <div
              key={c.id}
              style={{
                display: "grid",
                gridTemplateColumns: allowInventory ? "1.4fr 1fr 1.6fr 140px" : "1.4fr 1fr 1.8fr 140px",
                borderBottom: "1px solid #eee",
                alignItems: "start",
              }}
            >
              <div style={{ padding: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
                {c.copy_code}
              </div>
              <div style={{ padding: 10, fontSize: 13 }}>{c.status}</div>

              <div style={{ padding: 10, fontSize: 13, opacity: 0.9 }}>
                {showLoanInfo ? (loanText || (c.status === "checked_out" ? "Checked out" : "—")) : "—"}

                {checkoutFor === c.id ? (
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    <input
                      style={inp()}
                      placeholder="Borrower name"
                      value={borrower}
                      onChange={(e) => setBorrower(e.target.value)}
                    />
                    <input
                      style={inp()}
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => checkoutCopy(c.id)}
                        style={{ ...btn(), opacity: actingId === c.id ? 0.6 : 1 }}
                        disabled={actingId === c.id}
                      >
                        {actingId === c.id ? "Checking out…" : "Confirm checkout"}
                      </button>
                      <button type="button" onClick={() => setCheckoutFor(null)} style={btn()}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={{ padding: 10 }}>
                {c.status === "available" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCheckoutFor(c.id);
                      setBorrower("");
                      setDueDate("");
                    }}
                    style={btn()}
                  >
                    Check out
                  </button>
                ) : canCheckin ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => checkinCopy(c.id)}
                      style={{ ...btn(), opacity: actingId === c.id ? 0.6 : 1 }}
                      disabled={actingId === c.id}
                    >
                      {actingId === c.id ? "Checking in…" : "Check in"}
                    </button>

                    {allowInventory ? (
                      <button
                        type="button"
                        onClick={() => removeCopy(c.id, c.copy_code)}
                        disabled={removingId === c.id}
                        style={{ ...btn(), opacity: removingId === c.id ? 0.6 : 1 }}
                      >
                        {removingId === c.id ? "…" : "Remove"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button type="button" disabled style={{ ...btn(), opacity: 0.6, cursor: "not-allowed" }}>
                    Unavailable
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {copies.length === 0 && !loading ? <div style={{ padding: 12, opacity: 0.75 }}>No copies yet.</div> : null}
      </div>
    </div>
  );
}

/* =========================
   MODAL + UI HELPERS
========================= */
function Modal({ title, subtitle, onClose, zIndex = 50, children }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex,
        overflowY: "auto",
        padding: 16,
        WebkitOverflowScrolling: "touch",
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(1000px, 100%)",
          background: "white",
          borderRadius: 16,
          border: "1px solid #ddd",
          padding: 16,
          margin: "16px auto",
          maxHeight: "calc(100vh - 32px)",
          overflow: "auto",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            position: "sticky",
            top: 0,
            background: "white",
            paddingBottom: 10,
            zIndex: 1,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{title}</div>
            {subtitle ? <div style={{ fontSize: 13, opacity: 0.75 }}>{subtitle}</div> : null}
          </div>
          <button onClick={onClose} style={btn()}>
            Close
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

function btn() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #ddd",
    cursor: "pointer",
    background: "white",
  };
}

function inp() {
  return {
    padding: 10,
    borderRadius: 10,
    border: "1px solid #ddd",
  };
}

function linkBtn() {
  return {
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    color: "inherit",
  };
}

/* =========================
   CATEGORY COLOUR BADGES
========================= */
const CAT_BADGES = {
  "Story Books": { outer: "#0000FF", dots: [] },
  "Chapter Books": { outer: "#0000FF", dots: ["#FF0000"] },
  "Graphic Novels": { outer: "#0000FF", dots: ["#FFFF00"] },
  "Tales & Legends": { outer: "#0000FF", dots: ["#00FF00"] },
  "Jokes, Riddles, Songs & Poetry": { outer: "#0000FF", dots: ["#00FF00", "#FF0000", "#FFFF00"] },
  "Alphabet & Dictionaries": { outer: "#0000FF", dots: ["#FFFFFF"] },

  "Earth Science": { outer: "#00FF00", dots: [] },
  "Animals": { outer: "#00FF00", dots: ["#FF0000"] },
  "Space": { outer: "#00FF00", dots: ["#0000FF"] },
  "The Body": { outer: "#00FF00", dots: ["#FFFF00"] },
  "Machines": { outer: "#00FF00", dots: ["#FFFFFF"] },
  "Experiments": { outer: "#00FF00", dots: ["#0000FF", "#FF0000", "#FFFF00"] },

  "Multicultural": { outer: "#FFFF00", dots: [] },
  "Travel": { outer: "#FFFF00", dots: ["#FF0000"] },
  "Celebrations": { outer: "#FFFF00", dots: ["#0000FF"] },
  "Inspirational Figures": { outer: "#FFFF00", dots: ["#00FF00"] },
  "World Languages": { outer: "#FFFF00", dots: ["#0000FF", "#FF0000", "#00FF00"] },

  "Arts": { outer: "#FF0000", dots: [] },
  "Cooking": { outer: "#FF0000", dots: ["#00FF00"] },
  "Sports": { outer: "#FF0000", dots: ["#0000FF"] },
  "Numbers": { outer: "#FF0000", dots: ["#FFFF00"] },
  "Community Building / Social Emotional": { outer: "#FF0000", dots: ["#0000FF", "#FFFF00", "#00FF00"] },

  "Grade 5+": { outer: "#741B47", dots: [] },
};

function CategoryBadge({ name, size = 14 }) {
  const b = CAT_BADGES[name];
  if (!b) return null;

  const s = size;
  const r = s / 2;
  const dotR = Math.max(2, Math.floor(s * 0.16));

  const dotPos = [
    { x: r, y: r - s * 0.15 },
    { x: r - s * 0.18, y: r + s * 0.15 },
    { x: r + s * 0.18, y: r + s * 0.15 },
  ];

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: "block" }}>
      <circle cx={r} cy={r} r={r - 1} fill={b.outer} stroke="#333" strokeWidth="1" />
      {(b.dots || []).slice(0, 3).map((c, i) => (
        <circle key={i} cx={dotPos[i].x} cy={dotPos[i].y} r={dotR} fill={c} stroke="#333" strokeWidth="1" />
      ))}
    </svg>
  );
}
