/* ================= TELEGRAM MINI APP ================= */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

/*if (tg) {
  tg.ready();
  tg.expand();

  if (!(tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.username)) {
    console.warn("Telegram ник недоступен. Мини-приложение открыто вне Telegram или пользователь не вошел.");
  }
}*/

function getTelegramContext() {
  const tgApp = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  const tgUser = (tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user) ? tgApp.initDataUnsafe.user : null;

  const fromInit = (tgUser && tgUser.username) ? tgUser.username : "";
  const fromQuery = (new URLSearchParams(window.location.search).get("u")) || "";

  const nick = (fromInit || fromQuery).replace(/^@/, "").trim();

  return { tgApp, tgUser, tgNick: nick ? ("@" + nick) : null };
}



if (tg) {
  tg.ready();   // уведомляем Telegram, что Mini App готов
  tg.expand();  // разворачиваем на весь экран

  // Опционально: логируем, если ник недоступен
  if (!tg.initDataUnsafe?.user?.username) {
    console.warn("Telegram ник недоступен. Мини-приложение открыто вне Telegram или пользователь не вошел.");
  }
}

const API_BASE = "https://crazyde-production.up.railway.app";

// new: client-side safety & limits
const MAX_ITEMS_PER_ORDER = 12;        // максимум уникальных позиций в заказе
const MAX_QTY_PER_ITEM = 5;           // максимум единиц на одну позицию
const ORDER_TEXT_LIMIT = 3000;        // максимум символов для orderText (client-side)
const FETCH_TIMEOUT_MS = 12_000;      // стандартный таймаут для сетевых вызовов

// safe DOM getter — возвращает настоящий элемент или малую заглушку, чтобы не ломать скрипт на страницах с неполной вёрсткой
function safeGet(id) {
  const el = document.getElementById(id);
  if (el) return el;
  console.warn(`safeGet: element #${id} not found — returning stub`);
  // минимальная заглушка с необходимыми полями/методами, чтобы скрипт не падал
  const stub = document.createElement ? document.createElement("div") : { };
  if (stub) {
    stub.style = stub.style || {};
    stub.classList = stub.classList || {
      add: ()=>{},
      remove: ()=>{},
      contains: ()=>false
    };
    // event helpers
    stub.addEventListener = stub.addEventListener || (()=>{});
    stub.removeEventListener = stub.removeEventListener || (()=>{});
    // attributes / DOM helpers
    stub.removeAttribute = stub.removeAttribute || (()=>{});
    stub.setAttribute = stub.setAttribute || (()=>{});
    stub.appendChild = stub.appendChild || (()=>{});
    stub.querySelector = stub.querySelector || (()=>null);
    stub.querySelectorAll = stub.querySelectorAll || (()=>[]);
    stub.getBoundingClientRect = stub.getBoundingClientRect || (() => ({ top: 0, left: 0, width: 0, height: 0 }));
    stub.focus = stub.focus || (()=>{});
    stub.value = stub.value || "";
    stub.disabled = true;
    stub.textContent = stub.textContent || "";
    stub.innerHTML = stub.innerHTML || "";
  }
  return stub;
}

/**
 * realGet(id) возвращает реальный элемент из DOM или null.
 * Используйте, когда нужна настоящая нода (MutationObserver, getBoundingClientRect и т.п.).
 */
function realGet(id) {
  if (typeof document.getElementById !== "function") return null;
  const el = document.getElementById(id);
  // элемент должен существовать в документе и быть нодой-элементом
  if (el && el.nodeType === 1 && document.contains(el)) return el;
  return null;
}

// fetch wrapper with timeout and simple retry (1 retry on network abort)
async function fetchWithTimeout(url, opts = {}, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const signal = controller.signal;
  opts.signal = signal;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let res = await fetch(url, opts);
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    // retry once for transient network errors (but don't retry 4xx/5xx because fetch throws only on network)
    if (err && err.name === "AbortError") throw err;
    try {
      // small delay before retry
      await new Promise(r => setTimeout(r, 250));
      const controller2 = new AbortController();
      opts.signal = controller2.signal;
      const timer2 = setTimeout(() => controller2.abort(), timeout);
      const res2 = await fetch(url, opts);
      clearTimeout(timer2);
      return res2;
    } catch (e2) { throw e2; }
  }
}

// global error handlers — показываем в консоль и toast, но не ломаем UI
window.addEventListener("error", (ev) => {
  console.error("Uncaught error:", ev.error || ev.message || ev);
  try { showToast("Произошла ошибка. Обновите страницу."); } catch {}
});
window.addEventListener("unhandledrejection", (ev) => {
  console.error("Unhandled promise rejection:", ev.reason);
  try { showToast("Ошибка сети/скрипта. Попробуйте снова."); } catch {}
});

function safeJsonParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function getTgApp() {
  return (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
}

function getInitDataStrict() {
  const tgApp = getTgApp();
  const initData = (tgApp && typeof tgApp.initData === "string") ? tgApp.initData.trim() : "";
  if (!initData || initData.length > 5000) return "";
  return initData;
}

/* ---------------- Delivery normalization ---------------- */
/**
 * Приводит значение доставки к внутреннему формату, который ожидает бэкенд.
 * Поддерживает старые русские значения и уже нормализованные.
 */
function normalizeDeliveryValue(val) {
  if (!val) return "";
  const v = String(val).trim();
  if (!v) return "";
  const low = v.toLowerCase();
  if (low === "курьер" || low === "courier") return "Courier";
  if (low === "dhl") return "DHL";
  if (low === "pickup" || low === "самовывоз") return "Pickup";
  return v; // fallback — не трогаем неизвестное значение
}

// Вставляем нормализацию непосредственно перед отправкой в apiPostTG,
// чтобы гарантировать корректный delivery независимо от источника.
async function apiPostTG(path, bodyObj) {
  const initData = getInitDataStrict();

  if (!initData) {
    return { ok: false, status: 0, json: null, raw: "", error: "NO_INITDATA" };
  }

  const url = String(API_BASE || "").replace(/\/$/, "") + path;

  // Если отправляем заказ — нормализуем поле доставки на клиенте
  try {
    if (bodyObj && typeof bodyObj === "object" && /send-?order/i.test(String(path))) {
      if ("delivery" in bodyObj) {
        bodyObj.delivery = normalizeDeliveryValue(bodyObj.delivery);
      }
      // защитный лимит: не даём отправить слишком большой orderText или слишком много позиций
      try {
        const itemsCount = (bodyObj.orderText || "").split(/\n/).filter(Boolean).length;
        if (itemsCount > MAX_ITEMS_PER_ORDER) {
          return { ok: false, status: 400, json: null, raw: "", error: "TOO_MANY_ITEMS" };
        }
        if ((bodyObj.orderText || "").length > ORDER_TEXT_LIMIT) {
          return { ok: false, status: 400, json: null, raw: "", error: "ORDER_TEXT_TOO_LONG" };
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) {
    console.warn("normalizeDeliveryValue failed:", e);
  }

  // Generate a stable idempotency key per attempt
  const idemKey = (() => {
    try {
      const seed = `${path}|${Date.now()}|${Math.random()}`;
      const enc = new TextEncoder();
      const bytes = enc.encode(seed);
      let sum = 0;
      for (let i = 0; i < bytes.length; i++) sum = (sum * 31 + bytes[i]) >>> 0;
      return `miniapp-${sum.toString(16)}-${Math.floor(Math.random()*1e6)}`;
    } catch { return `miniapp-${Date.now()}`; }
  })();

  const res = await fetchWithTimeout(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": initData,
      "Idempotency-Key": idemKey
    },
    body: JSON.stringify(bodyObj || {})
  }, FETCH_TIMEOUT_MS);

  const raw = await res.text();
  const json = safeJsonParse(raw);

  return { ok: res.ok, status: res.status, json, raw, error: null };
}

function humanApiError(code) {
  switch (code) {
    case "ACTIVE_ORDER_EXISTS":
      return "У вас уже есть активный заказ. Завершите или отмените его, чтобы создать новый.";
    case "INITDATA_EXPIRED":
      return "Сессия Telegram устарела. Закройте и заново откройте мини-приложение в Telegram.";
    case "TOO_MANY_REQUESTS":
      return "Слишком часто. Подождите минуту и попробуйте снова.";
    case "REPLAY_DETECTED":
      return "Повтор запроса обнаружен. Обновите мини-приложение и попробуйте снова.";
    case "UNAUTHORIZED":
      return "Не удалось подтвердить Telegram. Откройте мини-приложение строго внутри Telegram.";
    case "USER_BANNED":
      return "Вы заблокированы и не можете создавать заказы.";
    default:
      return null;
  }
}



/* ---------------- Config ---------------- */
const CSV_URL = "https://docs.google.com/spreadsheets/d/1cKCawmrGiIULnN2d_o0X-TrAOAVDyXpNHjeKr1_D2Lw/export?format=tsv&gid=0&v=" + Date.now();

const categories = [
  { id: "elfbar", label: "ELFBAR" },
  { id: "chaserlux", label: "CHASER LUX" },
  { id: "vozol", label: "VOZOL" },
  { id: "chaserblack", label: "CHASER BLACK" },
  { id: "chaserspecial", label: "CHASER SPECIAL" },
  { id: "chasermix", label: "CHASER MIX" }
];

const CATEGORY_INFO = {
  elfbar: "30ML | 50MG",
  chaserlux: "30ML | 65MG",
  vozol: "30ML | 50MG",
  chaserblack: "30ML | 65MG",
  chaserspecial: "30ML | 65MG",
  chasermix: "30ML | 65MG"
};

const CATEGORY_LABEL_TO_IMAGE = {
  elfbar: "elfbar1.jpg",
  chaserlux: "chaserlux1.jpg",
  vozol: "vozol2.jpg",
  chaserblack: "chaserblack1.jpg",
  chaserspecial: "chaserspecial1.jpg",
  chasermix: "chasermix1.jpeg"
};

function imageForCategoryLabel(label) {
  if (!label) return "default.jpg";
  const key = normalizeKey(label);
  return CATEGORY_LABEL_TO_IMAGE[key] || "default.jpg";
}
const PRICE = 15;
let cart = [];
let stockData = [];
let currentCategoryId = null;
let currentCategoryLabel = null;

function showToast(text) {
  const box = safeGet("toast-box");
  if (!box) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;

  box.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-10px)";
  }, 1800);

  setTimeout(() => el.remove(), 2300);
}

