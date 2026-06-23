import { RateConfiguration } from '../types/rates';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateRateConfig(config: RateConfiguration): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (config.rate_type) {
    case 'RES_BASIC':
      validateResidentialBasic(config, errors, warnings);
      break;
    case 'RES_TOU':
      validateResidentialTOU(config, errors, warnings);
      break;
    case 'RES_SOLAR_NEM':
      validateResidentialSolarNEM(config, errors, warnings);
      break;
    case 'RES_EV':
      validateResidentialEV(config, errors, warnings);
      break;
    case 'COM_DEMAND':
      validateCommercialDemand(config, errors, warnings);
      break;
    case 'IND_COMPLEX':
      validateIndustrialComplex(config, errors, warnings);
      break;
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateResidentialBasic(config: any, errors: string[], warnings: string[]): void {
  if (config.customer_charge < 0) {
    errors.push('Customer charge must be non-negative');
  }

  if (!config.energy_tiers || config.energy_tiers.length === 0) {
    errors.push('At least one energy tier is required');
  } else {
    config.energy_tiers.forEach((tier: any, index: number) => {
      if (tier.rate < 0) {
        errors.push(`Energy tier ${index + 1} rate must be non-negative`);
      }
      if (index > 0 && tier.threshold <= config.energy_tiers[index - 1].threshold) {
        errors.push(`Energy tier ${index + 1} threshold must be greater than previous tier`);
      }
    });
  }

  if (config.minimum_bill < config.customer_charge) {
    warnings.push('Minimum bill is less than customer charge');
  }
}

function validateResidentialTOU(config: any, errors: string[], warnings: string[]): void {
  if (config.customer_charge < 0) {
    errors.push('Customer charge must be non-negative');
  }

  if (!config.summer_rates || !config.winter_rates) {
    errors.push('Both summer and winter rates are required');
  } else {
    if (config.summer_rates.on_peak_rate <= config.summer_rates.off_peak_rate) {
      warnings.push('Summer on-peak rate should typically be higher than off-peak rate');
    }
    if (config.winter_rates.on_peak_rate <= config.winter_rates.off_peak_rate) {
      warnings.push('Winter on-peak rate should typically be higher than off-peak rate');
    }
  }
}

function validateResidentialSolarNEM(config: any, errors: string[], warnings: string[]): void {
  if (config.customer_charge < 0) {
    errors.push('Customer charge must be non-negative');
  }

  if (config.solar_export_credit_rate < 0) {
    errors.push('Solar export credit rate must be non-negative');
  }

  if (config.energy_tiers && config.energy_tiers.length > 0) {
    const minRate = Math.min(...config.energy_tiers.map((t: any) => t.rate));
    if (config.solar_export_credit_rate > minRate) {
      warnings.push('Solar export credit rate exceeds minimum energy tier rate');
    }
  }
}

function validateResidentialEV(config: any, errors: string[], warnings: string[]): void {
  if (config.customer_charge < 0) {
    errors.push('Customer charge must be non-negative');
  }

  if (config.ev_on_peak_rate <= config.ev_off_peak_rate) {
    warnings.push('EV on-peak rate should typically be higher than off-peak rate');
  }

  if (config.ev_super_off_peak_rate && config.ev_super_off_peak_rate >= config.ev_off_peak_rate) {
    warnings.push('EV super off-peak rate should typically be lower than off-peak rate');
  }

  if (config.ev_demand_threshold < 0) {
    errors.push('EV demand threshold must be non-negative');
  }
}

function validateCommercialDemand(config: any, errors: string[], warnings: string[]): void {
  if (config.customer_charge < 0) {
    errors.push('Customer charge must be non-negative');
  }

  if (config.demand_ratchet_factor < 0 || config.demand_ratchet_factor > 1) {
    errors.push('Demand ratchet factor must be between 0 and 1');
  }

  if (config.power_factor_threshold < 0 || config.power_factor_threshold > 1) {
    errors.push('Power factor threshold must be between 0 and 1');
  }

  if (config.power_factor_threshold < 0.85) {
    warnings.push('Power factor threshold below 0.85 is unusually low');
  }
}

function validateIndustrialComplex(config: any, errors: string[], warnings: string[]): void {
  if (config.customer_charge < 0) {
    errors.push('Customer charge must be non-negative');
  }

  if (!config.riders || config.riders.length === 0) {
    warnings.push('No riders configured for industrial rate');
  } else {
    config.riders.forEach((rider: any, index: number) => {
      if (!rider.name || rider.name.trim() === '') {
        errors.push(`Rider ${index + 1} must have a name`);
      }
      if (rider.rate < 0) {
        errors.push(`Rider ${index + 1} (${rider.name}) rate must be non-negative`);
      }
      if (!['per_kwh', 'percentage', 'complex'].includes(rider.application_method)) {
        errors.push(`Rider ${index + 1} (${rider.name}) has invalid application method`);
      }
    });
  }
}
