-- The API logs in as isoform_api. It inherits app_user's limited rights and cannot bypass RLS.
-- Its password is set outside migrations by scripts/set-api-password.mjs.
create role isoform_api login in role app_user;

-- Supabase's postgres role is not a superuser, so it needs this to run tests as the API role.
grant app_user to postgres with set true;
