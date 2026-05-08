-- source_quality and profile_confidence are agent-internal quality signals.
-- Auto-approve them on insert so they never enter the human review queue.
create or replace function auto_approve_agent_labels()
returns trigger language plpgsql as $$
begin
  if new.label_type in ('source_quality', 'profile_confidence') then
    new.status      := 'approved';
    new.reviewed_at := now();
    new.promoted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_approve_agent_labels on derived_label_suggestions;
create trigger trg_auto_approve_agent_labels
  before insert on derived_label_suggestions
  for each row execute function auto_approve_agent_labels();
