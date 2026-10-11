// Traduce los códigos de error estables del servidor a mensajes para el usuario.
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  FORBIDDEN: 'No tienes permiso para realizar esta acción.',
  ROUND_NOT_FOUND: 'Esta jornada no existe o no tienes acceso a ella.',
  ROUND_CLOSED: 'La jornada ya está cerrada.',
  ROUND_NOT_OPEN_YET: 'La jornada todavía no abre.',
  DEADLINE_PASSED: 'La fecha límite ya pasó. No es posible enviar pronósticos.',
  INCOMPLETE_PREDICTION: 'Completa el marcador de todos los partidos antes de enviar.',
  INVALID_GOALS: 'Los goles deben ser números enteros dentro del rango permitido.',
  INVALID_ITEMS: 'Los datos del pronóstico no son válidos.',
  INVALID_MATCH: 'Partido no válido.',
  MATCH_NOT_IN_ROUND: 'Uno de los partidos no pertenece a esta jornada.',
  DUPLICATE_MATCH: 'Un partido aparece repetido.',
  PREDICTION_LOCKED: 'Tu quiniela ya fue enviada y no puede modificarse.',
  INVALID_INVITE_CODE: 'El código de invitación no es válido.',
  ROUND_HAS_SUBMISSIONS: 'Ya hay quinielas enviadas: los partidos de esta jornada están bloqueados.',
  ROUND_HAS_PREDICTIONS: 'Hay pronósticos registrados; no se puede regresar a borrador.',
  ROUND_NEEDS_MATCHES: 'Agrega al menos un partido a la jornada.',
  ROUND_NEEDS_PARTICIPANTS: 'Selecciona a los jugadores que pueden participar.',
  DEADLINE_IN_PAST: 'La fecha límite debe estar en el futuro.',
  DEADLINE_AFTER_KICKOFF: 'La fecha límite debe ser anterior al primer partido.',
  DEADLINE_REQUIRED: 'Indica la fecha límite.',
  ROUND_LOCKED: 'Esta jornada ya no puede modificarse.',
  RESULTS_PENDING: 'Aún hay partidos sin resultado oficial.',
  REASON_REQUIRED: 'Escribe un motivo (mínimo 5 caracteres). Quedará en la auditoría.',
  INVALID_TRANSITION: 'Ese cambio de estado no está permitido.',
  CANNOT_CHANGE_SELF: 'No puedes cambiar tu propio rol o estado.',
  USER_NOT_FOUND: 'No existe una cuenta con ese correo.',
  USER_NOT_IN_GROUP: 'Algún jugador no pertenece al grupo.',
  GROUP_NOT_FOUND: 'Grupo no encontrado.',
  MATCH_NOT_FOUND: 'Partido no encontrado.',
  TOO_MANY_MATCHES: 'Máximo 50 partidos por jornada.',
  SETTING_LOCKED: 'Esta opción está bloqueada en esta versión.',
  PROVIDER_NOT_CONFIGURED: 'El proveedor deportivo no está configurado.',
  PROVIDER_ERROR: 'El proveedor deportivo no respondió. Intenta más tarde.',
  FILTER_REQUIRED: 'Elige una competición o una fecha para buscar.',
  NOT_CONFIGURED: 'El proveedor de datos reales aún no tiene su clave configurada.',
  INVALID_KEY: 'El proveedor rechazó la clave de acceso. Revisa API_FOOTBALL_KEY en Supabase.',
  PLAN_RESTRICTED: 'El plan gratuito del proveedor no cubre esa temporada o consulta.',
  QUOTA_EXHAUSTED: 'Se alcanzó el límite de consultas del proveedor por hoy. Se conservan los últimos datos válidos.',
  RATE_LIMITED: 'Demasiadas consultas seguidas al proveedor. Espera un minuto.',
  SCORE_REQUIRED: 'Pon el marcador de cada partido antes de enviar.',
  INCOMPLETE_QUINIELA: 'Tu quiniela no está completa: hay partidos sin marcador o se agregó uno nuevo. Revísala y vuelve a enviarla.',
  BUDGET_BLOCKED: 'Consulta pausada para proteger la cuota diaria de API-Football. Se muestran los últimos datos guardados.',
  UNAVAILABLE: 'El proveedor deportivo no está disponible. Intenta más tarde.',
  BAD_REQUEST: 'Con una competición busca por rango; sin competición, un solo día.',
  INVALID_OUTCOME: 'Elige local, empate o visitante.',
  OUTCOME_MISMATCH: 'El marcador no coincide con el resultado elegido (local, empate o visitante).',
  STALE_SAVE: 'Había una versión más reciente guardada. Recarga la página.',
  INVALID_CLABE: 'La CLABE debe tener 18 dígitos.',
  INVALID_AMOUNT: 'El monto debe ser mayor a cero.',
  MATCH_CLOSED: 'Ese partido ya empezó: no admite pronósticos.',
  KICKOFF_IN_PAST: 'La fecha y hora del partido deben ser futuras.',
  INVALID_TEAM: 'Equipo no válido (nombre de 2 a 60 letras).',
  INVALID_PROVIDER_ID: 'El identificador del proveedor debe ser numérico.',
  INVALID_LOGO_URL: 'El escudo debe ser una dirección https:// a la imagen.',
  PROVIDER_MATCH_READONLY: 'El horario de los partidos de API-Football lo actualiza el proveedor.',
  PAYMENT_REQUIRED: 'Para enviar tus pronósticos necesitas tu pago confirmado. Ve a Mi perfil → «Cómo pagar».',
  USE_PAYMENT_CONFIRMATION: 'Confirma el pago desde «Confirmar pago», con referencia, vigencia y motivo.',
  PAYMENT_REFERENCE_REQUIRED: 'Indica la referencia del pago (número de transferencia o recibo).',
  PAYMENT_VALIDITY_IN_PAST: 'La vigencia del pago debe ser una fecha futura.',
  INVALID_PAYMENT_STATUS: 'Estado de pago no válido.',
  MIXED_TEST_DATA: 'Una jornada no puede mezclar partidos reales con partidos de prueba.',
  SYNC_IN_PROGRESS: 'Ya hay una sincronización en curso. Inténtalo en un momento.',
  USER_ALREADY_EXISTS: 'Ese correo ya tiene cuenta: agrégalo al grupo por correo.',
  INVALID_EMAIL: 'Correo no válido.',
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Confirma tu correo antes de iniciar sesión. Abre el enlace que te enviamos o pide uno nuevo aquí abajo.',
  'For security purposes, you can only request this': 'Espera un minuto antes de pedir otro correo.',
  over_email_send_rate_limit: 'Se enviaron demasiados correos. Inténtalo más tarde.',
  'Email rate limit exceeded': 'Se enviaron demasiados correos. Inténtalo más tarde.',
  'Email link is invalid or has expired': 'El enlace caducó o ya se usó. Pide uno nuevo.',
  'User already registered': 'Ya existe una cuenta con ese correo.',
  'Unable to validate email address': 'El correo no tiene un formato válido. Revisa que no tenga espacios ni caracteres especiales.',
}

