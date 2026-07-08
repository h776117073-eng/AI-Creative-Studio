CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'member');
CREATE TABLE IF NOT EXISTS subscriptions (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), stripe_customer_id TEXT, stripe_subscription_id TEXT, tier TEXT NOT NULL DEFAULT 'free', renews_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS credit_ledger (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT REFERENCES users(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, job_id TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_locks (job_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), amount INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
