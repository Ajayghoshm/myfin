import joi from 'joi';
import APIError from '../errorHandling/apiError.js';
import type { LegacyKind } from './legacyService.js';

const SECRET_MESSAGE = "Don't store passwords, PINs or OTPs here";
const SECRET_PATTERN = /password|passcode|\bpin\b|\botp\b|cvv/i;

const text = () => joi.string().trim().max(255).allow('');
const phone = () => joi.string().trim().max(255).pattern(/^[0-9 +()\-.,/xX#*]*$/).allow('');

export const dataSchemas: Record<LegacyKind, joi.ObjectSchema> = {
  account: joi
    .object({ bank_branch: text(), nominee: text(), documents_location: text() })
    .unknown(false),
  policy: joi
    .object({
      insurer: text(),
      policy_number: text(),
      sum_assured: joi.number().min(0).max(1e13).allow(null),
      nominee: text(),
      claim_helpline: phone(),
      documents_location: text(),
    })
    .unknown(false),
  contact: joi
    .object({ role: text(), name: text(), phone: phone(), email: joi.string().trim().max(255).email().allow('') })
    .unknown(false),
  instruction: joi.object({ text: joi.string().trim().max(5000).allow('') }).unknown(false),
};

/** Rejects any key or string value that looks like a credential. Runs before the per-kind schema. */
export function assertNoSecrets(value: unknown): void {
  if (typeof value === 'string') {
    if (SECRET_PATTERN.test(value)) throw APIError.badRequest(SECRET_MESSAGE);
  } else if (Array.isArray(value)) {
    value.forEach(assertNoSecrets);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_PATTERN.test(k)) throw APIError.badRequest(SECRET_MESSAGE);
      assertNoSecrets(v);
    }
  }
}

export async function validateLegacyData(kind: LegacyKind, data: unknown) {
  assertNoSecrets(data);
  return dataSchemas[kind].validateAsync(data);
}

