-- =====================================================================
-- Contraseña temporal puesta por el admin (sin correo). Para quien no puede
-- recuperar su cuenta por correo (límite de envíos, enlaces que caducan o que
-- el correo «abre» solo). El admin la genera, se la pasa en privado y el
-- participante la cambia en «Mi perfil». La contraseña NO se guarda en ningún
-- registro: solo su cifrado en auth.users, como cualquier contraseña.
-- =====================================================================
create or replace function public.admin_temp_password(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_pw text;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user and u.deleted_at is null) then
    perform private.fail('USER_NOT_FOUND');
  end if;
  -- Nunca sobre otra cuenta de administración.
  if exists (select 1 from public.profiles p where p.id = p_user and p.role = 'admin') then
    perform private.fail('FORBIDDEN');
  end if;
  -- 10 caracteres fáciles de dictar (sin 0/O ni 1/I): «GB» + 8 al azar.
  select 'GB' || string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 32), 1), '' order by i)
    into v_pw
    from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i;
  update auth.users
     set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_user;
  perform private.log_audit('member.temp_password', 'profile', p_user::text, jsonb_build_object('by', v_admin));
  return jsonb_build_object('password', v_pw);
end;
$$;
revoke execute on function public.admin_temp_password(uuid) from public, anon;
grant execute on function public.admin_temp_password(uuid) to authenticated;
