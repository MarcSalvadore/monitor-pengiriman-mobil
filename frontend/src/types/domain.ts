export type RouteType = 'toll' | 'nontoll';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface Shop {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

export interface Driver {
  id: string;
  employee_code: string;
  full_name: string;
  phone_number: string | null;
  base_shop_id: string | null;
  base_shop_code: string | null;
  base_shop_name: string | null;
  base_fixed_salary: number;
  is_active: boolean;
}

export interface RateCard {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  min_km: number;
  max_km: number;
  base_fare: number;
  rate_per_km: number;
  flat_trip_allowance: number;
  toll_allowance: number;
  is_active: boolean;
}

export interface OdMatrixEntry {
  id: string;
  origin_shop_id: string;
  origin_code: string;
  destination_shop_id: string;
  destination_code: string;
  route_type: RouteType;
  distance_km: number;
  estimated_duration_min: number;
  route_polyline: string | null;
  updated_at: string;
}

export interface DeliveryLog {
  id: string;
  delivery_date: string;
  driver_id: string;
  driver_code?: string;
  driver_name?: string;
  vehicle_vin: string;
  vehicle_plate: string;
  origin_shop_id: string;
  origin_code?: string;
  origin_name?: string;
  destination_shop_id: string | null;
  destination_code?: string | null;
  destination_name?: string | null;
  custom_destination_lat: number | null;
  custom_destination_lng: number | null;
  route_type: RouteType;
  computed_distance_km: number;
  applied_rate_card_id: string;
  applied_rate_card_name?: string;
  calculated_benefit_amount: number;
  supervisor_id: string;
  status: 'pending' | 'verified' | 'voided';
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDeliveryPayload {
  delivery_date: string;
  driver_id: string;
  vehicle_vin: string;
  vehicle_plate: string;
  origin_shop_id: string;
  destination_shop_id?: string;
  custom_coords?: Coordinates;
  route_type: RouteType;
  supervisor_id: string;
}

export interface QueuedDeliveryRecord {
  client_id: string;
  payload: CreateDeliveryPayload;
  preview: {
    driver_code: string;
    driver_name: string;
    origin_code: string;
    origin_name: string;
    destination_code: string | null;
    destination_name: string | null;
    computed_distance_km: number;
    calculated_benefit_amount: number;
    applied_rate_card_name: string;
  };
  queued_at: string;
  sync_status: 'queued_offline' | 'syncing' | 'failed';
  error_message?: string;
}

export interface BenefitBreakdown {
  variablePay: number;
  flatTripAllowance: number;
  baseBenefit: number;
  tollReimbursement: number;
  totalBenefit: number;
  appliedRateCardName: string;
}

export interface RoutePreview {
  distance_km: number;
  estimated_duration_min: number;
  polyline: GeoJsonLineString | null;
  source: 'od_matrix' | 'osrm_live' | 'haversine_fallback' | 'offline_cache';
  fallback_used: boolean;
  lookup_ms?: number;
}
