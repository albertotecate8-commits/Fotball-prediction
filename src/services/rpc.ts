import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'

/** Llama una RPC y convierte errores del servidor en AppError con mensaje legible. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw toAppError(error)
  return data as T
}

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // Las Edge Functions devuelven { error, message } en el cuerpo.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null)
      if (payload?.error) throw toAppError({ message: payload.error })
    }
    throw toAppError(error)
  }
  return data as T
}
