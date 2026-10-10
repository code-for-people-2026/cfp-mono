CREATE TABLE merchant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  app_id text NOT NULL CHECK (length(btrim(app_id)) > 0),
  openid text NOT NULL CHECK (length(btrim(openid)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, openid),
  UNIQUE (id, merchant_id)
);

-- Preserve the existing store, identity and sessions before separating membership.
INSERT INTO merchant_members (merchant_id, app_id, openid)
SELECT id, app_id, openid FROM merchants;

ALTER TABLE sessions ADD COLUMN member_id uuid;
UPDATE sessions s SET member_id = member.id
FROM merchant_members member WHERE member.merchant_id = s.merchant_id;
ALTER TABLE sessions ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_member_store_fkey
  FOREIGN KEY (member_id, merchant_id) REFERENCES merchant_members(id, merchant_id);
CREATE INDEX sessions_member_idx ON sessions (member_id);

-- Store creation is a privileged maintenance operation, never a login side effect.
ALTER TABLE merchants DROP COLUMN singleton, DROP COLUMN app_id, DROP COLUMN openid;
