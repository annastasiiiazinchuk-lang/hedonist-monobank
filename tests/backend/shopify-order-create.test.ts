import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { env } from '../../lib/config/env';
import * as shopifyAuth from '../../lib/services/shopify/shopify-auth';
import { createShopifyOrder } from '../../lib/services/shopify/shopify-order';
import type { CheckoutPayload } from '../../lib/types/checkout';

const checkout: CheckoutPayload = {
  locale: 'uk',
  payment_type: 'full',
  amount: 1200,
  cart_total: 1200,
  customer: {
    first_name: 'Тест',
    last_name: 'Клієнт',
    phone: '+380 50 000 00 01',
    email: 'checkout@example.com',
  },
  shipping_type: 'ukraine',
  shipping: { type: 'ukraine', city: 'Київ', warehouse: '12', delivery_method: 'branch' },
  goods: [{ variant_id: 111, name: 'Товар', price: 1200, quantity: 1 }],
  personal_data_consent: true,
};

const createdOrder = { id: 123, name: '#123', financial_status: 'pending' };
const phoneTaken = { errors: { 'customer.phone_number': ['has already been taken'] } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Shopify order creation', () => {
  const originalDomain = env.shopifyStoreDomain;
  let fetchMock: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
  let tokenMock: ReturnType<typeof spyOn<typeof shopifyAuth, 'getShopifyAccessToken'>>;

  beforeEach(() => {
    env.shopifyStoreDomain = 'checkout-test.myshopify.com';
    tokenMock = spyOn(shopifyAuth, 'getShopifyAccessToken').mockResolvedValue('test-token');
    fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected Shopify request'));
  });

  afterEach(() => {
    fetchMock.mockRestore();
    tokenMock.mockRestore();
    env.shopifyStoreDomain = originalDomain;
  });

  function sentOrders(): Array<Record<string, any>> {
    return fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).order);
  }

  test('successful orders are created once with the customer phone', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ order: createdOrder }, 201));

    expect(await createShopifyOrder(checkout, 1200)).toEqual(createdOrder);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentOrders()[0]?.customer.phone).toBe('+380500000001');
  });

  test('a taken phone retries once and preserves recipient details and payment fields', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(phoneTaken, 422))
      .mockResolvedValueOnce(jsonResponse({ order: createdOrder }, 201));

    expect(await createShopifyOrder(checkout, 1200)).toEqual(createdOrder);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [original, retry] = sentOrders();
    expect(original?.phone).toBe(checkout.customer.phone);
    expect(original?.customer.phone).toBe('+380500000001');
    expect(retry?.phone).toBeUndefined();
    expect(retry?.customer).toEqual({
      first_name: 'Тест', last_name: 'Клієнт', email: 'checkout@example.com',
    });
    expect(retry?.shipping_address.phone).toBe(checkout.customer.phone);
    expect(retry?.billing_address.phone).toBe(checkout.customer.phone);
    const { phone: _orderPhone, customer: { phone: _customerPhone, ...customer }, ...rest } = original!;
    expect(retry).toEqual({ ...rest, customer });
    expect(checkout.customer.phone).toBe('+380 50 000 00 01');
    expect(fetchMock.mock.calls.every(([url, options]) =>
      String(url).endsWith('/orders.json') && options?.method === 'POST',
    )).toBe(true);
  });

  test('phone conflicts also allow checkout without email and with prepayment', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(phoneTaken, 422))
      .mockResolvedValueOnce(jsonResponse({ order: createdOrder }, 201));

    await createShopifyOrder({
      ...checkout,
      payment_type: 'prepayment',
      customer: { ...checkout.customer, email: '', telegram: '@test_checkout' },
    }, 200);

    const retry = sentOrders()[1];
    expect(retry?.email).toBeUndefined();
    expect(retry?.customer).toEqual({ first_name: 'Тест', last_name: 'Клієнт' });
    expect(retry?.shipping_address.phone).toBe(checkout.customer.phone);
    expect(retry?.tags).toBe('not_paid_200');
    expect(retry?.financial_status).toBe('pending');
    expect(retry?.note).toBe('Telegram: @test_checkout');
  });

  for (const field of ['customer.phone', 'phone']) {
    test(`recognizes the ${field} duplicate error`, async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ errors: { [field]: ['has already been taken'] } }, 422))
        .mockResolvedValueOnce(jsonResponse({ order: createdOrder }, 201));

      expect(await createShopifyOrder(checkout, 1200)).toEqual(createdOrder);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  }

  for (const [name, body, status] of [
    ['invalid phone', { errors: { 'customer.phone_number': ['is invalid'] } }, 422],
    ['email conflict', { errors: { 'customer.email': ['has already been taken'] } }, 422],
    ['mixed validation errors', { errors: { ...phoneTaken.errors, line_items: ['is invalid'] } }, 422],
    ['mixed phone errors', { errors: { 'customer.phone_number': ['has already been taken', 'is invalid'] } }, 422],
    ['server failure', phoneTaken, 500],
  ] as const) {
    test(`${name} does not retry order creation`, async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(body, status));

      await expect(createShopifyOrder(checkout, 1200)).rejects.toThrow(`Shopify error ${status}:`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  test('unstructured Shopify errors do not retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('has already been taken', { status: 422 }));

    await expect(createShopifyOrder(checkout, 1200)).rejects.toThrow('Shopify error 422:');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('network failures do not retry because an order may already exist', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Connection reset'));

    await expect(createShopifyOrder(checkout, 1200)).rejects.toThrow('Connection reset');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('an unsuccessful fallback is reported without another retry', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(phoneTaken, 422))
      .mockResolvedValueOnce(jsonResponse(phoneTaken, 422));

    await expect(createShopifyOrder(checkout, 1200)).rejects.toThrow('Shopify error 422:');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
