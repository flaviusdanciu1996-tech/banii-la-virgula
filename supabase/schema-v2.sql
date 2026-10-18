-- Banii la virgulă — schema completă. Rulează o singură dată în Supabase → SQL Editor → Run.
-- Toate sumele sunt numere întregi în bani/cenți (bigint).

create extension if not exists pgcrypto;

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Familia mea',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists settings (
  household_id uuid primary key references households(id) on delete cascade,
  payday int not null default 1 check (payday between 1 and 31),
  total_budget bigint,
  savings_target_pct int not null default 20,
  eur_rate numeric(12,4) not null default 4.97,
  usd_rate numeric(12,4) not null default 4.30,
  rates_date date
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('in','out')),
  grp text check (grp in ('critic','important','optional','economii')),
  icon text not null default 'circle',
  allocated bigint not null default 0 check (allocated >= 0),
  archived boolean not null default false,
  sort int not null default 0
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null,
  platform text not null default '',
  currency text not null default 'RON' check (currency in ('RON','EUR','USD')),
  value bigint not null default 0,
  invested bigint not null default 0,
  note text not null default '',
  updated_on date not null default current_date,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('in','out')),
  amount bigint not null check (amount > 0),
  category_id uuid not null references categories(id),
  note text not null default '',
  date date not null default current_date,
  created_at timestamptz not null default now(),
  asset_id uuid references assets(id) on delete set null
);
create index if not exists transactions_hh_date on transactions(household_id, date);

create table if not exists snapshots (
  household_id uuid not null references households(id) on delete cascade,
  day date not null,
  liquid bigint not null, invest bigint not null, goods bigint not null, debts bigint not null, net bigint not null,
  primary key (household_id, day)
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  email text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Access rules ----------
create or replace function is_member(h uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from members where household_id = h and user_id = auth.uid())
$$;

create or replace function is_owner(h uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from households where id = h and owner_id = auth.uid())
$$;

alter table households enable row level security;
alter table members enable row level security;
alter table settings enable row level security;
alter table categories enable row level security;
alter table assets enable row level security;
alter table transactions enable row level security;
alter table snapshots enable row level security;
alter table invites enable row level security;

drop policy if exists hh_read on households;
create policy hh_read on households for select using (is_member(id));
drop policy if exists hh_update on households;
create policy hh_update on households for update using (is_owner(id));

drop policy if exists m_read on members;
create policy m_read on members for select using (is_member(household_id));
drop policy if exists m_update_self on members;
create policy m_update_self on members for update using (user_id = auth.uid());
drop policy if exists m_delete on members;
create policy m_delete on members for delete using (user_id = auth.uid() or is_owner(household_id));

do $$
declare t text;
begin
  foreach t in array array['settings','categories','assets','transactions','snapshots'] loop
    execute format('drop policy if exists %I_all on %I', t, t);
    execute format('create policy %I_all on %I for all using (is_member(household_id)) with check (is_member(household_id))', t, t);
  end loop;
end $$;

drop policy if exists inv_read on invites;
create policy inv_read on invites for select using (is_member(household_id));
drop policy if exists inv_insert on invites;
create policy inv_insert on invites for insert with check (is_member(household_id) and created_by = auth.uid());
drop policy if exists inv_delete on invites;
create policy inv_delete on invites for delete using (is_member(household_id));

-- ---------- Setup: one household per user, with default categories ----------
create or replace function seed_categories(h uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into categories (household_id, name, kind, grp, icon, sort) values
    (h,'Chirie / rată','out','critic','home',1),
    (h,'Utilități','out','critic','plug',2),
    (h,'Mâncare acasă','out','critic','shopping-cart',3),
    (h,'Transport','out','critic','bus',4),
    (h,'Combustibil','out','critic','fuel',5),
    (h,'Sănătate','out','critic','heart-pulse',6),
    (h,'Telefon & internet','out','critic','smartphone',7),
    (h,'Haine','out','important','shirt',10),
    (h,'Casă','out','important','sofa',11),
    (h,'Educație','out','important','graduation-cap',12),
    (h,'Familie & cadouri','out','important','gift',13),
    (h,'Asigurări','out','important','shield',14),
    (h,'Restaurante & cafenele','out','optional','utensils',20),
    (h,'Băuturi alcoolice','out','optional','wine',21),
    (h,'Îngrijire personală & sport','out','optional','dumbbell',22),
    (h,'Distracție','out','optional','party-popper',23),
    (h,'Abonamente','out','optional','repeat',24),
    (h,'Cumpărături diverse','out','optional','shopping-bag',25),
    (h,'Economii','out','economii','piggy-bank',30),
    (h,'Investiții','out','economii','trending-up',31),
    (h,'Fond de urgență','out','economii','life-buoy',32),
    (h,'Salariu','in',null,'wallet',40),
    (h,'Diurnă','in',null,'truck',41),
    (h,'Bonus','in',null,'sparkles',42),
    (h,'Alte venituri','in',null,'circle-plus',43);
end $$;

create or replace function ensure_household(p_name text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select household_id into h from members where user_id = auth.uid() order by created_at desc limit 1;
  if h is not null then return h; end if;
  insert into households (owner_id) values (auth.uid()) returning id into h;
  insert into members (household_id, user_id, display_name, role) values (h, auth.uid(), coalesce(nullif(p_name,''), 'Eu'), 'owner');
  insert into settings (household_id) values (h);
  perform seed_categories(h);
  return h;
end $$;

-- Join a household with an invite code. Leaves any household where you are the only member (its data is deleted).
create or replace function accept_invite(p_code text, p_name text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare inv invites; old uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from invites where code = upper(trim(p_code)) and accepted_at is null;
  if inv.id is null then raise exception 'Cod invalid sau deja folosit'; end if;
  if exists(select 1 from members where household_id = inv.household_id and user_id = auth.uid()) then return inv.household_id; end if;
  for old in select household_id from members where user_id = auth.uid() loop
    if (select count(*) from members where household_id = old) = 1 then
      delete from households where id = old;
    else
      delete from members where household_id = old and user_id = auth.uid();
    end if;
  end loop;
  insert into members (household_id, user_id, display_name, role) values (inv.household_id, auth.uid(), coalesce(nullif(p_name,''), 'Membru'), 'member');
  update invites set accepted_at = now() where id = inv.id;
  return inv.household_id;
end $$;

-- Leave the current household (owners cannot leave while others are still inside).
create or replace function leave_household(h uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_owner(h) and (select count(*) from members where household_id = h) > 1 then
    raise exception 'Ești proprietarul. Scoate întâi ceilalți membri.';
  end if;
  delete from members where household_id = h and user_id = auth.uid();
  if not exists(select 1 from members where household_id = h) then delete from households where id = h; end if;
end $$;

grant execute on function ensure_household(text), accept_invite(text, text), leave_household(uuid) to authenticated;
