// src/Home.jsx
export default function Home({ onGoLibrary, onGoClass, onSignOut }) {
  const card = (extra = {}) => ({
    border: "1px solid #ddd",
    borderRadius: 18,
    padding: 18,
    background: "white",
    cursor: "pointer",
    ...extra,
  });

  return (
    <div style={{ minHeight: "100vh", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>School Library</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Choose where you want to go</div>
        </div>
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
      </header>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        {/* Main block */}
        <div
          onClick={onGoLibrary}
          style={card({
            padding: 22,
            borderWidth: 2,
          })}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onGoLibrary()}
        >
          <div style={{ fontSize: 18, fontWeight: 900 }}>📚 Library Catalogue</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            Browse, search, and check out books
          </div>
        </div>

        {/* Class blocks */}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div
            onClick={() => onGoClass("pinecones")}
            style={card()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onGoClass("pinecones")}
          >
            <div style={{ fontSize: 16, fontWeight: 900 }}>Pinecones</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>Kindergarten resources</div>
          </div>

          <div
            onClick={() => onGoClass("cedars")}
            style={card()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onGoClass("cedars")}
          >
            <div style={{ fontSize: 16, fontWeight: 900 }}>Cedars</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>Grades 1–2 resources</div>
          </div>

          <div
            onClick={() => onGoClass("spruce")}
            style={card()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onGoClass("spruce")}
          >
            <div style={{ fontSize: 16, fontWeight: 900 }}>Spruce</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>Grades 3–4 resources</div>
          </div>
        </div>
      </div>
    </div>
  );
}
