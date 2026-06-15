-- CodeWithMe — Phase 1 schema
-- Run this in the Supabase SQL Editor (or `supabase db push`) once your
-- project exists. It is idempotent enough to re-run during development.

-- ---------------------------------------------------------------------------
-- Problems
-- ---------------------------------------------------------------------------
create table if not exists public.problems (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  description text not null default '',
  difficulty  text not null default 'easy'
                check (difficulty in ('easy', 'medium', 'hard')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Test cases (sample cases are shown to the user; hidden ones are for judging)
-- ---------------------------------------------------------------------------
create table if not exists public.test_cases (
  id              uuid primary key default gen_random_uuid(),
  problem_id      uuid not null references public.problems(id) on delete cascade,
  input           text not null default '',
  expected_output text not null default '',
  is_sample       boolean not null default false,
  ordinal         int not null default 0
);

create index if not exists test_cases_problem_id_idx
  on public.test_cases (problem_id);

-- ---------------------------------------------------------------------------
-- Submissions / saved code snippets — one row per (user, problem, language)
-- ---------------------------------------------------------------------------
create table if not exists public.submissions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  language   text not null check (language in ('python', 'cpp', 'javascript')),
  code       text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, problem_id, language)
);

create index if not exists submissions_user_problem_idx
  on public.submissions (user_id, problem_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.problems   enable row level security;
alter table public.test_cases enable row level security;
alter table public.submissions enable row level security;

-- Problems & sample test cases are readable by any authenticated user.
drop policy if exists "problems are readable" on public.problems;
create policy "problems are readable"
  on public.problems for select
  to authenticated
  using (true);

drop policy if exists "sample test cases are readable" on public.test_cases;
create policy "sample test cases are readable"
  on public.test_cases for select
  to authenticated
  using (is_sample = true);

-- Submissions are private to their owner.
drop policy if exists "owners manage their submissions" on public.submissions;
create policy "owners manage their submissions"
  on public.submissions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Seed data (a couple of starter problems so the UI isn't empty)
-- ---------------------------------------------------------------------------
insert into public.problems (slug, title, description, difficulty)
values
  (
    'two-sum',
    'Two Sum',
    E'Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`.\n\nYou may assume that each input has exactly one solution, and you may not use the same element twice.\n\n**Example**\n\n```\nInput:  nums = [2, 7, 11, 15], target = 9\nOutput: [0, 1]\n```',
    'easy'
  ),
  (
    'reverse-string',
    'Reverse String',
    E'Write a function that reverses a string. The input string is given as a single line.\n\n**Example**\n\n```\nInput:  hello\nOutput: olleh\n```',
    'easy'
  ),
  (
    'fizzbuzz',
    'FizzBuzz',
    E'Print numbers from 1 to `n`. For multiples of 3 print "Fizz", for multiples of 5 print "Buzz", and for multiples of both print "FizzBuzz".',
    'easy'
  )
on conflict (slug) do nothing;

-- Sample test cases for Two Sum
insert into public.test_cases (problem_id, input, expected_output, is_sample, ordinal)
select p.id, '4\n2 7 11 15\n9', '0 1', true, 0
from public.problems p
where p.slug = 'two-sum'
  and not exists (
    select 1 from public.test_cases t where t.problem_id = p.id
  );

insert into public.test_cases (problem_id, input, expected_output, is_sample, ordinal)
select p.id, 'hello', 'olleh', true, 0
from public.problems p
where p.slug = 'reverse-string'
  and not exists (
    select 1 from public.test_cases t where t.problem_id = p.id
  );