/* ---------------- Utilities ---------------- */
function parseTSV(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "").map(line => line.split("\t").map(c => c.trim()));
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function normalizeKey(s) { return String(s || "").toLowerCase().replace(/[\s\-\_]/g, ""); }

/* ---------------- Render categories ---------------- */
const catBox = safeGet("categories");
categories.forEach(cat => {
  const el = document.createElement("div");
  el.className = "category";
  el.textContent = cat.label;
  el.dataset.id = cat.id;

  el.addEventListener("pointerup", async (e) => {
    e.preventDefault();

    // подсветка активной категории
    document.querySelectorAll(".category").forEach(x => x.classList.remove("active"));
    el.classList.add("active");

    // ✅ 1) сначала обновляем цену (15 или 13)
    try {
      await loadUserPrice();
    } catch (err) {
      console.warn("[loadUserPrice] failed:", err);
      // если упало — просто оставим 15
    }

    // ✅ 2) потом рисуем категорию с актуальной CURRENT_PRICE
    loadCategory(cat.id, cat.label);
  });

  catBox.appendChild(el);
});


/* ---------------- Adjust padding for flavors ---------------- */
function adjustFlavorsPadding() {
  const addBtn = document.querySelector(".add-btn");
  const flavorsBox = document.querySelector("#flavors-box");
  if (!flavorsBox) return;
  if (addBtn) {
    const btnHeight = addBtn.offsetHeight;
    const extra = 20;
    flavorsBox.style.paddingBottom = (btnHeight + extra) + "px";
  } else {
    flavorsBox.style.paddingBottom = "80px";
  }
}


/* ---------------- Load Category ---------------- */
async function loadCategory(normId, displayLabel) {
  const card = safeGet("product-card");
  card.innerHTML = "<div style='opacity:.7'>Загрузка...</div>";

  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error("Network: " + res.status);
    const tsv = await res.text();
    const rows = parseTSV(tsv);
    const list = [];

    // Собираем все вкусы, даже если qty = 0 (для "нет в наличии")
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const catRaw = row[0] || "";
      const flavor = row[1] || "";
      const qty = Number(row[2] || 0);

      if (!flavor) continue; // пропускаем пустые вкусы
      if (normalizeKey(catRaw) === normId) list.push({ flavor, qty });
    }

    const img = CATEGORY_LABEL_TO_IMAGE[normId] || "default.jpg";
    const infoText = CATEGORY_INFO[normId] || "";

    if (list.length === 0) {
      card.innerHTML = `
        <div class="product-row">
          <img class="product-img" src="${img}" alt="${escapeHtml(displayLabel)}">
          <div class="info">
            <h2>${escapeHtml(displayLabel)}</h2>
            <div class="category-info" style="opacity:.8; margin-bottom:6px;">${infoText}</div>
            <div class="price">
  ${
    CURRENT_PRICE < 15
      ? `<span style="text-decoration:line-through;opacity:.6">15€</span> <span style="color:#ff1e9b">${CURRENT_PRICE}€</span>`
      : `15€`
  }
</div>

            <p style="opacity:.7">Ожидается поставка</p>
          </div>
        </div>`;
      return;
    }

    card.innerHTML = `
      <div class="product-row">
        <img class="product-img" src="${img}" alt="${escapeHtml(displayLabel)}">
        <div class="info">
          <h2>${escapeHtml(displayLabel)}</h2>
          <div class="category-info" style="opacity:.8; margin-bottom:6px;">${infoText}</div>
          <div class="price">
  ${
    CURRENT_PRICE < 15
      ? `<span style="text-decoration:line-through;opacity:.6">15€</span> <span style="color:#ff1e9b">${CURRENT_PRICE}€</span>`
      : `15€`
  }
</div>

          <div id="flavors-box" aria-label="Вкусы"></div>
          <button class="add-btn" id="add-to-cart" aria-disabled="true">Добавить в корзину</button>
        </div>
      </div>`;

    const box = safeGet("flavors-box");
    let active = null;

    // Сортируем: сначала доступные, потом распроданные
    list.sort((a, b) => b.qty - a.qty);

    list.forEach((item, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "flavor-btn";
  b.style.setProperty('--i', i);
  const cleanFlavor = item.flavor.replace(/[0-9]/g, '').trim();
 b.innerText = cleanFlavor;


  // Стили для доступных/недоступных
  if (item.qty > 0) {
    b.classList.add("available"); // светлый стиль
  } else {
    b.classList.add("unavailable"); // темный стиль
  }

  b.addEventListener("click", () => {
    if (item.qty <= 0) {
      showToast("Нет в наличии");
      return;
    }

    document.querySelectorAll(".flavor-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    active = item;
    b.focus();

    const addBtn = safeGet("add-to-cart");
    if (addBtn) {
      addBtn.classList.add("active");
      addBtn.removeAttribute('aria-disabled');

      // плавный скролл к кнопке "Добавить в корзину"
      const rect = addBtn.getBoundingClientRect();
      const footer = document.querySelector("footer");
      const footerRect = footer ? footer.getBoundingClientRect() : { top: document.body.scrollHeight + window.innerHeight };
      let scrollTarget = rect.top + window.scrollY - 20;
      const maxScroll = (footerRect.top || (document.body.scrollHeight + window.innerHeight)) + window.scrollY - window.innerHeight;
      if (scrollTarget > maxScroll) scrollTarget = maxScroll;
      window.scrollTo({ top: scrollTarget, behavior: "smooth" });
    }
  });

  box.appendChild(b);
});

// --- После добавления всех кнопок ---
adjustFlavorsPadding();

  const addBtn = safeGet("add-to-cart");
addBtn.onclick = () => {
  if (!active) {
    showToast("Пожалуйста, выберите вкус.");
    return;
  }

  const BASE_PRICE = 15;
  const unitPrice =
    (typeof CURRENT_PRICE === "number" && CURRENT_PRICE > 0)
      ? CURRENT_PRICE
      : BASE_PRICE;

  const existing = cart.find(it =>
    it.category === displayLabel && it.flavor === active.flavor
  );

  if (existing) {
    // ✅ подстрахуем цену, если вдруг надо
    existing.price = unitPrice;
    existing.originalPrice = BASE_PRICE;
    existing.discountType = CURRENT_DISCOUNT_TYPE;

    if (existing.qty < active.qty) {
      existing.qty += 1;
    } else {
      showToast(`В наличии только ${active.qty} шт этого вкуса`);
      return;
    }
  } else {
    cart.push({
      category: displayLabel,
      flavor: active.flavor,
      price: unitPrice,           // ✅ финальная цена (15 или 13)
      originalPrice: BASE_PRICE,  // ✅ чтобы в корзине показать "15 → 13"
      discountType: CURRENT_DISCOUNT_TYPE, // optional
      qty: 1,
      maxQty: active.qty
    });
  }

  updateCart();
  animateFlyToCart(document.querySelector(".flavor-btn.active"));
  addBtn.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => openCart(), 420);
};


  } catch (err) {
    console.error("Ошибка загрузки TSV:", err);
    card.innerHTML = "<p>Ошибка загрузки данных. Проверьте CORS/доступ к таблице.</p>";
  }
}


