/* Homepage: load catalog from server, render cards, handle cart + search/filter.
   Every active product can be added to the cart, including "Price on request" ones.
   Ordering happens through the checkout page (WhatsApp enquiry), not online payment. */
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
    const removed = Cart.sync(allProducts); // drop stale/inactive items saved in localStorage
    status.textContent = removed.length ? "Some items in your cart are no longer available and were removed." : ""; render();
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
    // Optional quick-question link, only shown when a valid WhatsApp number is configured
    const askLink = !priced && appConfig.whatsappReady
      ? `<a class="ask-link" target="_blank" rel="noopener" href="https://wa.me/${appConfig.whatsappNumber}?text=${waText}" aria-label="Ask about ${p.name} on WhatsApp">Ask a question on WhatsApp</a>` : "";
    card.innerHTML = `
      <span class="badge">${p.category || "Software"}</span>
      <h3>${p.name}</h3><p class="muted">${p.description}</p>
      <p class="muted">${p.type === "subscription" ? "Subscription" + (p.period ? ` · per ${p.period}` : " · durations available") : "One-time purchase"}</p>
      <p class="price">${priced ? inr(p.price) : "Price on request"}</p>
      <button class="btn" data-add="${p.id}" aria-label="Add ${p.name} to cart">Add to cart</button>${askLink}`;
    grid.appendChild(card);
  });
  grid.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const p = allProducts.find((x) => x.id === b.dataset.add);
    const added = Cart.add(b.dataset.add, Boolean(p && p.allowQty)); // allowQty:false products stay at quantity 1
    renderCart(); b.textContent = added ? "Added ✓" : "Already in cart";
    setTimeout(() => (b.textContent = "Add to cart"), 1400);
  }));
  renderCart();
}

function renderCart() {
  const box = document.getElementById("cart-items"), totals = document.getElementById("cart-totals");
  const checkoutBtn = document.getElementById("checkout-btn");
  document.getElementById("cart-count").textContent = Cart.count();
  const sum = Cart.summarize(allProducts);
  if (!sum.lines.length) {
    box.innerHTML = '<p class="muted">Your cart is empty. Add a product to get started.</p>';
    totals.textContent = ""; checkoutBtn.style.display = "none"; return;
  }
  box.innerHTML = "";
  sum.lines.forEach(({ product: p, qty, priced, lineTotal }) => {
    const row = document.createElement("div"); row.className = "cart-line";
    row.innerHTML = `<span><strong>${p.name}</strong><br><span class="muted">${priced ? `${inr(p.price)} each · line total ${inr(lineTotal)}` : "Price on request"}</span></span>
      <span class="qty">${p.allowQty ? `<button data-dec="${p.id}" aria-label="Decrease quantity of ${p.name}">−</button><span aria-live="polite">${qty}</span><button data-inc="${p.id}" aria-label="Increase quantity of ${p.name}">+</button>` : `<span class="muted">Qty 1</span>`}
      <button class="btn secondary" data-remove="${p.id}" aria-label="Remove ${p.name} from cart">Remove</button></span>`;
    box.appendChild(row);
  });
  // Only show a total when EVERY item has a known price; otherwise a total would be misleading.
  totals.innerHTML = sum.hasUnknown
    ? `<p><strong>Final quotation required.</strong></p><p class="muted">${sum.unknownCount} item${sum.unknownCount > 1 ? "s are" : " is"} “Price on request”, so we'll send you the final quote on WhatsApp.</p>`
    : `<p>Subtotal: <strong>${inr(sum.knownTotal)}</strong></p><p>Total: <strong>${inr(sum.knownTotal)}</strong></p>`;
  totals.innerHTML += '<p class="muted">Payment is not taken on this website. You send your order enquiry on WhatsApp, and we confirm availability, the final quote and payment steps with you there.</p>';
  checkoutBtn.style.display = "";
  box.querySelectorAll("[data-remove]").forEach((b) => b.onclick = () => { Cart.remove(b.dataset.remove); });
  box.querySelectorAll("[data-inc]").forEach((b) => b.onclick = () => { const l = Cart.get().find((i) => i.id === b.dataset.inc); Cart.setQty(b.dataset.inc, l.qty + 1); });
  box.querySelectorAll("[data-dec]").forEach((b) => b.onclick = () => { const l = Cart.get().find((i) => i.id === b.dataset.dec); Cart.setQty(b.dataset.dec, l.qty - 1); });
}
document.getElementById("search").addEventListener("input", render);
document.getElementById("category-filter").addEventListener("change", render);
window.addEventListener("cart-changed", renderCart);
init();
