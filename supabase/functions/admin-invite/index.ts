// Invita por correo a un participante (requiere service_role, por eso vive en el servidor).
import { corsHeaders, json, requireAdmin, serviceClient } from '../_shared/http.deno.ts'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405)

  const db = serviceClient()
  const adminId = await requireAdmin(req, db)
  if (!adminId) return json(req, { error: 'FORBIDDEN' }, 403)

  let body: { email?: string; display_name?: string; group_id?: string; redirect_to?: string }
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'INVALID_JSON' }, 400)
  }
  const email = (body.email ?? '').trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 254) return json(req, { error: 'INVALID_EMAIL' }, 400)
  const name = (body.display_name ?? '').trim().slice(0, 40)

  const { data: group } = body.group_id
    ? await db.from('groups').select('id').eq('id', body.group_id).maybeSingle()
    : { data: null }
  if (body.group_id && !group) return json(req, { error: 'GROUP_NOT_FOUND' }, 404)

  const siteUrl = Deno.env.get('SITE_URL') ?? ''
  const redirectTo = siteUrl ? `${siteUrl.replace(/\/$/, '')}/restablecer` : undefined
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { data: name ? { display_name: name } : {}, redirectTo })
  if (error) {
    const exists = /already|registered/i.test(error.message)
    return json(req, { error: exists ? 'USER_ALREADY_EXISTS' : 'INVITE_FAILED', message: error.message }, exists ? 409 : 400)
  }

  const userId = data.user.id
  if (group) {
    await db.from('group_members').upsert(
      { group_id: group.id, user_id: userId, status: 'active', approved_at: new Date().toISOString(), approved_by: adminId },
      { onConflict: 'group_id,user_id' },
    )
  }
  await db.from('audit_logs').insert({
    actor_id: adminId, action: 'user.invited', entity_type: 'profile', entity_id: userId,
    details: { group_id: group?.id ?? null },
  })
  return json(req, { user_id: userId, invited: true })
})
