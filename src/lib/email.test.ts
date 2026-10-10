import { describe, expect, it } from 'vitest'
import { isValidEmail, normalizeEmail, toAppError } from './errors'

describe('correo del registro', () => {
  it('quita espacios y caracteres invisibles del teclado y pasa a minúsculas', () => {
    expect(normalizeEmail(' Shabex10@Gmail.com ')).toBe('shabex10@gmail.com')
    expect(normalizeEmail('​persona@example.test‎')).toBe('persona@example.test')
    expect(normalizeEmail('persona＠example.test')).toBe('persona@example.test')
    expect(normalizeEmail('perso na@example.test')).toBe('persona@example.test')
  })
  it('valida el formato antes de llamar a Supabase', () => {
    expect(isValidEmail('persona@example.test')).toBe(true)
    expect(isValidEmail('persona@example')).toBe(false)
    expect(isValidEmail('persona@@example.test')).toBe(false)
  })
  it('traduce el error real de Supabase en lugar de un mensaje genérico', () => {
    const e = Object.assign(new Error('Unable to validate email address: invalid format'), { name: 'AuthApiError', code: 'validation_failed', __isAuthError: true })
    expect(toAppError(e).message).toMatch(/formato válido/)
    const other = Object.assign(new Error('Some new auth problem'), { name: 'AuthApiError', __isAuthError: true })
    expect(toAppError(other).message).toBe('No se pudo completar: Some new auth problem')
    const notConfirmed = Object.assign(new Error('Email not confirmed'), { name: 'AuthApiError', code: 'email_not_confirmed', __isAuthError: true })
    expect(toAppError(notConfirmed).code).toBe('Email not confirmed')
  })
})
