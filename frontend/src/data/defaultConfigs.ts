import {
  RateCode,
  RateConfiguration,
  ResidentialBasicRate,
  ResidentialTOURate,
  ResidentialSolarNEMRate,
  ResidentialEVRate,
  CommercialDemandRate,
  IndustrialComplexRate,
} from '../types/rates';

/**
 * Returns an empty configuration shell for the given rate code.
 * This replaces the previous implementation that returned default values.
 * Now, all values need to be fetched from the backend API.
 */
export function getDefaultConfig(rateCode: RateCode): RateConfiguration {
  switch (rateCode) {
    case 'RES_BASIC':
      return getEmptyResidentialBasic();
    case 'RES_TOU':
      return getEmptyResidentialTOU();
    case 'RES_SOLAR_NEM':
      return getEmptyResidentialSolarNEM();
    case 'RES_EV':
      return getEmptyResidentialEV();
    case 'COM_DEMAND':
      return getEmptyCommercialDemand();
    case 'IND_COMPLEX':
      return getEmptyIndustrialComplex();
    default:
      throw new Error(`Unknown rate code: ${rateCode}`);
  }
}

function getEmptyResidentialBasic(): ResidentialBasicRate {
  return {
    rate_type: 'RES_BASIC',
    customer_charge: 0,
    energy_tiers: [
      { threshold: 0, rate: 0 }
    ],
    fuel_rate: 0,
    storm_protection_rate: 0,
    capacity_rate: 0,
    environmental_rate: 0,
    minimum_bill: 0,
  };
}

function getEmptyResidentialTOU(): ResidentialTOURate {
  return {
    rate_type: 'RES_TOU',
    customer_charge: 0,
    seasonal_adjustment_enabled: false,
    summer_rates: {
      on_peak_rate: 0,
      off_peak_rate: 0,
    },
    winter_rates: {
      on_peak_rate: 0,
      off_peak_rate: 0,
    },
  };
}

function getEmptyResidentialSolarNEM(): ResidentialSolarNEMRate {
  return {
    rate_type: 'RES_SOLAR_NEM',
    customer_charge: 0,
    energy_tiers: [
      { threshold: 0, rate: 0 }
    ],
    solar_export_credit_rate: 0,
    minimum_bill: 0,
  };
}

function getEmptyResidentialEV(): ResidentialEVRate {
  return {
    rate_type: 'RES_EV',
    customer_charge: 0,
    household_energy_rate: 0,
    ev_on_peak_rate: 0,
    ev_off_peak_rate: 0,
    ev_super_off_peak_rate: 0,
    ev_demand_threshold: 0,
    ev_demand_rate: 0,
  };
}

function getEmptyCommercialDemand(): CommercialDemandRate {
  return {
    rate_type: 'COM_DEMAND',
    customer_charge: 0,
    energy_rate: 0,
    fuel_rate: 0,
    demand_rate: 0,
    demand_ratchet_factor: 0,
    power_factor_threshold: 0,
    power_factor_penalty: 0,
  };
}

function getEmptyIndustrialComplex(): IndustrialComplexRate {
  return {
    rate_type: 'IND_COMPLEX',
    customer_charge: 0,
    energy_rate: 0,
    demand_rate: 0,
    capacity_rate: 0,
    riders: [],
  };
}
