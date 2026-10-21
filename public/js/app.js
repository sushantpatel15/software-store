/* Homepage: load catalog from server, render cards, handle cart + search/filter + WhatsApp enquiry */
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
let allProducts = [], appConfig = {};

async function init() {
  const grid = document.getElementById("products");
  const status = document.getElementById("catalog-status");
  try {
    const [cfgRes, prodRes] = await Promise.all([fetch("/api/config"), fetch("/api/products")]);
    appConfig = await cfgRes.json(); allProducts = await prodRes.json();
    document.querySelectorAll(".business-name").forEach((e) => (e.textContent = appConfig.businessName));
    const mail = document.getElementById("support-email"); if (mail) { mail.textContent = appConfig.supportEmail; mail.href = "mailto:" + appConfig.supportEmail; }
    // Category filter options
    const sel = document.getElementById("category-filter");
    [...new Set(allProducts.map((p) => p.category).filter(Boolean))].forEach((c) => {
      const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    status.textContent = ""; render();
  } catch { status.innerHTML = '<div class="alert error" role="alert">Could not load products. Please refresh or contact support.</div>'; }
}

function render() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const cat = document.getElementById("category-filter").value;
  const grid = document.getElementById("products");
  const list = allProducts.filter((p) => (!cat || p.category === cat) && (!q || (p.name + " " + p.description).toLowerCase().includes(q)));
  grid.innerHTML = list.length ? "" : '<p class="muted">No products match your search.</p>';
  list.forEach((p) => {
    const card = document.createElement("article"); card.className = "card";
    const priced = Number(p.price) > 0;
    const waText = encodeURIComponent(`Hi! I'm interested in ${p.name}. Please share the available plan, price, duration, and warranty (FW/NW) details.`);
    card.innerHTML = `
      <span class="badge">${p.category || "Software"}</span>
      <h3>${p.name}</h3><p class="muted">${p.description}</p>
      <p class="muted">${p.type === "subscription" ? "Subscription" + (p.period ? ` · per ${p.period}` : " · durations available") : "One-time purchase"}</p>
      ${priced ? `<p class="price">${inr(p.price)}</p>
        <button class="btn" data-add="${p.id}" aria-label="Add ${p.name} to cart">Add to cart</button>`
      : `<p class="price">Price on request</p>
        <a class="btn whatsapp" target="_blank" rel="noopener" href="https://wa.me/${appConfig.whatsappNumber}?text=${waText}" aria-label="Enquire about ${p.name} on WhatsApp">Enquire on WhatsApp</a>`}`;
    grid.appendChild(card);
  });
  grid.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { Cart.add(b.dataset.add); renderCart(); b.textContent = "Added ✓"; setTimeout(() => (b.textContent = "Add to cart"), 1200); }));
  renderCart();
}

function renderCart() {
  const box = document.getElementById("cart-items"); const cart = Cart.get();
  document.getElementById("cart-count").textContent = Cart.count();
  if (!cart.length) { box.innerHTML = '<p class="muted">Your cart is empty. Add a product to get started.</p>'; document.getElementById("cart-totals").textContent = ""; document.getElementById("checkout-btn").style.display = "none"; return; }
  let total = 0; box.innerHTML = "";
  cart.forEach((line) => {
    const p = allProducts.find((x) => x.id === line.id); if (!p) return;
    total += p.price * line.qty;
    const row = document.createElement("div"); row.className = "cart-line";
    row.innerHTML = `<span><strong>${p.name}</strong><br><span class="muted">${inr(p.price)} ${p.allowQty ? "" : ""}</span></span>
      <span class="qty">${p.allowQty ? `<button data-dec="${p.id}" aria-label="Decrease quantity">−</button><span aria-live="polite">${line.qty}</span><button data-inc="${p.id}" aria-label="Increase quantity">+</button>` : `<span class="muted">Qty 1</span>`}
      <button class="btn secondary" data-remove="${p.id}" aria-label="Remove ${p.name} from cart">Remove</button></span>`;
    box.appendChild(row);
  });
  document.getElementById("cart-totals").innerHTML = `<p>Subtotal: <strong>${inr(total)}</strong></p><p>Total: <strong>${inr(total)}</strong></p><p class="muted">No extra charges in this starter. Server re-checks prices at checkout.</p>`;
  document.getElementById("checkout-btn").style.display = "";
  box.querySelectorAll("[data-remove]").forEach((b) => b.onclick = () => { Cart.remove(b.dataset.remove); renderCart(); });
  box.querySelectorAll("[data-inc]").forEach((b) => b.onclick = () => { const l = Cart.get().find((i) => i.id === b.dataset.inc); Cart.setQty(b.dataset.inc, l.qty + 1); renderCart(); });
  box.querySelectorAll("[data-dec]").forEach((b) => b.onclick = () => { const l = Cart.get().find((i) => i.id === b.dataset.dec); Cart.setQty(b.dataset.dec, l.qty - 1); renderCart(); });
}
document.getElementById("search").addEventListener("input", render);
document.getElementById("category-filter").addEventListener("change", render);
window.addEventListener("cart-changed", renderCart);
init();