function formatEuro(n) {
  const x = Number(n || 0);
  return Number.isInteger(x) ? `${x}€` : `${x.toFixed(2)}€`;
}

function priceHtml(item) {
  const p = Number(item.price || 0);
  const op = Number(item.originalPrice || 0);

  // если есть скидка (originalPrice > price) — показываем "15€ → 13€"
  if (op > 0 && p > 0 && p < op) {
    return `
      <span class="cart-old-price">${formatEuro(op)}</span>
      <span class="cart-new-price">${formatEuro(p)}</span>
    `;
  }

  // иначе просто одна цена
  return `<span class="cart-new-price">${formatEuro(p || op || 15)}</span>`;
}

/* ---------------- Cart logic ---------------- */
function updateCart() {
  const list = safeGet("cart-list");
  list.innerHTML = "";
  let total = 0;
  let totalItems = 0;

  // --- helpers (локально, чтобы просто копипаст) ---
  const formatEuro = (n) => {
    const x = Number(n || 0);
    return Number.isInteger(x) ? `${x}€` : `${x.toFixed(2)}€`;
  };

  const unitPriceHtml = (it) => {
    const p = Number(it.price || 0);
    const op = Number(it.originalPrice || 0);

    if (op > 0 && p > 0 && p < op) {
      return `<span class="cart-old-price">${formatEuro(op)}</span> <span class="cart-new-price">${formatEuro(p)}</span>`;
    }
    return `<span class="cart-new-price">${formatEuro(p || op || 15)}</span>`;
  };

  cart.forEach((it, idx) => {
    const qty = Number(it.qty || 1);
    const price = Number(it.price || 0);

    total += price * qty;
    totalItems += qty;

    const row = document.createElement("div");
    row.className = "cart-item";

    const thumb = imageForCategoryLabel(it.category);
    const categoryInfoText = CATEGORY_INFO[normalizeKey(it.category)] || "";

    const lineTotal = price * qty;

    row.innerHTML = `
      <img class="cart-thumb" src="${thumb}" alt="">
      <div class="cart-meta">
        <div class="cart-meta-title">${escapeHtml(it.flavor)}</div>
        <div class="cart-meta-flavor" style="opacity:.8; font-size:.85em;">${categoryInfoText}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <div class="qty-control" data-idx="${idx}">
          <button class="qty-btn" data-action="dec" aria-label="Уменьшить">−</button>
          <div class="qty-value">${qty}</div>
          <button class="qty-btn" data-action="inc" aria-label="Увеличить">+</button>
        </div>

        <!-- Цена: показываем 15→13 если есть скидка + итог по строке -->
        <div style="min-width:140px;text-align:right;">
          <div style="font-weight:700; line-height:1.1;">
            ${unitPriceHtml(it)}
          </div>
          <div style="opacity:.85; font-size:.85em; line-height:1.1;">
            × ${qty} = ${formatEuro(lineTotal)}
          </div>
        </div>

        <button class="remove" data-idx="${idx}" aria-label="Удалить"
          style="background:transparent;border:none;color:#ff6b6b;cursor:pointer;font-size:18px">
          ✖
        </button>
      </div>`;
    list.appendChild(row);
  });

  // total (с евро)
  safeGet("cart-total").textContent = formatEuro(total);


  const badge = safeGet("cart-count");
  badge.style.display = "inline-block";
  badge.textContent = totalItems;

  const cartListEl = safeGet("cart-list");
  const checkoutBtn = safeGet("checkout");

  function updateCheckoutButton() {
    if (totalItems === 0) {
      checkoutBtn.classList.add("inactive");
      checkoutBtn.style.opacity = "0.5";
      checkoutBtn.style.cursor = "not-allowed";
    } else {
      checkoutBtn.classList.remove("inactive");
      checkoutBtn.style.opacity = "1";
      checkoutBtn.style.cursor = "pointer";
    }
  }

  if (totalItems === 0) {
    cartListEl.classList.add("empty");
    cartListEl.innerHTML =
      '<div style="text-align:center;padding:18px;color:rgba(255,255,255,0.6)">Корзина пуста — добавьте вкус</div>';
  } else {
    cartListEl.classList.remove("empty");
  }

  updateCheckoutButton();


  // ------------------ управление кнопками количества ------------------
  document.querySelectorAll(".qty-control").forEach(ctrl => {
    const idx = Number(ctrl.dataset.idx);
    const item = cart[idx];
    ctrl.querySelectorAll("[data-action]").forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === "inc") {
          if (item.qty < item.maxQty) {       // проверка по складу
            item.qty += 1;
          } else {
            alert(`В наличии только ${item.maxQty} шт этого вкуса`);
          }
        }
        if (action === "dec") {
          if (item.qty <= 1) cart.splice(idx, 1);  // удаляем товар, если qty <= 1
          else item.qty -= 1;
        }
        updateCart(); // обновляем корзину после изменения
      };
    });
  });

  document.querySelectorAll(".remove").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      cart.splice(idx, 1);
      updateCart();
    };
  });
}



