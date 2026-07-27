import type { Payment } from '@prisma/client';
import { PREPAYMENT_AMOUNT, env } from '../../config/env';
import type { CheckoutPayload } from '../../types/checkout';
import type { MonobankWebhookBody } from '../../types/monobank';
import type { ShopifyOrder } from '../../types/shopify';
import { asNumber, asString, parseJsonObject } from '../../utils/format';
import { getCartTotal, getPaymentAmount, getShippingPrice } from '../shopify/shopify-order';

export interface SitniksOrderResponse {
  id?: number;
  orderNumber?: number;
  externalId?: string;
}

const PREPAYMENT_LABEL = `Передплата ${PREPAYMENT_AMOUNT} грн`;

function fullName(body: CheckoutPayload): string {
  const customer = body.customer || {};
  const name = [asString(customer.first_name), asString(customer.last_name)].filter(Boolean).join(' ');
  return name || asString(customer.phone) || asString(customer.email) || 'Custom checkout customer';
}

function buildGoodsComment(body: CheckoutPayload): string {
  return (body.goods || [])
    .map((item) => {
      const title = asString(item.name) || asString(item.title) || 'Товар';
      const variantTitle = asString(item.variant_title);
      const titleWithVariant = variantTitle ? `${title} (${variantTitle})` : title;
      const sku = asString(item.code) || asString(item.variant_id);
      const quantity = Math.max(1, Math.round(asNumber(item.quantity) || 1));
      const price = asNumber(item.price);
      const properties = (item.properties || [])
        .map((property) => {
          const name = asString(property.name);
          const value = asString(property.value);
          if (!name || !value) return '';
          return `${name}: ${value}`;
        })
        .filter(Boolean);
      const details = [
        `${titleWithVariant} x ${quantity}`,
        price ? `${price} грн` : '',
        sku ? `SKU/variant: ${sku}` : '',
        ...properties,
      ].filter(Boolean);
      return `- ${details.join(', ')}`;
    })
    .join('\n');
}

function getItemDiscountAmount(item: CheckoutPayload['goods'][number]): number {
  const row = item as Record<string, unknown>;
  return asNumber(row.discountAmount)
    || asNumber(row.discount_amount)
    || asNumber(row.total_discount)
    || asNumber(row.line_discount)
    || 0;
}

export function buildSitniksProducts(body: CheckoutPayload) {
  return (body.goods || [])
    .map((item) => {
      const title = asString(item.name) || asString(item.title);
      const variantTitle = asString(item.variant_title);
      const titleWithVariant = variantTitle ? `${title} (${variantTitle})` : title;
      const price = asNumber(item.price);
      const quantity = Math.max(1, Math.round(asNumber(item.quantity) || 1));
      const discountAmount = getItemDiscountAmount(item);

      if (!title || !price) return null;

      return {
        title: titleWithVariant,
        price,
        quantity,
        isUpsale: false,
        ...(discountAmount > 0 ? { discountAmount } : {}),
      };
    })
    .filter((item): item is {
      title: string;
      price: number;
      quantity: number;
      isUpsale: boolean;
      discountAmount?: number;
    } => Boolean(item));
}

function buildDeliveryComment(body: CheckoutPayload): string {
  const shipping = body.shipping || {};
  const isInternational = body.shipping_type === 'international' || shipping.type === 'international';

  if (isInternational) {
    return [
      'Тип доставки: закордон',
      'Доставка: за кордон',
      `Країна: ${asString(shipping.country)}`,
      `Місто: ${asString(shipping.intl_city) || asString(shipping.city)}`,
      `Адреса: ${asString(shipping.address)}`,
      `Квартира/кімната: ${asString(shipping.apartment)}`,
      `Індекс: ${asString(shipping.postcode)}`,
      `Вартість доставки: ${getShippingPrice(body)} грн`,
    ].filter((line) => !line.endsWith(': ') && !line.endsWith(':  грн')).join('\n');
  }

  const deliveryMethod = asString(shipping.delivery_method) || 'branch';
  const methodLabel: Record<string, string> = {
    branch: 'Відділення',
    postomat: 'Поштомат',
    address: 'Адресна доставка',
  };

  return [
    'Тип доставки: Україна',
    `Доставка: Нова Пошта (${methodLabel[deliveryMethod] || deliveryMethod})`,
    `Місто: ${asString(shipping.city)}`,
    `Відділення/поштомат: ${asString(shipping.warehouse)}`,
    `Вулиця: ${asString(shipping.street)}`,
    `Будинок: ${asString(shipping.house)}`,
    `Квартира: ${asString(shipping.apartment)}`,
  ].filter((line) => !line.endsWith(': ')).join('\n');
}