/** Códigos de Supabase Auth (error.code) → mensaje claro. */
const AUTH_CODES: Record<string, string> = {
  validation_failed: 'El correo no tiene un formato válido. Revisa que no tenga espacios ni caracteres especiales.',
  email_address_invalid: 'Ese correo no se puede usar. Revisa que esté bien escrito.',
  email_not_confirmed: 'Confirma tu correo antes de iniciar sesión. Abre el enlace que te enviamos o pide uno nuevo aquí abajo.',
  user_already_exists: 'Ya existe una cuenta con ese correo. Entra o recupera tu contraseña.',
  email_exists: 'Ya existe una cuenta con ese correo. Entra o recupera tu contraseña.',
  weak_password: 'La contraseña es demasiado débil. Usa al menos 8 caracteres combinando letras y números.',
  over_email_send_rate_limit: 'Se enviaron demasiados correos. Espera unos minutos e inténtalo de nuevo.',
  over_request_rate_limit: 'Demasiados intentos seguidos. Espera un momento.',
  signup_disabled: 'El registro de cuentas nuevas está desactivado.',
  otp_expired: 'El enlace caducó o ya se usó. Pide uno nuevo.',
  invalid_credentials: 'Correo o contraseña incorrectos.',
}

export class AppError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? MESSAGES[code] ?? code)
    this.name = 'AppError'
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  const raw = (e as { message?: string; error?: string } | null)?.message ?? (e as { error?: string })?.error ?? String(e)
  const code = Object.keys(MESSAGES).find((k) => raw === k || raw.startsWith(k + ':') || raw.includes(k)) ?? raw
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return new AppError('NETWORK', 'Sin conexión. Revisa tu internet e inténtalo de nuevo.')
  const authCode = (e as { code?: unknown } | null)?.code
  const isAuth = (e as { __isAuthError?: boolean } | null)?.__isAuthError === true || /^Auth/.test((e as Error | null)?.name ?? '')
  if (typeof authCode === 'string' && AUTH_CODES[authCode] && !MESSAGES[code]) return new AppError(authCode, AUTH_CODES[authCode])
  // Error de autenticación sin traducción: se muestra el motivo real (no contiene datos sensibles).
  if (isAuth && !MESSAGES[code]) return new AppError(typeof authCode === 'string' ? authCode : 'AUTH', `No se pudo completar: ${raw}`)
  return new AppError(code, MESSAGES[code] ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.')
}

export const errorMessage = (e: unknown) => toAppError(e).message

/** Correo limpio: sin espacios ni caracteres invisibles que agregan algunos teclados (iPhone), en minúsculas. */
export const normalizeEmail = (raw: string) =>
  raw.normalize('NFKC').replace(/[\s\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '').toLowerCase()
export const isValidEmail = (email: string) => /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)
