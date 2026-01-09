// src/App.jsx
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import Library from "./Library";

// Toggle this to skip login during development/testing
const BYPASS_AUTH = false; // set to false later

export default function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (BYPASS_AUTH) {
    return <Library onSignOut={() => {}} />;
  }

  if (!session) return <Auth />;
  return <Library onSignOut={() => supabase.auth.signOut()} />;
}

function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function signIn(e) {
    e.preventDefault();
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={signIn} style={{ width: "100%", maxWidth: 360, border: "1px solid #ddd", borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>School Library</div>
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <input
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", cursor: "pointer", background: "white" }}>
            Sign in
          </button>
          {msg ? <div style={{ color: "crimson", fontSize: 13 }}>{msg}</div> : null}
        </div>
      </form>
    </div>
  );
}
