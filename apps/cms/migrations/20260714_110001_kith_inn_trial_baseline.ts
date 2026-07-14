import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE SCHEMA IF NOT EXISTS "cms";
  CREATE TYPE "cms"."enum_sellers_enabled_modules" AS ENUM('menu-planning', 'delivery', 'purchasing', 'booking');
  CREATE TYPE "cms"."enum_sellers_status" AS ENUM('active', 'paused', 'archived');
  CREATE TYPE "cms"."enum_operators_role" AS ENUM('owner', 'helper');
  CREATE TYPE "cms"."enum_customers_default_occasion" AS ENUM('breakfast', 'brunch', 'lunch', 'dinner', 'all-day');
  CREATE TYPE "cms"."enum_offerings_kind" AS ENUM('combo-meal', 'single-item', 'service-session', 'component');
  CREATE TYPE "cms"."enum_offerings_category" AS ENUM('meat', 'veg', 'soup', 'staple');
  CREATE TYPE "cms"."enum_menu_plans_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum_service_slots_granularity" AS ENUM('occasion', 'time-slot');
  CREATE TYPE "cms"."enum_service_slots_occasion" AS ENUM('breakfast', 'brunch', 'lunch', 'dinner', 'all-day');
  CREATE TYPE "cms"."enum_service_slots_status" AS ENUM('draft', 'open', 'archived');
  CREATE TYPE "cms"."enum_orders_occasion" AS ENUM('breakfast', 'brunch', 'lunch', 'dinner', 'all-day');
  CREATE TYPE "cms"."enum_orders_status" AS ENUM('draft', 'confirmed', 'canceled');
  CREATE TYPE "cms"."enum_orders_source" AS ENUM('chat-paste', 'chat-voice', 'manual', 'subscription', 'import');
  CREATE TYPE "cms"."enum_orders_payment_status" AS ENUM('unpaid', 'paid', 'reconciled');
  CREATE TYPE "cms"."enum_fulfillments_occasion" AS ENUM('breakfast', 'brunch', 'lunch', 'dinner', 'all-day');
  CREATE TYPE "cms"."enum_fulfillments_status" AS ENUM('pending', 'done', 'canceled');
  CREATE TYPE "cms"."enum_chat_messages_role" AS ENUM('user', 'assistant');
  CREATE TYPE "cms"."enum_subscriptions_status" AS ENUM('active', 'paused');
  CREATE TYPE "cms"."enum_kiv1_sellers_status" AS ENUM('active', 'paused');
  CREATE TYPE "cms"."enum_kiv1_offerings_category" AS ENUM('meat', 'veg', 'soup');
  CREATE TYPE "cms"."enum_kiv1_meal_slots_menu_items_category_snapshot" AS ENUM('meat', 'veg', 'soup');
  CREATE TYPE "cms"."enum_kiv1_meal_slots_occasion" AS ENUM('lunch', 'dinner');
  CREATE TYPE "cms"."enum_kiv1_meal_slots_order_status" AS ENUM('draft', 'open', 'closed');
  CREATE TYPE "cms"."enum_kiv1_booking_batches_status" AS ENUM('open', 'closed', 'archived');
  CREATE TYPE "cms"."enum_kiv1_orders_status" AS ENUM('draft', 'confirmed', 'canceled');
  CREATE TYPE "cms"."enum_kiv1_orders_source" AS ENUM('customer-card', 'manual', 'jielong-import');
  CREATE TYPE "cms"."enum_kiv1_orders_payment_status" AS ENUM('unpaid', 'paid');
  CREATE TYPE "cms"."enum_kiv1_orders_delivery_status" AS ENUM('pending', 'done');
  CREATE TABLE "cms"."sellers_enabled_modules" (
   "order" integer NOT NULL,
   "parent_id" integer NOT NULL,
   "value" "cms"."enum_sellers_enabled_modules",
   "id" serial PRIMARY KEY NOT NULL
  );

  CREATE TABLE "cms"."sellers" (
   "id" serial PRIMARY KEY NOT NULL,
   "name" varchar NOT NULL,
   "service_area" varchar,
   "default_price_cents" numeric,
   "status" "cms"."enum_sellers_status" DEFAULT 'active',
   "module_settings" jsonb,
   "profile_free_text" varchar,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."operators_sessions" (
   "_order" integer NOT NULL,
   "_parent_id" integer NOT NULL,
   "id" varchar PRIMARY KEY NOT NULL,
   "created_at" timestamp(3) with time zone,
   "expires_at" timestamp(3) with time zone NOT NULL
  );

  CREATE TABLE "cms"."operators" (
   "id" serial PRIMARY KEY NOT NULL,
   "wechat_openid" varchar,
   "role" "cms"."enum_operators_role" DEFAULT 'owner' NOT NULL,
   "active" boolean DEFAULT true,
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "email" varchar NOT NULL,
   "reset_password_token" varchar,
   "reset_password_expiration" timestamp(3) with time zone,
   "salt" varchar,
   "hash" varchar,
   "login_attempts" numeric DEFAULT 0,
   "lock_until" timestamp(3) with time zone
  );

  CREATE TABLE "cms"."customers" (
   "id" serial PRIMARY KEY NOT NULL,
   "display_name" varchar NOT NULL,
   "default_servings" numeric,
   "default_occasion" "cms"."enum_customers_default_occasion",
   "note" varchar,
   "address" varchar,
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."offerings" (
   "id" serial PRIMARY KEY NOT NULL,
   "name" varchar NOT NULL,
   "kind" "cms"."enum_offerings_kind" DEFAULT 'component' NOT NULL,
   "main_ingredient" varchar,
   "category" "cms"."enum_offerings_category",
   "unit_label" varchar,
   "price_cents" numeric,
   "recipe" jsonb,
   "active" boolean DEFAULT true,
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."offerings_rels" (
   "id" serial PRIMARY KEY NOT NULL,
   "order" integer,
   "parent_id" integer NOT NULL,
   "path" varchar NOT NULL,
   "offerings_id" integer
  );

  CREATE TABLE "cms"."menu_plans" (
   "id" serial PRIMARY KEY NOT NULL,
   "slot_id" integer NOT NULL,
   "publish_text" varchar,
   "status" "cms"."enum_menu_plans_status" DEFAULT 'draft',
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."menu_plans_rels" (
   "id" serial PRIMARY KEY NOT NULL,
   "order" integer,
   "parent_id" integer NOT NULL,
   "path" varchar NOT NULL,
   "offerings_id" integer
  );

  CREATE TABLE "cms"."service_slots" (
   "id" serial PRIMARY KEY NOT NULL,
   "date" timestamp(3) with time zone NOT NULL,
   "granularity" "cms"."enum_service_slots_granularity" NOT NULL,
   "occasion" "cms"."enum_service_slots_occasion",
   "start_at" timestamp(3) with time zone,
   "end_at" timestamp(3) with time zone,
   "status" "cms"."enum_service_slots_status" DEFAULT 'draft',
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."orders" (
   "id" serial PRIMARY KEY NOT NULL,
   "customer_id" integer NOT NULL,
   "date" timestamp(3) with time zone NOT NULL,
   "occasion" "cms"."enum_orders_occasion" NOT NULL,
   "status" "cms"."enum_orders_status" DEFAULT 'draft',
   "source" "cms"."enum_orders_source" DEFAULT 'manual',
   "placed_at" timestamp(3) with time zone,
   "note" varchar,
   "total_cents" numeric,
   "address" varchar,
   "payment_status" "cms"."enum_orders_payment_status" DEFAULT 'unpaid',
   "payment_method" varchar,
   "paid_at" timestamp(3) with time zone,
   "idempotency_key" varchar,
   "created_by_id" integer,
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."order_items" (
   "id" serial PRIMARY KEY NOT NULL,
   "order_id" integer NOT NULL,
   "offering_id" integer NOT NULL,
   "quantity" numeric NOT NULL,
   "unit_price_cents" numeric,
   "note" varchar,
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."fulfillments" (
   "id" serial PRIMARY KEY NOT NULL,
   "order_id" integer NOT NULL,
   "service_date" timestamp(3) with time zone NOT NULL,
   "occasion" "cms"."enum_fulfillments_occasion",
   "status" "cms"."enum_fulfillments_status" DEFAULT 'pending',
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."chat_messages" (
   "id" serial PRIMARY KEY NOT NULL,
   "operator_id" integer NOT NULL,
   "content" varchar NOT NULL,
   "role" "cms"."enum_chat_messages_role" DEFAULT 'user',
   "card" jsonb,
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."subscriptions" (
   "id" serial PRIMARY KEY NOT NULL,
   "customer_id" integer NOT NULL,
   "offering_id" integer NOT NULL,
   "pattern" jsonb NOT NULL,
   "status" "cms"."enum_subscriptions_status" DEFAULT 'active',
   "paused_ranges" jsonb,
   "seller_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."kiv1_sellers" (
   "id" serial PRIMARY KEY NOT NULL,
   "name" varchar NOT NULL,
   "default_price_cents" numeric DEFAULT 3000 NOT NULL,
   "status" "cms"."enum_kiv1_sellers_status" DEFAULT 'active' NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."kiv1_operators" (
   "id" serial PRIMARY KEY NOT NULL,
   "seller_id" integer NOT NULL,
   "wechat_openid" varchar NOT NULL,
   "active" boolean DEFAULT true NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."kiv1_customer_profiles" (
   "id" serial PRIMARY KEY NOT NULL,
   "seller_id" integer NOT NULL,
   "openid" varchar,
   "display_name" varchar NOT NULL,
   "address" varchar NOT NULL,
   "last_used_at" timestamp(3) with time zone,
   "active" boolean DEFAULT true NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."kiv1_offerings" (
   "id" serial PRIMARY KEY NOT NULL,
   "seller_id" integer NOT NULL,
   "name" varchar NOT NULL,
   "main_ingredient" varchar,
   "category" "cms"."enum_kiv1_offerings_category" NOT NULL,
   "active" boolean DEFAULT true NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."kiv1_meal_slots_menu_items" (
   "_order" integer NOT NULL,
   "_parent_id" integer NOT NULL,
   "id" varchar PRIMARY KEY NOT NULL,
   "offering_id" integer NOT NULL,
   "name_snapshot" varchar NOT NULL,
   "main_ingredient_snapshot" varchar,
   "category_snapshot" "cms"."enum_kiv1_meal_slots_menu_items_category_snapshot" NOT NULL
  );

  CREATE TABLE "cms"."kiv1_meal_slots" (
   "id" serial PRIMARY KEY NOT NULL,
   "seller_id" integer NOT NULL,
   "date" varchar NOT NULL,
   "occasion" "cms"."enum_kiv1_meal_slots_occasion" NOT NULL,
   "order_status" "cms"."enum_kiv1_meal_slots_order_status" DEFAULT 'draft' NOT NULL,
   "order_deadline" timestamp(3) with time zone,
   "price_cents" numeric,
   "generated_at" timestamp(3) with time zone,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."kiv1_booking_batches" (
   "id" serial PRIMARY KEY NOT NULL,
   "seller_id" integer NOT NULL,
   "public_id" varchar NOT NULL,
   "title" varchar NOT NULL,
   "status" "cms"."enum_kiv1_booking_batches_status" DEFAULT 'open' NOT NULL,
   "created_by_id" integer NOT NULL,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."kiv1_booking_batches_rels" (
   "id" serial PRIMARY KEY NOT NULL,
   "order" integer,
   "parent_id" integer NOT NULL,
   "path" varchar NOT NULL,
   "kiv1_meal_slots_id" integer
  );

  CREATE TABLE "cms"."kiv1_orders" (
   "id" serial PRIMARY KEY NOT NULL,
   "seller_id" integer NOT NULL,
   "meal_slot_id" integer NOT NULL,
   "customer_profile_id" integer,
   "customer_openid" varchar,
   "status" "cms"."enum_kiv1_orders_status" DEFAULT 'draft' NOT NULL,
   "source" "cms"."enum_kiv1_orders_source" NOT NULL,
   "display_name" varchar NOT NULL,
   "address" varchar,
   "quantity" numeric NOT NULL,
   "unit_price_cents" numeric NOT NULL,
   "payment_status" "cms"."enum_kiv1_orders_payment_status" DEFAULT 'unpaid' NOT NULL,
   "paid_at" timestamp(3) with time zone,
   "delivery_status" "cms"."enum_kiv1_orders_delivery_status" DEFAULT 'pending' NOT NULL,
   "delivered_at" timestamp(3) with time zone,
   "confirmed_at" timestamp(3) with time zone,
   "canceled_at" timestamp(3) with time zone,
   "note" varchar,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."payload_kv" (
   "id" serial PRIMARY KEY NOT NULL,
   "key" varchar NOT NULL,
   "data" jsonb NOT NULL
  );

  CREATE TABLE "cms"."payload_locked_documents" (
   "id" serial PRIMARY KEY NOT NULL,
   "global_slug" varchar,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."payload_locked_documents_rels" (
   "id" serial PRIMARY KEY NOT NULL,
   "order" integer,
   "parent_id" integer NOT NULL,
   "path" varchar NOT NULL,
   "sellers_id" integer,
   "operators_id" integer,
   "customers_id" integer,
   "offerings_id" integer,
   "menu_plans_id" integer,
   "service_slots_id" integer,
   "orders_id" integer,
   "order_items_id" integer,
   "fulfillments_id" integer,
   "chat_messages_id" integer,
   "subscriptions_id" integer,
   "kiv1_sellers_id" integer,
   "kiv1_operators_id" integer,
   "kiv1_customer_profiles_id" integer,
   "kiv1_offerings_id" integer,
   "kiv1_meal_slots_id" integer,
   "kiv1_booking_batches_id" integer,
   "kiv1_orders_id" integer
  );

  CREATE TABLE "cms"."payload_preferences" (
   "id" serial PRIMARY KEY NOT NULL,
   "key" varchar,
   "value" jsonb,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "cms"."payload_preferences_rels" (
   "id" serial PRIMARY KEY NOT NULL,
   "order" integer,
   "parent_id" integer NOT NULL,
   "path" varchar NOT NULL,
   "operators_id" integer
  );

  CREATE TABLE "cms"."payload_migrations" (
   "id" serial PRIMARY KEY NOT NULL,
   "name" varchar,
   "batch" numeric,
   "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "cms"."sellers_enabled_modules" ADD CONSTRAINT "sellers_enabled_modules_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."sellers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."operators_sessions" ADD CONSTRAINT "operators_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."operators"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."operators" ADD CONSTRAINT "operators_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."customers" ADD CONSTRAINT "customers_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."offerings" ADD CONSTRAINT "offerings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."offerings_rels" ADD CONSTRAINT "offerings_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."offerings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."offerings_rels" ADD CONSTRAINT "offerings_rels_offerings_fk" FOREIGN KEY ("offerings_id") REFERENCES "cms"."offerings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."menu_plans" ADD CONSTRAINT "menu_plans_slot_id_service_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "cms"."service_slots"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."menu_plans" ADD CONSTRAINT "menu_plans_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."menu_plans_rels" ADD CONSTRAINT "menu_plans_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."menu_plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."menu_plans_rels" ADD CONSTRAINT "menu_plans_rels_offerings_fk" FOREIGN KEY ("offerings_id") REFERENCES "cms"."offerings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."service_slots" ADD CONSTRAINT "service_slots_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "cms"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."orders" ADD CONSTRAINT "orders_created_by_id_operators_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "cms"."operators"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."orders" ADD CONSTRAINT "orders_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "cms"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."order_items" ADD CONSTRAINT "order_items_offering_id_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "cms"."offerings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."order_items" ADD CONSTRAINT "order_items_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "cms"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."fulfillments" ADD CONSTRAINT "fulfillments_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."chat_messages" ADD CONSTRAINT "chat_messages_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "cms"."operators"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."chat_messages" ADD CONSTRAINT "chat_messages_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "cms"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."subscriptions" ADD CONSTRAINT "subscriptions_offering_id_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "cms"."offerings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."subscriptions" ADD CONSTRAINT "subscriptions_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_operators" ADD CONSTRAINT "kiv1_operators_seller_id_kiv1_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_customer_profiles" ADD CONSTRAINT "kiv1_customer_profiles_seller_id_kiv1_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_offerings" ADD CONSTRAINT "kiv1_offerings_seller_id_kiv1_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_meal_slots_menu_items" ADD CONSTRAINT "kiv1_meal_slots_menu_items_offering_id_kiv1_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "cms"."kiv1_offerings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_meal_slots_menu_items" ADD CONSTRAINT "kiv1_meal_slots_menu_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."kiv1_meal_slots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_meal_slots" ADD CONSTRAINT "kiv1_meal_slots_seller_id_kiv1_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_booking_batches" ADD CONSTRAINT "kiv1_booking_batches_seller_id_kiv1_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_booking_batches" ADD CONSTRAINT "kiv1_booking_batches_created_by_id_kiv1_operators_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "cms"."kiv1_operators"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_booking_batches_rels" ADD CONSTRAINT "kiv1_booking_batches_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."kiv1_booking_batches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_booking_batches_rels" ADD CONSTRAINT "kiv1_booking_batches_rels_kiv1_meal_slots_fk" FOREIGN KEY ("kiv1_meal_slots_id") REFERENCES "cms"."kiv1_meal_slots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_orders" ADD CONSTRAINT "kiv1_orders_seller_id_kiv1_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_orders" ADD CONSTRAINT "kiv1_orders_meal_slot_id_kiv1_meal_slots_id_fk" FOREIGN KEY ("meal_slot_id") REFERENCES "cms"."kiv1_meal_slots"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."kiv1_orders" ADD CONSTRAINT "kiv1_orders_customer_profile_id_kiv1_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "cms"."kiv1_customer_profiles"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sellers_fk" FOREIGN KEY ("sellers_id") REFERENCES "cms"."sellers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_operators_fk" FOREIGN KEY ("operators_id") REFERENCES "cms"."operators"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "cms"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_offerings_fk" FOREIGN KEY ("offerings_id") REFERENCES "cms"."offerings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_menu_plans_fk" FOREIGN KEY ("menu_plans_id") REFERENCES "cms"."menu_plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_service_slots_fk" FOREIGN KEY ("service_slots_id") REFERENCES "cms"."service_slots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_orders_fk" FOREIGN KEY ("orders_id") REFERENCES "cms"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_items_fk" FOREIGN KEY ("order_items_id") REFERENCES "cms"."order_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_fulfillments_fk" FOREIGN KEY ("fulfillments_id") REFERENCES "cms"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_chat_messages_fk" FOREIGN KEY ("chat_messages_id") REFERENCES "cms"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_subscriptions_fk" FOREIGN KEY ("subscriptions_id") REFERENCES "cms"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_sellers_fk" FOREIGN KEY ("kiv1_sellers_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_operators_fk" FOREIGN KEY ("kiv1_operators_id") REFERENCES "cms"."kiv1_operators"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_customer_profiles_fk" FOREIGN KEY ("kiv1_customer_profiles_id") REFERENCES "cms"."kiv1_customer_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_offerings_fk" FOREIGN KEY ("kiv1_offerings_id") REFERENCES "cms"."kiv1_offerings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_meal_slots_fk" FOREIGN KEY ("kiv1_meal_slots_id") REFERENCES "cms"."kiv1_meal_slots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_booking_batches_fk" FOREIGN KEY ("kiv1_booking_batches_id") REFERENCES "cms"."kiv1_booking_batches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_orders_fk" FOREIGN KEY ("kiv1_orders_id") REFERENCES "cms"."kiv1_orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_operators_fk" FOREIGN KEY ("operators_id") REFERENCES "cms"."operators"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "sellers_enabled_modules_order_idx" ON "cms"."sellers_enabled_modules" USING btree ("order");
  CREATE INDEX "sellers_enabled_modules_parent_idx" ON "cms"."sellers_enabled_modules" USING btree ("parent_id");
  CREATE INDEX "sellers_updated_at_idx" ON "cms"."sellers" USING btree ("updated_at");
  CREATE INDEX "sellers_created_at_idx" ON "cms"."sellers" USING btree ("created_at");
  CREATE INDEX "operators_sessions_order_idx" ON "cms"."operators_sessions" USING btree ("_order");
  CREATE INDEX "operators_sessions_parent_id_idx" ON "cms"."operators_sessions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "operators_wechat_openid_idx" ON "cms"."operators" USING btree ("wechat_openid");
  CREATE INDEX "operators_seller_idx" ON "cms"."operators" USING btree ("seller_id");
  CREATE INDEX "operators_updated_at_idx" ON "cms"."operators" USING btree ("updated_at");
  CREATE INDEX "operators_created_at_idx" ON "cms"."operators" USING btree ("created_at");
  CREATE UNIQUE INDEX "operators_email_idx" ON "cms"."operators" USING btree ("email");
  CREATE INDEX "customers_display_name_idx" ON "cms"."customers" USING btree ("display_name");
  CREATE INDEX "customers_address_idx" ON "cms"."customers" USING btree ("address");
  CREATE INDEX "customers_seller_idx" ON "cms"."customers" USING btree ("seller_id");
  CREATE INDEX "customers_updated_at_idx" ON "cms"."customers" USING btree ("updated_at");
  CREATE INDEX "customers_created_at_idx" ON "cms"."customers" USING btree ("created_at");
  CREATE INDEX "offerings_main_ingredient_idx" ON "cms"."offerings" USING btree ("main_ingredient");
  CREATE INDEX "offerings_seller_idx" ON "cms"."offerings" USING btree ("seller_id");
  CREATE INDEX "offerings_updated_at_idx" ON "cms"."offerings" USING btree ("updated_at");
  CREATE INDEX "offerings_created_at_idx" ON "cms"."offerings" USING btree ("created_at");
  CREATE INDEX "offerings_rels_order_idx" ON "cms"."offerings_rels" USING btree ("order");
  CREATE INDEX "offerings_rels_parent_idx" ON "cms"."offerings_rels" USING btree ("parent_id");
  CREATE INDEX "offerings_rels_path_idx" ON "cms"."offerings_rels" USING btree ("path");
  CREATE INDEX "offerings_rels_offerings_id_idx" ON "cms"."offerings_rels" USING btree ("offerings_id");
  CREATE INDEX "menu_plans_slot_idx" ON "cms"."menu_plans" USING btree ("slot_id");
  CREATE INDEX "menu_plans_seller_idx" ON "cms"."menu_plans" USING btree ("seller_id");
  CREATE INDEX "menu_plans_updated_at_idx" ON "cms"."menu_plans" USING btree ("updated_at");
  CREATE INDEX "menu_plans_created_at_idx" ON "cms"."menu_plans" USING btree ("created_at");
  CREATE INDEX "menu_plans_rels_order_idx" ON "cms"."menu_plans_rels" USING btree ("order");
  CREATE INDEX "menu_plans_rels_parent_idx" ON "cms"."menu_plans_rels" USING btree ("parent_id");
  CREATE INDEX "menu_plans_rels_path_idx" ON "cms"."menu_plans_rels" USING btree ("path");
  CREATE INDEX "menu_plans_rels_offerings_id_idx" ON "cms"."menu_plans_rels" USING btree ("offerings_id");
  CREATE INDEX "service_slots_date_idx" ON "cms"."service_slots" USING btree ("date");
  CREATE INDEX "service_slots_seller_idx" ON "cms"."service_slots" USING btree ("seller_id");
  CREATE INDEX "service_slots_updated_at_idx" ON "cms"."service_slots" USING btree ("updated_at");
  CREATE INDEX "service_slots_created_at_idx" ON "cms"."service_slots" USING btree ("created_at");
  CREATE INDEX "orders_customer_idx" ON "cms"."orders" USING btree ("customer_id");
  CREATE INDEX "orders_date_idx" ON "cms"."orders" USING btree ("date");
  CREATE INDEX "orders_occasion_idx" ON "cms"."orders" USING btree ("occasion");
  CREATE INDEX "orders_status_idx" ON "cms"."orders" USING btree ("status");
  CREATE INDEX "orders_address_idx" ON "cms"."orders" USING btree ("address");
  CREATE INDEX "orders_payment_status_idx" ON "cms"."orders" USING btree ("payment_status");
  CREATE INDEX "orders_idempotency_key_idx" ON "cms"."orders" USING btree ("idempotency_key");
  CREATE INDEX "orders_created_by_idx" ON "cms"."orders" USING btree ("created_by_id");
  CREATE INDEX "orders_seller_idx" ON "cms"."orders" USING btree ("seller_id");
  CREATE INDEX "orders_updated_at_idx" ON "cms"."orders" USING btree ("updated_at");
  CREATE INDEX "orders_created_at_idx" ON "cms"."orders" USING btree ("created_at");
  CREATE INDEX "order_items_order_idx" ON "cms"."order_items" USING btree ("order_id");
  CREATE INDEX "order_items_offering_idx" ON "cms"."order_items" USING btree ("offering_id");
  CREATE INDEX "order_items_seller_idx" ON "cms"."order_items" USING btree ("seller_id");
  CREATE INDEX "order_items_updated_at_idx" ON "cms"."order_items" USING btree ("updated_at");
  CREATE INDEX "order_items_created_at_idx" ON "cms"."order_items" USING btree ("created_at");
  CREATE INDEX "fulfillments_order_idx" ON "cms"."fulfillments" USING btree ("order_id");
  CREATE INDEX "fulfillments_service_date_idx" ON "cms"."fulfillments" USING btree ("service_date");
  CREATE INDEX "fulfillments_status_idx" ON "cms"."fulfillments" USING btree ("status");
  CREATE INDEX "fulfillments_seller_idx" ON "cms"."fulfillments" USING btree ("seller_id");
  CREATE INDEX "fulfillments_updated_at_idx" ON "cms"."fulfillments" USING btree ("updated_at");
  CREATE INDEX "fulfillments_created_at_idx" ON "cms"."fulfillments" USING btree ("created_at");
  CREATE INDEX "chat_messages_operator_idx" ON "cms"."chat_messages" USING btree ("operator_id");
  CREATE INDEX "chat_messages_seller_idx" ON "cms"."chat_messages" USING btree ("seller_id");
  CREATE INDEX "chat_messages_updated_at_idx" ON "cms"."chat_messages" USING btree ("updated_at");
  CREATE INDEX "chat_messages_created_at_idx" ON "cms"."chat_messages" USING btree ("created_at");
  CREATE INDEX "subscriptions_customer_idx" ON "cms"."subscriptions" USING btree ("customer_id");
  CREATE INDEX "subscriptions_offering_idx" ON "cms"."subscriptions" USING btree ("offering_id");
  CREATE INDEX "subscriptions_status_idx" ON "cms"."subscriptions" USING btree ("status");
  CREATE INDEX "subscriptions_seller_idx" ON "cms"."subscriptions" USING btree ("seller_id");
  CREATE INDEX "subscriptions_updated_at_idx" ON "cms"."subscriptions" USING btree ("updated_at");
  CREATE INDEX "subscriptions_created_at_idx" ON "cms"."subscriptions" USING btree ("created_at");
  CREATE INDEX "kiv1_sellers_status_idx" ON "cms"."kiv1_sellers" USING btree ("status");
  CREATE INDEX "kiv1_sellers_updated_at_idx" ON "cms"."kiv1_sellers" USING btree ("updated_at");
  CREATE INDEX "kiv1_sellers_created_at_idx" ON "cms"."kiv1_sellers" USING btree ("created_at");
  CREATE INDEX "kiv1_operators_seller_idx" ON "cms"."kiv1_operators" USING btree ("seller_id");
  CREATE INDEX "kiv1_operators_updated_at_idx" ON "cms"."kiv1_operators" USING btree ("updated_at");
  CREATE INDEX "kiv1_operators_created_at_idx" ON "cms"."kiv1_operators" USING btree ("created_at");
  CREATE UNIQUE INDEX "seller_wechatOpenid_idx" ON "cms"."kiv1_operators" USING btree ("seller_id","wechat_openid");
  CREATE INDEX "kiv1_customer_profiles_seller_idx" ON "cms"."kiv1_customer_profiles" USING btree ("seller_id");
  CREATE INDEX "kiv1_customer_profiles_openid_idx" ON "cms"."kiv1_customer_profiles" USING btree ("openid");
  CREATE INDEX "kiv1_customer_profiles_updated_at_idx" ON "cms"."kiv1_customer_profiles" USING btree ("updated_at");
  CREATE INDEX "kiv1_customer_profiles_created_at_idx" ON "cms"."kiv1_customer_profiles" USING btree ("created_at");
  CREATE INDEX "seller_openid_active_idx" ON "cms"."kiv1_customer_profiles" USING btree ("seller_id","openid","active");
  CREATE INDEX "kiv1_offerings_seller_idx" ON "cms"."kiv1_offerings" USING btree ("seller_id");
  CREATE INDEX "kiv1_offerings_updated_at_idx" ON "cms"."kiv1_offerings" USING btree ("updated_at");
  CREATE INDEX "kiv1_offerings_created_at_idx" ON "cms"."kiv1_offerings" USING btree ("created_at");
  CREATE UNIQUE INDEX "seller_name_idx" ON "cms"."kiv1_offerings" USING btree ("seller_id","name");
  CREATE INDEX "seller_active_category_idx" ON "cms"."kiv1_offerings" USING btree ("seller_id","active","category");
  CREATE INDEX "kiv1_meal_slots_menu_items_order_idx" ON "cms"."kiv1_meal_slots_menu_items" USING btree ("_order");
  CREATE INDEX "kiv1_meal_slots_menu_items_parent_id_idx" ON "cms"."kiv1_meal_slots_menu_items" USING btree ("_parent_id");
  CREATE INDEX "kiv1_meal_slots_menu_items_offering_idx" ON "cms"."kiv1_meal_slots_menu_items" USING btree ("offering_id");
  CREATE INDEX "kiv1_meal_slots_seller_idx" ON "cms"."kiv1_meal_slots" USING btree ("seller_id");
  CREATE INDEX "kiv1_meal_slots_updated_at_idx" ON "cms"."kiv1_meal_slots" USING btree ("updated_at");
  CREATE INDEX "kiv1_meal_slots_created_at_idx" ON "cms"."kiv1_meal_slots" USING btree ("created_at");
  CREATE UNIQUE INDEX "seller_date_occasion_idx" ON "cms"."kiv1_meal_slots" USING btree ("seller_id","date","occasion");
  CREATE INDEX "seller_orderStatus_idx" ON "cms"."kiv1_meal_slots" USING btree ("seller_id","order_status");
  CREATE INDEX "kiv1_booking_batches_seller_idx" ON "cms"."kiv1_booking_batches" USING btree ("seller_id");
  CREATE UNIQUE INDEX "kiv1_booking_batches_public_id_idx" ON "cms"."kiv1_booking_batches" USING btree ("public_id");
  CREATE INDEX "kiv1_booking_batches_created_by_idx" ON "cms"."kiv1_booking_batches" USING btree ("created_by_id");
  CREATE INDEX "kiv1_booking_batches_updated_at_idx" ON "cms"."kiv1_booking_batches" USING btree ("updated_at");
  CREATE INDEX "kiv1_booking_batches_created_at_idx" ON "cms"."kiv1_booking_batches" USING btree ("created_at");
  CREATE INDEX "seller_status_idx" ON "cms"."kiv1_booking_batches" USING btree ("seller_id","status");
  CREATE INDEX "kiv1_booking_batches_rels_order_idx" ON "cms"."kiv1_booking_batches_rels" USING btree ("order");
  CREATE INDEX "kiv1_booking_batches_rels_parent_idx" ON "cms"."kiv1_booking_batches_rels" USING btree ("parent_id");
  CREATE INDEX "kiv1_booking_batches_rels_path_idx" ON "cms"."kiv1_booking_batches_rels" USING btree ("path");
  CREATE INDEX "kiv1_booking_batches_rels_kiv1_meal_slots_id_idx" ON "cms"."kiv1_booking_batches_rels" USING btree ("kiv1_meal_slots_id");
  CREATE INDEX "kiv1_orders_seller_idx" ON "cms"."kiv1_orders" USING btree ("seller_id");
  CREATE INDEX "kiv1_orders_meal_slot_idx" ON "cms"."kiv1_orders" USING btree ("meal_slot_id");
  CREATE INDEX "kiv1_orders_customer_profile_idx" ON "cms"."kiv1_orders" USING btree ("customer_profile_id");
  CREATE INDEX "kiv1_orders_customer_openid_idx" ON "cms"."kiv1_orders" USING btree ("customer_openid");
  CREATE INDEX "kiv1_orders_updated_at_idx" ON "cms"."kiv1_orders" USING btree ("updated_at");
  CREATE INDEX "kiv1_orders_created_at_idx" ON "cms"."kiv1_orders" USING btree ("created_at");
  CREATE UNIQUE INDEX "seller_mealSlot_customerProfile_idx" ON "cms"."kiv1_orders" USING btree ("seller_id","meal_slot_id","customer_profile_id");
  CREATE INDEX "seller_mealSlot_status_idx" ON "cms"."kiv1_orders" USING btree ("seller_id","meal_slot_id","status");
  CREATE INDEX "seller_customerOpenid_idx" ON "cms"."kiv1_orders" USING btree ("seller_id","customer_openid");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "cms"."payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "cms"."payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "cms"."payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "cms"."payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "cms"."payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "cms"."payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "cms"."payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_sellers_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("sellers_id");
  CREATE INDEX "payload_locked_documents_rels_operators_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("operators_id");
  CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("customers_id");
  CREATE INDEX "payload_locked_documents_rels_offerings_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("offerings_id");
  CREATE INDEX "payload_locked_documents_rels_menu_plans_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("menu_plans_id");
  CREATE INDEX "payload_locked_documents_rels_service_slots_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("service_slots_id");
  CREATE INDEX "payload_locked_documents_rels_orders_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("orders_id");
  CREATE INDEX "payload_locked_documents_rels_order_items_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("order_items_id");
  CREATE INDEX "payload_locked_documents_rels_fulfillments_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("fulfillments_id");
  CREATE INDEX "payload_locked_documents_rels_chat_messages_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("chat_messages_id");
  CREATE INDEX "payload_locked_documents_rels_subscriptions_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("subscriptions_id");
  CREATE INDEX "payload_locked_documents_rels_kiv1_sellers_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_sellers_id");
  CREATE INDEX "payload_locked_documents_rels_kiv1_operators_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_operators_id");
  CREATE INDEX "payload_locked_documents_rels_kiv1_customer_profiles_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_customer_profiles_id");
  CREATE INDEX "payload_locked_documents_rels_kiv1_offerings_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_offerings_id");
  CREATE INDEX "payload_locked_documents_rels_kiv1_meal_slots_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_meal_slots_id");
  CREATE INDEX "payload_locked_documents_rels_kiv1_booking_batches_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_booking_batches_id");
  CREATE INDEX "payload_locked_documents_rels_kiv1_orders_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_orders_id");
  CREATE INDEX "payload_preferences_key_idx" ON "cms"."payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "cms"."payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "cms"."payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "cms"."payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "cms"."payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "cms"."payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_operators_id_idx" ON "cms"."payload_preferences_rels" USING btree ("operators_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "cms"."payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "cms"."payload_migrations" USING btree ("created_at");
  CREATE UNIQUE INDEX "service_slots_seller_date_occasion_unique" ON "cms"."service_slots" ("seller_id", "date", "occasion") WHERE "occasion" IS NOT NULL;
  CREATE UNIQUE INDEX "orders_seller_customer_date_occasion_unique" ON "cms"."orders" ("seller_id", "customer_id", "date", "occasion") WHERE "status" IN ('draft', 'confirmed');
  CREATE UNIQUE INDEX "orders_seller_idempotency_key_unique" ON "cms"."orders" ("seller_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
  CREATE UNIQUE INDEX "fulfillments_seller_order_unique" ON "cms"."fulfillments" ("seller_id", "order_id");
  CREATE INDEX "orders_seller_date_occasion_status_payment_status_idx" ON "cms"."orders" ("seller_id", "date", "occasion", "status", "payment_status");
  CREATE INDEX "orders_seller_customer_status_placed_at_idx" ON "cms"."orders" ("seller_id", "customer_id", "status", "placed_at");
  CREATE INDEX "fulfillments_seller_service_date_occasion_status_idx" ON "cms"."fulfillments" ("seller_id", "service_date", "occasion", "status");
  CREATE INDEX "chat_messages_seller_operator_created_at_idx" ON "cms"."chat_messages" ("seller_id", "operator_id", "created_at");
  CREATE UNIQUE INDEX "menu_plans_seller_slot_unique" ON "cms"."menu_plans" ("seller_id", "slot_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "cms"."sellers_enabled_modules" CASCADE;
  DROP TABLE "cms"."sellers" CASCADE;
  DROP TABLE "cms"."operators_sessions" CASCADE;
  DROP TABLE "cms"."operators" CASCADE;
  DROP TABLE "cms"."customers" CASCADE;
  DROP TABLE "cms"."offerings" CASCADE;
  DROP TABLE "cms"."offerings_rels" CASCADE;
  DROP TABLE "cms"."menu_plans" CASCADE;
  DROP TABLE "cms"."menu_plans_rels" CASCADE;
  DROP TABLE "cms"."service_slots" CASCADE;
  DROP TABLE "cms"."orders" CASCADE;
  DROP TABLE "cms"."order_items" CASCADE;
  DROP TABLE "cms"."fulfillments" CASCADE;
  DROP TABLE "cms"."chat_messages" CASCADE;
  DROP TABLE "cms"."subscriptions" CASCADE;
  DROP TABLE "cms"."kiv1_sellers" CASCADE;
  DROP TABLE "cms"."kiv1_operators" CASCADE;
  DROP TABLE "cms"."kiv1_customer_profiles" CASCADE;
  DROP TABLE "cms"."kiv1_offerings" CASCADE;
  DROP TABLE "cms"."kiv1_meal_slots_menu_items" CASCADE;
  DROP TABLE "cms"."kiv1_meal_slots" CASCADE;
  DROP TABLE "cms"."kiv1_booking_batches" CASCADE;
  DROP TABLE "cms"."kiv1_booking_batches_rels" CASCADE;
  DROP TABLE "cms"."kiv1_orders" CASCADE;
  DROP TABLE "cms"."payload_kv" CASCADE;
  DROP TABLE "cms"."payload_locked_documents" CASCADE;
  DROP TABLE "cms"."payload_locked_documents_rels" CASCADE;
  DROP TABLE "cms"."payload_preferences" CASCADE;
  DROP TABLE "cms"."payload_preferences_rels" CASCADE;
  DROP TABLE "cms"."payload_migrations" CASCADE;
  DROP TYPE "cms"."enum_sellers_enabled_modules";
  DROP TYPE "cms"."enum_sellers_status";
  DROP TYPE "cms"."enum_operators_role";
  DROP TYPE "cms"."enum_customers_default_occasion";
  DROP TYPE "cms"."enum_offerings_kind";
  DROP TYPE "cms"."enum_offerings_category";
  DROP TYPE "cms"."enum_menu_plans_status";
  DROP TYPE "cms"."enum_service_slots_granularity";
  DROP TYPE "cms"."enum_service_slots_occasion";
  DROP TYPE "cms"."enum_service_slots_status";
  DROP TYPE "cms"."enum_orders_occasion";
  DROP TYPE "cms"."enum_orders_status";
  DROP TYPE "cms"."enum_orders_source";
  DROP TYPE "cms"."enum_orders_payment_status";
  DROP TYPE "cms"."enum_fulfillments_occasion";
  DROP TYPE "cms"."enum_fulfillments_status";
  DROP TYPE "cms"."enum_chat_messages_role";
  DROP TYPE "cms"."enum_subscriptions_status";
  DROP TYPE "cms"."enum_kiv1_sellers_status";
  DROP TYPE "cms"."enum_kiv1_offerings_category";
  DROP TYPE "cms"."enum_kiv1_meal_slots_menu_items_category_snapshot";
  DROP TYPE "cms"."enum_kiv1_meal_slots_occasion";
  DROP TYPE "cms"."enum_kiv1_meal_slots_order_status";
  DROP TYPE "cms"."enum_kiv1_booking_batches_status";
  DROP TYPE "cms"."enum_kiv1_orders_status";
  DROP TYPE "cms"."enum_kiv1_orders_source";
  DROP TYPE "cms"."enum_kiv1_orders_payment_status";
  DROP TYPE "cms"."enum_kiv1_orders_delivery_status";`)
}
