/**
 * Cart stored in localStorage so it survives refresh.
 * Cart only stores {id, qty} — NEVER prices. Prices come from the server catalog.
 */
const Cart = {
  KEY: "software_store_cart",
  get() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  set(items) { localStorage.setItem(this.KEY, JSON.stringify(items)); window.dispatchEvent(new Event("cart-changed")); },
  add(id) {
    const cart = this.get();
    const line = cart.find((i) => i.id === id);
    if (line) line.qty += 1; else cart.push({ id, qty: 1 });
    this.set(cart);
  },
  remove(id) { this.set(this.get().filter((i) => i.id !== id)); },
  setQty(id, qty) {
    if (qty <= 0) return this.remove(id);
    const cart = this.get(); const line = cart.find((i) => i.id === id);
    if (line) { line.qty = qty; this.set(cart); }
  },
  clear() { this.set([]); },
  count() { return this.get().reduce((s, i) => s + i.qty, 0); },
};
window.Cart = Cart;
