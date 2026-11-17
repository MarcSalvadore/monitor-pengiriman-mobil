-- ============================================================================
-- BOLT 01 SEED DATA: 12 JABODETABEK DEALERSHIP BRANCHES, DRIVERS & RATE CARD
-- Executed automatically on initial PostgreSQL + PostGIS startup
-- ============================================================================

-- 1. Seed 12 Realistic Jabodetabek Dealership Locations
INSERT INTO shops (code, name, city, address, geom, is_active)
VALUES
    ('JKT-SUN', 'Sunter Auto Flagship', 'Jakarta Utara', 'Jl. Danau Sunter Selatan Blok O3 No. 5, Sunter Agung, Jakarta Utara', ST_SetSRID(ST_MakePoint(106.8765, -6.1462), 4326), TRUE),
    ('JKT-KLG', 'Kelapa Gading Boulevard', 'Jakarta Utara', 'Jl. Boulevard Barat Raya No. 45, Kelapa Gading, Jakarta Utara', ST_SetSRID(ST_MakePoint(106.8906, -6.1574), 4326), TRUE),
    ('JKT-KBJ', 'Kebon Jeruk Arteri', 'Jakarta Barat', 'Jl. Panjang Arteri Kelapa Dua No. 88, Kebon Jeruk, Jakarta Barat', ST_SetSRID(ST_MakePoint(106.7691, -6.1924), 4326), TRUE),
    ('JKT-PIN', 'Pondok Indah Flagship', 'Jakarta Selatan', 'Jl. Sultan Iskandar Muda No. 29, Pondok Indah, Jakarta Selatan', ST_SetSRID(ST_MakePoint(106.7831, -6.2655), 4326), TRUE),
    ('JKT-CAW', 'Cawang MT Haryono', 'Jakarta Timur', 'Jl. MT Haryono Kav. 12, Cawang, Jakarta Timur', ST_SetSRID(ST_MakePoint(106.8686, -6.2442), 4326), TRUE),
    ('JKT-CBB', 'Cibubur Transyogi', 'Jakarta Timur', 'Jl. Alternatif Cibubur KM 3, Cibubur, Jakarta Timur', ST_SetSRID(ST_MakePoint(106.9022, -6.3756), 4326), TRUE),
    ('DPK-MRG', 'Depok Margonda Branch', 'Depok', 'Jl. Margonda Raya No. 310, Kemiri Muka, Depok', ST_SetSRID(ST_MakePoint(106.8286, -6.3916), 4326), TRUE),
    ('BGR-PAJ', 'Bogor Pajajaran Branch', 'Bogor', 'Jl. Raya Pajajaran No. 78, Baranangsiang, Kota Bogor', ST_SetSRID(ST_MakePoint(106.8072, -6.6014), 4326), TRUE),
    ('BKS-BRT', 'Bekasi Barat Ahmad Yani', 'Bekasi', 'Jl. Jenderal Ahmad Yani No. 15, Bekasi Barat, Kota Bekasi', ST_SetSRID(ST_MakePoint(106.9936, -6.2407), 4326), TRUE),
    ('BKS-CKR', 'Cikarang Lippo Branch', 'Kab. Bekasi', 'Jl. MH Thamrin Kav. 105, Lippo Cikarang, Kab. Bekasi', ST_SetSRID(ST_MakePoint(107.1494, -6.3292), 4326), TRUE),
    ('TNG-BSD', 'Tangerang BSD City', 'Tangerang Selatan', 'Jl. Pahlawan Seribu Sektor VII, BSD City, Tangerang Selatan', ST_SetSRID(ST_MakePoint(106.6636, -6.2886), 4326), TRUE),
    ('TNG-KRW', 'Karawaci Imam Bonjol', 'Tangerang', 'Jl. Imam Bonjol No. 62, Lippo Karawaci, Kota Tangerang', ST_SetSRID(ST_MakePoint(106.6094, -6.2195), 4326), TRUE)
ON CONFLICT (code) DO NOTHING;

-- 2. Seed Sample Dealership Fleet Drivers
INSERT INTO drivers (employee_code, full_name, phone_number, base_shop_id, base_fixed_salary, is_active)
VALUES
    ('DRV-001', 'Budi Santoso', '+62-812-8801-1001', (SELECT id FROM shops WHERE code = 'JKT-SUN'), 5500000.00, TRUE),
    ('DRV-002', 'Agus Pratama', '+62-812-8801-1002', (SELECT id FROM shops WHERE code = 'JKT-KLG'), 5400000.00, TRUE),
    ('DRV-003', 'Hendra Wijaya', '+62-812-8801-1003', (SELECT id FROM shops WHERE code = 'JKT-PIN'), 5600000.00, TRUE),
    ('DRV-004', 'Dedi Kurniawan', '+62-812-8801-1004', (SELECT id FROM shops WHERE code = 'JKT-CAW'), 5350000.00, TRUE),
    ('DRV-005', 'Rizky Ramadhan', '+62-812-8801-1005', (SELECT id FROM shops WHERE code = 'DPK-MRG'), 5250000.00, TRUE),
    ('DRV-006', 'Andi Saputra', '+62-812-8801-1006', (SELECT id FROM shops WHERE code = 'BGR-PAJ'), 5200000.00, TRUE),
    ('DRV-007', 'Fajar Nugroho', '+62-812-8801-1007', (SELECT id FROM shops WHERE code = 'BKS-BRT'), 5450000.00, TRUE),
    ('DRV-008', 'Wahyu Hidayat', '+62-812-8801-1008', (SELECT id FROM shops WHERE code = 'TNG-BSD'), 5500000.00, TRUE)
ON CONFLICT (employee_code) DO NOTHING;

-- 3. Seed Initial IDR Rate Card (Active 2026 Jabodetabek Standard)
INSERT INTO rate_cards (
    name,
    effective_from,
    effective_to,
    min_km,
    max_km,
    base_fare,
    rate_per_km,
    flat_trip_allowance,
    toll_allowance,
    is_active
)
SELECT
    'Standard Jabodetabek Rate 2026',
    DATE '2026-01-01',
    NULL,
    5.00,
    999.99,
    35000.00,
    6000.00,
    25000.00,
    45000.00,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM rate_cards WHERE name = 'Standard Jabodetabek Rate 2026'
);
