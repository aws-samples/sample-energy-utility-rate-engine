export type RateCode =
  | 'RES_BASIC'
  | 'RES_TOU'
  | 'RES_SOLAR_NEM'
  | 'RES_EV'
  | 'COM_DEMAND'
  | 'IND_COMPLEX';

export interface EnergyTier {
  threshold: number;
  rate: number;
  limit?: number | null;
}

export interface SeasonalRates {
  on_peak_rate: number;
  off_peak_rate: number;
  mid_peak_rate?: number;
}

export interface Rider {
  name: string;
  application_method: 'per_kwh' | 'percentage' | 'complex';
  rate: number;
}

export interface ResidentialBasicRate {
  rate_type: 'RES_BASIC';
  customer_charge: number;
  energy_tiers: EnergyTier[];
  fuel_rate: number;
  storm_protection_rate: number;
  capacity_rate: number;
  environmental_rate: number;
  minimum_bill: number;
}

export interface ResidentialTOURate {
  rate_type: 'RES_TOU';
  customer_charge: number;
  seasonal_adjustment_enabled: boolean;
  summer_rates: SeasonalRates;
  winter_rates: SeasonalRates;
}

export interface ResidentialSolarNEMRate {
  rate_type: 'RES_SOLAR_NEM';
  customer_charge: number;
  energy_tiers: EnergyTier[];
  solar_export_credit_rate: number;
  minimum_bill: number;
}

export interface ResidentialEVRate {
  rate_type: 'RES_EV';
  customer_charge: number;
  household_energy_rate: number;
  ev_on_peak_rate: number;
  ev_off_peak_rate: number;
  ev_super_off_peak_rate?: number;
  ev_demand_threshold: number;
  ev_demand_rate: number;
}

export interface CommercialDemandRate {
  rate_type: 'COM_DEMAND';
  customer_charge: number;
  energy_rate: number;
  fuel_rate: number;
  demand_rate: number;
  demand_ratchet_factor: number;
  power_factor_threshold: number;
  power_factor_penalty: number;
}

export interface IndustrialComplexRate {
  rate_type: 'IND_COMPLEX';
  customer_charge: number;
  energy_rate: number;
  demand_rate: number;
  capacity_rate: number;
  riders: Rider[];
}

export type RateConfiguration =
  | ResidentialBasicRate
  | ResidentialTOURate
  | ResidentialSolarNEMRate
  | ResidentialEVRate
  | CommercialDemandRate
  | IndustrialComplexRate;

export interface RateConfigurationFile {
  [key: string]: Omit<RateConfiguration, 'rate_type'>;
}