function buildUtm(body: CheckoutPayload) {
  const tracking = body.tracking || body.utm || {};
  const utm = {
    source: asString(tracking.utm_source),
    medium: asString(tracking.utm_medium),
    campaign: asString(tracking.utm_campaign),
    content: asString(tracking.utm_content),
    term: asString(tracking.utm_term),
  };

  return Object.fromEntries(Object.entries(utm).filter(([, value]) => value));
}

export function buildSitniksOrderPayload(
  body: CheckoutPayload,
  shopifyOrder: Pick<ShopifyOrder, 'id' | 'name'>,
  options: { includeProducts?: boolean } = {},
) {
  const customer = body.customer || {};
  const cartTotal = getCartTotal(body);
  const paymentType = body.payment_type === 'prepayment' ? PREPAYMENT_LABEL : 'Повна оплата';
  const goodsComment = buildGoodsComment(body);
  const deliveryComment = buildDeliveryComment(body);
  const managerComment = [
    `Shopify order: ${shopifyOrder.name || shopifyOrder.id}`,
    `Варіант оплати: ${paymentType}`,
    `Сума товарів: ${cartTotal} грн`,
    goodsComment ? `Товари:\n${goodsComment}` : '',
    deliveryComment,
  ].filter(Boolean).join('\n');

  const payload: Record<string, unknown> = {
    externalId: `shopify-${shopifyOrder.id}`,
    client: {
      fullname: fullName(body),
      phone: asString(customer.phone),
      email: asString(customer.email),
    },
    clientComment: asString(body.comment),
    managerComment,
  };

  const utm = buildUtm(body);
  if (Object.keys(utm).length > 0) payload.utm = utm;
  if (env.sitniksStatusId > 0) payload.statusId = env.sitniksStatusId;
  if (env.sitniksSalesChannelId > 0) payload.salesChannelId = env.sitniksSalesChannelId;

  if (options.includeProducts) {
    const products = buildSitniksProducts(body);
    if (products.length > 0) payload.products = products;
  }

  return payload;
}

async function sitniksRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${env.sitniksApiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${env.sitniksApiToken}`,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sitniks error ${response.status}: ${text}`);
  }

  return parseJsonObject<T>(text, 'Sitniks');
}

