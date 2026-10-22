/**
 * Cart stored in localStorage so it survives refresh.
 * Cart only stores {id, qty} — NEVER prices. Prices come from the server catalog,
 * and the server re-checks everything again when the enquiry is submitted.
 */
const Cart = {
  KEY: "software_store_cart",
  MAX_QTY: 10,
  // Read the cart; ignore anything malformed (e.g. edited by hand in the browser).
  get() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY));
      if (!Array.isArray(raw)) return [];
      return raw.filter((l) => l && typeof l.id === "string" && Number.isInteger(l.qty) && l.qty > 0)
        .map((l) => ({ id: l.id, qty: Math.min(l.qty, this.MAX_QTY) }));
    } catch { return []; }
  },
  set(items) { localStorage.setItem(this.KEY, JSON.stringify(items)); window.dispatchEvent(new Event("cart-changed")); },
  /** Adds one. Products with allowQty:false can only be in the cart once. Returns false if it was already there. */
  add(id, allowQty = true) {
    const cart = this.get();
    const line = cart.find((i) => i.id === id);
    if (line && !allowQty) return false;
    if (line) line.qty = Math.min(line.qty + 1, this.MAX_QTY); else cart.push({ id, qty: 1 });
    this.set(cart);
    return true;
  },
  remove(id) { this.set(this.get().filter((i) => i.id !== id)); },
  setQty(id, qty) {
    if (qty <= 0) return this.remove(id);
    const cart = this.get(); const line = cart.find((i) => i.id === id);
    if (line) { line.qty = Math.min(qty, this.MAX_QTY); this.set(cart); }
  },
  clear() { this.set([]); },
  count() { return this.get().reduce((s, i) => s + i.qty, 0); },

  /**
   * Cleans the saved cart against the live product list:
   * removes products that no longer exist / are inactive, and forces qty 1 where quantity isn't allowed.
   * Returns the ids that were removed.
   */
  sync(products) {
    const before = this.get(), removed = [], cleaned = [];
    for (const l of before) {
      const p = products.find((x) => x.id === l.id);
      if (!p) { removed.push(l.id); continue; }
      cleaned.push({ id: p.id, qty: p.allowQty ? l.qty : 1 });
    }
    if (JSON.stringify(cleaned) !== JSON.stringify(before)) this.set(cleaned);
    return removed;
  },

  /** Display-only totals. Price 0 = "Price on request" (unknown), so no misleading total is shown. */
  summarize(products) {
    const lines = []; let knownTotal = 0, unknownCount = 0;
    for (const l of this.get()) {
      const product = products.find((x) => x.id === l.id); if (!product) continue;
      const priced = Number(product.price) > 0;
      const lineTotal = priced ? product.price * l.qty : null;
      if (priced) knownTotal += lineTotal; else unknownCount += 1;
      lines.push({ product, qty: l.qty, priced, lineTotal });
    }
    return { lines, knownTotal, unknownCount, hasUnknown: unknownCount > 0 };
  },
};
window.Cart = Cart;
