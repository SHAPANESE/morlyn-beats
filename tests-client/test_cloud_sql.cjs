// PostgreSQL execution and RLS checks, with a minimal local Supabase schema.
// npm install --prefix D:/OWN/.tools/morlyn-sql-validation @electric-sql/pglite
const {PGlite} = require(process.env.PGLITE_MODULE || 'D:/OWN/.tools/morlyn-sql-validation/node_modules/@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const owner = '11111111-1111-4111-8111-111111111111';
const outsider = '22222222-2222-4222-8222-222222222222';
async function verify(legacy) {
  const root = path.join(__dirname, '..');
  const ownerSql = fs.readFileSync(path.join(root, 'supabase-owner.sql'), 'utf8');
  const ownerEmail = ownerSql.match(/where lower\(email\) = '([^']+)'/)[1];
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    grant usage on schema auth,storage,public to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    insert into auth.users values ('${owner}','${ownerEmail.replaceAll("'", "''")}',now()),('${outsider}','other@example.com',now());`);
  if (legacy) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase-setup.sql'), 'utf8'));
    await db.exec("insert into public.portfolio_works(channel,title,media_type,media_path) values('03','Old video','video','03/old.mp4')");
  }
  const sql = fs.readFileSync(path.join(root, 'supabase-free.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec(ownerSql); await db.exec(ownerSql);
  await assert.rejects(db.exec(`insert into public.portfolio_admins values('${outsider}')`), /unique/i);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  assert.equal((await db.query('select public.is_portfolio_admin() as allowed')).rows[0].allowed, true);
  await db.exec(`insert into public.portfolio_works(channel,title,media_type,video_id,published) values
    ('04','Published','youtube','dQw4w9WgXcQ',true),('04','Draft','youtube','dQw4w9WgXcQ',false);
    insert into public.portfolio_works(channel,title,media_type,media_path,published) values
    ('01','Public image','image','01/public.png',true),('01','Private image','image','01/private.png',false);
    insert into storage.objects(bucket_id,name) values('portfolio','01/public.png'),('portfolio','01/private.png');`);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('portfolio','99/bad.png')"), /row-level security/i);
  await assert.rejects(db.exec("insert into public.portfolio_works(channel,title,media_type,video_id) values('04','Bad','youtube','bad')"), /check constraint/i);
  await db.exec("update public.portfolio_works set description='Updated' where title='Draft'");
  await db.exec('reset role; set role anon');
  assert.equal((await db.query("select count(*)::int as n from public.portfolio_works where channel='04'")).rows[0].n, 1);
  assert.deepEqual((await db.query('select name from storage.objects')).rows.map(row=>row.name), ['01/public.png']);
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${outsider}',false);`);
  assert.equal((await db.query('select public.is_portfolio_admin() as allowed')).rows[0].allowed, false);
  await assert.rejects(db.exec("insert into public.portfolio_works(channel,title,media_type,video_id) values('04','Intruder','youtube','dQw4w9WgXcQ')"), /row-level security/i);
  assert.equal((await db.query("delete from public.portfolio_works where title='Published' returning id")).rows.length, 0);
  assert.equal((await db.query("update public.portfolio_works set title='Hijacked' returning id")).rows.length, 0);
  await db.exec('reset role');
  assert.equal((await db.query("select public,file_size_limit from storage.buckets where id='portfolio'")).rows[0].public, false);
  if (legacy) assert.equal((await db.query("select count(*)::int as n from public.portfolio_works where title='Old video'")).rows[0].n, 1);
  await db.close();
  console.log(`PASS: ${legacy ? 'existing project migration' : 'new project'}, rerun, single owner, public/private storage and RLS`);
}
(async()=>{await verify(false); await verify(true);})().catch(error=>{console.error(error);process.exitCode=1;});
