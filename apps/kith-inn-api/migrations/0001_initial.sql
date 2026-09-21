CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true CHECK (singleton IS TRUE) UNIQUE,
  app_id text NOT NULL CHECK (length(btrim(app_id)) > 0),
  openid text NOT NULL CHECK (length(btrim(openid)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, openid)
);

CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz
);
CREATE INDEX sessions_merchant_idx ON sessions (merchant_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE dishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  name text COLLATE "C" NOT NULL CHECK (
    char_length(name) BETWEEN 1 AND 60 AND name = btrim(name) AND name = normalize(name, NFC)
  ),
  category text NOT NULL CHECK (category IN ('meat', 'vegetable', 'soup')),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, name)
);
CREATE INDEX dishes_candidates_idx ON dishes (merchant_id, active, category);

CREATE TABLE week_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  week_start date NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  structure jsonb NOT NULL CHECK (jsonb_typeof(structure) = 'object'),
  meals jsonb NOT NULL CHECK (jsonb_typeof(meals) = 'array' AND jsonb_array_length(meals) = 14),
  confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, week_start)
);

CREATE TABLE mutation_receipts (
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  idempotency_key uuid NOT NULL,
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CHECK (expires_at = created_at + interval '24 hours'),
  PRIMARY KEY (merchant_id, idempotency_key)
);
CREATE INDEX mutation_receipts_expiry_idx ON mutation_receipts (expires_at);
