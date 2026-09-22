-- Проекты: приоритет и план по найму.
--
-- priority — булев флаг, а не число «важности»: три уровня приоритета никто не
-- поддерживает честно, всё скатывается в «всё срочное». Либо проект наверху
-- списка, либо нет.
--
-- openings — сколько человек нужно закрыть. Без плана «нанято: 3» ничего не
-- значит, и полоса заполнения в карточке проекта считаться не из чего.

alter table jobs
  add column if not exists priority boolean not null default false,
  add column if not exists openings integer;

-- Приоритетные проекты вытаскиваются наверх на каждом открытии экрана —
-- частичный индекс дешевле полного, их всегда единицы.
create index if not exists jobs_priority_idx on jobs (workspace_id) where priority;
