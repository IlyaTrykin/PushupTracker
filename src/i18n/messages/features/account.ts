/**
 * Registration and password reset: requirement hints under the fields and the client-side
 * validation errors (same rules as the server, `src/lib/account-validation.ts`).
 * Used as `accountMessages[locale]`.
 */
import { PASSWORD_MIN_LENGTH } from '@/lib/account-validation';

export const accountMessages = {
  ru: {
    usernameHint: 'От 3 до 32 символов: латинские буквы, цифры и . _ -',
    usernameInvalid: 'Ник: от 3 до 32 символов, только латинские буквы, цифры и . _ -',
    passwordHint: `Не меньше ${PASSWORD_MIN_LENGTH} символов`,
    passwordTooShort: `Пароль должен быть не меньше ${PASSWORD_MIN_LENGTH} символов`,
    passwordTooLong: 'Пароль слишком длинный',
  },
  en: {
    usernameHint: '3 to 32 characters: Latin letters, digits and . _ -',
    usernameInvalid: 'Username: 3 to 32 characters, only Latin letters, digits and . _ -',
    passwordHint: `At least ${PASSWORD_MIN_LENGTH} characters`,
    passwordTooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    passwordTooLong: 'The password is too long',
  },
} as const;
