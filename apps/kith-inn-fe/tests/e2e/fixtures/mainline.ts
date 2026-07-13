import { resolve } from "node:path";
import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import type { DeliveryView, Fulfillment, MenuPlanView, Order, OrderItem } from "@cfp/kith-inn-shared";
import { MAINLINE_DATE } from "./fixed-llm-server";

export const MAINLINE_BE = "http://127.0.0.1:3311";
export const MAINLINE_LLM = "http://127.0.0.1:3321";
export const mainlineServiceLog = (name: string) => resolve("test-results/mainline-services", `${name}.log`);
type MainlineOrder = Order & { items: OrderItem[] };
type OrderAggregate = { orders: MainlineOrder[]; fulfillments: Fulfillment[] };

async function expectOk(response: APIResponse): Promise<APIResponse> {
  expect(response.ok(), `${response.url()} → ${response.status()}`).toBe(true);
  return response;
}

export async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await expectOk(await request.post(`${MAINLINE_BE}/auth/dev-login`, { data: { openid: "taozi-dev-openid" } }));
  return ((await response.json()) as { token: string }).token;
}

export async function readOrderAggregate(request: APIRequestContext, token: string, date = MAINLINE_DATE): Promise<OrderAggregate> {
  const headers = { Authorization: `Bearer ${token}` };
  const [ordersResponse, deliveryResponse] = await Promise.all([
    request.get(`${MAINLINE_BE}/orders?date=${date}`, { headers }),
    request.get(`${MAINLINE_BE}/delivery?date=${date}`, { headers }),
  ]);
  await expectOk(ordersResponse);
  await expectOk(deliveryResponse);
  const orders = ((await ordersResponse.json()) as { orders: MainlineOrder[] }).orders;
  const delivery = (await deliveryResponse.json()) as DeliveryView;
  return { orders, fulfillments: delivery.sort.flatMap((group) => group.fulfillments) };
}

export async function readDeliveryView(request: APIRequestContext, token: string, date: string): Promise<DeliveryView> {
  const response = await expectOk(await request.get(`${MAINLINE_BE}/delivery?date=${date}`, { headers: { Authorization: `Bearer ${token}` } }));
  return response.json() as Promise<DeliveryView>;
}

export async function readMenuPlans(request: APIRequestContext, token: string, date = MAINLINE_DATE): Promise<MenuPlanView[]> {
  const response = await expectOk(await request.get(`${MAINLINE_BE}/menu/plans?date=${date}`, { headers: { Authorization: `Bearer ${token}` } }));
  return ((await response.json()) as { plans: MenuPlanView[] }).plans;
}

export function expectOrderAggregate(aggregate: OrderAggregate, status: "draft" | "confirmed") {
  expect(aggregate.orders).toHaveLength(3);
  const coordinates = Object.fromEntries(aggregate.orders.map((order) => {
    const customer = typeof order.customer === "object" ? order.customer.displayName : String(order.customer);
    return [`${customer}|${order.occasion}`, order.items[0]?.quantity];
  }));
  expect(coordinates).toEqual({ "王燕萍|lunch": 2, "王燕萍|dinner": 1, "李阿姨|lunch": 1 });
  expect(aggregate.orders.every((order) => order.status === status && order.items.length === 1)).toBe(true);
  expect(aggregate.fulfillments).toHaveLength(status === "draft" ? 0 : 3);
  if (status === "confirmed") {
    expect(aggregate.fulfillments.every((item) => item.status === "pending")).toBe(true);
    const orderIds = aggregate.orders.map((order) => String(order.id)).sort();
    const fulfillmentOrderIds = aggregate.fulfillments.map((item) => String(typeof item.order === "object" ? item.order.id : item.order)).sort();
    expect(fulfillmentOrderIds).toEqual(orderIds);
  }
}

export const freezeMainlineDate = (page: Page) => page.clock.setFixedTime(new Date(`${MAINLINE_DATE}T12:00:00+08:00`));
