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
  UNAVAILABLE: 'El proveedor deportivo no está disponible. Intenta más tarde.',
  BAD_REQUEST: 'Con una competición busca por rango; sin competición, un solo día.',
  PAYMENT_REQUIRED: 'Tu participación no está activada: el administrador debe confirmar tu pago para enviar pronósticos oficiales.',
  USE_PAYMENT_CONFIRMATION: 'Confirma el pago desde «Confirmar pago», con referencia, vigencia y motivo.',
  PAYMENT_REFERENCE_REQUIRED: 'Indica la referencia del pago (número de transferencia o recibo).',
  PAYMENT_VALIDITY_IN_PAST: 'La vigencia del pago debe ser una fecha futura.',
  INVALID_PAYMENT_STATUS: 'Estado de pago no válido.',
  MIXED_TEST_DATA: 'Una jornada no puede mezclar partidos reales con partidos de prueba.',
  SYNC_IN_PROGRESS: 'Ya hay una sincronización en curso. Inténtalo en un momento.',
  USER_ALREADY_EXISTS: 'Ese correo ya tiene cuenta: agrégalo al grupo por correo.',
  INVALID_EMAIL: 'Correo no válido.',
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Confirma tu correo antes de iniciar sesión.',
  'User already registered': 'Ya existe una cuenta con ese correo.',
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
  return new AppError(code, MESSAGES[code] ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.')
}

export const errorMessage = (e: unknown) => toAppError(e).message
