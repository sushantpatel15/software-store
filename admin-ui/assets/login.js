"use strict";
(() => {
  const form = document.getElementById("login-form"), emailEl = document.getElementById("email"), pwEl = document.getElementById("password"), err = document.getElementById("error"), btn = document.getElementById("submit");
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return; // no double submits
    err.hidden = true;
    const email = emailEl.value.trim(), password = pwEl.value;
    if (!email || !password) { err.textContent = "Enter your email and password."; err.hidden = false; return; }
    busy = true; btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const res = await fetch("/admin/api/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not sign in.");
      location.href = "/admin";
    } catch (e2) {
      err.textContent = e2.message === "Failed to fetch" ? "Network problem. Please try again." : e2.message; err.hidden = false;
      pwEl.value = ""; pwEl.focus();
    } finally { busy = false; btn.disabled = false; btn.textContent = "Sign in"; }
  });
})();
