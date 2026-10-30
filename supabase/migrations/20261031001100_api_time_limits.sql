-- A till must never hang. These limits turn a stuck request into a quick, clear failure.
alter role isoform_api set statement_timeout = '20s';
alter role isoform_api set lock_timeout = '10s';
alter role isoform_api set idle_in_transaction_session_timeout = '30s';
