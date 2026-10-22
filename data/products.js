/**
 * ============================================================
 *  ★ EDIT YOUR PRODUCTS & PRICES HERE ★
 * ============================================================
 *  This is the ONLY file to edit for products/prices.
 *  Server + website both read this file. Browser never sets price.
 *
 *  HOW TO SET A PRICE:
 *    Change `price: 0` to e.g. `price: 1499` (INR, no commas)
 *    - price > 0  -> product shows its price; price is used in the WhatsApp order message
 *    - price = 0  -> product shows "Price on request"; it CAN still be added to the cart
 *                      and the WhatsApp message says "Price on request" /
 *                      "Final quotation required" (you quote it manually)
 *    - active: false -> hidden from the store and rejected by the server
 *
 *  Fields:
 *    id, name, description, category,
 *    price (INR), type: "subscription" | "one-time",
 *    period: "month"|"year" (optional), allowQty, active
 *
 *  Variants (duration / Full Warranty FW / Non-Warranty NW):
 *    Don't create fake variants — add a separate entry per variant
 *    once you know its price, e.g. id "canva-pro-original-1m-fw".
 * ============================================================
 */
const P = (id, name, category, description) => ({
  id, name, category,
  description: description || `${name} — contact us for available plan, duration, and warranty (FW/NW) options.`,
  price: 0, type: "subscription", allowQty: false, active: true,
});

const PRODUCTS = [
  // 🤖 AI Tools & Automation
  P("chatprd-pro","Chatprd Pro","AI Tools & Automation"),
  P("descript-creator","Descript Creator","AI Tools & Automation"),
  P("elevenlabs-creator","ElevenLabs Creator","AI Tools & Automation"),
  P("gamma-pro","Gamma Pro","AI Tools & Automation"),
  P("gemini-ai-pro","Gemini AI Pro","AI Tools & Automation"),
  P("google-ai-plus","Google AI Plus","AI Tools & Automation"),
  P("granola-business","Granola Business","AI Tools & Automation"),
  P("gumloop-pro","Gumloop Pro","AI Tools & Automation"),
  P("leonardo-essential","Leonardo Essential","AI Tools & Automation"),
  P("lovable-lite","Lovable Lite","AI Tools & Automation","Lovable Lite — also used for website & app development."),
  P("lovable-pro","Lovable Pro","AI Tools & Automation","Lovable Pro — also used for website & app development."),
  P("magic-patterns-starter","Magic Patterns Starter","AI Tools & Automation","Magic Patterns Starter — also used for website & app development."),
  P("manus-pro","Manus Pro","AI Tools & Automation"),
  P("runway-pro","Runway Pro","AI Tools & Automation"),
  P("warp-build","Warp Build","AI Tools & Automation","Warp Build — also used for website & app development."),
  // 🎨 Design & Creative
  P("adobe-creative-cloud","Adobe Creative Cloud","Design & Creative"),
  P("canva-pro-edu","Canva Pro Edu","Design & Creative"),
  P("canva-pro-original","Canva Pro Original","Design & Creative"),
  P("coreldraw-g-suite","CorelDRAW G-Suite","Design & Creative"),
  P("coreldraw-t-suite","CorelDRAW T-Suite","Design & Creative"),
  P("figma-pro-edu","Figma Pro Edu","Design & Creative"),
  P("framer-pro","Framer Pro","Design & Creative","Framer Pro — also used for website & app development."),
  P("supercut-pro","Supercut Pro","Design & Creative"),
  // 💻 Development & Coding
  P("api-test","API Test","Development & Coding"),
  P("factory-pro","Factory Pro","Development & Coding"),
  P("firecrawl-credits","Firecrawl Credits","Development & Coding"),
  P("jetbrains-education-pack","JetBrains Education Pack","Development & Coding"),
  P("replit-core","Replit Core","Development & Coding"),
  P("railway-pro","Railway Pro","Development & Coding"),
  // 📈 Business & Productivity
  P("airtable-team","Airtable Team Plan","Business & Productivity"),
  P("customer-io-essential","Customer.io Essential","Business & Productivity"),
  P("intercom-advanced","Intercom Advanced","Business & Productivity"),
  P("jam-team","Jam Team Plan","Business & Productivity"),
  P("linear-business","Linear Business","Business & Productivity"),
  P("mobbin-team","Mobbin Team","Business & Productivity"),
  P("notion-business","Notion Business","Business & Productivity"),
  P("pangram-professional","Pangram Professional","Business & Productivity"),
  P("posthog-scale","PostHog Scale","Business & Productivity"),
  P("readwise","Readwise","Business & Productivity"),
  P("wispr-flow","Wispr Flow","Business & Productivity"),
  P("wispr-flow-pro","Wispr Flow Pro","Business & Productivity"),
  // 📚 Education & Learning
  P("coursera-premium","Coursera Premium","Education & Learning"),
  P("duolingo-super","Duolingo Super","Education & Learning"),
  P("waking-up","Waking Up","Education & Learning"),
  // 📄 PDF & Documents
  P("ilovepdf-premium","iLovePDF Premium","PDF & Document Tools"),
  // 🎬 Entertainment — type is subscription by default; edit if needed
  P("amazon-prime-video","Amazon Prime Video","Entertainment"),
  P("apple-music","Apple Music","Entertainment"),
  P("crunchyroll","Crunchyroll","Entertainment"),
  // 🛠️ Additional Tools
  P("autodesk-admin-panel","Autodesk Admin Panel","Additional Tools"),
  P("capcut-pro","CapCut Pro","Additional Tools"),
];
module.exports = PRODUCTS;