/* ---------------- UI: menu & cart open/close ---------------- */
const burger = safeGet("burger");
const menuBackdrop = safeGet("menu-backdrop");
const sideMenu = safeGet("side-menu");
const sideMenuCloseBtn = safeGet("side-menu-close");
const cartBtn = safeGet("cart");
const cartModal = safeGet("cart-modal");
const cartOverlay = safeGet("cart-overlay");
const cartCloseBtn = safeGet("cart-close");
const burgerBtn = document.querySelector(".burger");

if (burger) {
  burger.addEventListener("click", () => {
     menuBackdrop.style.display = "block";
     setTimeout(() => sideMenu.classList.add("open"), 10);
     burgerBtn.classList.add("open");
  });
}

if (sideMenuCloseBtn) {
  sideMenuCloseBtn.addEventListener("click", () => {
     sideMenu.classList.remove("open");
     menuBackdrop.style.display = "none";
     burgerBtn.classList.remove("open");
   });
 }

if (menuBackdrop) {
  menuBackdrop.addEventListener("click", (e) => {
    if (e.target === menuBackdrop) {
      sideMenu.classList.remove("open");
      menuBackdrop.style.display = "none";
      if (burgerBtn) burgerBtn.classList.remove("open");
    }
  });
}

function openCart() {
  if (!cartModal || !cartOverlay) return;
  cartModal.style.bottom = "0";
  cartOverlay.style.display = "block";
  document.body.classList.add("no-scroll");
  cartModal.classList.add("open");          // ✅ добавили
}

function closeCart() {
  if (!cartModal || !cartOverlay) return;
  cartModal.style.bottom = "-100vh";
  cartOverlay.style.display = "none";
  document.body.classList.remove("no-scroll");
  cartModal.classList.remove("open");       // ✅ убрали
}

if (cartBtn) {
  cartBtn.addEventListener("click", (e) => {
   e.stopPropagation();
   if (cartModal.classList.contains("open")) closeCart();
   else openCart();
 });
}

if (cartCloseBtn) cartCloseBtn.addEventListener("click", closeCart);
if (cartOverlay) cartOverlay.addEventListener("click", closeCart);
if (cartModal) cartModal.addEventListener("click", e => e.stopPropagation());


document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (sideMenu.classList.contains("open")) {
      sideMenu.classList.remove("open");
      menuBackdrop.style.display = "none";
      burgerBtn.classList.remove("open");
    }
    if (cartModal.classList.contains("open")) closeCart();
  }
});

