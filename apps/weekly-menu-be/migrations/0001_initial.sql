CREATE TABLE weekly_menu_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_menu_migrations_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE weekly_menu_identities (
  id text PRIMARY KEY,
  wechat_open_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_menu_identities_id_not_blank CHECK (length(btrim(id)) > 0),
  CONSTRAINT weekly_menu_identities_open_id_not_blank CHECK (length(btrim(wechat_open_id)) > 0)
);

CREATE TABLE weekly_menu_sessions (
  id text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES weekly_menu_identities(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_menu_sessions_id_not_blank CHECK (length(btrim(id)) > 0),
  CONSTRAINT weekly_menu_sessions_token_hash_not_blank CHECK (length(btrim(token_hash)) > 0),
  CONSTRAINT weekly_menu_sessions_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT weekly_menu_sessions_revocation_after_creation CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX weekly_menu_sessions_active_identity_idx
  ON weekly_menu_sessions (identity_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE weekly_menu_plans (
  id text PRIMARY KEY,
  owner_identity_id text NOT NULL REFERENCES weekly_menu_identities(id) ON DELETE CASCADE,
  contract_version smallint NOT NULL DEFAULT 1,
  week_start date NOT NULL,
  source_plan_id text,
  status text NOT NULL DEFAULT 'draft',
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_menu_plans_id_not_blank CHECK (length(btrim(id)) > 0),
  CONSTRAINT weekly_menu_plans_contract_version CHECK (contract_version = 1),
  CONSTRAINT weekly_menu_plans_source_differs CHECK (source_plan_id IS NULL OR source_plan_id <> id),
  CONSTRAINT weekly_menu_plans_status CHECK (status IN ('draft', 'confirmed')),
  CONSTRAINT weekly_menu_plans_confirmation_matches_status CHECK (
    (status = 'draft' AND confirmed_at IS NULL)
    OR (status = 'confirmed' AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT weekly_menu_plans_owner_key UNIQUE (id, owner_identity_id),
  CONSTRAINT weekly_menu_plans_source_same_owner FOREIGN KEY (source_plan_id, owner_identity_id)
    REFERENCES weekly_menu_plans (id, owner_identity_id) ON DELETE RESTRICT
);

CREATE INDEX weekly_menu_plans_owner_week_idx
  ON weekly_menu_plans (owner_identity_id, week_start DESC);

CREATE INDEX weekly_menu_plans_source_idx
  ON weekly_menu_plans (source_plan_id)
  WHERE source_plan_id IS NOT NULL;

CREATE TABLE weekly_menu_plan_items (
  plan_id text NOT NULL REFERENCES weekly_menu_plans(id) ON DELETE CASCADE,
  day_index smallint NOT NULL,
  meal_index smallint NOT NULL,
  big_meat text NOT NULL,
  small_meat text NOT NULL,
  vegetable text NOT NULL,
  PRIMARY KEY (plan_id, day_index, meal_index),
  CONSTRAINT weekly_menu_plan_items_day_index CHECK (day_index BETWEEN 0 AND 6),
  CONSTRAINT weekly_menu_plan_items_meal_index CHECK (meal_index BETWEEN 0 AND 1),
  CONSTRAINT weekly_menu_plan_items_big_meat_not_blank CHECK (length(btrim(big_meat)) > 0),
  CONSTRAINT weekly_menu_plan_items_small_meat_not_blank CHECK (length(btrim(small_meat)) > 0),
  CONSTRAINT weekly_menu_plan_items_vegetable_not_blank CHECK (length(btrim(vegetable)) > 0)
);

CREATE FUNCTION weekly_menu_guard_plan_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_count integer;
  source_status text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    RAISE EXCEPTION 'weekly_menu confirmed plans must be created through a draft transition'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'weekly_menu confirmed plans are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.source_plan_id IS NOT NULL THEN
    SELECT status INTO source_status
      FROM weekly_menu_plans
      WHERE id = NEW.source_plan_id
        AND owner_identity_id = NEW.owner_identity_id;

    IF source_status IS DISTINCT FROM 'confirmed' THEN
      RAISE EXCEPTION 'weekly_menu source plans must be confirmed and owned by the same identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'confirmed' THEN
    SELECT count(*) INTO item_count
      FROM weekly_menu_plan_items
      WHERE plan_id = OLD.id;

    IF item_count <> 14 THEN
      RAISE EXCEPTION 'weekly_menu plans require 14 meals before confirmation'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER weekly_menu_plans_immutable_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON weekly_menu_plans
  FOR EACH ROW EXECUTE FUNCTION weekly_menu_guard_plan_mutation();

CREATE FUNCTION weekly_menu_guard_plan_item_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_parent_status text;
  new_parent_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO old_parent_status
      FROM weekly_menu_plans
      WHERE id = OLD.plan_id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO new_parent_status
      FROM weekly_menu_plans
      WHERE id = NEW.plan_id;
  END IF;

  IF old_parent_status = 'confirmed' OR new_parent_status = 'confirmed' THEN
    RAISE EXCEPTION 'weekly_menu confirmed plan items are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER weekly_menu_plan_items_immutable_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON weekly_menu_plan_items
  FOR EACH ROW EXECUTE FUNCTION weekly_menu_guard_plan_item_mutation();
