CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, subtitle TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), scent TEXT NOT NULL, burn_time TEXT NOT NULL, color TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, customer_email TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT, address TEXT NOT NULL, postal TEXT NOT NULL, city TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'BE', shipping TEXT NOT NULL, shipping_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, items_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', stripe_session_id TEXT UNIQUE, paid_at TEXT, withdrawal_requested_at TEXT);
CREATE TABLE IF NOT EXISTS otp (email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, start_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, visitor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
INSERT OR IGNORE INTO products (id,name,subtitle,description,price_cents,stock,scent,burn_time,color,featured) VALUES
('aurore','Aurore','La lumière du matin','Une composition imaginée pour les instants doux. Produit de démonstration : renseigner la composition réelle, la masse, la sécurité et les caractéristiques avant vente.',2900,8,'Fleur de coton','À confirmer','#b98966',1),
('sillage','Sillage','Le temps suspendu','Une silhouette sculpturale pour les intérieurs singuliers. Produit de démonstration : caractéristiques à compléter.',3400,6,'Bois ambré','À confirmer','#78816e',1),
('solstice','Solstice','L’heure dorée','Une pièce chaleureuse qui invite à ralentir. Produit de démonstration : caractéristiques à compléter.',3200,4,'Vanille épicée','À confirmer','#ab7952',1);
