/* ================= TELEGRAM MINI APP ================= */
const tg = window.Telegram?.WebApp;

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

const API_BASE = "https://bot1-production-376a.up.railway.app";


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
  const box = document.getElementById("toast-box");
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
const catBox = document.getElementById("categories");
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
  const card = document.getElementById("product-card");
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

    const box = document.getElementById("flavors-box");
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

    const addBtn = document.getElementById("add-to-cart");
    if (addBtn) {
      addBtn.classList.add("active");
      addBtn.removeAttribute('aria-disabled');

      // плавный скролл к кнопке "Добавить в корзину"
      const rect = addBtn.getBoundingClientRect();
      const footer = document.querySelector("footer");
      const footerRect = footer.getBoundingClientRect();
      let scrollTarget = rect.top + window.scrollY - 20;
      const maxScroll = footerRect.top + window.scrollY - window.innerHeight;
      if (scrollTarget > maxScroll) scrollTarget = maxScroll;
      window.scrollTo({ top: scrollTarget, behavior: "smooth" });
    }
  });

  box.appendChild(b);
});

// --- После добавления всех кнопок ---
adjustFlavorsPadding();

  const addBtn = document.getElementById("add-to-cart");
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
  const list = document.getElementById("cart-list");
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
  document.getElementById("cart-total").textContent = total;


  const badge = document.getElementById("cart-count");
  badge.style.display = "inline-block";
  badge.textContent = totalItems;

  const cartListEl = document.getElementById("cart-list");
  const checkoutBtn = document.getElementById("checkout");

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
const burger = document.getElementById("burger");
const menuBackdrop = document.getElementById("menu-backdrop");
const sideMenu = document.getElementById("side-menu");
const sideMenuCloseBtn = document.getElementById("side-menu-close");
const cartBtn = document.getElementById("cart");
const cartModal = document.getElementById("cart-modal");
const cartOverlay = document.getElementById("cart-overlay");
const cartCloseBtn = document.getElementById("cart-close");
const burgerBtn = document.querySelector(".burger");

burger.addEventListener("click", () => {
  menuBackdrop.style.display = "block";
  setTimeout(() => sideMenu.classList.add("open"), 10);
  burgerBtn.classList.add("open");
});

sideMenuCloseBtn.addEventListener("click", () => {
  sideMenu.classList.remove("open");
  menuBackdrop.style.display = "none";
  burgerBtn.classList.remove("open");
});

menuBackdrop.addEventListener("click", (e) => {
  if (e.target === menuBackdrop) {
    sideMenu.classList.remove("open");
    menuBackdrop.style.display = "none";
    burgerBtn.classList.remove("open");
  }
});

function openCart() {
  cartModal.style.bottom = "0";
  cartOverlay.style.display = "block";
  document.body.classList.add("no-scroll");
}
function closeCart() {
  cartModal.style.bottom = "-100vh";
  cartOverlay.style.display = "none";
  document.body.classList.remove("no-scroll");
}
cartBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (cartModal.classList.contains("open")) closeCart();
  else openCart();
});
cartCloseBtn.addEventListener("click", closeCart);
cartOverlay.addEventListener("click", closeCart);
cartModal.addEventListener("click", e => e.stopPropagation());

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
const flyDot = document.getElementById("fly-dot");
function animateFlyToCart(sourceElem) {
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
}

/* ---------------- Checkout modal ---------------- */
const checkoutModal = document.getElementById("checkout-modal");
const checkoutConfirm = document.getElementById("checkout-confirm");
const checkoutCancel = document.getElementById("checkout-cancel");
const checkoutCity = document.getElementById("checkout-city");
const checkoutDelivery = document.getElementById("checkout-delivery");
const checkoutPayment = document.getElementById("checkout-payment");
const checkoutBtn = document.getElementById("checkout");
const backToFlavors = document.getElementById("back-to-flavors");

/// ===== Цена для пользователя (15 или 13) =====
let CURRENT_PRICE = 15;
let CURRENT_DISCOUNT_TYPE = null;

async function loadUserPrice() {
  // Telegram context (без optional chaining)
  var tgApp = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  var tgUser = (tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user) ? tgApp.initDataUnsafe.user : null;

  var tgNick = (tgUser && tgUser.username) ? ("@" + tgUser.username) : null;
  var client_chat_id = (tgUser && tgUser.id) ? Number(tgUser.id) : null;

  // если вообще нет телеги — без скидки
  if (!tgNick && !client_chat_id) {
    CURRENT_PRICE = 15;
    CURRENT_DISCOUNT_TYPE = null;
    return;
  }

  try {
    const res = await fetch(API_BASE + "/api/price-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tgNick: tgNick,             // может быть null
        tgUser: tgUser || null,     // объект юзера
        client_chat_id: client_chat_id
      })
    });

    const json = await res.json();

    if (json && json.ok) {
      CURRENT_PRICE = Number(json.finalPrice || 15);
      CURRENT_DISCOUNT_TYPE = json.discountType || null;
    } else {
      CURRENT_PRICE = 15;
      CURRENT_DISCOUNT_TYPE = null;
    }
  } catch (e) {
    CURRENT_PRICE = 15;
    CURRENT_DISCOUNT_TYPE = null;
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

  // Обработка изменения города
  checkoutCity.addEventListener("input", () => {
    checkoutDelivery.value = "";
    checkoutPayment.value = "";
    checkoutDelivery.disabled = true;
    checkoutPayment.disabled = true;
    if (checkoutCity.value) setTimeout(() => showField(checkoutDelivery), 500);
  });

  // Обработка изменения доставки
  checkoutDelivery.addEventListener("input", () => {
    checkoutPayment.value = "";
    checkoutPayment.disabled = true;
    if (checkoutDelivery.value) setTimeout(() => showField(checkoutPayment), 500);
  });
});