/* ------------- add-to-cart flying dot animation ------------- */
const flyDot = safeGet("fly-dot");
function animateFlyToCart(sourceElem) {
  if (!sourceElem || !flyDot || !cartBtn) return;
  try {
    const srcRect = sourceElem.getBoundingClientRect();
    const cartRect = cartBtn.getBoundingClientRect();
    const startX = srcRect.left + srcRect.width / 2;
    const startY = srcRect.top + srcRect.height / 2;
    const endX = cartRect.left + cartRect.width / 2;
    const endY = cartRect.top + cartRect.height / 2;

    flyDot.style.left = startX + "px";
    flyDot.style.top = startY + "px";
    flyDot.style.opacity = 1;
    flyDot.style.transform = "translate(-50%,-50%) scale(1)";

    flyDot.style.transition = "transform 520ms cubic-bezier(.2,.9,.25,1), opacity 120ms linear";
    const dx = endX - startX;
    const dy = endY - startY;
    requestAnimationFrame(() => {
      flyDot.style.transform = `translate(${dx}px, ${dy}px) scale(.2)`;
    });

    setTimeout(() => {
      flyDot.style.opacity = 0;
      flyDot.style.transition = "opacity 120ms linear";
      flyDot.style.transform = "translate(-50%,-50%) scale(.2)";
      setTimeout(() => {
        flyDot.style.transform = "translate(-50%,-50%) scale(1)";
        flyDot.style.left = "-9999px";
        flyDot.style.top = "-9999px";
      }, 180);
    }, 560);
  } catch (e) { /* swallow animation errors */ }
}


/* ---------------- Checkout modal ---------------- */
// replace direct getElementById calls with safeGet to avoid crashes if markup missing
const checkoutModal = safeGet("checkout-modal");
const checkoutConfirm = safeGet("checkout-confirm");
const checkoutCancel = safeGet("checkout-cancel");
const checkoutCity = safeGet("checkout-city");
const checkoutDelivery = safeGet("checkout-delivery");
const checkoutPayment = safeGet("checkout-payment");
const checkoutBtn = safeGet("checkout");
const backToFlavors = safeGet("back-to-flavors");

/// ===== Цена для пользователя (15 или 13) =====
let CURRENT_PRICE = 15;
let CURRENT_DISCOUNT_TYPE = null;

// ✅ мини-кеш на 20 сек (чтобы не спамить бэк при кликах по категориям)
let _priceCache = { ts: 0, price: 15, type: null };

async function loadUserPrice(force) {
  try {
    const now = Date.now();
    if (!force && (now - _priceCache.ts) < 20_000) {
      CURRENT_PRICE = _priceCache.price;
      CURRENT_DISCOUNT_TYPE = _priceCache.type;
      return;
    }

    // Telegram context (без optional chaining)
    var tgApp = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
    var tgUser = (tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user) ? tgApp.initDataUnsafe.user : null;

    // если миниапп не в Telegram — без скидки
    if (!tgApp || !tgUser) {
      CURRENT_PRICE = 15;
      CURRENT_DISCOUNT_TYPE = null;
      _priceCache = { ts: now, price: 15, type: null };
      return;
    }

    // initData обязателен, иначе бэк вернёт UNAUTHORIZED
    var initData = (tgApp && typeof tgApp.initData === "string") ? tgApp.initData : "";
    if (!initData) {
      CURRENT_PRICE = 15;
      CURRENT_DISCOUNT_TYPE = null;
      _priceCache = { ts: now, price: 15, type: null };
      return;
    }

    // нормализуем BASE (убираем / в конце)
    var API_URL = String(API_BASE || "").replace(/\/$/, "") + "/api/price-info";

    var res = await fetchWithTimeout(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({}) // пусть будет {}, чтобы express.json не ругался
    }, FETCH_TIMEOUT_MS);

    // Railway может вернуть HTML/502 -> читаем текст
    var raw = await res.text();

    // если вернули HTML/пусто — считаем что скидки нет
    if (!raw || raw[0] === "<") {
      CURRENT_PRICE = 15;
      CURRENT_DISCOUNT_TYPE = null;
      _priceCache = { ts: now, price: 15, type: null };
      return;
    }

    var json = null;
    try { json = JSON.parse(raw); } catch (e) { json = null; }

    // ожидаем { ok:true, finalPrice, discountType }
    if (!res.ok || !json || json.ok !== true) {
      CURRENT_PRICE = 15;
      CURRENT_DISCOUNT_TYPE = null;
      _priceCache = { ts: now, price: 15, type: null };
      return;
    }

    var p = Number(json.finalPrice);
    if (!Number.isFinite(p) || p <= 0) p = 15;

    CURRENT_PRICE = p;
    CURRENT_DISCOUNT_TYPE = json.discountType || null;

    _priceCache = { ts: now, price: CURRENT_PRICE, type: CURRENT_DISCOUNT_TYPE };
  } catch (e) {
    CURRENT_PRICE = 15;
    CURRENT_DISCOUNT_TYPE = null;
    _priceCache = { ts: Date.now(), price: 15, type: null };
  }
}







