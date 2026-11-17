-- ============================================================================
-- AUTOMOTIVE DEALERSHIP FLEET & DYNAMIC PAYROLL SYSTEM (PostgreSQL + PostGIS)
-- Zero-OpEx Jabodetabek Delivery & Compensation Platform
-- Target: PostgreSQL 15+ with PostGIS Extension Enabled
-- ============================================================================

-- Enable PostGIS Spatial Extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable UUID Generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. SHOPS & BRANCHES (10+ Dealerships Across Jabodetabek)
-- ============================================================================
CREATE TABLE shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,                      -- e.g., 'JKT-SUN', 'BGR-PAJ'
    name VARCHAR(150) NOT NULL,                            -- e.g., 'Sunter Auto Flagship', 'Bogor Pajajaran Branch'
    city VARCHAR(100) NOT NULL,                            -- e.g., 'Jakarta Utara', 'Bogor'
    address TEXT NOT NULL,
    -- PostGIS Point Geometry (WGS 84 / SRID 4326: Longitude, Latitude)
    geom GEOMETRY(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION GENERATED ALWAYS AS (ST_Y(geom)) STORED,
    longitude DOUBLE PRECISION GENERATED ALWAYS AS (ST_X(geom)) STORED,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shops_geom ON shops USING GIST (geom);
CREATE INDEX idx_shops_active ON shops (is_active);

-- ============================================================================
-- 2. DRIVERS & PERSONNEL
-- ============================================================================
CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_code VARCHAR(50) UNIQUE NOT NULL,             -- e.g., 'DRV-001'
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(30),
    base_shop_id UUID REFERENCES shops(id) ON DELETE RESTRICT,
    base_fixed_salary NUMERIC(15, 2) DEFAULT 0.00,         -- Base monthly salary (IDR)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_drivers_shop ON drivers (base_shop_id);

-- ============================================================================
-- 3. ORIGIN-DESTINATION (OD) DISTANCE MATRIX (Pre-computed & Cached)
-- ============================================================================
CREATE TYPE route_type_enum AS ENUM ('toll', 'nontoll');

CREATE TABLE od_distance_matrix (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    origin_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    destination_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    route_type route_type_enum NOT NULL DEFAULT 'nontoll',
    distance_km NUMERIC(10, 2) NOT NULL,                   -- Road distance from OSRM
    estimated_duration_min NUMERIC(8, 2) NOT NULL,         -- Estimated travel time
    route_polyline TEXT,                                   -- Encoded GeoJSON / Polyline for Leaflet
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_shop_route UNIQUE (origin_shop_id, destination_shop_id, route_type)
);

CREATE INDEX idx_od_matrix_lookup ON od_distance_matrix (origin_shop_id, destination_shop_id, route_type);

-- ============================================================================
-- 4. VERSIONED RATE CARDS (Indonesian Rupiah / IDR Tiered Surcharge Rules)
-- ============================================================================
CREATE TABLE rate_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,                            -- e.g., 'Standard Jabodetabek Rate 2026'
    effective_from DATE NOT NULL,
    effective_to DATE,                                     -- NULL means currently active
    min_km NUMERIC(6, 2) DEFAULT 0.00,                     -- Base distance threshold (e.g., 4 km)
    max_km NUMERIC(6, 2) DEFAULT 999.99,                   -- Upper limit for this tier
    base_fare NUMERIC(15, 2) NOT NULL,                     -- Base fare for initial min_km (IDR)
    rate_per_km NUMERIC(15, 2) NOT NULL,                   -- Surcharge per km exceeding min_km (IDR)
    flat_trip_allowance NUMERIC(15, 2) DEFAULT 0.00,       -- Meal / parking trip allowance (IDR)
    toll_allowance NUMERIC(15, 2) DEFAULT 0.00,            -- Flat toll reimbursement when route_type = 'toll' (IDR)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rate_cards_active ON rate_cards (is_active, effective_from);

-- ============================================================================
-- 5. IMMUTABLE DELIVERY LOGS & AUDIT LEDGER
-- ============================================================================
CREATE TYPE delivery_status_enum AS ENUM ('pending', 'verified', 'voided');

CREATE TABLE delivery_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
    vehicle_vin VARCHAR(50) NOT NULL,                      -- Automobile VIN / Chassis Number
    vehicle_plate VARCHAR(30) NOT NULL,                    -- License Plate Number
    origin_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    destination_shop_id UUID REFERENCES shops(id) ON DELETE RESTRICT, -- Nullable if ad-hoc custom drop
    custom_destination_geom GEOMETRY(Point, 4326),         -- For external body shop / customer drop
    route_type route_type_enum NOT NULL DEFAULT 'nontoll',
    computed_distance_km NUMERIC(10, 2) NOT NULL,          -- Snapshotted road distance
    applied_rate_card_id UUID NOT NULL REFERENCES rate_cards(id) ON DELETE RESTRICT,
    calculated_benefit_amount NUMERIC(15, 2) NOT NULL,     -- Immutable calculated payout (IDR)
    supervisor_id VARCHAR(100) NOT NULL,                   -- Supervisor who logged the delivery
    status delivery_status_enum NOT NULL DEFAULT 'verified',
    void_reason TEXT,                                      -- Required if status = 'voided'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_delivery_logs_date ON delivery_logs (delivery_date);
CREATE INDEX idx_delivery_logs_driver ON delivery_logs (driver_id);
CREATE INDEX idx_delivery_logs_status ON delivery_logs (status);
CREATE INDEX idx_delivery_logs_geom ON delivery_logs USING GIST (custom_destination_geom);

-- ============================================================================
-- 6. AUDIT & AUTOMATED TIMESTAMP TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_shops_modtime
    BEFORE UPDATE ON shops
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drivers_modtime
    BEFORE UPDATE ON drivers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_od_matrix_modtime
    BEFORE UPDATE ON od_distance_matrix
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_delivery_logs_modtime
    BEFORE UPDATE ON delivery_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