// --- Закрытие модалки ---
checkoutCancel.addEventListener("click", closeCheckout);

// Закрытие при клике вне контента
checkoutModal.addEventListener("click", (e) => {
  if (!e.target.closest(".checkout-modal-content")) closeCheckout();
});

// --- Подтверждение заказа ---
checkoutConfirm.addEventListener("click", async () => {
  // 1) Контекст Telegram (без optional chaining, чтобы не "краснело")
  var tgApp = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  var tgUser = (tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user) ? tgApp.initDataUnsafe.user : null;

  // tgNick берем только если есть username
  var tgNick = (tgUser && tgUser.username) ? ("@" + tgUser.username) : null;

  if (!tgNick) {
    alert("Не удалось определить ваш Telegram ник. Откройте мини-приложение через Telegram и убедитесь, что у вас установлен username.");
    return;
  }

  const city = checkoutCity.value.trim();
  const delivery = checkoutDelivery.value.trim();
  const payment = checkoutPayment.value.trim();

  if (!city) { alert("Укажите город"); return; }
  if (!delivery) { alert("Выберите способ доставки"); return; }
  if (!payment) { alert("Выберите способ оплаты"); return; }
  if (cart.length === 0) { alert("Корзина пуста"); return; }

  // Формируем текст заказанных товаров
  const itemsText = cart
    .map(item => `${item.category} — ${item.flavor} × ${item.qty} шт = ${item.price * item.qty}€`)
    .join("\n");

  // Дата и время
  const now = new Date();
  const orderDate = now.toLocaleDateString("ru-RU");
  const orderTime = now.toLocaleTimeString("ru-RU");

  // Обработка способов доставки и оплаты
  const deliveryText = delivery === "Pickup" ? "DHL" :
                       delivery === "Courier" ? "Курьер" : delivery;

  const paymentText = payment === "Cash" ? "Наличные" :
                      payment === "Card" ? "Карта" :
                      payment === "Crypto" ? "Криптовалюта" : payment;

  // 2) Данные для отправки
  const orderData = {
    tgNick, // "@username"
    city,
    delivery: deliveryText,
    payment: paymentText,
    orderText: itemsText,
    date: orderDate,
    time: orderTime,

    // Telegram user объект
    tgUser: tgUser,

    // initData (если нужно будет валидировать подпись)
    initData: tgApp ? tgApp.initData : null,

    // chat_id пользователя (id телеги)
    client_chat_id: (tgUser && tgUser.id) ? Number(tgUser.id) : null
  };

  try {
    // ✅ нормализуем BASE (убираем / в конце, чтобы не было двойного //)
    const API_URL = String(API_BASE || "").replace(/\/$/, "") + "/api/send-order";

    console.log("[SEND ORDER] API_URL =", API_URL);
    console.log("[SEND ORDER] orderData =", orderData);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderData)
    });

    // ✅ Railway может вернуть HTML/502, поэтому читаем как текст
    const raw = await res.text();
    console.log("[SEND ORDER] status =", res.status);
    console.log("[SEND ORDER] raw =", raw);

    // ✅ пробуем распарсить JSON
    let json = null;
    try { json = JSON.parse(raw); } catch (e) {}

    // ✅ если сервер вернул не 200
    if (!res.ok) {
      alert("Сервер вернул ошибку: " + res.status + "\n" + (raw ? raw.slice(0, 400) : ""));
      return;
    }

    // ✅ если 200, но success=false или json не распарсился
    if (!json || !json.success) {
      alert("Ошибка: " + ((json && json.error) ? json.error : (raw ? raw.slice(0, 400) : "UNKNOWN")));
      return;
    }

    // ✅ УСПЕХ (твой старый код успеха)
    if (tgApp) {
      tgApp.showPopup({
        title: "Заказ принят ✅",
        message: "Спасибо! Менеджер свяжется с вами.\n\nВаш Telegram: " + tgNick,
        buttons: [{ id: "ok", type: "default", text: "ОК" }]
      });

      tgApp.onEvent("popupClosed", () => {
        cart = [];
        updateCart();
        updateCheckoutButton();
        closeCheckout();
        tgApp.close();
      });
    } else {
      alert("Спасибо! С вами свяжется менеджер.\nВаш Telegram: " + tgNick);
      cart = [];
      updateCart();
      updateCheckoutButton();
      closeCheckout();
    }

  } catch (err) {
    console.error("[SEND ORDER] error:", err);
    alert("Ошибка сети/скрипта: " + (err && err.message ? err.message : String(err)));
  }
});


// --- Кнопка назад к вкусам ---
backToFlavors.addEventListener("click", closeCart);

// Обсервер для обновления кнопки оформления заказа
const observer = new MutationObserver(updateCheckoutButton);
const cartList = document.getElementById("cart-list");
observer.observe(cartList, { childList: true, subtree: true });

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
