import { describe, expect, it } from 'vitest'
import { emailLinkTarget } from './emailLink'

describe('enlaces de correo que llegan a otra página', () => {
  const rec = '#access_token=a&refresh_token=b&type=recovery'
  it('recuperar contraseña: de la principal a «Nueva contraseña», con el fragmento', () => {
    expect(emailLinkTarget('/', '', rec)).toBe(`/restablecer${rec}`)
    expect(emailLinkTarget('/quinielas', '?x=1', rec)).toBe(`/restablecer?x=1${rec}`)
    expect(emailLinkTarget('/restablecer', '', rec)).toBeNull()
  })
  it('respeta la ruta base (GitHub Pages)', () => {
    expect(emailLinkTarget('/Fotball-prediction/', '', rec, '/Fotball-prediction/')).toBe(`/Fotball-prediction/restablecer${rec}`)
  })
  it('confirmar cuenta va a su pantalla; sin enlace de correo no hace nada', () => {
    expect(emailLinkTarget('/', '', '#access_token=a&refresh_token=b&type=signup')).toBe('/auth/confirmar#access_token=a&refresh_token=b&type=signup')
    expect(emailLinkTarget('/', '', '')).toBeNull()
    expect(emailLinkTarget('/', '', '#pago')).toBeNull()
  })
})
