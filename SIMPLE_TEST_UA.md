# Найпростіший тест після рефакторингу

Актуальний backend тепер запускається з `index.ts`, а логіка розкладена по `lib/**`.
`simple-test-server.js` більше не використовується.

## Що потрібно

- Bun
- PostgreSQL або Render database
- ngrok / Cloudflare Tunnel для локального тесту
- Monobank merchant token
- Shopify app з Dev Dashboard
- Nova Poshta API key

## 1. Env

Створи `.env` на основі `.env.example`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shopify_monobank
MONO_TOKEN=твій_monobank_token
WEBHOOK_URL=https://abc-123.ngrok-free.app/api/webhooks/monobank
REDIRECT_URL=https://твій-магазин.myshopify.com
SHOPIFY_STORE_DOMAIN=твій-магазин.myshopify.com
SHOPIFY_CLIENT_ID=твій_client_id
SHOPIFY_CLIENT_SECRET=твій_client_secret
NOVA_POSHTA_API_KEY=твій_ключ_нової_пошти
NODE_ENV=development
PORT=3000
```

Для швидкого тесту можна також додати `SHOPIFY_ADMIN_ACCESS_TOKEN`.
Тоді OAuth через `/auth` не потрібен.

Для Meta Conversions API додай:

```env
META_PIXEL_ID=твій_meta_pixel_id
META_ACCESS_TOKEN=твій_meta_access_token
META_GRAPH_VERSION=v23.0
```

`META_ACCESS_TOKEN` потрібен тільки backend-у. У Shopify frontend вставляється лише Pixel ID.

## 2. Міграції

```bash
bun install
bunx prisma migrate deploy
bunx prisma generate
```

## 3. Запуск

```bash
bun run index.ts
```

Сервер має відповісти:

```text
Server is running on http://localhost:3000
```

## 4. Shopify OAuth

Якщо `SHOPIFY_ADMIN_ACCESS_TOKEN` не заданий, відкрий:

```text
https://abc-123.ngrok-free.app/auth?shop=твій-магазин.myshopify.com
```

Після підтвердження має бути:

```text
Shopify token отримано. Можна повертатися до checkout тесту.
```

## 5. Health

```text
https://abc-123.ngrok-free.app/api/health
```

Очікувана відповідь:

```json
{"status":"ok","mode":"refactored-server","shopifyTokenReady":true,"novaPoshtaReady":true}
```

## 6. Shopify сторінка

У frontend-файлі `shopify-custom-checkout-monobank.js` вистав:

```js
const API_BASE_URL = 'https://abc-123.ngrok-free.app';
const META_PIXEL_ID = String(window.HEDONIST_META_PIXEL_ID || 'твій_meta_pixel_id').trim();
```

Не додавай `/api/orders/create-invoice`, frontend додає цей шлях сам.

## 7. Що має відбутися

- Backend створює Shopify order.
- Для повної оплати order створюється з тегом `full_not_paid`.
- Для передплати order створюється з `financial_status: pending`, тегом `not_paid_200` без знижки до оплати.
- Backend створює Monobank invoice.
- Після успішної оплати webhook знаходить payment у БД.
- Для передплати фінансовий статус не змінюється, тег стає `prepayment_200_paid`.
- Для повної оплати backend додає payment transaction, ставить order у `paid`, тег стає `full_paid_ok`.