/* === Проверка Telegram ника (латиница, цифры, _, начинается с @) === */
function validateTgNick(nick) {
  const tgRegex = /^@[a-zA-Z0-9_]{3,32}$/;
  return tgRegex.test(nick);
}

function updateCheckoutButton() {
  if (cart.length === 0) {
    checkoutBtn.classList.add("inactive");
    checkoutBtn.style.opacity = "0.5";
    checkoutBtn.style.cursor = "not-allowed";
  } else {
    checkoutBtn.classList.remove("inactive");
    checkoutBtn.style.opacity = "1";
    checkoutBtn.style.cursor = "pointer";
  }
}

function closeCheckout() {
  checkoutModal.style.display = "none";
  document.body.style.overflow = "";
  if (cartOverlay) {
    cartOverlay.style.display = "block";
    cartOverlay.style.pointerEvents = "auto";
  }
}

// --- Плавное появление поля ---
function showField(field) {
  field.disabled = false;
  field.style.opacity = 0;
  field.style.transition = "opacity 0.2s ease";
  requestAnimationFrame(() => {
    field.style.opacity = 1;
  });
}

// --- Открытие модалки ---
checkoutBtn.addEventListener("click", () => {
  if (cart.length === 0) return;

  checkoutCity.value = "";
  checkoutDelivery.value = "";
  checkoutPayment.value = "";

  checkoutModal.style.display = "flex";
  document.body.style.overflow = "hidden";

  if (cartOverlay) {
    cartOverlay.style.display = "none";
    cartOverlay.style.pointerEvents = "none";
  }

  checkoutDelivery.disabled = true;
  checkoutPayment.disabled = true;
});


// --- Закрытие модалки ---
checkoutCancel.addEventListener("click", closeCheckout);

// Закрытие при клике вне контента
checkoutModal.addEventListener("click", (e) => {
  if (!e.target.closest(".checkout-modal-content")) closeCheckout();
});

/// --- Подтверждение заказа (защита от даблклика/спама на фронте) ---
let _sendingOrder = false;
const ORDER_COOLDOWN_MS = 12_000; // 12 секунд между попытками
const LS_LAST_ORDER_TS = "cc_last_order_ts";