export async function sendSitniksOrder(
  body: CheckoutPayload,
  shopifyOrder: Pick<ShopifyOrder, 'id' | 'name'>,
): Promise<SitniksOrderResponse | null> {
  if (!env.sitniksApiToken) return null;

  let payload = buildSitniksOrderPayload(body, shopifyOrder, { includeProducts: true });
  let data: SitniksOrderResponse;
  try {
    data = await sitniksRequest<SitniksOrderResponse>('/open-api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!('products' in payload)) throw error;

    console.error('[Sitniks] Order with structured products failed, retrying without products:', error);
    payload = buildSitniksOrderPayload(body, shopifyOrder, { includeProducts: false });
    data = await sitniksRequest<SitniksOrderResponse>('/open-api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  console.log('[Sitniks] Order sent:', {
    shopifyOrderId: shopifyOrder.id,
    sitniksOrderId: data.id,
    sitniksOrderNumber: data.orderNumber,
  });
  return data;
}

export async function sendSitniksPaymentTransaction(
  payment: Payment,
  webhookBody: MonobankWebhookBody,
): Promise<unknown | null> {
  if (!env.sitniksApiToken || !env.sitniksSettlementAccountId || !payment.sitniksOrderId) {
    return null;
  }

  const paidAmount = asNumber(webhookBody.finalAmount || webhookBody.amount) / 100;
  if (!paidAmount) return null;

  const paymentType = payment.paymentType === 'prepayment' ? PREPAYMENT_LABEL : 'Повна оплата';
  const comment = [
    `Monobank: ${paymentType}`,
    `Shopify order: ${payment.shopifyOrderName || payment.shopifyOrderId || payment.orderId}`,
    `Invoice: ${webhookBody.invoiceId || payment.invoiceId || ''}`,
    `Сплачено онлайн: ${paidAmount} грн`,
    payment.cartTotal ? `Сума замовлення: ${payment.cartTotal} грн` : '',
    payment.cartTotal ? `Залишок: ${Math.max(0, payment.cartTotal - paidAmount)} грн` : '',
  ].filter(Boolean).join('\n');

  const payload = {
    orderId: Number(payment.sitniksOrderId),
    settlementAccountId: env.sitniksSettlementAccountId,
    amount: paidAmount,
    comment,
  };

  const data = await sitniksRequest('/open-api/transactions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  console.log('[Sitniks] Payment transaction sent:', {
    shopifyOrderId: payment.shopifyOrderId?.toString(),
    sitniksOrderId: payment.sitniksOrderId.toString(),
    amount: paidAmount,
  });

  return data;
}

export function getSitniksPaidStatusId(paymentType: Payment['paymentType']): number {
  if (paymentType === 'prepayment') {
    return env.sitniksPrepaymentPaidStatusId || env.sitniksPaidStatusId;
  }

  return env.sitniksPaidStatusId;
}

export function buildSitniksPaymentStatusComment(
  payment: Pick<Payment, 'paymentType' | 'shopifyOrderName' | 'shopifyOrderId' | 'orderId' | 'invoiceId' | 'cartTotal'>,
  webhookBody: MonobankWebhookBody,
): string {
  const paidAmount = asNumber(webhookBody.finalAmount || webhookBody.amount) / 100;
  const paymentType = payment.paymentType === 'prepayment' ? PREPAYMENT_LABEL : 'Повна оплата';
  const balance = payment.cartTotal ? Math.max(0, payment.cartTotal - paidAmount) : 0;

  return [
    `Оплату Monobank підтверджено: ${paymentType}`,
    `Shopify order: ${payment.shopifyOrderName || payment.shopifyOrderId || payment.orderId}`,
    `Invoice: ${webhookBody.invoiceId || payment.invoiceId || ''}`,
    `Сплачено онлайн: ${paidAmount} грн`,
    payment.cartTotal ? `Сума замовлення: ${payment.cartTotal} грн` : '',
    payment.cartTotal ? `Залишок: ${balance} грн` : '',
  ].filter(Boolean).join('\n');
}

export async function updateSitniksPaymentStatus(
  payment: Payment,
  webhookBody: MonobankWebhookBody,
): Promise<unknown | null> {
  if (!env.sitniksApiToken || !payment.sitniksOrderId) {
    return null;
  }

  const statusId = getSitniksPaidStatusId(payment.paymentType);
  if (!statusId) {
    console.warn('[Sitniks] Paid status id is not configured; skipping status update', {
      paymentId: payment.id,
      shopifyOrderId: payment.shopifyOrderId?.toString(),
      sitniksOrderId: payment.sitniksOrderId.toString(),
      paymentType: payment.paymentType,
    });
    return null;
  }

  const orderId = Number(payment.sitniksOrderId);
  const data = await sitniksRequest(`/open-api/orders/${orderId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ statusId }),
  });

  console.log('[Sitniks] Payment status updated:', {
    paymentId: payment.id,
    shopifyOrderId: payment.shopifyOrderId?.toString(),
    sitniksOrderId: payment.sitniksOrderId.toString(),
    statusId,
    comment: buildSitniksPaymentStatusComment(payment, webhookBody),
  });

  return data;
}
