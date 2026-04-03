-- ============================================================
-- STEP 1: Run this in Supabase → SQL Editor → New Query → Run
-- ============================================================

create table if not exists profiles (
  id           text primary key,
  name         text not null,
  age          int,
  weight       numeric,
  height       numeric,
  gender       text default 'male',
  goal         text default 'Lose Weight',
  activity     numeric default 1.55,
  password     text not null,
  is_admin     boolean default false,
  created_at   timestamptz default now()
);

create table if not exists daily_logs (
  id           uuid default gen_random_uuid() primary key,
  user_id      text references profiles(id) on delete cascade,
  date         date not null,
  meals        jsonb default '[]',
  exercise     text,
  water        int default 4,
  sleep        numeric default 7,
  mood         text default 'Good',
  notes        text,
  report       text,
  created_at   timestamptz default now(),
  unique(user_id, date)
);

create table if not exists weight_logs (
  id           uuid default gen_random_uuid() primary key,
  user_id      text references profiles(id) on delete cascade,
  date         date not null,
  weight       numeric not null,
  unique(user_id, date)
);

create table if not exists measurements (
  id           uuid default gen_random_uuid() primary key,
  user_id      text references profiles(id) on delete cascade,
  week_start   date not null,
  waist        numeric,
  chest        numeric,
  hips         numeric,
  unique(user_id, week_start)
);

create table if not exists notifications (
  user_id      text references profiles(id) on delete cascade primary key,
  notif_time   text
);

-- Disable Row Level Security (fine for a family app)
alter table profiles disable row level security;
alter table daily_logs disable row level security;
alter table weight_logs disable row level security;
alter table measurements disable row level security;
alter table notifications disable row level security;

-- Create the admin account
insert into profiles (id, name, age, weight, height, gender, goal, activity, password, is_admin)
values ('admin', 'Admin', 30, 70, 170, 'male', 'Maintain Weight', 1.55, 'Monarc@met1920', true)
on conflict (id) do nothing;

select 'Database ready!' as status;
