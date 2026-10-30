-- Typing a reference during a rush is not realistic, so no method needs one by default.
alter table app.payment_methods alter column requires_reference set default false;
update app.payment_methods set requires_reference = false;