checkoutConfirm.addEventListener && checkoutConfirm.addEventListener("click", async () => {
  if (_sendingOrder) return;

  const nowTs = Date.now();
  const lastTs = Number(localStorage.getItem(LS_LAST_ORDER_TS) || 0);
  if (lastTs && (nowTs - lastTs) < ORDER_COOLDOWN_MS) {
    alert("Подождите пару секунд и попробуйте снова.");
    return;
  }

  // 1) Контекст Telegram (без optional chaining)
  var tgApp = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  var tgUser = (tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user) ? tgApp.initDataUnsafe.user : null;

  // username обязателен (ты на бэке тоже это требуешь)
  var tgNick = (tgUser && tgUser.username) ? ("@" + tgUser.username) : null;
  if (!tgApp || !tgUser || !tgNick) {
    alert("Открой мини-приложение через Telegram и убедись, что у тебя установлен username.");
    return;
  }

  // initData ОБЯЗАТЕЛЕН — без него бэк вернёт UNAUTHORIZED
  var initData = (tgApp && typeof tgApp.initData === "string") ? tgApp.initData : "";
  if (!initData || initData.length < 10) {
    alert("Не удалось получить initData. Открой мини-приложение через Telegram (не через браузер).");
    return;
  }

  // 2) Валидация полей
  var city = String(checkoutCity.value || "").trim();
  var delivery = String(checkoutDelivery.value || "").trim();
  var payment = String(checkoutPayment.value || "").trim();

  if (!city) { alert("Укажите город"); return; }
  if (!delivery) { alert("Выберите способ доставки"); return; }
  if (!payment) { alert("Выберите способ оплаты"); return; }
  if (!cart || cart.length === 0) { alert("Корзина пуста"); return; }

  // 3) Маппинг (как у тебя было)
  var deliveryText =
    delivery === "Pickup" ? "Самовывоз" :
    delivery === "DHL" ? "DHL" :
    delivery === "Courier" ? "Курьер" :
    delivery;

  var paymentText =
    payment === "Cash" ? "Наличные" :
    payment === "Card" ? "Карта" :
    payment === "Crypto" ? "Криптовалюта" :
    payment;

  // 4) Формируем orderText (ВАЖНО: формат "× N шт" нужен твоему бэку для qty)
  var itemsText = cart
    .map(function (item) {
      var cat = String(item.category || "").trim();
      var flv = String(item.flavor || "").trim();
      var qty = Number(item.qty) || 0;
      var price = Number(item.price) || 0;

      if (!cat || !flv || qty <= 0) return "";
      return cat + " — " + flv + " × " + qty + " шт = " + (price * qty) + "€";
    })
    .filter(function (x) { return x && x.trim(); })
    .join("\n");

  if (!itemsText.trim()) { alert("Корзина пуста"); return; }

  // 5) Подготовка запроса
  var API_URL = String(API_BASE || "").replace(/\/$/, "") + "/api/send-order";

  var orderData = {
    city: city,
    delivery: deliveryText,
    payment: paymentText,
    orderText: itemsText
  };

  // 6) UI lock
  _sendingOrder = true;
  localStorage.setItem(LS_LAST_ORDER_TS, String(Date.now()));

  var prevText = checkoutConfirm.textContent;
  checkoutConfirm.disabled = true;
  checkoutConfirm.textContent = "Отправляем...";

  // таймаут на запрос
  var controller = null;
  var timer = null;
  try {
    controller = new AbortController();
    timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 12_000);

    // Create an Idempotency-Key for this order attempt
    var idemKey = (function () {
      try {
        var seed = "send-order|" + Date.now() + "|" + Math.random();
        var enc = new TextEncoder();
        var bytes = enc.encode(seed);
        var sum = 0;
        for (var i = 0; i < bytes.length; i++) sum = (sum * 31 + bytes[i]) >>> 0;
        return "miniapp-ord-" + sum.toString(16) + "-" + Math.floor(Math.random()*1e6);
      } catch (e) { return "miniapp-ord-" + Date.now(); }
    })();

    var res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
        "Idempotency-Key": idemKey
      },
      body: JSON.stringify(orderData),
      signal: controller.signal
    });

    var raw = await res.text();
    var json = null;
    try { json = JSON.parse(raw); } catch (e) { json = null; }

    // 7) Обработка ошибок
    if (!res.ok) {
      // частые кейсы
      if (res.status === 401) {
        alert("Не удалось подтвердить Telegram-сессию. Закрой мини-апп и открой заново через бота.");
        return;
      }
      if (res.status === 429) {
        alert("Слишком часто. Подожди минуту и попробуй снова.");
        return;
      }
      if (res.status === 409) {
        var errCode = (json && json.error) ? json.error : "";
        if (errCode === "ACTIVE_ORDER_EXISTS") {
          alert("У вас уже есть активный заказ. Завершите или отмените его, чтобы создать новый.");
          return;
        }
        if (errCode === "REPLAY_DETECTED") {
          alert("Защита от повтора сработала. Закрой мини-апп и открой заново через Telegram, затем попробуй снова.");
          return;
        }
      }

      // дефолт
      alert("Сервер вернул ошибку: " + res.status + "\n" + (raw ? raw.slice(0, 300) : ""));
      return;
    }

    if (!json || !json.success) {
      var msg = (json && json.error) ? json.error : (raw ? raw.slice(0, 300) : "UNKNOWN");
      alert("Ошибка: " + msg);
      return;
    }

    // 8) Успех
    var onClosed = function () {
      try {
        cart = [];
        updateCart();
        updateCheckoutButton();
        closeCheckout();
      } catch (e) {}
      try { tgApp.close(); } catch (e) {}
      // чтобы не копились обработчики
      try { if (tgApp && tgApp.offEvent) tgApp.offEvent("popupClosed", onClosed); } catch (e) {}
    };

    if (tgApp && tgApp.showPopup) {
      try { if (tgApp.offEvent) tgApp.offEvent("popupClosed", onClosed); } catch (e) {}
      try { tgApp.onEvent("popupClosed", onClosed); } catch (e) {}

      tgApp.showPopup({
        title: "Заказ принят ✅",
        message: "Спасибо! Менеджер свяжется с вами.\n\nВаш Telegram: " + tgNick,
        buttons: [{ id: "ok", type: "default", text: "ОК" }]
      });
    } else {
      alert("Спасибо! С вами свяжется менеджер.\nВаш Telegram: " + tgNick);
      onClosed();
    }

  } catch (err) {
    var isAbort = (err && (err.name === "AbortError"));
    alert(isAbort ? "Сервер долго отвечает. Попробуй ещё раз." : ("Ошибка сети/скрипта: " + (err && err.message ? err.message : String(err))));
  } finally {
    if (timer) clearTimeout(timer);

    _sendingOrder = false;
    checkoutConfirm.disabled = false;
    checkoutConfirm.textContent = prevText;
  }
});

// --- Кнопка назад к вкусам ---
backToFlavors.addEventListener("click", closeCart);

// Обсервер для обновления кнопки оформления заказа
const observer = new MutationObserver(updateCheckoutButton);
// attach observer only to a real DOM node (do not attach to safe stub)
const _realCartList = realGet("cart-list");
if (_realCartList) {
  observer.observe(_realCartList, { childList: true, subtree: true });
} else {
  console.warn("cart-list not found — MutationObserver not attached");
}

// --- Touch-fix для мобильных ---
checkoutModal.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });
});

updateCheckoutButton();

document.addEventListener("DOMContentLoaded", async () => {
  await loadUserPrice();   // ← СНАЧАЛА цена

  const firstCat = document.querySelector(".category");
  if (firstCat) {
    firstCat.classList.add("active");
    const normId = firstCat.dataset.id;
    const label = firstCat.textContent;
    loadCategory(normId, label); // ← ПОТОМ рендер
  }

  updateCart();
});
