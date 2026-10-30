-- Small teams should not need a second person for every payment. Cashiers still cannot
-- confirm at all. A business that wants two-person checks turns them on in Settings.
alter table app.tenants alter column allow_self_verification set default true;
update app.tenants set allow_self_verification = true;
