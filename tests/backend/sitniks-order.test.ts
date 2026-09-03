import { describe, expect, test } from 'bun:test';
import { env } from '../../lib/config/env';
import {
  buildSitniksPaymentStatusComment,
  buildSitniksOrderPayload,
  buildSitniksProducts,
  getSitniksPaidStatusId,
} from '../../lib/services/sitniks/sitniks-order';
import type { CheckoutPayload } from '../../lib/types/checkout';

const basePayload: CheckoutPayload = {
  locale: 'uk',
  payment_type: 'prepayment',
  amount: 200,
  cart_total: 1200,
  customer: {
    first_name: 'Анастасія',
    last_name: 'Зінчук',
    phone: '0682345729',
    email: 'test@example.com',
  },
  shipping_type: 'ukraine',
  shipping: {
    type: 'ukraine',
    delivery_method: 'branch',
    city: 'Київ',
    warehouse: 'Відділення №12',
  },
  goods: [
    {
      code: 'SKU-1',
      variant_id: 111,
      variant_title: '44 мм',
      name: 'Годинник',
      price: 1200,
      quantity: 1,
      properties: [
        {
          name: 'Текст для гравіювання на коробці',
          value: '1111',
        },
      ],
    },
  ],
  comment: 'Подзвоніть перед відправкою',
  personal_data_consent: true,
  tracking: {
    utm_source: 'facebook',
    utm_campaign: 'summer',
  },
  utm: {},
};

describe('Sitniks order mapping', () => {
  test('builds minimal order payload with client and Shopify external id', () => {
    const payload = buildSitniksOrderPayload(basePayload, { id: 123, name: '#1001' });

    expect(payload.externalId).toBe('shopify-123');
    expect(payload.client).toEqual({
      fullname: 'Анастасія Зінчук',
      phone: '0682345729',
      email: 'test@example.com',
    });
    expect(payload.clientComment).toBe('Подзвоніть перед відправкою');
    expect(payload.utm).toEqual({ source: 'facebook', campaign: 'summer' });
    expect(String(payload.managerComment)).toContain('Shopify order: #1001');
    expect(String(payload.managerComment)).toContain('Передплата 200 грн');
    expect(String(payload.managerComment)).not.toContain('Shopify tag:');
    expect(String(payload.managerComment)).toContain('Сума товарів: 1200 грн');
    expect(String(payload.managerComment)).toContain('Годинник (44 мм) x 1');
    expect(String(payload.managerComment)).toContain('Текст для гравіювання на коробці: 1111');
    expect(String(payload.managerComment)).toContain('Відділення №12');
    expect(String(payload.managerComment)).toContain('SKU/variant: SKU-1');
    expect(String(payload.managerComment)).not.toContain('Створено з кастомного Shopify checkout');
    expect(String(payload.managerComment)).not.toContain('Статус оплати');
    expect(String(payload.managerComment)).not.toContain('Залишок');
    expect(payload.payment).toBeUndefined();
  });

  test('includes telegram in manager comment when provided', () => {
    const payload = buildSitniksOrderPayload({
      ...basePayload,
      customer: {
        ...basePayload.customer,
        telegram: '@hedonist',
      },
    }, { id: 123, name: '#1001' });

    expect(String(payload.managerComment)).toContain('Telegram: @hedonist');
  });

  test('builds product rows by title without SKU', () => {
    const products = buildSitniksProducts(basePayload);

    expect(products).toEqual([
      {
        title: 'Годинник (44 мм)',
        price: 1200,
        quantity: 1,
        isUpsale: false,
      },
    ]);
  });

  test('can include structured products in order payload', () => {
    const payload = buildSitniksOrderPayload(basePayload, { id: 123, name: '#1001' }, {
      includeProducts: true,
    });

    expect(payload.products).toEqual([
      {
        title: 'Годинник (44 мм)',
        price: 1200,
        quantity: 1,
        isUpsale: false,
      },
    ]);
  });

  test('includes international delivery information in manager comment', () => {
    const payload = buildSitniksOrderPayload({
      ...basePayload,
      payment_type: 'full',
      amount: 1860,
      shipping_type: 'international',
      shipping: {
        type: 'international',
        country: 'Poland',
        intl_city: 'Warsaw',
        address: 'Main street 1',
        apartment: '2',
        postcode: '00-001',
        shipping_price: 660,
      },
    }, { id: 124, name: '#1002' });

    expect(String(payload.managerComment)).toContain('Повна оплата');
    expect(String(payload.managerComment)).not.toContain('Shopify tag:');
    expect(String(payload.managerComment)).toContain('Тип доставки: закордон');
    expect(String(payload.managerComment)).toContain('Доставка: за кордон');
    expect(String(payload.managerComment)).toContain('Країна: Poland');
    expect(String(payload.managerComment)).toContain('Вартість доставки: 660 грн');
  });

  test('uses separate paid statuses for full payment and prepayment', () => {
    const originalPaidStatusId = env.sitniksPaidStatusId;
    const originalPrepaymentPaidStatusId = env.sitniksPrepaymentPaidStatusId;

    env.sitniksPaidStatusId = 10;
    env.sitniksPrepaymentPaidStatusId = 20;

    expect(getSitniksPaidStatusId('full')).toBe(10);
    expect(getSitniksPaidStatusId('prepayment')).toBe(20);

    env.sitniksPaidStatusId = originalPaidStatusId;
    env.sitniksPrepaymentPaidStatusId = originalPrepaymentPaidStatusId;
  });

  test('builds payment status comment after Monobank success', () => {
    const comment = buildSitniksPaymentStatusComment({
      paymentType: 'prepayment',
      shopifyOrderName: '#1048',
      shopifyOrderId: BigInt(123),
      orderId: '123',
      invoiceId: 'invoice-old',
      cartTotal: 6000,
    }, {
      invoiceId: 'invoice-new',
      status: 'success',
      amount: 20000,
      finalAmount: 20000,
    });

    expect(comment).toContain('Оплату Monobank підтверджено: Передплата 200 грн');
    expect(comment).toContain('Shopify order: #1048');
    expect(comment).not.toContain('Shopify tag:');
    expect(comment).toContain('Invoice: invoice-new');
    expect(comment).toContain('Сплачено онлайн: 200 грн');
    expect(comment).toContain('Залишок: 5800 грн');
  });

  test('builds full payment status comment without Shopify tag', () => {
    const comment = buildSitniksPaymentStatusComment({
      paymentType: 'full',
      shopifyOrderName: '#1049',
      shopifyOrderId: BigInt(124),
      orderId: '124',
      invoiceId: 'invoice-old',
      cartTotal: 1200,
    }, {
      invoiceId: 'invoice-new',
      status: 'success',
      amount: 120000,
      finalAmount: 120000,
    });

    expect(comment).toContain('Оплату Monobank підтверджено: Повна оплата');
    expect(comment).not.toContain('Shopify tag:');
    expect(comment).toContain('Залишок: 0 грн');
  });
});
