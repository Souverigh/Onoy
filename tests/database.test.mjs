import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
const db = new PGlite();
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
let orgA, orgB, productA;
before(async () => {
  await db.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated; INSERT INTO auth.users VALUES ('${a}'),('${b}');`,
  );
  if (existsSync("supabase/migrations"))
    for (const f of readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
});
after(() => db.close());
async function user(id) {
  await db.exec(
    `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function owner() {
  await db.exec("RESET ROLE;");
}
test("foundation tables exist and all tenant tables have RLS", async () => {
  const { rows } = await db.query(
    `select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'`,
  );
  assert.equal(rows.length, 14);
  assert.ok(rows.every((r) => r.relrowsecurity));
});
test("organization creation is idempotent and cannot enroll another user", async () => {
  await user(a);
  orgA = (
    await db.query(
      `select public.create_organization('Магазин A','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as id`,
    )
  ).rows[0].id;
  const retry = (
    await db.query(
      `select public.create_organization('Магазин A','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as id`,
    )
  ).rows[0].id;
  assert.equal(retry, orgA);
  await assert.rejects(
    db.query(
      `insert into organization_members(organization_id,user_id) values ($1,$2)`,
      [orgA, b],
    ),
    /permission denied/,
  );
  await user(b);
  orgB = (
    await db.query(
      `select public.create_organization('Магазин B','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as id`,
    )
  ).rows[0].id;
});
test("RLS isolates lists and denies forging organization on insert/update", async () => {
  await user(a);
  productA = (
    await db.query(
      `insert into products(organization_id,name,sku) values ($1,'Лампа','L12') returning id`,
      [orgA],
    )
  ).rows[0].id;
  await user(b);
  assert.equal((await db.query("select * from products")).rows.length, 0);
  await assert.rejects(
    db.query(
      `insert into products(organization_id,name) values ($1,'Чужой товар')`,
      [orgA],
    ),
    /row-level security/,
  );
  await user(a);
  await assert.rejects(
    db.query("update products set organization_id=$1 where id=$2", [
      orgB,
      productA,
    ]),
    /permission denied/,
  );
});
test("ledger tables cannot be edited by authenticated users", async () => {
  await user(a);
  for (const table of [
    "sales",
    "purchases",
    "payments",
    "inventory_movements",
    "audit_events",
    "documents",
    "document_extractions",
  ]) {
    await assert.rejects(db.query(`delete from ${table}`), /permission denied/);
  }
  await assert.rejects(
    db.query(
      `insert into inventory_movements(organization_id,product_id,qty_delta,reason) values ($1,$2,10,'opening')`,
      [orgA, productA],
    ),
    /permission denied/,
  );
});
test("composite foreign keys prevent linking another organization product", async () => {
  await owner();
  await assert.rejects(
    db.query(
      `insert into inventory_movements(organization_id,product_id,qty_delta,reason) values ($1,$2,10,'opening')`,
      [orgB, productA],
    ),
    /foreign key constraint/,
  );
});
test("stock and debts are computed from posted ledger records and views respect RLS", async () => {
  await owner();
  const customer = (
    await db.query(
      `insert into customers(organization_id,name) values ($1,'Асан') returning id`,
      [orgA],
    )
  ).rows[0].id;
  const supplier = (
    await db.query(
      `insert into suppliers(organization_id,name) values ($1,'Horoz') returning id`,
      [orgA],
    )
  ).rows[0].id;
  await db.query(
    `insert into sales(organization_id,customer_id,total,status,idempotency_key) values ($1,$2,14850,'posted','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),($1,$2,99999,'draft','dddddddd-dddd-4ddd-8ddd-dddddddddddd')`,
    [orgA, customer],
  );
  await db.query(
    `insert into purchases(organization_id,supplier_id,total,status,idempotency_key) values ($1,$2,20000,'posted','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')`,
    [orgA, supplier],
  );
  await db.query(
    `insert into payments(organization_id,customer_id,direction,amount,idempotency_key) values ($1,$2,'incoming',10000,'ffffffff-ffff-4fff-8fff-ffffffffffff')`,
    [orgA, customer],
  );
  await db.query(
    `insert into payments(organization_id,supplier_id,direction,amount,idempotency_key) values ($1,$2,'outgoing',2500,'12345678-ffff-4fff-8fff-ffffffffffff')`,
    [orgA, supplier],
  );
  await db.query(
    `insert into inventory_movements(organization_id,product_id,qty_delta,reason) values ($1,$2,30,'opening'),($1,$2,-2.5,'adjustment')`,
    [orgA, productA],
  );
  await user(a);
  assert.equal(
    Number(
      (await db.query("select stock from product_balances")).rows[0].stock,
    ),
    27.5,
  );
  assert.equal(
    Number(
      (await db.query("select balance from customer_balances")).rows[0].balance,
    ),
    4850,
  );
  assert.equal(
    Number(
      (await db.query("select balance from supplier_balances")).rows[0].balance,
    ),
    17500,
  );
  await user(b);
  for (const view of [
    "product_balances",
    "customer_balances",
    "supplier_balances",
  ])
    assert.equal((await db.query("select * from " + view)).rows.length, 0);
});
test("payment direction and duplicate reference constraints reject inconsistent entries", async () => {
  await owner();
  const c = (
    await db.query("select id from customers where organization_id=$1", [orgA])
  ).rows[0].id;
  await assert.rejects(
    db.query(
      `insert into payments(organization_id,customer_id,direction,amount,idempotency_key) values ($1,$2,'outgoing',100,gen_random_uuid())`,
      [orgA, c],
    ),
    /check constraint/,
  );
  await db.query(
    `insert into payments(organization_id,customer_id,direction,amount,bank_reference,idempotency_key) values ($1,$2,'incoming',100,'MB-1',gen_random_uuid())`,
    [orgA, c],
  );
  await assert.rejects(
    db.query(
      `insert into payments(organization_id,customer_id,direction,amount,bank_reference,idempotency_key) values ($1,$2,'incoming',100,'MB-1',gen_random_uuid())`,
      [orgA, c],
    ),
    /unique constraint/,
  );
});
test("a member of two shops cannot move a directory record between them", async () => {
  await user(a);
  const other = (
    await db.query(
      `select public.create_organization('Магазин A2','98765432-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as id`,
    )
  ).rows[0].id;
  const product = (
    await db.query(
      `insert into products(organization_id,name) values ($1,'Только в A') returning id`,
      [orgA],
    )
  ).rows[0].id;
  await assert.rejects(
    db.query("update products set organization_id=$1 where id=$2", [
      other,
      product,
    ]),
    /permission denied/,
  );
});
test("API read models preserve exact prices through JSON transport", async () => {
  await owner();
  await db.query(
    "update products set sale_price=99999999999999.99 where id=$1",
    [productA],
  );
  await user(a);
  const data = (
    await db.query(
      "select row_to_json(p) as payload from product_balances p where id=$1",
      [productA],
    )
  ).rows[0].payload;
  assert.equal(data.sale_price, "99999999999999.99");
  assert.equal(typeof data.stock, "string");
  const customer = (
    await db.query(
      "select row_to_json(c) as payload from customer_balances c limit 1",
    )
  ).rows[0].payload;
  assert.equal(typeof customer.balance, "string");
});
test("dashboard aggregates are exact and invisible to non-members", async () => {
  await user(a);
  const data = (await db.query("select dashboard_summary($1) as data", [orgA]))
    .rows[0].data;
  assert.equal(data.receivable, "4750.00");
  assert.equal(data.payable, "17500.00");
  assert.equal(typeof data.sold, "string");
  await user(b);
  const hidden = (
    await db.query("select dashboard_summary($1) as data", [orgA])
  ).rows[0].data;
  assert.equal(Number(hidden.receivable), 0);
  assert.equal(hidden.low_stock, 0);
});
test("editable fields remain writable while IDs and timestamps are protected", async () => {
  await user(a);
  await db.query("update products set name=$1,sale_price=$2 where id=$3", [
    "Лампа новая",
    "12.50",
    productA,
  ]);
  assert.equal(
    (await db.query("select name from products where id=$1", [productA]))
      .rows[0].name,
    "Лампа новая",
  );
  await assert.rejects(
    db.query("update products set id=gen_random_uuid() where id=$1", [
      productA,
    ]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("update products set created_at=now() where id=$1", [productA]),
    /permission denied/,
  );
});
test("anonymous callers cannot create or read a store", async () => {
  await owner();
  await db.exec(
    `SET ROLE anon;SELECT set_config('request.jwt.claim.sub','',false)`,
  );
  await assert.rejects(
    db.query(`select create_organization('Attacker',gen_random_uuid())`),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select * from organizations"),
    /permission denied/,
  );
});
