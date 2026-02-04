// src/ClassResources.jsx
const CLASSES = {
  pinecones: { name: "Pinecones", grades: "Kindergarten" },
  cedars: { name: "Cedars", grades: "Grades 1–2" },
  spruce: { name: "Spruce", grades: "Grades 3–4" },
};

export default function ClassResources({ classKey, onHome, onGoLibrary, onSignOut }) {
  const info = CLASSES[classKey] || CLASSES.pinecones;

  const box = {
    border: "1px solid #ddd",
    borderRadius: 16,
    padding: 16,
    background: "white",
  };

  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #ddd",
    fontSize: 12,
    background: "white",
    cursor: "pointer",
  };

  return (
    <div style={{ minHeight: "100vh", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{info.name} Resources</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>{info.grades}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onHome} style={pill}>Home</button>
          <button onClick={onGoLibrary} style={pill}>Library</button>
          <button onClick={onSignOut} style={pill}>Sign out</button>
        </div>
      </header>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        <div style={box}>
          <div style={{ fontWeight: 900 }}>Quick links</div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
            Add links to class docs, newsletters, weekly plans, etc.
          </div>
          <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
            <li>Class schedule (add link)</li>
            <li>Parent updates / newsletter (add link)</li>
            <li>Printable activities (add link)</li>
          </ul>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div style={box}>
            <div style={{ fontWeight: 900 }}>Reading</div>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              Put your reading resources here (lists, leveled books, sites).
            </div>
          </div>

          <div style={box}>
            <div style={{ fontWeight: 900 }}>Math</div>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              Put your math resources here (games, practice, printables).
            </div>
          </div>

          <div style={box}>
            <div style={{ fontWeight: 900 }}>Other</div>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              Anything else (projects, science, SEL, etc.).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
