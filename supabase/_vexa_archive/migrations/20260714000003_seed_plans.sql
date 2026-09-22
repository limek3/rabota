-- ============================================================================
-- Vexa — справочник тарифов. Один-в-один с lib/plans.ts.
-- Идемпотентно: повторный прогон обновляет строки.
-- ============================================================================

insert into plans (id, name, tagline, tagline_ru, price_m, price_y, seats, searches, sources, deliveries, polling, features, features_ru, recommended, sort)
values
('free', 'Free',
 'Try Vexa on a single search', 'Попробуйте Vexa на одном поиске',
 0, 0, 1, 1, 3, 50, 'EVERY 15 MIN',
 array['1 active search','3 sources','50 bot deliveries / mo','Dashboard inbox','7-day match history'],
 array['1 активный поиск','3 источника','50 доставок бота / мес','Входящие в дашборде','История совпадений 7 дней'],
 false, 1),

('lite', 'Lite',
 'For a solo recruiter or founder', 'Для соло-рекрутера или фаундера',
 19, 15, 1, 3, 15, 500, 'EVERY 5 MIN',
 array['3 active searches','15 sources','500 bot deliveries / mo','Minus-words & match modes','30-day match history','CSV export'],
 array['3 активных поиска','15 источников','500 доставок бота / мес','Минус-слова и режимы поиска','История 30 дней','Экспорт CSV'],
 false, 2),

('pro', 'Pro',
 'Serious monitoring, full speed', 'Серьёзный мониторинг на полной скорости',
 49, 39, 1, 10, 100, 2000, 'EVERY 30 SEC',
 array['10 active searches','100 sources','2,000 bot deliveries / mo','Comments monitoring','Relevance tuning per search','Unlimited history','Priority support'],
 array['10 активных поисков','100 источников','2 000 доставок бота / мес','Мониторинг комментариев','Порог релевантности на поиск','Безлимитная история','Приоритетная поддержка'],
 true, 3),

('team', 'Team',
 'Shared inbox for up to 5 people', 'Общий инбокс на 5 человек',
 99, 79, 5, 25, 300, 10000, 'EVERY 30 SEC',
 array['Everything in Pro','5 team seats','25 active searches','300 sources','10,000 bot deliveries / mo','Shared inbox & assignments','Member roles (owner / member)'],
 array['Всё из Pro','5 мест в команде','25 активных поисков','300 источников','10 000 доставок бота / мес','Общий инбокс и назначения','Роли участников (владелец / участник)'],
 false, 4)

on conflict (id) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  tagline_ru = excluded.tagline_ru,
  price_m = excluded.price_m,
  price_y = excluded.price_y,
  seats = excluded.seats,
  searches = excluded.searches,
  sources = excluded.sources,
  deliveries = excluded.deliveries,
  polling = excluded.polling,
  features = excluded.features,
  features_ru = excluded.features_ru,
  recommended = excluded.recommended,
  sort = excluded.sort;

-- ─── Realtime: инбокс, чат и CRM-доска обновляются live ───
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table chat_reactions;
alter publication supabase_realtime add table candidates;
alter publication supabase_realtime add table crm_tasks;
