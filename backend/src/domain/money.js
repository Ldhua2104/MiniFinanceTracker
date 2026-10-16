import Decimal from 'decimal.js';
import mongoose from 'mongoose';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const AMOUNT_PATTERN = /^\d{1,16}(?:\.\d{1,2})?$/;
const RATE_PATTERN = /^\d{1,10}(?:\.\d{1,10})?$/;

export class MoneyInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoneyInputError';
  }
}

function decimalInput(value, pattern, label, { positive = false } = {}) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new MoneyInputError(`${label} must be a decimal string with supported precision`);
  }
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || (positive && decimal.lte(0))) {
    throw new MoneyInputError(`${label} must be finite${positive ? ' and greater than zero' : ''}`);
  }
  return decimal;
}

export function parseAmount(value, { positive = false } = {}) {
  return decimalInput(value, AMOUNT_PATTERN, 'Amount', { positive });
}

export function parseRate(value, { positive = true } = {}) {
  return decimalInput(value, RATE_PATTERN, 'Exchange rate', { positive });
}

export function convertToBaseAmount(amount, rate) {
  const parsedAmount = typeof amount === 'string' ? parseAmount(amount) : amount;
  const parsedRate = typeof rate === 'string' ? parseRate(rate) : rate;
  const result = parsedAmount.mul(parsedRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!result.isFinite() || result.abs().greaterThan('9999999999999999.99')) {
    throw new MoneyInputError('Converted amount exceeds the supported range');
  }
  return result;
}

export function toDecimal128(value) {
  const decimal = value instanceof Decimal ? value : parseAmount(value);
  return mongoose.Types.Decimal128.fromString(decimal.toFixed(2));
}

export function decimal128ToString(value, scale = 2) {
  if (value == null) return null;
  return new Decimal(value.toString()).toFixed(scale);
}
