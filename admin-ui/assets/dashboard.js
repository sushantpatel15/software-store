"use strict";
/* Admin dashboard. All data is inserted with textContent (never innerHTML), so customer-supplied text can't run as code. */
(() => {
  let csrf = "", products = [], orderOffset = 0;
  const LIMIT = 25;
  const $ = (id) => document.getElementById(id);
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const when = (s) => (s ? new Date(s).toLocaleString("en-IN") : "");
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, ""); else if (v !== false && v != null) el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const td = (label, ...kids) => h("td", { "data-label": label }, ...kids);

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch("/admin/api" + path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { location.href = "/admin/login"; throw new Error("Signed out"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "Request failed."); e.fields = data.fields; throw e; }
    return data;
  }
  let noticeTimer;
  function notify(msg, isError) {
    const n = $("notice"); n.textContent = msg; n.className = "alert " + (isError ? "err" : "ok"); n.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => (n.hidden = true), 5000);
  }

  // ---------- tabs ----------
  const tabs = ["overview", "products", "orders", "activity"];
  function showTab(name) {
    for (const t of tabs) { $("tab-" + t).setAttribute("aria-selected", String(t === name)); $("tab-" + t).tabIndex = t === name ? 0 : -1; $("panel-" + t).hidden = t !== name; }
    ({ overview: loadOverview, products: loadProducts, orders: loadOrders, activity: loadActivity })[name]().catch((e) => notify(e.message, true));
  }
  tabs.forEach((t, i) => {
    $("tab-" + t).addEventListener("click", () => showTab(t));
    $("tab-" + t).addEventListener("keydown", (e) => { // arrow-key navigation
      const next = e.key === "ArrowRight" ? (i + 1) % 4 : e.key === "ArrowLeft" ? (i + 3) % 4 : -1;
      if (next >= 0) { e.preventDefault(); showTab(tabs[next]); $("tab-" + tabs[next]).focus(); }
    });
  });

  // ---------- overview ----------
  async function loadOverview() {
    const s = await api("/summary");
    const card = (label, n) => h("div", { class: "card" }, h("b", {}, n), label);
    $("cards").replaceChildren(card("Products", s.products.total), card("Available", s.products.active), card("Hidden", s.products.hidden), card("Price on request", s.products.priceOnRequest),
      ...["pending", "paid", "failed", "cancelled"].map((k) => card(`Orders: ${k}`, s.orders[k] || 0)));
  }

  // ---------- products ----------
  async function loadProducts() { products = await api("/products"); renderProducts(); }
  function renderProducts() {
    const q = $("p-search").value.trim().toLowerCase(), f = $("p-filter").value;
    const list = products.filter((p) => (!q || `${p.name} ${p.id} ${p.category}`.toLowerCase().includes(q)) &&
      (f === "all" || (f === "active" && p.active) || (f === "hidden" && !p.active) || (f === "request" && p.price === 0)));
    $("p-count").textContent = `${list.length} of ${products.length} products`;
    $("p-body").replaceChildren(...list.map(productRow));
    $("cat-list").replaceChildren(...[...new Set(products.map((p) => p.category))].map((c) => h("option", { value: c })));
  }
  function productRow(p) {
    const price = h("input", { type: "number", min: 0, step: 1, value: p.price, class: "price-input", "aria-label": `Price in rupees for ${p.name}` });
    const avail = h("input", { type: "checkbox", checked: p.active, "aria-label": `${p.name} is available` });
    const save = h("button", { class: "btn small", type: "button", disabled: true }, "Save");
    const dirty = () => (save.disabled = !(price.value !== String(p.price) || avail.checked !== p.active));
    price.addEventListener("input", dirty); avail.addEventListener("change", dirty);
    save.addEventListener("click", async () => {
      if (!/^\d+$/.test(price.value)) return notify("Price must be a whole number of rupees (0 = price on request).", true);
      save.disabled = true;
      try { Object.assign(p, await api("/products/" + encodeURIComponent(p.id), { method: "PATCH", body: { price: Number(price.value), active: avail.checked } })); notify(`Saved “${p.name}”.`); renderProducts(); }
      catch (e) { notify(e.fields ? Object.values(e.fields)[0] : e.message, true); save.disabled = false; }
    });
    return h("tr", {}, td("Product", h("strong", {}, p.name), h("span", { class: "pid" }, p.id)), td("Category", p.category), td("Price (₹)", price), td("Available", avail),
      td("Actions", save, " ", h("button", { class: "btn secondary small", type: "button", onclick: () => openProductDialog(p) }, "Edit")));
  }

  const FIELDS = ["id", "name", "category", "description", "price", "type", "period", "allowQty", "active"];
  let editing = null, saving = false;
  function openProductDialog(p) {
    editing = p; $("pd-title").textContent = p ? `Edit ${p.name}` : "Add product";
    const v = p || { id: "", name: "", category: "", description: "", price: 0, type: "subscription", period: "", allowQty: false, active: true };
    for (const f of FIELDS) { const el = $("pf-" + f); if (el.type === "checkbox") el.checked = !!v[f]; else el.value = v[f] ?? ""; }
    $("pf-id").disabled = !!p; $("pf-error").hidden = true; FIELDS.forEach((f) => { const e = $("pe-" + f); if (e) e.textContent = ""; });
    $("p-dialog").showModal(); (p ? $("pf-name") : $("pf-id")).focus();
  }
  $("p-add").addEventListener("click", () => openProductDialog(null));
  $("pf-cancel").addEventListener("click", () => $("p-dialog").close());
  $("p-form").addEventListener("submit", async (e) => {
    e.preventDefault(); if (saving) return;
    const body = { name: $("pf-name").value, category: $("pf-category").value, description: $("pf-description").value, price: Number($("pf-price").value),
      type: $("pf-type").value, period: $("pf-period").value, allowQty: $("pf-allowQty").checked, active: $("pf-active").checked };
    if ($("pf-price").value === "" || !Number.isInteger(body.price)) { $("pe-price").textContent = "Enter a whole number of rupees."; return; }
    if (!editing) body.id = $("pf-id").value.trim();
    saving = true; $("pf-save").disabled = true; $("pf-error").hidden = true; FIELDS.forEach((f) => { const el = $("pe-" + f); if (el) el.textContent = ""; });
    try {
      await api(editing ? "/products/" + encodeURIComponent(editing.id) : "/products", { method: editing ? "PATCH" : "POST", body });
      $("p-dialog").close(); notify(editing ? "Product updated." : "Product added."); await loadProducts();
    } catch (err) {
      for (const [k, m] of Object.entries(err.fields || {})) { const el = $("pe-" + k); if (el) el.textContent = m; }
      $("pf-error").textContent = err.message; $("pf-error").hidden = false;
    } finally { saving = false; $("pf-save").disabled = false; }
  });

  // ---------- orders ----------
  let searchTimer;
  async function loadOrders() {
    const qs = new URLSearchParams({ limit: LIMIT, offset: orderOffset, status: $("o-filter").value, q: $("o-search").value.trim() });
    const { total, orders } = await api("/orders?" + qs);
    $("o-count").textContent = total ? `Showing ${orderOffset + 1}–${orderOffset + orders.length} of ${total}` : "No orders found.";
    $("o-prev").disabled = orderOffset === 0; $("o-next").disabled = orderOffset + orders.length >= total;
    $("o-body").replaceChildren(...orders.map((o) => h("tr", {}, td("Order", o.id), td("Customer", o.customerName), td("Total", inr(o.total)),
      td("Status", h("span", { class: "badge " + o.status }, o.status)), td("Date", when(o.createdAt)),
      td("", h("button", { class: "btn secondary small", type: "button", onclick: () => openOrder(o.id) }, "View")))));
  }
  const resetAndLoad = () => { orderOffset = 0; loadOrders().catch((e) => notify(e.message, true)); };
  $("o-filter").addEventListener("change", resetAndLoad);
  $("o-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(resetAndLoad, 300); });
  $("o-prev").addEventListener("click", () => { orderOffset = Math.max(0, orderOffset - LIMIT); loadOrders(); });
  $("o-next").addEventListener("click", () => { orderOffset += LIMIT; loadOrders(); });

  async function openOrder(id) {
    try {
      const o = await api("/orders/" + encodeURIComponent(id));
      const select = h("select", { id: "od-status", "aria-label": "Order status" }, ...["pending", "paid", "failed", "cancelled"].map((s) => h("option", { value: s, selected: s === o.status }, s)));
      const save = h("button", { class: "btn small", type: "button" }, "Update status");
      save.addEventListener("click", async () => {
        if (select.value === o.status) return;
        if (select.value === "paid" && !confirm("Mark as PAID manually? This does not verify any payment — only do this after you have received the money.")) return;
        save.disabled = true;
        try { await api("/orders/" + encodeURIComponent(o.id), { method: "PATCH", body: { status: select.value } }); $("o-dialog").close(); notify(`Order ${o.id} is now ${select.value}.`); loadOrders(); }
        catch (e) { notify(e.message, true); save.disabled = false; }
      });
      const items = h("ul", {}, ...o.items.map((i) => h("li", {}, `${i.name} × ${i.qty} — ${Number(i.price) > 0 ? inr(i.price * i.qty) : "Price on request"}`)));
      $("od-title").textContent = "Order " + o.id;
      $("od-body").replaceChildren(h("dl", { class: "kv" }, h("dt", {}, "Customer"), h("dd", {}, o.customerName), h("dt", {}, "Email"), h("dd", {}, o.email), h("dt", {}, "Phone"), h("dd", {}, o.phone),
        h("dt", {}, "Items"), h("dd", {}, items), h("dt", {}, "Total"), h("dd", {}, inr(o.total)), h("dt", {}, "Payment ref"), h("dd", {}, o.paymentReference || "—"),
        h("dt", {}, "Created"), h("dd", {}, when(o.createdAt)), h("dt", {}, "Status"), h("dd", {}, select, " ", save)));
      $("o-dialog").showModal();
    } catch (e) { notify(e.message, true); }
  }
  $("od-close").addEventListener("click", () => $("o-dialog").close());

  // ---------- activity ----------
  async function loadActivity() {
    const rows = await api("/audit");
    $("a-body").replaceChildren(...rows.map((a) => h("tr", {}, td("When", when(a.at)), td("Admin", a.admin || "—"), td("Action", a.action), td("Target", a.target || ""), td("Details", a.detail ? JSON.stringify(a.detail) : ""))));
  }

  $("p-search").addEventListener("input", renderProducts); $("p-filter").addEventListener("change", renderProducts);
  $("logout").addEventListener("click", async () => { try { await api("/logout", { method: "POST" }); } catch { /* fall through */ } location.href = "/admin/login"; });

  (async () => {
    try { const me = await api("/me"); csrf = me.csrfToken; $("who").textContent = me.email; await loadOverview(); }
    catch (e) { if (e.message !== "Signed out") notify(e.message, true); }
  })();
})();
