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
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz, raw_user_meta_data jsonb not null default '{}'); CREATE TABLE auth.mfa_factors(id uuid primary key default gen_random_uuid(), user_id uuid not null, factor_type text not null default 'totp', status text not null); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated; GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated; INSERT INTO auth.users VALUES ('${a}'),('${b}');`,
  );
  if (existsSync("supabase/migrations"))
    for (const f of readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.exec(
    "insert into private.shop_signup_codes(code,note) values ('CODEA00001','A'),('CODEB00001','B'),('CODEA00002','A2')",
  );
});
after(() => db.close());
/** Вход пользователя; aal2 — со вторым ключом (код из приложения), как у админа. */
async function user(id, aal = "aal2") {
  await db.exec(
    `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false); SELECT set_config('request.jwt.claims','{"sub":"${id}","aal":"${aal}"}',false);`,
  );
}
async function owner() {
  await db.exec("RESET ROLE;");
}
test("foundation tables exist and all tenant tables have RLS", async () => {
  const { rows } = await db.query(
    `select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'`,
  );
  assert.equal(rows.length, 33);
  assert.ok(rows.every((r) => r.relrowsecurity));
});
test("organization creation is idempotent and cannot enroll another user", async () => {
  await user(a);
  orgA = (
    await db.query(
      `select public.create_organization('Магазин A','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','codea00001') as id`,
    )
  ).rows[0].id;
  const retry = (
    await db.query(
      `select public.create_organization('Магазин A','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','codea00001') as id`,
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
      `select public.create_organization('Магазин B','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CODEB00001') as id`,
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
  // Повтор номера перевода не запрещён таблицей — commit_payment пишет его
  // как дубликат на проверке (см. «a repeated bank reference…»).
  await db.query(
    `insert into payments(organization_id,customer_id,direction,amount,bank_reference,idempotency_key) values ($1,$2,'incoming',100,'MB-1',gen_random_uuid())`,
    [orgA, c],
  );
});
test("a member of two shops cannot move a directory record between them", async () => {
  await user(a);
  const other = (
    await db.query(
      `select public.create_organization('Магазин A2','98765432-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CODEA00002') as id`,
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
    db.query(`select create_organization('Attacker',gen_random_uuid(),'CODEA00001')`),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select * from organizations"),
    /permission denied/,
  );
});
test("ERP commands post purchase, sale and payment atomically and idempotently", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'ERP customer') returning id",
      [orgA],
    )
  ).rows[0].id;
  const supplier = (
    await db.query(
      "insert into suppliers(organization_id,name) values ($1,'ERP supplier') returning id",
      [orgA],
    )
  ).rows[0].id;

  await user(a);
  const purchaseKey = "aaaaaaaa-0000-4000-8000-000000000001";
  const purchase = (
    await db.query("select commit_purchase($1,$2,$3,$4) as id", [
      orgA,
      supplier,
      "1000.00",
      purchaseKey,
    ])
  ).rows[0].id;
  assert.equal(
    (
      await db.query("select commit_purchase($1,$2,$3,$4) as id", [
        orgA,
        supplier,
        "1000.00",
        purchaseKey,
      ])
    ).rows[0].id,
    purchase,
  );
  await assert.rejects(
    db.query("select commit_purchase($1,$2,$3,$4)", [
      orgA,
      supplier,
      "2000.00",
      purchaseKey,
    ]),
    /idempotency_conflict/,
  );

  const saleKey = "aaaaaaaa-0000-4000-8000-000000000002";
  const sale = (
    await db.query("select commit_sale($1,$2,$3,$4,$5) as id", [
      orgA,
      customer,
      "500.00",
      false,
      saleKey,
    ])
  ).rows[0].id;
  assert.equal(
    (
      await db.query("select commit_sale($1,$2,$3,$4,$5) as id", [
        orgA,
        customer,
        "500.00",
        false,
        saleKey,
      ])
    ).rows[0].id,
    sale,
  );
  await assert.rejects(
    db.query("select commit_sale($1,$2,$3,$4,$5)", [
      orgA,
      customer,
      "999.00",
      false,
      saleKey,
    ]),
    /idempotency_conflict/,
  );
  const cashSaleKey = "aaaaaaaa-0000-4000-8000-000000000003";
  await db.query("select commit_sale($1,$2,$3,$4,$5)", [
    orgA,
    customer,
    "300.00",
    true,
    cashSaleKey,
  ]);

  const paymentKey = "aaaaaaaa-0000-4000-8000-000000000004";
  const payment = (
    await db.query("select commit_payment($1,$2,$3,$4,$5,$6) as id", [
      orgA,
      "incoming",
      customer,
      "100.00",
      null,
      paymentKey,
    ])
  ).rows[0].id;
  assert.equal(
    (
      await db.query("select commit_payment($1,$2,$3,$4,$5,$6) as id", [
        orgA,
        "incoming",
        customer,
        "100.00",
        null,
        paymentKey,
      ])
    ).rows[0].id,
    payment,
  );
  await assert.rejects(
    db.query("select commit_payment($1,$2,$3,$4,$5,$6)", [
      orgA,
      "incoming",
      customer,
      "120.00",
      null,
      paymentKey,
    ]),
    /idempotency_conflict/,
  );
  await db.query("select commit_payment($1,$2,$3,$4,$5,$6)", [
    orgA,
    "outgoing",
    supplier,
    "400.00",
    "BANK-ERP-1",
    "aaaaaaaa-0000-4000-8000-000000000005",
  ]);
  // Cash sale is settled on the spot and must not add to the customer's debt.
  assert.equal(
    (
      await db.query("select balance from customer_balances where id=$1", [
        customer,
      ])
    ).rows[0].balance,
    "400.00",
  );
  assert.equal(
    (
      await db.query("select balance from supplier_balances where id=$1", [
        supplier,
      ])
    ).rows[0].balance,
    "600.00",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from audit_events where organization_id=$1 and action in ('purchase.posted','sale.posted','payment.received','payment.paid')",
        [orgA],
      )
    ).rows[0].count,
    5,
  );
});
test("ERP commands reject non-members and malformed input", async () => {
  await user(b);
  await assert.rejects(
    db.query("select commit_payment($1,$2,$3,$4,$5,$6)", [
      orgA,
      "incoming",
      "00000000-0000-4000-8000-000000000001",
      "10",
      null,
      "bbbbbbbb-0000-4000-8000-000000000001",
    ]),
    /not_a_member/,
  );
  await user(a);
  await assert.rejects(
    db.query("select commit_sale($1,$2,$3,$4,$5)", [
      orgA,
      "00000000-0000-4000-8000-000000000001",
      "10.00",
      false,
      "bbbbbbbb-0000-4000-8000-000000000002",
    ]),
    /invalid_customer/,
  );
  await assert.rejects(
    db.query("select commit_purchase($1,$2,$3,$4)", [
      orgA,
      "00000000-0000-4000-8000-000000000001",
      "10.00",
      "bbbbbbbb-0000-4000-8000-000000000005",
    ]),
    /invalid_supplier/,
  );
  await assert.rejects(
    db.query("select commit_payment($1,$2,$3,$4,$5,$6)", [
      orgA,
      "incoming",
      "00000000-0000-4000-8000-000000000001",
      "-1",
      null,
      "bbbbbbbb-0000-4000-8000-000000000003",
    ]),
    /invalid_payment/,
  );
});
test("reversal removes an entry from the balance but keeps it visible in history", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'Сторно клиент') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const saleKey = "cccccccc-0000-4000-8000-000000000001";
  const sale = (
    await db.query("select commit_sale($1,$2,$3,$4,$5) as id", [
      orgA,
      customer,
      "1500.00",
      false,
      saleKey,
    ])
  ).rows[0].id;
  assert.equal(
    (
      await db.query("select balance from customer_balances where id=$1", [
        customer,
      ])
    ).rows[0].balance,
    "1500.00",
  );
  await assert.rejects(
    db.query("select reverse_sale($1,$2,$3)", [orgA, sale, ""]),
    /invalid_comment/,
  );
  await db.query("select reverse_sale($1,$2,$3)", [
    orgA,
    sale,
    "Ошиблись суммой",
  ]);
  assert.equal(
    (
      await db.query("select balance from customer_balances where id=$1", [
        customer,
      ])
    ).rows[0].balance,
    "0.00",
  );
  const row = (
    await db.query(
      "select reversed_at is not null as reversed, reversal_comment from sales where id=$1",
      [sale],
    )
  ).rows[0];
  assert.equal(row.reversed, true);
  assert.equal(row.reversal_comment, "Ошиблись суммой");
  await assert.rejects(
    db.query("select reverse_sale($1,$2,$3)", [orgA, sale, "Ещё раз"]),
    /invalid_sale/,
  );
});
test("client payment claims stay pending until the shop confirms or rejects them", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'Клиент по ссылке') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const token = (
    await db.query("select create_share_link($1,$2) as token", [
      orgA,
      customer,
    ])
  ).rows[0].token;
  assert.equal(token.length, 32);
  assert.equal(
    (
      await db.query("select create_share_link($1,$2) as token", [
        orgA,
        customer,
      ])
    ).rows[0].token,
    token,
  );

  await owner();
  const statement = (
    await db.query("select get_statement_by_token($1) as data", [token])
  ).rows[0].data;
  assert.equal(statement.customer_name, "Клиент по ссылке");
  assert.equal(statement.balance, "0.00");

  await db.query("select submit_payment_claim($1,$2,$3)", [
    token,
    "750.00",
    "Перевёл на карту",
  ]);
  assert.equal(
    (
      await db.query("select balance from customer_balances where id=$1", [
        customer,
      ])
    ).rows[0].balance,
    "0.00",
  );
  const pending = (
    await db.query(
      "select id,amount from payments where organization_id=$1 and customer_id=$2 and status='pending'",
      [orgA, customer],
    )
  ).rows[0];
  assert.equal(pending.amount, "750.00");

  await user(a);
  await db.query("select confirm_payment_claim($1,$2,$3)", [
    orgA,
    pending.id,
    "700.00",
  ]);
  assert.equal(
    (
      await db.query("select balance from customer_balances where id=$1", [
        customer,
      ])
    ).rows[0].balance,
    "-700.00",
  );
  await assert.rejects(
    db.query("select confirm_payment_claim($1,$2,$3)", [
      orgA,
      pending.id,
      "700.00",
    ]),
    /invalid_payment/,
  );
});
test("an invalid or revoked token cannot read a statement or submit a claim", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'Отозванная ссылка') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const token = (
    await db.query("select create_share_link($1,$2) as token", [
      orgA,
      customer,
    ])
  ).rows[0].token;
  const linkId = (
    await db.query("select id from share_links where token=$1", [token])
  ).rows[0].id;
  await db.query("select revoke_share_link($1,$2)", [orgA, linkId]);

  await owner();
  await assert.rejects(
    db.query("select get_statement_by_token($1)", [token]),
    /invalid_token/,
  );
  await assert.rejects(
    db.query("select submit_payment_claim($1,$2,$3)", [
      token,
      "100.00",
      "Не пройдёт",
    ]),
    /invalid_token/,
  );
  await assert.rejects(
    db.query("select get_statement_by_token($1)", ["not-a-real-token"]),
    /invalid_token/,
  );
});
test("photo document must belong to the same organization and matching kind", async () => {
  await owner();
  const supplier = (
    await db.query(
      "insert into suppliers(organization_id,name) values ($1,'С фото') returning id",
      [orgA],
    )
  ).rows[0].id;
  const wrongKindDoc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind) values ($1,'p1','h1','image/jpeg','sale') returning id",
      [orgA],
    )
  ).rows[0].id;
  const purchaseDoc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind) values ($1,'p2','h2','image/jpeg','purchase') returning id",
      [orgA],
    )
  ).rows[0].id;
  const foreignDoc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind) values ($1,'p3','h3','image/jpeg','purchase') returning id",
      [orgB],
    )
  ).rows[0].id;
  await user(a);
  await assert.rejects(
    db.query("select commit_purchase($1,$2,$3,$4,$5)", [
      orgA,
      supplier,
      "10.00",
      "dddddddd-1111-4000-8000-000000000001",
      wrongKindDoc,
    ]),
    /invalid_document/,
  );
  await assert.rejects(
    db.query("select commit_purchase($1,$2,$3,$4,$5)", [
      orgA,
      supplier,
      "10.00",
      "dddddddd-1111-4000-8000-000000000002",
      foreignDoc,
    ]),
    /invalid_document/,
  );
  const purchase = (
    await db.query("select commit_purchase($1,$2,$3,$4,$5) as id", [
      orgA,
      supplier,
      "10.00",
      "dddddddd-1111-4000-8000-000000000003",
      purchaseDoc,
    ])
  ).rows[0].id;
  assert.equal(
    (
      await db.query("select document_id from purchases where id=$1", [
        purchase,
      ])
    ).rows[0].document_id,
    purchaseDoc,
  );
});
test("recognition pipeline: digitized when totals match, review on mismatch, retry after failure", async () => {
  await owner();
  const supplier = (
    await db.query(
      "insert into suppliers(organization_id,name) values ($1,'ADRE поставщик') returning id",
      [orgA],
    )
  ).rows[0].id;
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind) values ($1,'adre1','adre-hash-1','image/jpeg','purchase') returning id",
      [orgA],
    )
  ).rows[0].id;
  await db.query(
    "insert into purchases(organization_id,supplier_id,total,status,idempotency_key,document_id) values ($1,$2,1000.00,'posted','aaaaaaaa-2222-4000-8000-000000000001',$3)",
    [orgA, supplier, doc],
  );

  await user(a);
  await assert.rejects(
    db.query("select fail_recognition($1,$2,$3)", [orgA, doc, "provider down"]),
    /invalid_document/,
  );
  await db.query("select start_recognition($1,$2)", [orgA, doc]);
  assert.equal(
    (await db.query("select status from documents where id=$1", [doc])).rows[0].status,
    "processing",
  );
  await assert.rejects(
    db.query("select start_recognition($1,$2)", [orgA, doc]),
    /already_running/,
  );

  const lines = JSON.stringify([
    { n: 1, name_raw: "Щит-4", qty: "4", unit: "шт", price: "240", confidence: 0.97 },
    { n: 2, name_raw: "Кабель", qty: "2", unit: "м", price: "20", confidence: 0.5 },
  ]);
  await db.query(
    "select save_recognition($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)",
    [orgA, doc, "gemini", "gemini-2.5-flash", "v1", "{}", lines, "digitized", 4200, 0.01],
  );
  assert.equal(
    (await db.query("select status from documents where id=$1", [doc])).rows[0].status,
    "digitized",
  );
  const savedLines = (
    await db.query(
      "select name_raw,sum,confidence from document_lines where document_id=$1 order by n",
      [doc],
    )
  ).rows;
  assert.equal(savedLines.length, 2);
  assert.equal(savedLines[0].sum, "960.00");
  assert.equal(Number(savedLines[1].confidence), 0.5);
  assert.equal(
    (await db.query("select provider,prompt_version from document_extractions where document_id=$1", [doc]))
      .rows[0].provider,
    "gemini",
  );

  await owner();
  const doc2 = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind) values ($1,'adre2','adre-hash-2','image/jpeg','purchase') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  await db.query("select start_recognition($1,$2)", [orgA, doc2]);
  await db.query("select fail_recognition($1,$2,$3)", [orgA, doc2, "timeout"]);
  assert.deepEqual(
    (await db.query("select status,error_message from documents where id=$1", [doc2])).rows[0],
    { status: "failed", error_message: "timeout" },
  );
  await db.query("select start_recognition($1,$2)", [orgA, doc2]);
  await db.query(
    "select save_recognition($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)",
    [orgA, doc2, "gemini", "gemini-2.5-flash", "v1", "{}", "[]", "review", 3000, 0.01],
  );
  assert.equal(
    (await db.query("select status from documents where id=$1", [doc2])).rows[0].status,
    "review",
  );
  await db.query("select confirm_document_lines($1,$2)", [orgA, doc2]);
  assert.equal(
    (await db.query("select status from documents where id=$1", [doc2])).rows[0].status,
    "digitized",
  );
  await assert.rejects(
    db.query("select confirm_document_lines($1,$2)", [orgA, doc2]),
    /invalid_document/,
  );
});
test("document_lines RLS: only the owning organization can read or edit recognized lines", async () => {
  await owner();
  const doc = (
    await db.query(
      "select id from documents where organization_id=$1 and storage_path='adre1'",
      [orgA],
    )
  ).rows[0].id;
  const line = (
    await db.query("select id from document_lines where document_id=$1 limit 1", [doc])
  ).rows[0].id;
  await user(a);
  await db.query("update document_lines set name_raw=$1 where id=$2", ["Щит-4 (правка)", line]);
  await user(b);
  assert.equal(
    (await db.query("select * from document_lines where id=$1", [line])).rows.length,
    0,
  );
  await db.query("update document_lines set name_raw=$1 where id=$2", [
    "Чужая правка",
    line,
  ]);
  await owner();
  assert.equal(
    (await db.query("select name_raw from document_lines where id=$1", [line]))
      .rows[0].name_raw,
    "Щит-4 (правка)",
  );
});
test("create_document reuses an existing document instead of failing on a repeat upload", async () => {
  await owner();
  const supplier = (
    await db.query(
      "insert into suppliers(organization_id,name) values ($1,'Повтор фото') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const first = (
    await db.query(
      "select create_document($1,$2,$3,$4,$5) as id",
      [orgA, "purchase", "path/one.jpg", "same-hash-retry", "image/jpeg"],
    )
  ).rows[0].id;
  const second = (
    await db.query(
      "select create_document($1,$2,$3,$4,$5) as id",
      [orgA, "purchase", "path/two.jpg", "same-hash-retry", "image/jpeg"],
    )
  ).rows[0].id;
  assert.equal(second, first);
  assert.equal(
    (
      await db.query("select count(*)::int as count from documents where organization_id=$1 and file_hash=$2", [
        orgA,
        "same-hash-retry",
      ])
    ).rows[0].count,
    1,
  );
  const purchase = (
    await db.query("select commit_purchase($1,$2,$3,$4,$5) as id", [
      orgA,
      supplier,
      "10.00",
      "eeeeeeee-1111-4000-8000-000000000001",
      first,
    ])
  ).rows[0].id;
  assert.equal(
    (await db.query("select document_id from purchases where id=$1", [purchase]))
      .rows[0].document_id,
    first,
  );
});
test("add_counterparty_alias learns a synonym once, isolated per organization", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'Медербек уулу') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  await db.query("select add_counterparty_alias($1,$2,$3,$4)", [
    orgA,
    "customer",
    customer,
    "Медербек",
  ]);
  await db.query("select add_counterparty_alias($1,$2,$3,$4)", [
    orgA,
    "customer",
    customer,
    "Медербек",
  ]);
  assert.deepEqual(
    (await db.query("select aliases from customers where id=$1", [customer])).rows[0].aliases,
    ["Медербек"],
  );
  await assert.rejects(
    db.query("select add_counterparty_alias($1,$2,$3,$4)", [
      orgA,
      "customer",
      "00000000-0000-4000-8000-000000000001",
      "Кто-то",
    ]),
    /invalid_customer/,
  );
  await user(b);
  await assert.rejects(
    db.query("select add_counterparty_alias($1,$2,$3,$4)", [
      orgA,
      "customer",
      customer,
      "Чужой",
    ]),
    /not_a_member/,
  );
});
test("create_document reuses a photo across kinds until it backs a record", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'Фото сменило вид') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const create = async (kind, path) =>
    (
      await db.query("select create_document($1,$2,$3,$4,$5) as id", [
        orgA,
        kind,
        path,
        "same-hash-kind-switch",
        "image/jpeg",
      ])
    ).rows[0].id;
  const asPurchase = await create("purchase", "path/p.jpg");
  const asSale = await create("sale", "path/s.jpg");
  assert.equal(asSale, asPurchase);
  assert.equal(
    (await db.query("select kind from documents where id=$1", [asSale])).rows[0].kind,
    "sale",
  );
  await db.query("select commit_sale($1,$2,$3,$4,$5,$6)", [
    orgA,
    customer,
    "54270.00",
    false,
    "eeeeeeee-2222-4000-8000-000000000001",
    asSale,
  ]);
  await assert.rejects(create("purchase", "path/p2.jpg"), /document_in_use/);
});
test("cache_extraction stores a Gemini result without touching document status, members only", async () => {
  await user(a);
  const doc = (
    await db.query("select create_document($1,$2,$3,$4,$5) as id", [
      orgA,
      "sale",
      "path/cache.jpg",
      "cache-hash-1",
      "image/jpeg",
    ])
  ).rows[0].id;
  const args = (org, payload) => [org, doc, "gemini", "gemini-3.8-flash", "v1", payload, 1200, 0.0012];
  const sql = "select cache_extraction($1,$2,$3,$4,$5,$6,$7,$8)";
  await db.query(sql, args(orgA, { kind: "invoice", extracted: { total_computed: 54270 } }));
  await assert.rejects(db.query(sql, args(orgA, { extracted: {} })), /invalid_extraction/);
  assert.equal(
    (await db.query("select status from documents where id=$1", [doc])).rows[0].status,
    "uploaded",
  );
  assert.equal(
    (
      await db.query(
        "select payload->'extracted'->>'total_computed' as total from document_extractions where document_id=$1 and payload->>'kind'='invoice'",
        [doc],
      )
    ).rows[0].total,
    "54270",
  );
  await user(b);
  await assert.rejects(
    db.query(sql, args(orgA, { kind: "invoice", extracted: {} })),
    /not_a_member/,
  );
});
test("duplicate photos: blocked by default, allowed with a warning when the shop opts in, freed by reversal", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'Дубликаты фото') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const create = async (path) =>
    (
      await db.query("select create_document($1,$2,$3,$4,$5) as id", [
        orgA,
        "sale",
        path,
        "dup-hash-1",
        "image/jpeg",
      ])
    ).rows[0].id;
  const sale = async (doc, key) =>
    (
      await db.query("select commit_sale($1,$2,$3,$4,$5,$6) as id", [
        orgA,
        customer,
        "100.00",
        false,
        key,
        doc,
      ])
    ).rows[0].id;
  const isDuplicate = async (doc) =>
    (await db.query("select document_is_duplicate($1,$2) as dup", [orgA, doc])).rows[0].dup;

  const first = await create("dup/1.jpg");
  assert.equal(await isDuplicate(first), false);
  const firstSale = await sale(first, "dddddddd-0000-4000-8000-000000000001");

  // По умолчанию — запрет.
  await assert.rejects(create("dup/2.jpg"), /document_in_use/);

  // Магазин разрешил повторы — новый документ, запись проходит, флаг дубликата.
  await db.query("update organizations set block_duplicate_photos=false where id=$1", [orgA]);
  const second = await create("dup/2.jpg");
  assert.notEqual(second, first);
  assert.equal(await isDuplicate(second), true);
  await sale(second, "dddddddd-0000-4000-8000-000000000002");

  // Снова запрет; после сторно обеих записей фото свободно.
  await db.query("update organizations set block_duplicate_photos=true where id=$1", [orgA]);
  await assert.rejects(create("dup/3.jpg"), /document_in_use/);
  const secondSale = (
    await db.query("select id from sales where organization_id=$1 and document_id=$2", [
      orgA,
      second,
    ])
  ).rows[0].id;
  for (const id of [firstSale, secondSale])
    await db.query("select reverse_sale($1,$2,$3)", [orgA, id, "Задвоили"]);
  const third = await create("dup/3.jpg");
  assert.equal(await isDuplicate(third), false);
  await sale(third, "dddddddd-0000-4000-8000-000000000003");
});
test("find_similar_records: same invoice content or same party+amount within 30 days, via fingerprint", async () => {
  await owner();
  const customer = (
    await db.query(
      "insert into customers(organization_id,name) values ($1,'Похожие записи') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const fp = "a".repeat(64);
  const doc = async (hash) =>
    (
      await db.query("select create_document($1,'sale',$2,$3,'image/jpeg') as id", [
        orgA,
        "similar/" + hash,
        hash,
      ])
    ).rows[0].id;
  const similar = async (document, party, amount) =>
    (
      await db.query("select * from find_similar_records($1,'sale',$2,$3,$4)", [
        orgA,
        document,
        party,
        amount,
      ])
    ).rows;

  // Первая продажа с отпечатком.
  const firstDoc = await doc("similar-hash-1");
  await db.query("select set_document_fingerprint($1,$2,$3)", [orgA, firstDoc, fp]);
  const firstSale = (
    await db.query("select commit_sale($1,$2,'777.00',false,$3,$4) as id", [
      orgA,
      customer,
      "5e5e5e5e-0000-4000-8000-000000000001",
      firstDoc,
    ])
  ).rows[0].id;

  // Та же накладная, другой файл фото — совпадение по содержимому.
  const rephoto = await doc("similar-hash-2");
  await db.query("select set_document_fingerprint($1,$2,$3)", [orgA, rephoto, fp]);
  let rows = await similar(rephoto, null, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].r_id, firstSale);
  assert.equal(rows[0].r_reason, "content");
  assert.equal(rows[0].r_party, "Похожие записи");

  // Другое фото, но тот же клиент и сумма.
  const other = await doc("similar-hash-3");
  rows = await similar(other, customer, "777.00");
  assert.deepEqual(
    rows.map((r) => r.r_reason),
    ["party_amount"],
  );
  assert.equal((await similar(other, customer, "778.00")).length, 0);

  // Старше 30 дней — не похожа по сумме, но по содержимому находится всегда.
  await owner();
  await db.query("update sales set occurred_at=now()-interval '31 days' where id=$1", [firstSale]);
  await user(a);
  assert.equal((await similar(other, customer, "777.00")).length, 0);
  assert.equal((await similar(rephoto, null, null)).length, 1);

  // Сторнированная запись не считается.
  await db.query("select reverse_sale($1,$2,'Ошибка')", [orgA, firstSale]);
  assert.equal((await similar(rephoto, null, null)).length, 0);

  // Чужой магазин — нет доступа.
  await user(b);
  await assert.rejects(similar(rephoto, null, null), /not_a_member/);
  await assert.rejects(
    db.query("select set_document_fingerprint($1,$2,$3)", [orgA, rephoto, fp]),
    /not_a_member/,
  );
});

test("document_pages: extra pages belong to one shop, attach once, never touch existing documents", async () => {
  await user(a);
  const before = (
    await db.query("select id,storage_path,file_hash from documents order by id")
  ).rows;
  const doc = (
    await db.query("select create_document($1,'purchase',$2,'pages-set-hash','image/jpeg') as id", [
      orgA,
      `${orgA}/purchase/p1.jpg`,
    ])
  ).rows[0].id;
  const pages = [
    { storage_path: `${orgA}/purchase/p2.jpg`, file_hash: "h2", mime_type: "image/jpeg" },
    { storage_path: `${orgA}/purchase/p3.jpg`, file_hash: "h3", mime_type: "image/jpeg" },
  ];
  await db.query("select add_document_pages($1,$2,$3)", [orgA, doc, JSON.stringify(pages)]);
  // Повтор (create_document вернул тот же документ) — ничего не добавляет.
  await db.query("select add_document_pages($1,$2,$3)", [orgA, doc, JSON.stringify(pages)]);
  assert.deepEqual(
    (
      await db.query("select page_no,storage_path from document_pages where document_id=$1 order by page_no", [doc])
    ).rows,
    [
      { page_no: 2, storage_path: `${orgA}/purchase/p2.jpg` },
      { page_no: 3, storage_path: `${orgA}/purchase/p3.jpg` },
    ],
  );
  // Существующие документы не изменились — добавился только новый.
  const after = (await db.query("select id,storage_path,file_hash from documents order by id")).rows;
  assert.deepEqual(
    after.filter((d) => d.id !== doc),
    before,
  );

  // Файл страницы из чужой папки не принимается.
  const other = (
    await db.query("select create_document($1,'purchase',$2,'pages-foreign','image/jpeg') as id", [
      orgA,
      `${orgA}/purchase/q1.jpg`,
    ])
  ).rows[0].id;
  await assert.rejects(
    db.query("select add_document_pages($1,$2,$3)", [
      orgA,
      other,
      JSON.stringify([{ storage_path: `${orgB}/purchase/x.jpg`, file_hash: "x", mime_type: "image/jpeg" }]),
    ]),
    /invalid_pages/,
  );

  // Другой магазин не видит страниц и не может их добавить.
  await user(b);
  assert.equal((await db.query("select * from document_pages")).rows.length, 0);
  await assert.rejects(
    db.query("select add_document_pages($1,$2,$3)", [orgA, other, JSON.stringify(pages)]),
    /not_a_member/,
  );
  await assert.rejects(
    db.query("select add_document_pages($1,$2,$3)", [orgB, doc, JSON.stringify(pages)]),
    /invalid_document|invalid_pages/,
  );
  await assert.rejects(
    db.query(
      "insert into document_pages(organization_id,document_id,page_no,storage_path,file_hash,mime_type) values($1,$2,2,'x','x','image/jpeg')",
      [orgA, doc],
    ),
    /permission denied/,
  );
});

test("import_opening_balance: notebook debts become ledger entries once per party, per shop", async () => {
  await user(a);
  const imp = (kind, party, name, amount, key) =>
    db.query("select import_opening_balance($1,$2,$3,$4,'',$5,$6) as id", [orgA, kind, party, name, amount, key]);
  const balance = async (view, id) =>
    Number((await db.query(`select balance from ${view} where id=$1`, [id])).rows[0].balance);

  // Новый клиент по имени — создаётся, долг из тетради сразу в балансе.
  const customer = (await imp("customer", null, "Тетрадь Асан", "12500.50", "0c000000-0000-4000-8000-000000000001")).rows[0].id;
  assert.equal(await balance("customer_balances", customer), 12500.5);
  // Повтор с тем же ключом — тот же результат, без задвоения.
  assert.equal(
    (await imp("customer", null, "Тетрадь Асан", "12500.50", "0c000000-0000-4000-8000-000000000001")).rows[0].id,
    customer,
  );
  assert.equal(await balance("customer_balances", customer), 12500.5);
  // Тот же клиент (имя без учёта регистра) вторым переносом — отказ.
  await assert.rejects(
    imp("customer", null, "тетрадь асан", "100", "0c000000-0000-4000-8000-000000000002"),
    /opening_exists/,
  );
  const sale = (
    await db.query("select id,is_opening,document_id from sales where customer_id=$1", [customer])
  ).rows[0];
  assert.equal(sale.is_opening, true);
  assert.equal(sale.document_id, null);

  // Аванс поставщику (отрицательная сумма) — оплата с пометкой.
  const supplier = (await imp("supplier", null, "Тетрадь Склад", "-3000", "0c000000-0000-4000-8000-000000000003")).rows[0].id;
  assert.equal(await balance("supplier_balances", supplier), -3000);

  // После отмены переноса можно внести правильную сумму.
  await db.query("select reverse_sale($1,$2,'ошибся суммой')", [orgA, sale.id]);
  await imp("customer", customer, null, "9000", "0c000000-0000-4000-8000-000000000004");
  assert.equal(await balance("customer_balances", customer), 9000);

  // Обычные записи не помечены.
  assert.equal(
    (await db.query("select count(*)::int as n from sales where is_opening and customer_id<>$1", [customer])).rows[0].n,
    0,
  );

  // Другой магазин: не может писать в чужой и не видит чужого.
  await user(b);
  await assert.rejects(
    db.query("select import_opening_balance($1,'customer',null,'Чужой','','100',$2)", [
      orgA,
      "0c000000-0000-4000-8000-000000000005",
    ]),
    /not_a_member/,
  );
  await assert.rejects(
    db.query("select import_opening_balance($1,'customer',$2,null,'','100',$3)", [
      orgB,
      customer,
      "0c000000-0000-4000-8000-000000000006",
    ]),
    /invalid_party/,
  );
  assert.equal((await db.query("select * from sales where customer_id=$1", [customer])).rows.length, 0);

  await user(a);
  await assert.rejects(imp("customer", null, "Ноль", "0", "0c000000-0000-4000-8000-000000000007"), /invalid_opening/);
});

test("close_day: one immutable snapshot per shop and day, no future days", async () => {
  await user(a);
  const first = (
    await db.query("select close_day($1,'2026-09-20',$2) as id", [orgA, JSON.stringify({ sold: "100.00" })])
  ).rows[0].id;
  // Повтор — тот же снимок, не перезаписывается.
  const again = (
    await db.query("select close_day($1,'2026-09-20',$2) as id", [orgA, JSON.stringify({ sold: "999.00" })])
  ).rows[0].id;
  assert.equal(again, first);
  assert.equal(
    (await db.query("select snapshot->>'sold' as sold from day_closures where id=$1", [first])).rows[0].sold,
    "100.00",
  );
  await assert.rejects(
    db.query("select close_day($1,(now() at time zone 'Asia/Bishkek')::date + 1,'{}')", [orgA]),
    /invalid_day/,
  );
  await assert.rejects(db.query("select close_day($1,'2026-09-19','[]')", [orgA]), /invalid_day/);
  await assert.rejects(
    db.query("update day_closures set snapshot='{}' where id=$1", [first]),
    /permission denied/,
  );

  await user(b);
  assert.equal((await db.query("select * from day_closures")).rows.length, 0);
  // Чужой магазин: не хозяин — отказ.
  await assert.rejects(db.query("select close_day($1,'2026-09-21','{}')", [orgA]), /owner_only/);
});
test("get_invoice_by_token: only a digitized, active sale of the link's own customer", async () => {
  await owner();
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'Клиент с накладной') returning id", [orgA])
  ).rows[0].id;
  const other = (
    await db.query("insert into customers(organization_id,name) values ($1,'Другой клиент') returning id", [orgA])
  ).rows[0].id;
  const newSale = async (party, key, status) => {
    const doc = (
      await db.query(
        "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,$2,'image/jpeg','sale',$3) returning id",
        [orgA, "inv-" + key, status],
      )
    ).rows[0].id;
    const sale = (
      await db.query(
        "insert into sales(organization_id,customer_id,total,status,idempotency_key,document_id) values ($1,$2,960.00,'posted',$3,$4) returning id",
        [orgA, party, `cccccccc-7777-4000-8000-00000000000${key}`, doc],
      )
    ).rows[0].id;
    return { doc, sale };
  };
  const ok = await newSale(customer, 1, "digitized");
  await db.query(
    "insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,1,'Щит-4',4,'шт',240)",
    [orgA, ok.doc],
  );
  await db.query(
    "insert into document_extractions(organization_id,document_id,payload,model_version,provider,prompt_version) values ($1,$2,$3,'m','gemini','v3')",
    [orgA, ok.doc, JSON.stringify({ kind: "invoice", extracted: { number: " 15 " } })],
  );
  const review = await newSale(customer, 2, "review");
  const foreign = await newSale(other, 3, "digitized");
  const reversed = await newSale(customer, 4, "digitized");
  await user(a);
  await db.query("select reverse_sale($1,$2,$3)", [orgA, reversed.sale, "Ошибка"]);
  const token = (await db.query("select create_share_link($1,$2) as token", [orgA, customer])).rows[0].token;

  await owner();
  await db.exec("SET ROLE anon;");
  const invoice = (await db.query("select get_invoice_by_token($1,$2) as data", [token, ok.sale])).rows[0].data;
  assert.equal(invoice.customer_name, "Клиент с накладной");
  assert.equal(invoice.total, "960.00");
  assert.equal(invoice.lines.length, 1);
  assert.equal(invoice.lines[0].sum, "960.00");
  // Шапка по образцу: номер среди продаж магазина и долг после этой накладной
  // (отменённая позже продажа не считается).
  assert.equal(typeof invoice.number, "number");
  assert.ok(invoice.number > 0);
  // Номер с фото — отдельно, без пробелов по краям.
  assert.equal(invoice.paper_number, "15");
  assert.equal(invoice.debt_after, "960.00");
  assert.equal(invoice.customer_phone, "");
  for (const sale of [review.sale, foreign.sale, reversed.sale])
    await assert.rejects(db.query("select get_invoice_by_token($1,$2)", [token, sale]), /invalid_invoice/);

  const statement = (await db.query("select get_statement_by_token($1) as data", [token])).rows[0].data;
  const flags = Object.fromEntries(statement.entries.map((e) => [e.id, e.invoice]));
  assert.equal(flags[ok.sale], true);
  assert.equal(flags[review.sale], false);

  await owner();
  await user(a);
  const linkId = (await db.query("select id from share_links where token=$1", [token])).rows[0].id;
  await db.query("select revoke_share_link($1,$2)", [orgA, linkId]);
  await owner();
  await assert.rejects(db.query("select get_invoice_by_token($1,$2)", [token, ok.sale]), /invalid_token/);
});

test("a repeated bank reference is saved as a pending duplicate that does not move the debt", async () => {
  await owner();
  await user(a);
  const customer = (await db.query(
    "insert into customers(organization_id,name) values($1,'Клиент дубликата') returning id", [orgA],
  )).rows[0].id;
  const balance = async () =>
    (await db.query("select balance from customer_balances where id=$1", [customer])).rows[0].balance;
  const pay = async (key, ref = "DUP-REF-1") =>
    (await db.query("select commit_payment($1,'incoming',$2,'100.00',$3,$4) as id", [orgA, customer, ref, key])).rows[0].id;
  const row = async (id) =>
    (await db.query("select status,duplicate_of from payments where id=$1", [id])).rows[0];

  const first = await pay("dddd0001-3232-4000-8000-000000000001");
  assert.deepEqual(await row(first), { status: "confirmed", duplicate_of: null });
  assert.equal(await balance(), "-100.00");

  const second = await pay("dddd0001-3232-4000-8000-000000000002");
  assert.deepEqual(await row(second), { status: "pending", duplicate_of: first });
  assert.equal(await balance(), "-100.00");
  // Повтор того же запроса — та же запись, не третья.
  assert.equal(await pay("dddd0001-3232-4000-8000-000000000002"), second);

  // Владелец подтверждает — долг меняется; отклоняет — нет.
  const third = await pay("dddd0001-3232-4000-8000-000000000003");
  assert.equal((await row(third)).duplicate_of, first);
  await db.query("select confirm_payment_claim($1,$2,null)", [orgA, second]);
  assert.equal(await balance(), "-200.00");
  await db.query("select reject_payment_claim($1,$2,'Двойная запись')", [orgA, third]);
  assert.equal(await balance(), "-200.00");

  // Отменённая оплата номер не занимает.
  const fresh = await pay("dddd0001-3232-4000-8000-000000000004", "DUP-REF-2");
  await db.query("select reverse_payment($1,$2,'Ошибка в сумме')", [orgA, fresh]);
  const again = await pay("dddd0001-3232-4000-8000-000000000005", "DUP-REF-2");
  assert.deepEqual(await row(again), { status: "confirmed", duplicate_of: null });
  await owner();
});

test("client claim with an already counted receipt is marked duplicate (same photo or same transfer number)", async () => {
  await owner();
  await user(a);
  const customer = (await db.query(
    "insert into customers(organization_id,name) values($1,'Клиент с повтором чека') returning id", [orgA],
  )).rows[0].id;
  const token = (await db.query("select create_share_link($1,$2) as token", [orgA, customer])).rows[0].token;
  // Оплата продавца с чеком (фото hash-dup-1) и номером перевода.
  await owner();
  const doc = (await db.query(
    "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values($1,'x/1.jpg','hash-dup-1','image/jpeg','payment','uploaded') returning id",
    [orgA],
  )).rows[0].id;
  await user(a);
  const first = (await db.query(
    "select commit_payment($1,'incoming',$2,'100.00','CLAIM-REF-1','dddd0001-3333-4000-8000-000000000001',$3) as id",
    [orgA, customer, doc],
  )).rows[0].id;

  await owner();
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  const claimDoc = async (path, hash) =>
    (await db.query("select create_claim_document($1,$2,$3,'image/jpeg') as id", [token, path, hash])).rows[0].id;
  const claim = async (document) =>
    (await db.query("select submit_payment_claim($1,'100.00',null,$2) as id", [token, document])).rows[0].id;
  const row = async (id) => {
    await owner();
    const r = (await db.query("select status,duplicate_of,bank_reference from payments where id=$1", [id])).rows[0];
    await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
    return r;
  };

  // 1) То же фото — дубликат сразу.
  const samePhoto = await claim(await claimDoc(`claims/${token}/a.jpg`, "hash-dup-1"));
  assert.deepEqual(await row(samePhoto), { status: "pending", duplicate_of: first, bank_reference: null });

  // 2) Другое фото, но тот же номер перевода после распознавания.
  const otherPhoto = await claim(await claimDoc(`claims/${token}/b.jpg`, "hash-dup-2"));
  assert.equal((await row(otherPhoto)).duplicate_of, null);
  const extraction = { kind: "receipt", extracted: { operation_id: "CLAIM-REF-1" } };
  await db.query("select note_claim_receipt($1,$2,'CLAIM-REF-1','gemini','m','v3',$3,100,0.0005)", [token, otherPhoto, extraction]);
  assert.deepEqual(await row(otherPhoto), { status: "pending", duplicate_of: first, bank_reference: "CLAIM-REF-1" });

  // Тот же файл, что у заявки-дубликата, — ссылка на исходную оплату, не на заявку.
  const chained = await claim(await claimDoc(`claims/${token}/b2.jpg`, "hash-dup-2"));
  assert.equal((await row(chained)).duplicate_of, first);
  // Номер перевода важнее совпадения по фото (и тоже на исходную).
  await db.query("select note_claim_receipt($1,$2,'CLAIM-REF-1','gemini','m','v3',null,null,null)", [token, chained]);
  assert.equal((await row(chained)).duplicate_of, first);
  await owner();
  const docStatus = (await db.query(
    "select d.status from documents d join payments p on p.document_id=d.id where p.id=$1", [otherPhoto],
  )).rows[0].status;
  assert.equal(docStatus, "digitized");
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");

  // 3) Новый номер — не дубликат, номер сохраняется.
  const fresh = await claim(await claimDoc(`claims/${token}/c.jpg`, "hash-dup-3"));
  await db.query("select note_claim_receipt($1,$2,'CLAIM-REF-NEW','gemini','m','v3',null,null,null)", [token, fresh]);
  assert.deepEqual(await row(fresh), { status: "pending", duplicate_of: null, bank_reference: "CLAIM-REF-NEW" });

  // Чужая оплата по этому токену не трогается.
  await assert.rejects(
    db.query("select note_claim_receipt($1,$2,'X','g','m','v',null,null,null)", [token, first]),
    /invalid_payment/,
  );
  await owner();
  const cached = (await db.query(
    "select count(*)::int as n from document_extractions where document_id=(select document_id from payments where id=$1)", [otherPhoto],
  )).rows[0].n;
  assert.equal(cached, 1);
});

test("client claim in another currency is converted to the debt currency, original kept until the owner edits the amount", async () => {
  await owner();
  await user(a);
  const customer = (await db.query(
    "insert into customers(organization_id,name,currency) values($1,'Клиент в рублях','RUB') returning id", [orgA],
  )).rows[0].id;
  const token = (await db.query("select create_share_link($1,$2) as token", [orgA, customer])).rows[0].token;
  await owner();
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  const claim = async () =>
    (await db.query("select submit_payment_claim($1,null,null,null,'1250','KGS','1.0365') as id", [token])).rows[0].id;
  const first = await claim();
  const second = await claim();
  await assert.rejects(
    db.query("select submit_payment_claim($1,null,null,null,'1250','RUB','1')", [token]),
    /invalid_currency/,
  );
  await owner();
  const row = async (id) =>
    (await db.query("select amount,original_amount,original_currency,fx_rate from payments where id=$1", [id])).rows[0];
  assert.deepEqual(await row(first), { amount: "1205.98", original_amount: "1250.00", original_currency: "KGS", fx_rate: "1.036500" });

  await user(a);
  await db.query("select confirm_payment_claim($1,$2,'1205.98')", [orgA, first]);
  assert.equal((await row(first)).original_currency, "KGS");
  await db.query("select confirm_payment_claim($1,$2,'1200.00')", [orgA, second]);
  assert.deepEqual(await row(second), { amount: "1200.00", original_amount: null, original_currency: null, fx_rate: null });

  // 10 $ по другому курсу: владелец меняет курс — доллары остаются, рубли пересчитаны.
  await owner();
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  const dollars = (await db.query("select submit_payment_claim($1,null,null,null,'10','USD','84.4283') as id", [token])).rows[0].id;
  const statement = (await db.query("select get_statement_by_token($1) as s", [token])).rows[0].s;
  assert.deepEqual(statement.originals[dollars], { amount: "10.00", currency: "USD", rate: "84.428300" });
  await user(a);
  await db.query("select confirm_payment_claim($1,$2,null,'10','USD','90')", [orgA, dollars]);
  await owner();
  assert.deepEqual(await row(dollars), { amount: "900.00", original_amount: "10.00", original_currency: "USD", fx_rate: "90.000000" });
});

test("anon checks a claim token without reading share_links", async () => {
  await owner();
  await user(a);
  const customer = (await db.query(
    "select id from customers where organization_id=$1 and archived_at is null limit 1", [orgA],
  )).rows[0].id;
  const token = (await db.query("select create_share_link($1,$2) as token", [orgA, customer])).rows[0].token;
  await owner();
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  const active = async (t) => (await db.query("select claim_token_active($1) as ok", [t])).rows[0].ok;
  assert.equal(await active(token), true);
  assert.equal(await active("0".repeat(32)), false);
  assert.equal(await active(null), false);
  await assert.rejects(db.query("select 1 from share_links"), /permission denied/);
  await owner();
});
test("document_lines: a discount line may have a negative price, quantity stays positive", async () => {
  await owner();
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,'disc','disc-hash','image/jpeg','sale','processing') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const lines = JSON.stringify([
    { n: 1, name_raw: "Розетка", qty: "10", unit: "шт", price: "85", confidence: 1 },
    { n: 2, name_raw: "Скидка", qty: "1", unit: "шт", price: "-200", confidence: 1 },
  ]);
  await db.query("select save_recognition($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)", [
    orgA, doc, "gemini", "m", "v1", "{}", lines, "digitized", 1, 0,
  ]);
  assert.equal(
    (await db.query("select sum(sum)::text as total from document_lines where document_id=$1", [doc])).rows[0].total,
    "650.00",
  );
  await owner();
  await assert.rejects(
    db.query(
      "insert into document_lines(organization_id,document_id,n,name_raw,qty,price) values ($1,$2,3,'Минус',-1,10)",
      [orgA, doc],
    ),
    /document_lines_qty_check/,
  );
});
test("commit_payment keeps the receipt date, rejects future or year-old dates", async () => {
  await owner();
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'Оплата с датой') returning id", [orgA])
  ).rows[0].id;
  await user(a);
  const call = (key, at) =>
    db.query("select commit_payment($1,'incoming',$2,'500.00',null,$3,null,$4) as id", [orgA, customer, key, at]);
  const at = new Date(Date.now() - 3 * 86400_000).toISOString();
  const id = (await call("dddddddd-8888-4000-8000-000000000001", at)).rows[0].id;
  assert.equal(
    (await db.query("select occurred_at from payments where id=$1", [id])).rows[0].occurred_at.toISOString(),
    at,
  );
  assert.equal((await call("dddddddd-8888-4000-8000-000000000001", at)).rows[0].id, id);
  await assert.rejects(
    call("dddddddd-8888-4000-8000-000000000001", new Date(Date.now() - 86400_000).toISOString()),
    /idempotency_conflict/,
  );
  await assert.rejects(
    call("dddddddd-8888-4000-8000-000000000002", new Date(Date.now() + 86400_000).toISOString()),
    /invalid_date/,
  );
  await assert.rejects(
    call("dddddddd-8888-4000-8000-000000000003", new Date(Date.now() - 400 * 86400_000).toISOString()),
    /invalid_date/,
  );
  const plain = (
    await db.query(
      "select commit_payment($1,'incoming',$2,'100.00',null,'dddddddd-8888-4000-8000-000000000004') as id",
      [orgA, customer],
    )
  ).rows[0].id;
  assert.equal(
    (await db.query("select occurred_at > now() - interval '1 minute' as fresh from payments where id=$1", [plain]))
      .rows[0].fresh,
    true,
  );
});
test("customers.credit_limit: optional, non-negative, editable by members and shown with the balance", async () => {
  await owner();
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'С лимитом') returning id", [orgA])
  ).rows[0].id;
  await user(a);
  assert.equal(
    (await db.query("select credit_limit from customer_balances where id=$1", [customer])).rows[0].credit_limit,
    null,
  );
  await db.query("update customers set credit_limit='50000.00' where id=$1", [customer]);
  const row = (await db.query("select credit_limit,balance from customer_balances where id=$1", [customer])).rows[0];
  assert.equal(row.credit_limit, "50000.00");
  assert.equal(row.balance, "0.00");
  await assert.rejects(
    db.query("update customers set credit_limit='-1' where id=$1", [customer]),
    /credit_limit_check/,
  );
  await user(b);
  assert.equal((await db.query("select * from customer_balances where id=$1", [customer])).rows.length, 0);
});
test("customer_debt_aging: payments cover the oldest sales first, the rest ages from the sale day", async () => {
  await owner();
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'Должник по давности') returning id", [orgA])
  ).rows[0].id;
  const sale = (daysAgo, total, key, extra = "") =>
    db.query(
      `insert into sales(organization_id,customer_id,total,status,idempotency_key,occurred_at${extra ? ",paid_immediately" : ""})
       values ($1,$2,$3,'posted',$4,now() - make_interval(days => $5)${extra ? ",true" : ""})`,
      [orgA, customer, total, `eeeeeeee-9999-4000-8000-00000000000${key}`, daysAgo],
    );
  await sale(100, "1000.00", 1);
  await sale(45, "2000.00", 2);
  await sale(10, "3000.00", 3);
  await sale(200, "9999.00", 4, "cash"); // за наличные — не долг
  await db.query(
    "insert into payments(organization_id,customer_id,direction,amount,status,idempotency_key) values ($1,$2,'incoming',1500.00,'confirmed','eeeeeeee-9999-4000-8000-000000000005')",
    [orgA, customer],
  );
  await db.query("update customers set promised_date=current_date + 3 where id=$1", [customer]);

  await user(a);
  const aging = (await db.query("select * from customer_debt_aging where customer_id=$1", [customer])).rows[0];
  // 1500 гасит продажу 100 дней назад (1000) и 500 из продажи 45 дней назад.
  assert.equal(aging.due_over_90, "0.00");
  assert.equal(aging.due_61_90, "0.00");
  assert.equal(aging.due_31_60, "1500.00");
  assert.equal(aging.due_0_30, "3000.00");
  assert.equal(aging.oldest_days, 45);
  const balance = (await db.query("select balance,promised_date from customer_balances where id=$1", [customer])).rows[0];
  assert.equal(balance.balance, "4500.00");
  assert.ok(balance.promised_date);

  // Полностью оплатил — строки нет.
  await owner();
  await db.query(
    "insert into payments(organization_id,customer_id,direction,amount,status,idempotency_key) values ($1,$2,'incoming',4500.00,'confirmed','eeeeeeee-9999-4000-8000-000000000006')",
    [orgA, customer],
  );
  await user(a);
  assert.equal((await db.query("select * from customer_debt_aging where customer_id=$1", [customer])).rows.length, 0);
  await user(b);
  assert.equal((await db.query("select * from customer_debt_aging")).rows.length, 0);
});
test("commit_adjustment: discount/return lower the debt like a payment, need a note, reversible, per shop", async () => {
  await owner();
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'Клиент со скидкой') returning id", [orgA])
  ).rows[0].id;
  const supplier = (
    await db.query("insert into suppliers(organization_id,name) values ($1,'Поставщик с возвратом') returning id", [orgA])
  ).rows[0].id;
  await db.query(
    "insert into sales(organization_id,customer_id,total,status,idempotency_key) values ($1,$2,5000.00,'posted','ffffffff-1111-4000-8000-000000000001')",
    [orgA, customer],
  );
  await db.query(
    "insert into purchases(organization_id,supplier_id,total,status,idempotency_key) values ($1,$2,8000.00,'posted','ffffffff-1111-4000-8000-000000000002')",
    [orgA, supplier],
  );
  await user(a);
  const adjust = (direction, party, kind, amount, note, key) =>
    db.query("select commit_adjustment($1,$2,$3,$4,$5,$6,$7) as id", [orgA, direction, party, kind, amount, note, key]);
  const discount = (await adjust("incoming", customer, "discount", "500.00", "Постоянному клиенту", "ffffffff-1111-4000-8000-000000000003")).rows[0].id;
  await adjust("outgoing", supplier, "return", "1200.00", "Вернули 2 автомата", "ffffffff-1111-4000-8000-000000000004");
  // Повтор — та же запись.
  assert.equal(
    (await adjust("incoming", customer, "discount", "500.00", "Постоянному клиенту", "ffffffff-1111-4000-8000-000000000003")).rows[0].id,
    discount,
  );
  const balance = async (view, id) => (await db.query(`select balance from ${view} where id=$1`, [id])).rows[0].balance;
  assert.equal(await balance("customer_balances", customer), "4500.00");
  assert.equal(await balance("supplier_balances", supplier), "6800.00");
  assert.equal(
    (await db.query("select due_0_30 from customer_debt_aging where customer_id=$1", [customer])).rows[0].due_0_30,
    "4500.00",
  );
  await assert.rejects(adjust("incoming", customer, "discount", "100.00", "  ", "ffffffff-1111-4000-8000-000000000005"), /invalid_note/);
  await assert.rejects(adjust("incoming", customer, "gift", "100.00", "x", "ffffffff-1111-4000-8000-000000000006"), /invalid_adjustment/);
  await assert.rejects(adjust("incoming", supplier, "discount", "100.00", "x", "ffffffff-1111-4000-8000-000000000007"), /invalid_party/);

  await db.query("select reverse_payment($1,$2,$3)", [orgA, discount, "Ошиблись"]);
  assert.equal(await balance("customer_balances", customer), "5000.00");

  await owner();
  const row = (await db.query("select kind,note from payments where id=$1", [discount])).rows[0];
  assert.deepEqual(row, { kind: "discount", note: "Постоянному клиенту" });
  await assert.rejects(
    db.query(
      "insert into payments(organization_id,customer_id,direction,amount,status,kind,idempotency_key) values ($1,$2,'incoming',1,'confirmed','discount','ffffffff-1111-4000-8000-000000000008')",
      [orgA, customer],
    ),
    /payments_adjustment_note/,
  );
  await user(b);
  await assert.rejects(
    db.query("select commit_adjustment($1,'incoming',$2,'discount','1.00','x','ffffffff-1111-4000-8000-000000000009')", [orgA, customer]),
    /not_a_member/,
  );
});
test("staff roles: invite link, seller can sell but not reverse/discount/close day, owner manages staff", async () => {
  const c = "33333333-3333-4333-8333-333333333333";
  await owner();
  await db.query("insert into auth.users values ($1) on conflict do nothing", [c]);
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'Клиент продавца') returning id", [orgA])
  ).rows[0].id;

  await user(a);
  // Сотрудники — на любом тарифе, лимит — из plan_limits (по умолчанию «Базовый»).
  const token = (await db.query("select create_invite($1,'Айбек') as t", [orgA])).rows[0].t;
  assert.equal(token.length, 32);

  await owner();
  await db.exec("SET ROLE anon;");
  assert.deepEqual((await db.query("select get_invite($1) as v", [token])).rows[0].v, {
    shop_name: "Магазин A",
    display_name: "Айбек",
  });

  await user(c);
  await db.exec(`SELECT set_config('request.jwt.claims','{"email":"aibek@example.com"}',false);`);
  assert.equal((await db.query("select accept_invite($1) as org", [token])).rows[0].org, orgA);
  await assert.rejects(db.query("select accept_invite($1)", [token]), /invalid_invite/);
  const mine = (await db.query("select role,display_name,email from organization_members")).rows;
  assert.deepEqual(mine, [{ role: "staff", display_name: "Айбек", email: "aibek@example.com" }]);

  // Продавец оформляет — запись помечена автором.
  const sale = (
    await db.query("select commit_sale($1,$2,'700.00',false,'abababab-0000-4000-8000-000000000001') as id", [orgA, customer])
  ).rows[0].id;
  // …но хозяйские действия ему закрыты.
  await assert.rejects(db.query("select reverse_sale($1,$2,'x')", [orgA, sale]), /owner_only/);
  await assert.rejects(
    db.query("select commit_adjustment($1,'incoming',$2,'discount','10.00','x','abababab-0000-4000-8000-000000000002')", [orgA, customer]),
    /owner_only/,
  );
  await assert.rejects(db.query("select close_day($1,'2026-09-22','{}')", [orgA]), /owner_only/);
  await assert.rejects(db.query("select create_invite($1,'Ещё')", [orgA]), /owner_only/);
  await assert.rejects(db.query("select remove_member($1,$2)", [orgA, a]), /owner_only/);

  await owner();
  assert.equal((await db.query("select created_by from sales where id=$1", [sale])).rows[0].created_by, c);

  await user(a);
  assert.equal((await db.query("select * from organization_members where organization_id=$1", [orgA])).rows.length, 2);
  await assert.rejects(db.query("select accept_invite($1)", [(await db.query("select create_invite($1,'Сам') as t", [orgA])).rows[0].t]), /already_member/);
  // «Базовый» — 5: продавец Айбек + «Сам» (приглашение) + ещё 3 — шестое нельзя.
  for (const name of ["П1", "П2", "П3"]) await db.query("select create_invite($1,$2)", [orgA, name]);
  await assert.rejects(db.query("select create_invite($1,'П4')", [orgA]), /staff_limit/);
  // «Бизнес» — 20; лимит меняется одной строкой в plan_limits, без кода.
  await owner();
  await db.query("update organizations set plan='business' where id=$1", [orgA]);
  await user(a);
  await db.query("select create_invite($1,'П4')", [orgA]);
  await owner();
  await db.query("update plan_limits set max_staff=6 where plan='business'");
  await user(a);
  await assert.rejects(db.query("select create_invite($1,'П5')", [orgA]), /staff_limit/);
  // Менять лимиты из приложения нельзя — только читать.
  assert.deepEqual(
    (await db.query("select plan,max_staff from plan_limits order by plan")).rows,
    [{ plan: "basic", max_staff: 5 }, { plan: "business", max_staff: 6 }],
  );
  await assert.rejects(db.query("update plan_limits set max_staff=100"), /permission denied/);
  await owner();
  await db.query("update plan_limits set max_staff=20 where plan='business'");
  await user(a);
  await assert.rejects(db.query("select remove_member($1,$2)", [orgA, a]), /cannot_remove_self/);
  await db.query("select remove_member($1,$2)", [orgA, c]);

  await user(c);
  assert.equal((await db.query("select * from organization_members")).rows.length, 0);
  await assert.rejects(db.query("select commit_sale($1,$2,'1.00',false,'abababab-0000-4000-8000-000000000003')", [orgA, customer]), /not_a_member/);
});

test("create_organization: without a code — a free month; a given code must be unused and means no end date", async () => {
  await owner();
  const code = (await db.query("insert into private.shop_signup_codes(note) values ('тест') returning code")).rows[0].code;
  assert.match(code, /^[0-9A-F]{10}$/);
  const fresh = "3a3a3a3a-3333-4333-8333-333333333333";
  await db.query("insert into auth.users(id) values ($1)", [fresh]);
  await user(fresh);
  const trial = (
    await db.query("select create_organization('Без кода','cccccccc-0000-4000-8000-000000000001','') as id")
  ).rows[0].id;
  await owner();
  const { rows: trialRows } = await db.query(
    `select paid_until = ((now() at time zone 'Asia/Bishkek')::date + interval '1 month')::date as month,
       (select metadata->>'trial' from audit_events where entity_id=o.id and action='organization.created') as trial
     from organizations o where id=$1`,
    [trial],
  );
  assert.deepEqual(trialRows[0], { month: true, trial: "true" });
  // Второй магазин без кода — нельзя (новый бесплатный месяц, а открыт был бы только первый).
  await user(fresh);
  await assert.rejects(
    db.query("select create_organization('Ещё один','cccccccc-0000-4000-8000-000000000005','')"),
    /shop_exists/,
  );
  await user(b);
  await assert.rejects(
    db.query("select create_organization('Чужой код','cccccccc-0000-4000-8000-000000000002','CODEA00001')"),
    /invalid_code/, // уже погашен магазином A
  );
  const id = (
    await db.query("select create_organization('С кодом','cccccccc-0000-4000-8000-000000000003',$1) as id", [code.toLowerCase()])
  ).rows[0].id;
  // Повтор того же запроса — тот же магазин, код не нужен.
  assert.equal(
    (await db.query("select create_organization('С кодом','cccccccc-0000-4000-8000-000000000003','') as id")).rows[0].id,
    id,
  );
  await assert.rejects(
    db.query("select create_organization('Ещё раз','cccccccc-0000-4000-8000-000000000004',$1)", [code]),
    /invalid_code/,
  );
  await assert.rejects(db.query("select * from private.shop_signup_codes"), /permission denied/);
  await owner();
  assert.equal((await db.query("select organization_id from private.shop_signup_codes where code=$1", [code])).rows[0].organization_id, id);
  assert.equal((await db.query("select paid_until from organizations where id=$1", [id])).rows[0].paid_until, null);
});

test("platform admin: codes, shop overview without money data, plan, block stops writes and the client page", async () => {
  await owner();
  await db.query("update auth.users set email='owner-a@example.com' where id=$1", [a]);
  await user(a);
  await assert.rejects(db.query("select * from admin_shops()"), /admin_only/);
  assert.equal((await db.query("select am_i_platform_admin() as v")).rows[0].v, false);
  await owner();
  await db.query("insert into private.platform_admins(user_id) values ($1)", [b]);

  await user(b);
  assert.equal((await db.query("select am_i_platform_admin() as v")).rows[0].v, true);
  const code = (await db.query("select admin_create_code('Малик, Манас') as c")).rows[0].c;
  const codes = (await db.query("select * from admin_codes()")).rows;
  assert.ok(codes.some((c) => c.code === code && c.note === "Малик, Манас" && c.used_at === null));
  await db.query("select admin_delete_code($1)", [code]);
  await assert.rejects(db.query("select admin_delete_code('CODEA00001')"), /invalid_code/); // использованный не удалить

  const shopA = (await db.query("select * from admin_shops() where id=$1", [orgA])).rows[0];
  assert.equal(shopA.owner_email, "owner-a@example.com");
  assert.equal(shopA.signup_code, "CODEA00001");
  assert.ok(shopA.customers > 0 && shopA.records_30d > 0);
  // Денежные данные магазина админу не видны напрямую.
  assert.equal((await db.query("select * from customers where organization_id=$1", [orgA])).rows.length, 0);

  await owner();
  const customer = (await db.query("select id from customers where organization_id=$1 limit 1", [orgA])).rows[0].id;
  await user(a);
  const link = (await db.query("select create_share_link($1,$2) as t", [orgA, customer])).rows[0].t;
  await owner();
  await db.exec("SET ROLE anon;");
  assert.ok((await db.query("select get_statement_by_token($1) as d", [link])).rows[0].d);

  await user(b);
  await db.query("select admin_set_plan($1,'basic','2026-12-31')", [orgA]);
  await db.query("select admin_set_blocked($1,true,'Не оплачено')", [orgA]);

  // ТЗ §13: страница клиента открывается и у приостановленного магазина,
  // заявка «Я оплатил» принимается (долг не меняет).
  await owner();
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  assert.ok((await db.query("select get_statement_by_token($1) as d", [link])).rows[0].d);
  await db.query("select submit_payment_claim($1,'100.00','Перевёл')", [link]);
  await user(a);
  await assert.rejects(
    db.query("select commit_sale($1,$2,'1.00',false,'bbbbbbbb-9999-4000-8000-000000000001')", [orgA, customer]),
    /shop_blocked/,
  );
  await assert.rejects(db.query("insert into customers(organization_id,name) values ($1,'Новый')", [orgA]), /shop_blocked/);
  assert.ok((await db.query("select * from customers where organization_id=$1", [orgA])).rows.length > 0); // читать можно
  // Владелец не может сам снять блокировку или сменить тариф.
  await user(a);
  await assert.rejects(db.query("update organizations set blocked_at=null where id=$1", [orgA]), /permission denied/);
  await assert.rejects(db.query("select admin_set_blocked($1,false,null)", [orgA]), /admin_only/);

  await user(b);
  await db.query("select admin_set_blocked($1,false,null)", [orgA]);
  await db.query("select admin_set_plan($1,'business',null)", [orgA]);
  await user(a);
  await db.query("insert into customers(organization_id,name) values ($1,'После разблокировки')", [orgA]);
  await owner();
  await db.query("delete from private.platform_admins where user_id=$1", [b]);
});

test("view-only after the paid period: 7 grace days, then no new records; unpaid pilot shops unaffected", async () => {
  await owner();
  const shop = (await db.query("insert into organizations(name,created_by,creation_key) values ('Льгота',$1,gen_random_uuid()) returning id", [a])).rows[0].id;
  await db.query("insert into organization_members(organization_id,user_id) values ($1,$2)", [shop, a]);
  const add = (name) => db.query("insert into customers(organization_id,name) values ($1,$2)", [shop, name]);
  await user(a);
  await add("Без оплаты — пилот"); // paid_until null
  await owner();
  await db.query("update organizations set paid_until=(now() at time zone 'Asia/Bishkek')::date - 7 where id=$1", [shop]);
  await user(a);
  await add("Седьмой льготный день");
  await owner();
  await db.query("update organizations set paid_until=(now() at time zone 'Asia/Bishkek')::date - 8 where id=$1", [shop]);
  await user(a);
  await assert.rejects(add("Льгота кончилась"), /shop_blocked/);
  assert.equal((await db.query("select count(*)::int as n from customers where organization_id=$1", [shop])).rows[0].n, 2);
});
test("undo_recent: the author cancels a just-made record without a reason, only within 2 minutes", async () => {
  await owner();
  const customer = (await db.query("insert into customers(organization_id,name) values ($1,'Ошиблись клиентом') returning id", [orgA])).rows[0].id;
  await user(a);
  const sale = (await db.query("select commit_sale($1,$2,'300.00',false,'dededede-0000-4000-8000-000000000001') as id", [orgA, customer])).rows[0].id;
  await user(b);
  await assert.rejects(db.query("select undo_recent($1,'sale',$2)", [orgA, sale]), /not_a_member/);
  await user(a);
  await db.query("select undo_recent($1,'sale',$2)", [orgA, sale]);
  assert.equal((await db.query("select balance from customer_balances where id=$1", [customer])).rows[0].balance, "0.00");
  assert.equal((await db.query("select reversal_comment from sales where id=$1", [sale])).rows[0].reversal_comment, "Отменено сразу после записи");
  await assert.rejects(db.query("select undo_recent($1,'sale',$2)", [orgA, sale]), /undo_expired/); // уже отменена

  const old = (await db.query("select commit_sale($1,$2,'400.00',false,'dededede-0000-4000-8000-000000000002') as id", [orgA, customer])).rows[0].id;
  await owner();
  await db.query("update sales set created_at=now() - interval '3 minutes' where id=$1", [old]);
  await user(a);
  await assert.rejects(db.query("select undo_recent($1,'sale',$2)", [orgA, old]), /undo_expired/);
});

test("delete / archive / merge counterparties: delete only without records, merge moves everything and can be undone", async () => {
  await owner();
  const mk = async (name) => (await db.query("insert into customers(organization_id,name) values ($1,$2) returning id", [orgA, name])).rows[0].id;
  const empty = await mk("Пустой по ошибке");
  const timur1 = await mk("Тимур аке");
  const timur2 = await mk("Тимур ака");
  await user(a);
  await db.query("select commit_sale($1,$2,'1000.00',false,'afafafaf-0000-4000-8000-000000000001')", [orgA, timur1]);
  await db.query("select commit_sale($1,$2,'500.00',false,'afafafaf-0000-4000-8000-000000000002')", [orgA, timur2]);
  const link2 = (await db.query("select create_share_link($1,$2) as t", [orgA, timur2])).rows[0].t;

  await db.query("select delete_party($1,'customers',$2)", [orgA, empty]);
  assert.equal((await db.query("select * from customers where id=$1", [empty])).rows.length, 0);
  await assert.rejects(db.query("select delete_party($1,'customers',$2)", [orgA, timur1]), /has_records/);

  await db.query("select set_party_archived($1,'customers',$2,true)", [orgA, timur1]);
  assert.ok((await db.query("select archived_at from customer_balances where id=$1", [timur1])).rows[0].archived_at);
  await db.query("select set_party_archived($1,'customers',$2,false)", [orgA, timur1]);

  const merge = (await db.query("select merge_party($1,'customers',$2,$3) as id", [orgA, timur2, timur1])).rows[0].id;
  const into = (await db.query("select balance,aliases from customer_balances where id=$1", [timur1])).rows[0];
  assert.equal(into.balance, "1500.00");
  assert.ok(into.aliases.includes("Тимур ака"));
  const from = (await db.query("select merged_into_id,archived_at from customers where id=$1", [timur2])).rows[0];
  assert.equal(from.merged_into_id, timur1);
  assert.ok(from.archived_at);
  // Ссылка второго теперь показывает общий долг остающегося.
  await owner();
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  assert.equal((await db.query("select get_statement_by_token($1) as d", [link2])).rows[0].d.balance, "1500.00");

  await user(a);
  await db.query("select undo_merge($1,$2)", [orgA, merge]);
  assert.equal((await db.query("select balance from customer_balances where id=$1", [timur1])).rows[0].balance, "1000.00");
  assert.equal((await db.query("select balance,merged_into_id from customer_balances where id=$1", [timur2])).rows[0].balance, "500.00");
  assert.ok(!(await db.query("select aliases from customers where id=$1", [timur1])).rows[0].aliases.includes("Тимур ака"));
  await assert.rejects(db.query("select undo_merge($1,$2)", [orgA, merge]), /undo_expired/);

  // Два действующих переноса из тетради — объединять нельзя.
  await db.query("select import_opening_balance($1,'customer',$2,null,null,'100.00','afafafaf-0000-4000-8000-000000000003')", [orgA, timur1]);
  await db.query("select import_opening_balance($1,'customer',$2,null,null,'200.00','afafafaf-0000-4000-8000-000000000004')", [orgA, timur2]);
  await assert.rejects(db.query("select merge_party($1,'customers',$2,$3)", [orgA, timur2, timur1]), /opening_conflict/);
});
test("save_recognition keeps good lines when one line is broken and explains it in plain words", async () => {
  await owner();
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,'partial','partial-hash','image/jpeg','sale','processing') returning id",
      [orgA],
    )
  ).rows[0].id;
  await user(a);
  const lines = JSON.stringify([
    { n: 1, name_raw: "Розетка", qty: "10", unit: "шт", price: "85", confidence: 1 },
    { n: 2, name_raw: "Кабель", qty: "0", unit: "м", price: "20", confidence: 1 }, // qty > 0 — нарушено
    { n: 3, name_raw: "Автомат", qty: "5", unit: "шт", price: "abc", confidence: 1 }, // не число
    { n: 4, name_raw: "Щит", qty: "1", unit: "шт", price: "240", confidence: 1 },
  ]);
  await db.query("select save_recognition($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)", [
    orgA, doc, "gemini", "m", "v1", "{}", lines, "digitized", 1, 0,
  ]);
  const saved = (await db.query("select n from document_lines where document_id=$1 order by n", [doc])).rows.map((r) => r.n);
  assert.deepEqual(saved, [1, 4]);
  const d = (await db.query("select status,error_message from documents where id=$1", [doc])).rows[0];
  assert.equal(d.status, "review");
  assert.equal(d.error_message, "Не разобрали строки 2, 3 — проверьте их на фото и добавьте вручную.");
  // Строки, которые не разобрали, — вручную; лишнюю — удалить.
  const added = (await db.query("select add_document_line($1,$2,'Кабель','100','м','20') as id", [orgA, doc])).rows[0].id;
  assert.equal((await db.query("select n,sum from document_lines where id=$1", [added])).rows[0].n, 5);
  await db.query("select delete_document_line($1,$2)", [orgA, added]);
  await assert.rejects(db.query("select add_document_line($1,$2,'Минус','-1','шт','10')", [orgA, doc]), /qty_check/);
  await user(b);
  await assert.rejects(db.query("select add_document_line($1,$2,'Чужое','1','шт','1')", [orgA, doc]), /not_a_member/);
});
test("organizations.document_names: shop names on documents, editable by members, at most 20", async () => {
  await user(a);
  await db.query("update organizations set document_names=$2 where id=$1", [orgA, ["Maliknur", "D MALIKNUR SATAROV"]]);
  assert.deepEqual(
    (await db.query("select document_names from organizations where id=$1", [orgA])).rows[0].document_names,
    ["Maliknur", "D MALIKNUR SATAROV"],
  );
  await assert.rejects(
    db.query("update organizations set document_names=$2 where id=$1", [orgA, Array.from({ length: 21 }, (_, i) => `n${i}`)]),
    /check constraint/,
  );
  // Чужой магазин не меняется (RLS).
  await user(b);
  await db.query("update organizations set document_names='{x}' where id=$1", [orgA]);
  await owner();
  assert.deepEqual(
    (await db.query("select document_names from organizations where id=$1", [orgA])).rows[0].document_names,
    ["Maliknur", "D MALIKNUR SATAROV"],
  );
});
test("currencies: debt in the party's currency, other currencies converted at the record's rate", async () => {
  await user(a);
  const horoz = (
    await db.query("insert into suppliers(organization_id,name,currency) values ($1,'Хороз USD','USD') returning id", [orgA])
  ).rows[0].id;
  const client = (
    await db.query("insert into customers(organization_id,name) values ($1,'Клиент в сомах') returning id", [orgA])
  ).rows[0].id;
  // Приход в долларах поставщика — без пересчёта.
  await db.query("select commit_purchase($1,$2,$3,$4)", [orgA, horoz, "3006.96", "cccc0001-0000-4000-8000-000000000001"]);
  // Оплата сомами по 87,80: слабая → сильная — делим.
  const pay = (
    await db.query("select commit_payment($1,'outgoing',$2,null,null,$3,null,null,$4,'KGS',$5) as id", [
      orgA, horoz, "cccc0001-0000-4000-8000-000000000002", "87800", "87.80",
    ])
  ).rows[0].id;
  const payment = (await db.query("select amount,original_amount,original_currency,fx_rate from payments where id=$1", [pay])).rows[0];
  assert.deepEqual(
    [payment.amount, payment.original_amount, payment.original_currency, payment.fx_rate],
    ["1000.00", "87800.00", "KGS", "87.800000"],
  );
  assert.equal(
    (await db.query("select balance,currency from supplier_balances where id=$1", [horoz])).rows[0].balance,
    "2006.96",
  );
  // Повтор — та же запись; другой курс с тем же ключом — конфликт.
  assert.equal(
    (await db.query("select commit_payment($1,'outgoing',$2,null,null,$3,null,null,$4,'KGS',$5) as id", [
      orgA, horoz, "cccc0001-0000-4000-8000-000000000002", "87800", "87.8",
    ])).rows[0].id,
    pay,
  );
  await assert.rejects(
    db.query("select commit_payment($1,'outgoing',$2,null,null,$3,null,null,$4,'KGS',$5)", [
      orgA, horoz, "cccc0001-0000-4000-8000-000000000002", "87800", "88",
    ]),
    /idempotency_conflict/,
  );
  // Курс и сумма записи зафиксированы: ни поменять напрямую, ни пересчитать задним числом.
  await assert.rejects(db.query("update payments set fx_rate=90 where id=$1", [pay]), /permission denied/);
  await assert.rejects(db.query("update payments set amount=1 where id=$1", [pay]), /permission denied/);
  // Долларовая накладная клиенту в сомах: сильная → слабая — умножаем.
  const sale = (
    await db.query("select commit_sale($1,$2,null,false,$3,null,$4,'USD',$5) as id", [
      orgA, client, "cccc0001-0000-4000-8000-000000000003", "100.50", "87.8",
    ])
  ).rows[0].id;
  assert.equal((await db.query("select total from sales where id=$1", [sale])).rows[0].total, "8823.90");
  // Та же валюта, нулевой курс, мусор — отказ.
  await assert.rejects(
    db.query("select commit_sale($1,$2,null,false,$3,null,'10','KGS','1')", [orgA, client, "cccc0001-0000-4000-8000-000000000004"]),
    /invalid_currency/,
  );
  await assert.rejects(
    db.query("select commit_sale($1,$2,null,false,$3,null,'10','USD','0')", [orgA, client, "cccc0001-0000-4000-8000-000000000005"]),
    /invalid_currency/,
  );
  // Валюту не меняют, когда есть записи; без записей — можно.
  await assert.rejects(db.query("update suppliers set currency='KGS' where id=$1", [horoz]), /currency_locked/);
  await assert.rejects(db.query("update organizations set currency='RUB' where id=$1", [orgA]), /currency_locked/);
  const fresh = (
    await db.query("insert into customers(organization_id,name) values ($1,'Новый клиент') returning id", [orgA])
  ).rows[0].id;
  await db.query("update customers set currency='USD' where id=$1", [fresh]);
  assert.equal((await db.query("select currency from customer_balances where id=$1", [fresh])).rows[0].currency, "USD");
  // Объединить клиентов с разной валютой нельзя.
  await assert.rejects(
    db.query("select merge_party($1,'customers',$2,$3)", [orgA, client, fresh]),
    /currency_mismatch/,
  );
});

test("expenses: any member records, owner reverses, author undoes, other shops see nothing", async () => {
  await owner();
  await db.query("insert into organization_members(organization_id,user_id,role) values ($1,$2,'staff') on conflict do nothing", [orgA, b]);
  await user(b);
  const key = "e0e0e0e0-0000-4000-8000-000000000001";
  // Продавец вносит расход: сегодня по умолчанию, валюта — магазина.
  const id = (
    await db.query("select commit_expense($1,'1500.50','transport','Доставка цемента',null,null,$2) as id", [orgA, key])
  ).rows[0].id;
  const row = (await db.query("select amount,currency,spent_on,created_by from expenses where id=$1", [id])).rows[0];
  assert.equal(row.amount, "1500.50");
  assert.equal(row.created_by, b);
  // Повтор с тем же ключом — та же запись; с другими данными — конфликт.
  assert.equal(
    (await db.query("select commit_expense($1,'1500.50','transport','Доставка цемента',null,null,$2) as id", [orgA, key])).rows[0].id,
    id,
  );
  await assert.rejects(
    db.query("select commit_expense($1,'1600','transport','Доставка цемента',null,null,$2)", [orgA, key]),
    /idempotency_conflict/,
  );
  // «Прочее» без комментария, будущая дата, чужая папка фото — отказ.
  await assert.rejects(
    db.query("select commit_expense($1,'100','other','  ',null,null,'e0e0e0e0-0000-4000-8000-000000000002')", [orgA]),
    /invalid_note/,
  );
  await assert.rejects(
    db.query("select commit_expense($1,'100','food',null,current_date+5,null,'e0e0e0e0-0000-4000-8000-000000000003')", [orgA]),
    /invalid_date/,
  );
  // Фото — документ расхода своего магазина; документ продажи или чужой — отказ.
  const doc = (
    await db.query("select create_document($1,'expense','x/expense/1.jpg','hash-expense-1','image/jpeg') as id", [orgA])
  ).rows[0].id;
  const saleDoc = (
    await db.query("select create_document($1,'sale','x/sale/1.jpg','hash-expense-2','image/jpeg') as id", [orgA])
  ).rows[0].id;
  await assert.rejects(
    db.query("select commit_expense($1,'100','food',null,null,$2,'e0e0e0e0-0000-4000-8000-000000000004')", [orgA, saleDoc]),
    /invalid_document/,
  );
  const withPhoto = (
    await db.query(
      "select commit_expense($1,'250','food',null,current_date-1,$2,'e0e0e0e0-0000-4000-8000-000000000005') as id",
      [orgA, doc],
    )
  ).rows[0].id;
  // Фото занято действующим расходом — второй раз не приложить (повторы запрещены по умолчанию).
  await assert.rejects(
    db.query("select create_document($1,'expense','x/expense/2.jpg','hash-expense-1','image/jpeg')", [orgA]),
    /document_in_use/,
  );
  // Напрямую в таблицу не пишут и не правят.
  await assert.rejects(db.query("update expenses set amount=1 where id=$1", [id]), /permission denied/);
  // Продавец не отменяет с причиной; автор отменяет свой расход в первые 2 минуты.
  await assert.rejects(db.query("select reverse_expense($1,$2,'ошибка')", [orgA, id]), /owner_only/);
  await db.query("select undo_recent($1,'expense',$2)", [orgA, withPhoto]);
  assert.ok((await db.query("select reversed_at from expenses where id=$1", [withPhoto])).rows[0].reversed_at);
  // Владелец отменяет с причиной.
  await user(a);
  await db.query("select reverse_expense($1,$2,'Задвоили')", [orgA, id]);
  assert.equal((await db.query("select reversal_comment from expenses where id=$1", [id])).rows[0].reversal_comment, "Задвоили");
  await assert.rejects(db.query("select reverse_expense($1,$2,'ещё раз')", [orgA, id]), /invalid_expense/);
  // Магазин B расходов A не видит.
  await owner();
  await db.query("delete from organization_members where organization_id=$1 and user_id=$2", [orgA, b]);
  await user(b);
  assert.equal((await db.query("select count(*)::int as n from expenses where organization_id=$1", [orgA])).rows[0].n, 0);
  await assert.rejects(
    db.query("select commit_expense($1,'100','food',null,null,null,'e0e0e0e0-0000-4000-8000-000000000006')", [orgA]),
    /not_a_member/,
  );
});

test("warehouse: products with codes, sale lines write off stock, reversal returns it, receive and import", async () => {
  await user(a);
  const stock = async (id) => (await db.query("select stock from product_balances where id=$1", [id])).rows[0].stock;
  // Код необязателен и сам не придумывается; занятый код и повтор названия — отказ.
  const cable = (
    await db.query("select save_product($1,null,'Кабель ВВГнг 3х2,5',null,'м','85.50','60','10',array['ввг 3*2.5'],'100') as id", [orgA])
  ).rows[0].id;
  const cement = (await db.query("select save_product($1,null,'Цемент М400','C-400','мешок','520') as id", [orgA])).rows[0].id;
  const row = (await db.query("select sku,unit,aliases from products where id=$1", [cable])).rows[0];
  assert.equal(row.sku, null);
  assert.deepEqual([row.unit, row.aliases], ["м", ["ввг 3*2.5"]]);
  assert.equal(await stock(cable), "100.000");
  await assert.rejects(db.query("select save_product($1,null,'Другое','c-400','шт','1')", [orgA]), /sku_taken/);
  await assert.rejects(db.query("select save_product($1,null,' цемент   м400 ',null,'шт','1')", [orgA]), /name_taken/);
  await assert.rejects(db.query("select save_product($1,null,'Труба',null,'ведро','1')", [orgA]), /invalid_unit/);
  // Правка: цена меняется, код остаётся.
  await db.query("select save_product($1,$2,'Цемент М400',null,'мешок','540')", [orgA, cement]);
  assert.deepEqual(
    Object.values((await db.query("select sku,sale_price from products where id=$1", [cement])).rows[0]),
    ["C-400", "540.00"],
  );

  // «Пришло», «списать» (с причиной), «пересчёт»; повтор ключа — без второго движения.
  const k = (n) => `aaaa5555-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  assert.equal(Number((await db.query("select adjust_stock($1,$2,'receipt','40',null,$3) as s", [orgA, cement, k(1)])).rows[0].s), 40);
  assert.equal(Number((await db.query("select adjust_stock($1,$2,'receipt','40',null,$3) as s", [orgA, cement, k(1)])).rows[0].s), 40);
  await assert.rejects(db.query("select adjust_stock($1,$2,'writeoff','2',' ',$3)", [orgA, cement, k(2)]), /note_required/);
  await db.query("select adjust_stock($1,$2,'writeoff','2','Порван мешок',$3)", [orgA, cement, k(3)]);
  await db.query("select adjust_stock($1,$2,'count','35',null,$3)", [orgA, cement, k(4)]);
  assert.equal(await stock(cement), "35.000");

  // Продажа строками: сумма = сумма строк, строки и остаток списаны.
  const buyer = (await db.query("insert into customers(organization_id,name) values ($1,'Прораб Нурлан') returning id", [orgA])).rows[0].id;
  const lines = JSON.stringify([
    { product: cable, qty: "12.5", price: "85.50" },
    { product: cement, qty: "10", price: "540" },
  ]);
  const saleKey = k(10);
  const sale = (await db.query("select commit_sale_items($1,$2,$3,false,$4) as id", [orgA, buyer, lines, saleKey])).rows[0].id;
  assert.equal((await db.query("select total,document_id from sales where id=$1", [sale])).rows[0].total, "6468.75");
  assert.deepEqual(
    (await db.query("select n,name_snapshot,unit,qty,line_total from sale_items where sale_id=$1 order by n", [sale])).rows.map(Object.values),
    [[1, "Кабель ВВГнг 3х2,5", "м", "12.500", "1068.75"], [2, "Цемент М400", "мешок", "10.000", "5400.00"]],
  );
  assert.equal(await stock(cable), "87.500");
  assert.equal(await stock(cement), "25.000");
  assert.equal((await db.query("select balance from customer_balances where id=$1", [buyer])).rows[0].balance, "6468.75");
  // Повтор — та же продажа; другие строки с тем же ключом — конфликт; пустая/кривая — отказ.
  assert.equal((await db.query("select commit_sale_items($1,$2,$3,false,$4) as id", [orgA, buyer, lines, saleKey])).rows[0].id, sale);
  await assert.rejects(
    db.query("select commit_sale_items($1,$2,$3,false,$4)", [orgA, buyer, JSON.stringify([{ product: cable, qty: "1", price: "85.50" }]), saleKey]),
    /idempotency_conflict/,
  );
  await assert.rejects(db.query("select commit_sale_items($1,$2,'[]',false,$3)", [orgA, buyer, k(5)]), /invalid_sale/);
  await assert.rejects(
    db.query("select commit_sale_items($1,$2,$3,false,$4)", [orgA, buyer, JSON.stringify([{ product: cable, qty: "0", price: "1" }]), k(6)]),
    /invalid_line/,
  );
  // Клиент в долларах: строки в сомах магазина, долг — по курсу.
  const usdBuyer = (await db.query("insert into customers(organization_id,name,currency) values ($1,'Клиент $','USD') returning id", [orgA])).rows[0].id;
  const usdSale = (
    await db.query("select commit_sale_items($1,$2,$3,false,$4,'87.8') as id", [
      orgA, usdBuyer, JSON.stringify([{ product: cement, qty: "1", price: "878" }]), k(7),
    ])
  ).rows[0].id;
  assert.deepEqual(
    Object.values((await db.query("select total,original_amount,original_currency from sales where id=$1", [usdSale])).rows[0]),
    ["10.00", "878.00", "KGS"],
  );
  await assert.rejects(
    db.query("select commit_sale_items($1,$2,$3,false,$4)", [orgA, usdBuyer, JSON.stringify([{ product: cement, qty: "1", price: "878" }]), k(8)]),
    /invalid_currency/,
  );
  // Отмена продажи возвращает остаток (вид не считает отменённые движения).
  assert.equal(await stock(cement), "24.000");
  await db.query("select reverse_sale($1,$2,'Вернули товар')", [orgA, usdSale]);
  assert.equal(await stock(cement), "25.000");

  // Клиент по ссылке видит накладную строками и флаг invoice на своей странице.
  const token = (await db.query("select create_share_link($1,$2) as token", [orgA, buyer])).rows[0].token;
  await owner();
  await db.exec("SET ROLE anon;");
  const invoice = (await db.query("select get_invoice_by_token($1,$2) as data", [token, sale])).rows[0].data;
  assert.equal(invoice.total, "6468.75");
  assert.deepEqual(invoice.lines.map((l) => [l.name_raw, l.qty, l.unit, l.sum]), [
    ["Кабель ВВГнг 3х2,5", "12.500", "м", "1068.75"],
    ["Цемент М400", "10.000", "мешок", "5400.00"],
  ]);
  const statement = (await db.query("select get_statement_by_token($1) as data", [token])).rows[0].data;
  assert.equal(statement.entries.find((e) => e.id === sale).invoice, true);

  // Приём на склад вручную по несверенной накладной прихода (сверенная приходит
  // сама — auto_stock): известный товар по id, новый — создаётся; название со
  // строки запоминается синонимом; второй раз — отказ.
  await owner();
  const supplier = (await db.query("insert into suppliers(organization_id,name) values ($1,'Склад №1') returning id", [orgA])).rows[0].id;
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,'wh-1','wh-1','image/jpeg','purchase','review') returning id",
      [orgA],
    )
  ).rows[0].id;
  const [l1, l2] = (
    await db.query(
      "insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,1,'Цемент М-400 50кг',20,'шт',480),($1,$2,2,'Гвозди 100мм',5,'кг',150) returning id",
      [orgA, doc],
    )
  ).rows.map((r) => r.id);
  await user(a);
  const purchase = (
    await db.query("select commit_purchase($1,$2,'10350',$3,$4) as id", [orgA, supplier, k(9), doc])
  ).rows[0].id;
  const items = JSON.stringify([{ line: l1, product: cement }, { line: l2, unit: "кг", sale_price: "200" }]);
  assert.equal((await db.query("select receive_purchase_lines($1,$2,$3) as n", [orgA, purchase, items])).rows[0].n, 2);
  assert.equal(await stock(cement), "45.000");
  const nails = (await db.query("select id,unit,sale_price,purchase_price from products where organization_id=$1 and name='Гвозди 100мм'", [orgA])).rows[0];
  assert.deepEqual([nails.unit, nails.sale_price, nails.purchase_price, await stock(nails.id)], ["кг", "200.00", "150.00", "5.000"]);
  const cementRow = (await db.query("select aliases,purchase_price from products where id=$1", [cement])).rows[0];
  assert.deepEqual([cementRow.aliases, cementRow.purchase_price], [["Цемент М-400 50кг"], "480.00"]);
  await assert.rejects(db.query("select receive_purchase_lines($1,$2,$3)", [orgA, purchase, items]), /already_stocked/);
  // Отменённый приход больше не в остатке.
  await db.query("select reverse_purchase($1,$2,'Не тот поставщик')", [orgA, purchase]);
  assert.equal(await stock(cement), "25.000");

  // Импорт: по коду обновляет, по названию находит, новые создаёт, остаток — пересчётом;
  // плохие строки пропускаются с причиной.
  const imported = (
    await db.query("select import_products($1,$2) as r", [
      orgA,
      JSON.stringify([
        { name: "Цемент М400", sku: "C-400", sale_price: "560", stock: "30" },
        { name: "кабель ввгнг 3х2,5", stock: "90" },
        { name: "Профиль 60х27", unit: "шт", sale_price: "210", stock: "50" },
        { name: "", sale_price: "1" },
        { name: "Шпатель", sale_price: "abc" },
      ]),
    ])
  ).rows[0].r;
  assert.deepEqual([imported.created, imported.updated], [1, 2]);
  assert.deepEqual(imported.errors, [{ row: 4, error: "invalid_name" }, { row: 5, error: "invalid_price" }]);
  assert.equal(await stock(cement), "30.000");
  assert.equal(await stock(cable), "90.000");
  assert.equal((await db.query("select sale_price from products where id=$1", [cement])).rows[0].sale_price, "560.00");
  // Найден по названию в другом регистре — своё название остаётся.
  assert.equal((await db.query("select name from products where id=$1", [cable])).rows[0].name, "Кабель ВВГнг 3х2,5");

  // Валюта закупки из файла: доллары остаются долларами, валюта магазина — null;
  // без цены закупки валюта не меняется; неизвестная валюта — строка с ошибкой.
  const fx = (
    await db.query("select import_products($1,$2) as r", [
      orgA,
      JSON.stringify([
        { name: "Вилка 807", purchase_price: "0.6", purchase_currency: "USD", sale_price: "70" },
        { name: "Цемент М400", purchase_price: "450", purchase_currency: "KGS" },
        { name: "Вилка 807", sale_price: "75" },
        { name: "Скотч", purchase_price: "1", purchase_currency: "EUR" },
      ]),
    ])
  ).rows[0].r;
  assert.deepEqual(fx.errors, [{ row: 4, error: "invalid_currency" }]);
  const cost = async (name) =>
    Object.values((await db.query("select purchase_price,purchase_currency from product_balances where organization_id=$1 and name=$2", [orgA, name])).rows[0]);
  assert.deepEqual(await cost("Вилка 807"), ["0.60", "USD"]);
  assert.deepEqual(await cost("Цемент М400"), ["450.00", null]);
  // Форма товара: валюта сохраняется; валюта магазина — снова null.
  const fork = (await db.query("select id from products where organization_id=$1 and name='Вилка 807'", [orgA])).rows[0].id;
  await db.query("select save_product($1,$2,'Вилка 807',null,'шт','75','0.65','0',null,null,'USD')", [orgA, fork]);
  assert.deepEqual(await cost("Вилка 807"), ["0.65", "USD"]);
  await db.query("select save_product($1,$2,'Вилка 807',null,'шт','75','57','0',null,null,'KGS')", [orgA, fork]);
  assert.deepEqual(await cost("Вилка 807"), ["57.00", null]);
  await assert.rejects(db.query("select save_product($1,$2,'Вилка 807',null,'шт','75','1','0',null,null,'EUR')", [orgA, fork]), /invalid_currency/);
  assert.ok((await db.query("select purchase_currency, stock_value from product_list where id=$1", [fork])).rows[0]);

  // Прайс дилера после товаров без кода (случай 25.10.2026): товары без кода
  // остаются без кода, товар с тем же кодом, но другим названием, не
  // переписывает чужой — строка не грузится, в ошибке — чей код.
  await db.query("select save_product($1,null,'Прожектор BILLOW 100W','2','шт','900')", [orgA]);
  const dealer = (
    await db.query("select import_products($1,$2) as r", [
      orgA,
      JSON.stringify([
        { name: "Автомат SAFE 1P", sale_price: "300" },
        { name: "Розетка без кода", sale_price: "120" },
        { name: "FELIX БЕЛЫЙ", sku: "2", sale_price: "450" },
        { name: "прожектор billow 100w", sku: "2", sale_price: "950" },
        { name: "Бек Кабель 2х2,5", sku: "D-7", sale_price: "60" },
        { name: "Бек Кабель 2х2,5", sku: "d-7", stock: "12" },
      ]),
    ])
  ).rows[0].r;
  assert.deepEqual(dealer.errors, [{ row: 3, error: "sku_other", other: "Прожектор BILLOW 100W" }]);
  assert.deepEqual([dealer.created, dealer.updated], [3, 2]);
  const byName = async (name) =>
    (await db.query("select name,sku,sale_price from products where organization_id=$1 and name=$2", [orgA, name])).rows[0];
  assert.deepEqual(await byName("Прожектор BILLOW 100W"), { name: "Прожектор BILLOW 100W", sku: "2", sale_price: "950.00" });
  assert.deepEqual(await byName("Автомат SAFE 1P"), { name: "Автомат SAFE 1P", sku: null, sale_price: "300.00" });
  assert.equal((await byName("Розетка без кода")).sku, null);
  assert.equal(await byName("FELIX БЕЛЫЙ"), undefined);
  // Товар без кода, найденный по названию, получает код из файла.
  await db.query("select import_products($1,$2)", [orgA, JSON.stringify([{ name: "Автомат SAFE 1P", sku: "S-1" }])]);
  assert.equal((await byName("Автомат SAFE 1P")).sku, "S-1");
  // В форме код можно стереть; null (не передан) — код остаётся.
  const auto = (await db.query("select id from products where organization_id=$1 and name='Автомат SAFE 1P'", [orgA])).rows[0].id;
  await db.query("select save_product($1,$2,'Автомат SAFE 1P',null,'шт','300')", [orgA, auto]);
  assert.equal((await byName("Автомат SAFE 1P")).sku, "S-1");
  await db.query("select save_product($1,$2,'Автомат SAFE 1P','','шт','300')", [orgA, auto]);
  assert.equal((await byName("Автомат SAFE 1P")).sku, null);

  // Без кода товар находится и по другому названию, и в архиве (возвращается),
  // остаток бывает в минусе; смена кода — в ответе с прежним кодом.
  const lampId = (await db.query("select save_product($1,null,'Лампа импорт 10W','L-10','шт','90',null,'0',array['лампочка 10 ватт']) as id", [orgA])).rows[0].id;
  const oldId = (await db.query("select save_product($1,null,'Старый товар',null,'шт','10') as id", [orgA])).rows[0].id;
  await db.query("select set_product_archived($1,$2,true)", [orgA, oldId]);
  const more = (
    await db.query("select import_products($1,$2) as r", [
      orgA,
      JSON.stringify([
        { name: "Лампочка 10 ватт", sku: "L-10N", stock: "-3" },
        { name: "старый товар", sale_price: "12" },
        { name: "Новый в минусе", stock: "-2" },
      ]),
    ])
  ).rows[0].r;
  assert.deepEqual([more.created, more.updated, more.restored, more.errors], [1, 2, 1, []]);
  assert.deepEqual(more.recoded, [{ row: 1, old: "L-10" }]);
  assert.equal(await stock(lampId), "-3.000");
  assert.equal((await db.query("select archived_at from products where id=$1", [oldId])).rows[0].archived_at, null);
  assert.equal((await db.query("select count(*)::int as n from products where organization_id=$1 and lower(name)='старый товар'", [orgA])).rows[0].n, 1);
  assert.equal((await db.query("select stock from product_balances where organization_id=$1 and name='Новый в минусе'", [orgA])).rows[0].stock, "-2.000");

  // Архив: товар скрыт, вернуть можно; чужой магазин не видит и не продаёт.
  await db.query("select set_product_archived($1,$2,true)", [orgA, cable]);
  assert.ok((await db.query("select archived_at from product_balances where id=$1", [cable])).rows[0].archived_at);
  await db.query("select set_product_archived($1,$2,false)", [orgA, cable]);
  assert.ok((await db.query("select sold_count from product_balances where id=$1", [cable])).rows[0].sold_count >= 1);
  await user(b);
  assert.equal((await db.query("select count(*)::int as n from product_balances where organization_id=$1", [orgA])).rows[0].n, 0);
  await assert.rejects(db.query("select save_product($1,null,'Чужой','','шт','1')", [orgA]), /not_a_member/);
  await assert.rejects(db.query("select adjust_stock($1,$2,'receipt','1',null,$3)", [orgA, cable, k(11)]), /not_a_member/);
});

test("auto stock: a checked purchase invoice goes to stock by itself; purchase lines without a photo post debt, stock and cost", async () => {
  const stock = async (id) => Number((await db.query("select stock from product_balances where id=$1", [id])).rows[0].stock);
  const k = (n) => `aaaa6666-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const recognize = (doc, lines, status) =>
    db.query("select save_recognition($1,$2,'gemini','m','v1','{}'::jsonb,$3::jsonb,$4,1,0)", [orgA, doc, JSON.stringify(lines), status]);
  const newDoc = async (name, status) =>
    (
      await db.query(
        "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,$2,'image/jpeg','purchase',$3) returning id",
        [orgA, name, status],
      )
    ).rows[0].id;

  await user(a);
  const socket = (await db.query("select save_product($1,null,'Розетка двойная Horoz',null,'шт','150',null,null,array['розетка 2х']) as id", [orgA])).rows[0].id;
  await owner();
  const supplier = (await db.query("insert into suppliers(organization_id,name) values ($1,'Хороз авто') returning id", [orgA])).rows[0].id;

  // Приход записан, распознавание ещё идёт — склад не трогаем; сверено — товар на складе.
  const doc = await newDoc("auto-1", "processing");
  await user(a);
  const purchase = (await db.query("select commit_purchase($1,$2,'1560',$3,$4) as id", [orgA, supplier, k(1), doc])).rows[0].id;
  assert.equal(await stock(socket), 0);
  await recognize(doc, [
    { n: 1, name_raw: "Розетка 2х", qty: "10", unit: "шт", price: "120" },
    { n: 2, name_raw: "Лампа LED 10W", qty: "4", unit: "шт", price: "90" },
  ], "digitized");
  assert.equal(await stock(socket), 10);
  const lamp = (await db.query("select id,purchase_price,sale_price from products where organization_id=$1 and name='Лампа LED 10W'", [orgA])).rows[0];
  assert.deepEqual([lamp.purchase_price, lamp.sale_price, await stock(lamp.id)], ["90.00", "0.00", 4]);
  assert.equal((await db.query("select purchase_price from products where id=$1", [socket])).rows[0].purchase_price, "120.00");
  assert.deepEqual(
    (await db.query("select unit_cost,cost_currency from inventory_movements where purchase_id=$1 order by unit_cost", [purchase])).rows.map(Object.values),
    [["90.00", "KGS"], ["120.00", "KGS"]],
  );
  assert.ok((await db.query("select stocked_at from purchases where id=$1", [purchase])).rows[0].stocked_at);
  await assert.rejects(db.query("select receive_purchase_lines($1,$2,'[]')", [orgA, purchase]), /invalid_input|already_stocked/);

  // «Расхождение» ждёт проверки; подтвердили — на складе.
  await owner();
  const reviewDoc = await newDoc("auto-2", "processing");
  await user(a);
  const reviewed = (await db.query("select commit_purchase($1,$2,'600',$3,$4) as id", [orgA, supplier, k(2), reviewDoc])).rows[0].id;
  await recognize(reviewDoc, [{ n: 1, name_raw: "Розетка двойная Horoz", qty: "5", unit: "шт", price: "120" }], "review");
  assert.equal(await stock(socket), 10);
  await db.query("select confirm_document_lines($1,$2)", [orgA, reviewDoc]);
  assert.equal(await stock(socket), 15);
  // Отменённый приход в остатке не считается.
  await db.query("select reverse_purchase($1,$2,'Ошибка')", [orgA, reviewed]);
  assert.equal(await stock(socket), 10);

  // Накладную распознали раньше, чем записали приход, — на складе сразу при записи.
  await owner();
  const earlyDoc = await newDoc("auto-3", "digitized");
  await db.query("insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,1,'розетка 2х',2,'шт',125)", [orgA, earlyDoc]);
  await user(a);
  await db.query("select commit_purchase($1,$2,'250',$3,$4)", [orgA, supplier, k(3), earlyDoc]);
  assert.equal(await stock(socket), 12);

  // Приход товарами без фото: долг = сумма строк, строки и остаток, цена закупки.
  const before = Number((await db.query("select balance from supplier_balances where id=$1", [supplier])).rows[0].balance);
  const lines = JSON.stringify([
    { product: socket, qty: "20", price: "118" },
    { product: lamp.id, qty: "10", price: "85.5" },
  ]);
  const manual = (await db.query("select commit_purchase_items($1,$2,$3,$4) as id", [orgA, supplier, lines, k(4)])).rows[0].id;
  assert.equal((await db.query("select total,document_id from purchases where id=$1", [manual])).rows[0].total, "3215.00");
  assert.equal(Number((await db.query("select balance from supplier_balances where id=$1", [supplier])).rows[0].balance) - before, 3215);
  assert.deepEqual(
    (await db.query("select n,name_snapshot,unit,qty,line_total from purchase_items where purchase_id=$1 order by n", [manual])).rows.map(Object.values),
    [[1, "Розетка двойная Horoz", "шт", "20.000", "2360.00"], [2, "Лампа LED 10W", "шт", "10.000", "855.00"]],
  );
  assert.equal(await stock(socket), 32);
  assert.equal(await stock(lamp.id), 14);
  assert.equal((await db.query("select purchase_price from products where id=$1", [lamp.id])).rows[0].purchase_price, "85.50");
  // Повтор — тот же приход; кривые строки, чужой поставщик — отказ.
  assert.equal((await db.query("select commit_purchase_items($1,$2,$3,$4) as id", [orgA, supplier, lines, k(4)])).rows[0].id, manual);
  assert.equal(await stock(socket), 32);
  await assert.rejects(db.query("select commit_purchase_items($1,$2,'[]',$3)", [orgA, supplier, k(5)]), /invalid_purchase/);
  await assert.rejects(
    db.query("select commit_purchase_items($1,$2,$3,$4)", [orgA, socket, lines, k(6)]),
    /invalid_supplier/,
  );
  // Поставщик в долларах: строки в сомах, долг — по курсу.
  await owner();
  const usd = (await db.query("insert into suppliers(organization_id,name,currency) values ($1,'Хороз $','USD') returning id", [orgA])).rows[0].id;
  await user(a);
  const usdPurchase = (
    await db.query("select commit_purchase_items($1,$2,$3,$4,'87.8') as id", [orgA, usd, JSON.stringify([{ product: socket, qty: "1", price: "878" }]), k(7)])
  ).rows[0].id;
  assert.deepEqual(
    Object.values((await db.query("select total,original_amount,original_currency from purchases where id=$1", [usdPurchase])).rows[0]),
    ["10.00", "878.00", "KGS"],
  );
  // Отмена прихода товарами возвращает остаток назад.
  await db.query("select reverse_purchase($1,$2,'Вернули поставщику')", [orgA, usdPurchase]);
  assert.equal(await stock(socket), 32);
  // Новая форма — без курса: цены в $, долг ровно на сумму строк, закупка товара — в $.
  const usdItems = (
    await db.query("select commit_purchase_items($1,$2,$3,$4) as id", [orgA, usd, JSON.stringify([{ product: socket, qty: "4", price: "1.25" }]), k(12)])
  ).rows[0].id;
  assert.deepEqual(
    Object.values((await db.query("select total,original_amount,original_currency,fx_rate from purchases where id=$1", [usdItems])).rows[0]),
    ["5.00", null, null, null],
  );
  assert.deepEqual(
    Object.values((await db.query("select unit_cost,cost_currency from inventory_movements where purchase_id=$1", [usdItems])).rows[0]),
    ["1.25", "USD"],
  );
  assert.deepEqual(
    Object.values((await db.query("select purchase_price,purchase_currency from products where id=$1", [socket])).rows[0]),
    ["1.25", "USD"],
  );
  assert.equal(await stock(socket), 36);
  // Поставщик в валюте магазина — закупка снова в сомах (null).
  await db.query("select commit_purchase_items($1,$2,$3,$4)", [orgA, supplier, JSON.stringify([{ product: socket, qty: "1", price: "110" }]), k(13)]);
  assert.deepEqual(
    Object.values((await db.query("select purchase_price,purchase_currency from products where id=$1", [socket])).rows[0]),
    ["110.00", null],
  );
  // Валюта цен выбрана в форме: у поставщика в сомах цены в $ — долг по курсу,
  // закупка товара — в $; без курса — отказ.
  const withCurrency =
    "select commit_purchase_items(p_org=>$1,p_supplier=>$2,p_lines=>$3,p_idempotency_key=>$4,p_fx_rate=>$5,p_line_currency=>$6) as id";
  const usdLines = JSON.stringify([{ product: socket, qty: "4", price: "1.25" }]);
  await assert.rejects(db.query(withCurrency, [orgA, supplier, usdLines, k(14), null, "USD"]), /invalid_currency/);
  await assert.rejects(db.query(withCurrency, [orgA, supplier, usdLines, k(14), null, "EUR"]), /invalid_currency/);
  const inUsd = (await db.query(withCurrency, [orgA, supplier, usdLines, k(14), "87.8", "USD"])).rows[0].id;
  assert.deepEqual(
    (await db.query("select total,original_amount,original_currency,fx_rate::numeric::float as fx from purchases where id=$1", [inUsd])).rows.map(Object.values)[0],
    ["439.00", "5.00", "USD", 87.8],
  );
  assert.deepEqual(
    Object.values((await db.query("select purchase_price,purchase_currency from products where id=$1", [socket])).rows[0]),
    ["1.25", "USD"],
  );
  assert.equal((await db.query(withCurrency, [orgA, supplier, usdLines, k(14), "87.8", "USD"])).rows[0].id, inUsd);
  // Валюта цен = валюта поставщика — курс не нужен, долг на сумму строк.
  const sameCurrency = (await db.query(withCurrency, [orgA, usd, usdLines, k(15), null, "USD"])).rows[0].id;
  assert.deepEqual(
    Object.values((await db.query("select total,original_amount,original_currency from purchases where id=$1", [sameCurrency])).rows[0]),
    ["5.00", null, null],
  );

  await user(b);
  await assert.rejects(db.query("select commit_purchase_items($1,$2,$3,$4)", [orgA, supplier, lines, k(8)]), /not_a_member/);
});

test("purchase by photo: supplier code in the line finds the product, owner's choice per line, merge of duplicates", async () => {
  const stock = async (id) => Number((await db.query("select stock from product_balances where id=$1", [id])).rows[0].stock);
  const k = (n) => `aaaa7777-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const product = async (name) =>
    (await db.query("select id,name,sku,aliases,archived_at,merged_into_id from products where organization_id=$1 and name=$2", [orgA, name])).rows[0];
  const doc = async (name, rows) => {
    await owner();
    const id = (
      await db.query(
        "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,$2,'image/jpeg','purchase','digitized') returning id",
        [orgA, name],
      )
    ).rows[0].id;
    for (const [n, name_raw, qty, price] of rows)
      await db.query("insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,$3,$4,$5,'шт',$6)", [orgA, id, n, name_raw, qty, price]);
    await user(a);
    return id;
  };

  // Код и название без кода: только цифровые группы в начале строки.
  const codeOf = async (name) => (await db.query("select private.line_code($1) as c, private.line_name($1) as n", [name])).rows[0];
  await owner();
  assert.deepEqual(await codeOf("001-006-0020 20W 6400K E27 ЛАМПА PREMIER-20"), { c: "001-006-0020", n: "20W 6400K E27 ЛАМПА PREMIER-20" });
  assert.deepEqual(await codeOf("LED-9W лампа"), { c: null, n: "LED-9W лампа" });
  assert.deepEqual(await codeOf("38 шт кабель"), { c: null, n: "38 шт кабель" });
  assert.deepEqual(await codeOf("052-005-120"), { c: "052-005-120", n: "052-005-120" });

  const supplier = (await db.query("insert into suppliers(organization_id,name) values ($1,'Horoz Asia') returning id", [orgA])).rows[0].id;
  await user(a);
  const premier = (await db.query("select save_product($1,null,'Лампа PREMIER-20','001-006-0020','шт','94') as id", [orgA])).rows[0].id;
  const torch = (await db.query("select save_product($1,null,'Лампа TORCH-20','001-016-0020','шт','94') as id", [orgA])).rows[0].id;
  const short = (await db.query("select save_product($1,null,'Короткий код','38','шт','1') as id", [orgA])).rows[0].id;

  // Без выбора (старая форма): по коду — к товару, синоним запомнили; без совпадения —
  // новый товар, код в поле «Код», название без кода; короткий код «38» не ловится.
  const first = await doc("code-1", [
    [1, "001-006-0020 20W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-20", "200", "0.84"],
    [2, "001-016-0030 30W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА TORCH-30", "24", "1.65"],
    [3, "38 шт кабель", "1", "5"],
  ]);
  await db.query("select commit_purchase($1,$2,'200',$3,$4)", [orgA, supplier, k(1), first]);
  assert.equal(await stock(premier), 200);
  assert.ok((await product("Лампа PREMIER-20")).aliases.includes("001-006-0020 20W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-20"));
  const torch30 = await product("30W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА TORCH-30");
  assert.equal(torch30.sku, "001-016-0030");
  assert.equal(await stock(torch30.id), 24);
  assert.equal(await stock(short), 0);
  assert.equal((await product("38 шт кабель")).sku, null);
  assert.equal(
    (await db.query("select count(*)::int as n from document_lines where document_id=$1 and product_id is not null", [first])).rows[0].n,
    3,
  );

  // Выбор владельца: этот товар (синоним), не принимать, новый; строки без выбора — поиском.
  const second = await doc("code-2", [
    [1, "Лампочка 20 ватт торч", "5", "0.99"],
    [2, "Доставка", "1", "10"],
    [3, "001-006-0018 18W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-18", "200", "0.81"],
    [4, "001-006-0020 20W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-20", "10", "0.84"],
  ]);
  const choices = [
    { n: 1, product: torch },
    { n: 2, product: null },
    { n: 3, product: null, new: true },
  ];
  const commit = (choice, key, document) =>
    db.query(
      "select commit_purchase(p_org=>$1,p_supplier=>$2,p_amount=>'300',p_idempotency_key=>$3,p_document=>$4,p_line_products=>$5::jsonb)",
      [orgA, supplier, key, document, JSON.stringify(choice)],
    );
  await commit(choices, k(2), second);
  assert.equal(await stock(torch), 5);
  assert.ok((await product("Лампа TORCH-20")).aliases.includes("Лампочка 20 ватт торч"));
  assert.equal(await product("Доставка"), undefined);
  assert.equal((await product("18W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-18")).sku, "001-006-0018");
  assert.equal(await stock(premier), 210);
  // «Новый товар» по той же строке ещё раз (исправление прихода) — второй не заводится.
  const again = await doc("code-3", [[1, "001-006-0018 18W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-18", "10", "0.81"]]);
  await commit([{ n: 1, product: null, new: true }], k(8), again);
  assert.equal(
    (await db.query("select count(*)::int as n from products where organization_id=$1 and name='18W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-18'", [orgA])).rows[0].n,
    1,
  );
  assert.equal(await stock((await product("18W 6400K E27 СВЕТОДИОДНАЯ ЛАМПА PREMIER-18")).id), 210);
  // Кривой выбор и чужой товар — отказ; выбор без накладной — отказ.
  await assert.rejects(commit([{ n: 1, product: "11111111-1111-4111-8111-111111111111" }], k(3), second), /invalid_product/);
  await assert.rejects(commit([{ n: 1 }], k(4), second), /invalid_line/);
  await assert.rejects(commit([{ n: 1, product: null, new: "да" }], k(5), second), /invalid_line/);
  await assert.rejects(commit([{ n: 1, product: torch }], k(6), null), /invalid_line/);

  // Объединение: всё дубля — товару, имя — синоним, дубль в архиве и без кода.
  const dup = (await db.query("select save_product($1,null,'Дубль PREMIER','DUP-12345','шт','1',null,'0',null,'7') as id", [orgA])).rows[0].id;
  await user(b);
  await assert.rejects(db.query("select merge_products($1,$2,$3)", [orgA, dup, premier]), /not_a_member/);
  await user(a);
  await assert.rejects(db.query("select merge_products($1,$2,$2)", [orgA, dup]), /invalid_product/);
  const merge = (await db.query("select merge_products($1,$2,$3) as id", [orgA, dup, premier])).rows[0].id;
  assert.equal(await stock(premier), 217);
  const merged = await product("Дубль PREMIER");
  assert.deepEqual([merged.sku, merged.merged_into_id, Boolean(merged.archived_at)], [null, premier, true]);
  const kept = await product("Лампа PREMIER-20");
  assert.equal(kept.sku, "001-006-0020");
  assert.ok(kept.aliases.includes("Дубль PREMIER"));
  await assert.rejects(db.query("select set_product_archived($1,$2,false)", [orgA, dup]), /product_merged/);
  await assert.rejects(db.query("select merge_products($1,$2,$3)", [orgA, dup, torch]), /invalid_product/);
  await assert.rejects(commit([{ n: 1, product: dup }], k(7), second), /invalid_product/);
  // Отмена: всё обратно, код дубля вернулся, синоним убран.
  await db.query("select undo_product_merge($1,$2)", [orgA, merge]);
  assert.equal(await stock(premier), 210);
  assert.equal(await stock(dup), 7);
  const back = await product("Дубль PREMIER");
  assert.deepEqual([back.sku, back.merged_into_id, back.archived_at], ["DUP-12345", null, null]);
  assert.ok(!(await product("Лампа PREMIER-20")).aliases.includes("Дубль PREMIER"));
  await assert.rejects(db.query("select undo_product_merge($1,$2)", [orgA, merge]), /undo_expired/);
  // Код дубля переходит товару без кода.
  const noCode = (await db.query("select save_product($1,null,'Без кода',null,'шт','1') as id", [orgA])).rows[0].id;
  await db.query("select merge_products($1,$2,$3)", [orgA, dup, noCode]);
  assert.equal((await product("Без кода")).sku, "DUP-12345");
});

test("auto stock for sales: a checked sale invoice writes off the seller's choice or exact names; reversal and returns put it back", async () => {
  const stock = async (id) => Number((await db.query("select stock from product_balances where id=$1", [id])).rows[0].stock);
  const k = (n) => `aaaa7a7a-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const recognize = (doc, lines, status) =>
    db.query("select save_recognition($1,$2,'gemini','m','v1','{}'::jsonb,$3::jsonb,$4,1,0)", [orgA, doc, JSON.stringify(lines), status]);
  const newDoc = async (name, status = "processing") => {
    await owner();
    const id = (
      await db.query(
        "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,$2,'image/jpeg','sale',$3) returning id",
        [orgA, name, status],
      )
    ).rows[0].id;
    await user(a);
    return id;
  };
  const sale = async (doc, key, amount, lineProducts = null) =>
    (
      await db.query(
        "select commit_sale(p_org=>$1,p_customer=>$2,p_amount=>$3,p_paid_immediately=>false,p_idempotency_key=>$4,p_document=>$5,p_line_products=>$6::jsonb) as id",
        [orgA, buyer, amount, key, doc, lineProducts && JSON.stringify(lineProducts)],
      )
    ).rows[0].id;

  await owner();
  const buyer = (await db.query("insert into customers(organization_id,name) values ($1,'Покупатель склада') returning id", [orgA])).rows[0].id;
  await user(a);
  const lamp = (await db.query("select save_product($1,null,'Лампа LED 9W Horoz',null,'шт','100',null,null,'{}') as id", [orgA])).rows[0].id;
  const cable = (await db.query("select save_product($1,null,'Кабель ВВГ 3х1.5',null,'м','50',null,null,'{}') as id", [orgA])).rows[0].id;
  const lamp0 = await stock(lamp);
  const cable0 = await stock(cable);

  // Старая форма, без выбора: продажа записана, накладная ещё читается — склад не трогаем;
  // сверена — списываем только точные названия (регистр, «ё» и пробелы не важны).
  const doc1 = await newDoc("sale-stock-1");
  const first = await sale(doc1, k(1), "350");
  assert.equal(await stock(lamp), lamp0);
  await recognize(doc1, [
    { n: 1, name_raw: "лампа  LED 9W horoz", qty: "2", unit: "шт", price: "100" },
    { n: 2, name_raw: "Лампа LED 9 W", qty: "1", unit: "шт", price: "100" },
    { n: 3, name_raw: "Доставка", qty: "1", unit: "шт", price: "50" },
  ], "digitized");
  assert.equal(await stock(lamp), lamp0 - 2);
  assert.ok((await db.query("select stocked_at from sales where id=$1", [first])).rows[0].stocked_at);

  // Выбор продавца: «Да» на похожий — списываем и запоминаем название; «Не списывать» —
  // даже точное название не трогаем; строку, которую продавец не видел, — по точному.
  const doc2 = await newDoc("sale-stock-2");
  const choice = [
    { n: 1, product: lamp },
    { n: 2, product: null },
  ];
  const second = await sale(doc2, k(2), "800", choice);
  assert.equal(await sale(doc2, k(2), "800", choice), second);
  await assert.rejects(sale(doc2, k(2), "800", [{ n: 1, product: cable }]), /idempotency_conflict/);
  await recognize(doc2, [
    { n: 1, name_raw: "Лампочка 9 ватт Хороз", qty: "3", unit: "шт", price: "100" },
    { n: 2, name_raw: "Кабель ВВГ 3х1.5", qty: "5", unit: "м", price: "50" },
    { n: 3, name_raw: "кабель ввг 3х1.5", qty: "5", unit: "м", price: "50" },
  ], "review");
  assert.equal(await stock(lamp), lamp0 - 2); // «Расхождение» — ждём проверки
  await db.query("select confirm_document_lines($1,$2)", [orgA, doc2]);
  assert.equal(await stock(lamp), lamp0 - 5);
  assert.equal(await stock(cable), cable0 - 5);
  const aliases = (await db.query("select aliases from products where id=$1", [lamp])).rows[0].aliases;
  assert.deepEqual(aliases, ["Лампочка 9 ватт Хороз"]);
  assert.deepEqual(
    (await db.query("select n,product_id from document_lines where document_id=$1 order by n", [doc2])).rows.map(Object.values),
    [[1, lamp], [2, null], [3, cable]],
  );

  // Запомненное название в следующий раз совпадает точно, без выбора.
  const doc3 = await newDoc("sale-stock-3", "digitized");
  await owner();
  await db.query("insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,1,'лампочка 9 ватт хороз',1,'шт',100)", [orgA, doc3]);
  await user(a);
  const third = await sale(doc3, k(3), "100");
  assert.equal(await stock(lamp), lamp0 - 6);
  // Отменённая продажа возвращает остаток.
  await db.query("select reverse_sale($1,$2,'Ошибка')", [orgA, third]);
  assert.equal(await stock(lamp), lamp0 - 5);

  // Возврат строкой фото возвращает списанный товар; несписанная строка — нет.
  const line = (await db.query("select id from document_lines where document_id=$1 and n=1", [doc2])).rows[0].id;
  const skipped = (await db.query("select id from document_lines where document_id=$1 and n=2", [doc2])).rows[0].id;
  await db.query("select commit_return($1,$2,$3,'Вернул лампу',$4)", [orgA, buyer, JSON.stringify([{ document_line: line, qty: "1" }]), k(4)]);
  assert.equal(await stock(lamp), lamp0 - 4);
  await db.query("select commit_return($1,$2,$3,'Вернул кабель',$4)", [orgA, buyer, JSON.stringify([{ document_line: skipped, qty: "1" }]), k(5)]);
  assert.equal(await stock(cable), cable0 - 5);

  // Чужой товар, выбор без накладной, кривой номер строки — отказ.
  await owner();
  const foreign = (await db.query("insert into products(organization_id,name) values ($1,'Чужая лампа') returning id", [orgB])).rows[0].id;
  await user(a);
  const doc4 = await newDoc("sale-stock-4");
  await assert.rejects(sale(doc4, k(6), "100", [{ n: 1, product: foreign }]), /invalid_product/);
  await assert.rejects(sale(null, k(7), "100", [{ n: 1, product: lamp }]), /invalid_line/);
  await assert.rejects(sale(doc4, k(8), "100", [{ n: 0, product: lamp }]), /invalid_line/);
  await assert.rejects(sale(doc4, k(9), "100", [{ n: 1 }]), /invalid_line/);
});

test("member email follows a confirmed email change in auth.users", async () => {
  await owner();
  await db.query("update auth.users set email='old@shop.kg' where id=$1", [a]);
  await db.query("update auth.users set email='new@shop.kg' where id=$1", [a]);
  const emails = (await db.query("select distinct email from organization_members where user_id=$1", [a])).rows;
  assert.deepEqual(emails, [{ email: "new@shop.kg" }]);
  // Другой пользователь не задет.
  assert.ok(
    (await db.query("select email from organization_members where user_id=$1", [b])).rows.every((r) => r.email !== "new@shop.kg"),
  );
});

test("promo QR on invoices: per-shop code, anonymous click tracking, counts only for the platform admin", async () => {
  await user(a);
  const ref = (await db.query("select promo_ref($1) as r", [orgA])).rows[0].r;
  assert.match(ref, /^[a-f0-9]{10}$/);
  assert.equal((await db.query("select promo_ref($1) as r", [orgA])).rows[0].r, ref); // тот же код
  await assert.rejects(db.query("select promo_ref($1)", [orgB]), /not_a_member/);
  await assert.rejects(db.query("select * from admin_promo_clicks()"), /admin_only/); // владелец магазина не видит

  await owner();
  const link = (await db.query("select token from share_links where organization_id=$1 and revoked_at is null limit 1", [orgA])).rows[0].token;
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  assert.equal((await db.query("select promo_ref_by_token($1) as r", [link])).rows[0].r, ref);
  assert.equal((await db.query("select promo_ref_by_token('0000') as r")).rows[0].r, null);
  await db.query("select track_promo_click($1)", [ref]);
  await db.query("select track_promo_click($1)", [ref]);
  await db.query("select track_promo_click('ffffffffff')"); // чужой код — пропускается
  await assert.rejects(db.query("select * from private.promo_clicks"), /permission denied/);
  await assert.rejects(db.query("select * from admin_promo_clicks()"), /permission denied/);

  await owner();
  await db.query("insert into private.platform_admins(user_id) values ($1) on conflict do nothing", [b]);
  await user(b);
  const rows = (await db.query("select * from admin_promo_clicks()")).rows;
  assert.deepEqual(rows.map((r) => [r.organization_id, r.clicks_7d, r.clicks_total]), [[orgA, 2, 2]]);
});

test("feedback from the login page: anonymous send with limits, read only by the platform admin", async () => {
  await owner();
  await db.exec("SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  await db.query("select send_feedback($1,$2,$3)", [" Айбек ", "+996 555 000 000", "Хочу подключить магазин"]);
  await assert.rejects(db.query("select send_feedback('', '+996', 'текст')"), /invalid_feedback/);
  await assert.rejects(db.query("select send_feedback('Айбек', '+996 555', $1)", ["x".repeat(2001)]), /invalid_feedback/);
  await assert.rejects(db.query("select * from private.feedback_messages"), /permission denied/);
  await assert.rejects(db.query("select * from admin_feedback()"), /permission denied/);

  await user(a);
  await assert.rejects(db.query("select * from admin_feedback()"), /admin_only/); // владелец магазина не видит

  await owner();
  await db.query("insert into private.platform_admins(user_id) values ($1) on conflict do nothing", [b]);
  await user(b);
  const rows = (await db.query("select * from admin_feedback()")).rows;
  assert.deepEqual(rows.map((r) => [r.name, r.contact, r.message]), [["Айбек", "+996 555 000 000", "Хочу подключить магазин"]]);

  await owner();
  await db.query("insert into private.feedback_messages(name, contact, message) select 'спам', '000', 'спам' from generate_series(1, 29)");
  await db.exec("SET ROLE anon;");
  await assert.rejects(db.query("select send_feedback('Ещё', '+996 555', 'текст')"), /too_many/);
});

test("payment method: cash or transfer is stored; a receipt or bank reference means transfer", async () => {
  await owner();
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'Клиент кассы') returning id", [orgA])
  ).rows[0].id;
  await user(a);
  const pay = async (key, method, reference = null) =>
    (
      await db.query(
        "select commit_payment(p_org=>$1,p_direction=>'incoming',p_party=>$2,p_amount=>'100.00',p_bank_reference=>$3,p_idempotency_key=>$4,p_method=>$5) as id",
        [orgA, customer, reference, key, method],
      )
    ).rows[0].id;
  const cash = await pay("dddddddd-1005-4000-8000-000000000001", "cash");
  const transfer = await pay("dddddddd-1005-4000-8000-000000000002", "transfer");
  const unknown = await pay("dddddddd-1005-4000-8000-000000000003", null);
  const byReference = await pay("dddddddd-1005-4000-8000-000000000004", null, "MB-1005");
  const method = async (id) => (await db.query("select method from payments where id=$1", [id])).rows[0].method;
  assert.equal(await method(cash), "cash");
  assert.equal(await method(transfer), "transfer");
  assert.equal(await method(unknown), null);
  assert.equal(await method(byReference), "transfer");
  await assert.rejects(pay("dddddddd-1005-4000-8000-000000000005", "card"), /invalid_payment/);
  // Старый вызов без p_method по-прежнему работает.
  await db.query("select commit_payment($1,'incoming',$2,'50.00',null,'dddddddd-1005-4000-8000-000000000006')", [orgA, customer]);
});

test("sale date: a sale can be written for yesterday, not for the future or older than a year", async () => {
  await owner();
  const customer = (
    await db.query("insert into customers(organization_id,name) values ($1,'Клиент вчера') returning id", [orgA])
  ).rows[0].id;
  await user(a);
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const sale = (
    await db.query(
      "select commit_sale(p_org=>$1,p_customer=>$2,p_amount=>'500.00',p_paid_immediately=>false,p_idempotency_key=>$3,p_occurred_at=>$4) as id",
      [orgA, customer, "eeeeeeee-1005-4000-8000-000000000001", yesterday],
    )
  ).rows[0].id;
  const row = (await db.query("select occurred_at from sales where id=$1", [sale])).rows[0];
  assert.equal(new Date(row.occurred_at).toISOString(), yesterday);
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  await assert.rejects(
    db.query(
      "select commit_sale(p_org=>$1,p_customer=>$2,p_amount=>'500.00',p_paid_immediately=>false,p_idempotency_key=>$3,p_occurred_at=>$4)",
      [orgA, customer, "eeeeeeee-1005-4000-8000-000000000002", tomorrow],
    ),
    /invalid_date/,
  );
  // Без даты — как раньше, «сейчас».
  await db.query("select commit_sale($1,$2,'10.00',false,'eeeeeeee-1005-4000-8000-000000000003')", [orgA, customer]);
});

test("record date: purchase by amount, sale and purchase by items can be written for yesterday", async () => {
  const k = (n) => `eeeeeeee-1006-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  await owner();
  const customer = (await db.query("insert into customers(organization_id,name) values ($1,'Тест вчера') returning id", [orgA])).rows[0].id;
  const supplier = (await db.query("insert into suppliers(organization_id,name) values ($1,'Поставщик вчера') returning id", [orgA])).rows[0].id;
  await user(a);
  const socket = (await db.query("select save_product($1,null,'Розетка вчера',null,'шт','85',null,null,null) as id", [orgA])).rows[0].id;
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const lines = JSON.stringify([{ product: socket, qty: "10", price: "85" }]);
  const dateOf = async (table, id) => new Date((await db.query(`select occurred_at from ${table} where id=$1`, [id])).rows[0].occurred_at).toISOString();

  // Товар от поставщика без накладной, вчерашним числом; повтор — та же запись.
  const purchaseCall = "select commit_purchase(p_org=>$1,p_supplier=>$2,p_amount=>'850.00',p_idempotency_key=>$3,p_occurred_at=>$4) as id";
  const purchase = (await db.query(purchaseCall, [orgA, supplier, k(1), yesterday])).rows[0].id;
  assert.equal(await dateOf("purchases", purchase), yesterday);
  assert.equal((await db.query(purchaseCall, [orgA, supplier, k(1), yesterday])).rows[0].id, purchase);
  await assert.rejects(db.query(purchaseCall, [orgA, supplier, k(2), tomorrow]), /invalid_date/);

  // «Тест вчера взял 10 розеток по 85»: продажа товарами вчерашним числом.
  const saleCall = "select commit_sale_items(p_org=>$1,p_customer=>$2,p_lines=>$3,p_paid_immediately=>false,p_idempotency_key=>$4,p_occurred_at=>$5) as id";
  const sale = (await db.query(saleCall, [orgA, customer, lines, k(3), yesterday])).rows[0].id;
  assert.equal(await dateOf("sales", sale), yesterday);
  assert.equal((await db.query("select total from sales where id=$1", [sale])).rows[0].total, "850.00");
  await assert.rejects(db.query(saleCall, [orgA, customer, lines, k(4), tomorrow]), /invalid_date/);

  const itemsCall = "select commit_purchase_items(p_org=>$1,p_supplier=>$2,p_lines=>$3,p_idempotency_key=>$4,p_occurred_at=>$5) as id";
  const received = (await db.query(itemsCall, [orgA, supplier, lines, k(5), yesterday])).rows[0].id;
  assert.equal(await dateOf("purchases", received), yesterday);
  await assert.rejects(db.query(itemsCall, [orgA, supplier, lines, k(6), tomorrow]), /invalid_date/);

  // Старые вызовы без даты работают как раньше.
  await db.query("select commit_purchase($1,$2,'10.00',$3)", [orgA, supplier, k(7)]);
  await db.query("select commit_sale_items($1,$2,$3,false,$4)", [orgA, customer, lines, k(8)]);
  await db.query("select commit_purchase_items($1,$2,$3,$4)", [orgA, supplier, lines, k(9)]);
});

test("client page: a rejected claim shows its reason, reversed records and internal notes are hidden", async () => {
  await owner();
  await user(a);
  const customer = (
    await db.query("insert into customers(organization_id,name) values($1,'Тимур аке') returning id", [orgA])
  ).rows[0].id;
  const token = (await db.query("select create_share_link($1,$2) as token", [orgA, customer])).rows[0].token;
  await db.query("select commit_sale($1,$2,'500.00',false,'ffffffff-1005-4000-8000-000000000001')", [orgA, customer]);
  const reversed = (
    await db.query("select commit_sale($1,$2,'70.00',false,'ffffffff-1005-4000-8000-000000000002') as id", [orgA, customer])
  ).rows[0].id;
  await db.query("select reverse_sale($1,$2,'Повтор')", [orgA, reversed]);
  await db.query(
    "select commit_adjustment($1,'incoming',$2,'discount','50.00','скидка за опт, не говорить клиенту','ffffffff-1005-4000-8000-000000000003')",
    [orgA, customer],
  );
  await db.exec("RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  const claim = (await db.query("select submit_payment_claim($1,'150000',null) as id", [token])).rows[0].id;
  await owner();
  await user(a);
  await db.query("select reject_payment_claim($1,$2,'Денег не пришло')", [orgA, claim]);

  await db.exec("RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  const page = (await db.query("select get_client_page_by_token($1) as data", [token])).rows[0].data;
  const rejected = page.entries.find((e) => e.id === claim);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reject_comment, "Денег не пришло");
  assert.ok(!page.entries.some((e) => e.id === reversed), "отменённая продажа не видна");
  assert.ok(page.entries.every((e) => !("note" in e)), "внутренние заметки не видны");
  assert.equal(page.balance, "450.00");

  // Отозванная ссылка: страница знает магазин, но не долг.
  await owner();
  await user(a);
  const link = (await db.query("select id from share_links where token=$1", [token])).rows[0].id;
  await db.query("select revoke_share_link($1,$2)", [orgA, link]);
  await db.exec("RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  await assert.rejects(db.query("select get_client_page_by_token($1)", [token]), /invalid_token/);
  const shop = (await db.query("select get_revoked_link_shop($1) as data", [token])).rows[0].data;
  assert.equal(shop.shop_name, "Магазин A");
  assert.equal((await db.query("select get_shop_payment_by_token($1) as data", [token])).rows[0].data, null);
  await owner();
});

test("notebook import with the debt date: aging counts from the written date", async () => {
  await owner();
  await user(a);
  const date = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const party = (
    await db.query(
      "select import_opening_balance($1,'customer',null,'Канат ака','','1500.00','abababab-1005-4000-8000-000000000001',$2) as id",
      [orgA, date],
    )
  ).rows[0].id;
  const aging = (await db.query("select oldest_days from customer_debt_aging where customer_id=$1", [party])).rows[0];
  assert.ok(aging.oldest_days >= 39 && aging.oldest_days <= 41, `oldest_days ${aging.oldest_days}`);
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await assert.rejects(
    db.query(
      "select import_opening_balance($1,'customer',null,'Завтрашний','','10.00','abababab-1005-4000-8000-000000000002',$2)",
      [orgA, tomorrow],
    ),
    /invalid_opening/,
  );
  await owner();
});

test("notebook import keeps the notebook page photo, only this shop's files", async () => {
  await owner();
  await user(a);
  const photo = `${orgA}/notebook/0d0d0d0d-0000-4000-8000-000000000001.jpg`;
  const party = (
    await db.query(
      "select import_opening_balance($1,'customer',null,'Фото ака','','700.00','abababab-1006-4000-8000-000000000001',null,$2) as id",
      [orgA, [photo]],
    )
  ).rows[0].id;
  const sale = (await db.query("select notebook_photos from sales where customer_id=$1 and is_opening", [party])).rows[0];
  assert.deepEqual(sale.notebook_photos, [photo]);
  for (const bad of [`${orgB}/notebook/0d0d0d0d-0000-4000-8000-000000000002.jpg`, `${orgA}/sale/x.jpg`, `${orgA}/notebook/../x.jpg`])
    await assert.rejects(
      db.query(
        "select import_opening_balance($1,'customer',null,'Чужое фото','','10.00','abababab-1006-4000-8000-000000000002',null,$2)",
        [orgA, [bad]],
      ),
      /invalid_opening/,
    );
  // Без фото — как раньше.
  const plain = (
    await db.query(
      "select import_opening_balance($1,'customer',null,'Без фото','','10.00','abababab-1006-4000-8000-000000000003') as id",
      [orgA],
    )
  ).rows[0].id;
  assert.equal((await db.query("select notebook_photos from sales where customer_id=$1", [plain])).rows[0].notebook_photos, null);
  await owner();
});

test("delete a photo without a record: only an unused document, only in its own shop", async () => {
  await owner();
  const doc = async (key) =>
    (
      await db.query(
        "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,$2,'image/jpeg','sale','uploaded') returning id",
        [orgA, "orphan-" + key],
      )
    ).rows[0].id;
  const orphan = await doc(1);
  const used = await doc(2);
  await db.query(
    "insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,1,'Лампа',1,'шт',10)",
    [orgA, orphan],
  );
  const customer = (await db.query("insert into customers(organization_id,name) values ($1,'Клиент фото') returning id", [orgA])).rows[0].id;
  await user(a);
  const sale = (
    await db.query("select commit_sale($1,$2,'10.00',false,'acacacac-1005-4000-8000-000000000001',$3) as id", [orgA, customer, used])
  ).rows[0].id;
  await db.query("select reverse_sale($1,$2,'Повтор')", [orgA, sale]);
  // Чужой магазин — нельзя.
  await user(b);
  await assert.rejects(db.query("select delete_unused_document($1,$2)", [orgA, orphan]), /not_a_member/);
  await user(a);
  // Фото отменённой продажи — история записи, не удаляем.
  await assert.rejects(db.query("select delete_unused_document($1,$2)", [orgA, used]), /document_in_use/);
  await db.query("select delete_unused_document($1,$2)", [orgA, orphan]);
  // Мягкое удаление: участник документа больше не видит, строки остались.
  assert.equal((await db.query("select count(*)::int as n from documents where id=$1", [orphan])).rows[0].n, 0);
  await assert.rejects(db.query("select delete_unused_document($1,$2)", [orgA, orphan]), /invalid_document/);
  await owner();
  assert.ok((await db.query("select deleted_at from documents where id=$1", [orphan])).rows[0].deleted_at);
  assert.equal((await db.query("select count(*)::int as n from document_lines where document_id=$1", [orphan])).rows[0].n, 1);
  assert.equal(
    (await db.query("select count(*)::int as n from audit_events where action='document.deleted' and entity_id=$1", [orphan])).rows[0].n,
    1,
  );
  // «Вернуть»: чужой магазин — нельзя; свой — документ снова виден.
  await user(b);
  await assert.rejects(db.query("select restore_document($1,$2)", [orgA, orphan]), /not_a_member/);
  await user(a);
  await db.query("select restore_document($1,$2)", [orgA, orphan]);
  assert.equal((await db.query("select count(*)::int as n from documents where id=$1", [orphan])).rows[0].n, 1);
  await assert.rejects(db.query("select restore_document($1,$2)", [orgA, orphan]), /invalid_document/);
  // То же фото, загруженное после удаления, — тот же документ, снова видимый.
  await db.query("select delete_unused_document($1,$2)", [orgA, orphan]);
  const again = (
    await db.query("select create_document($1,'purchase','orphan-1b','orphan-1','image/jpeg') as id", [orgA])
  ).rows[0].id;
  assert.equal(again, orphan);
  assert.deepEqual(
    (await db.query("select kind from documents where id=$1", [orphan])).rows[0],
    { kind: "purchase" },
  );
  await owner();
});

test("claims: a confirmation can be undone by its owner within a minute, the claim waits again", async () => {
  await owner();
  await user(a);
  const customer = (
    await db.query("insert into customers(organization_id,name) values($1,'Клиент заявки') returning id", [orgA])
  ).rows[0].id;
  const token = (await db.query("select create_share_link($1,$2) as token", [orgA, customer])).rows[0].token;
  await db.exec("RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.sub','',false);");
  const claim = (await db.query("select submit_payment_claim($1,'700',null) as id", [token])).rows[0].id;
  await owner();
  await user(a);
  const balance = async () => (await db.query("select balance from customer_balances where id=$1", [customer])).rows[0].balance;
  await db.query("select confirm_payment_claim($1,$2,'650')", [orgA, claim]);
  assert.equal(await balance(), "-650.00");
  await user(b);
  await assert.rejects(db.query("select undo_confirm_claim($1,$2)", [orgA, claim]), /owner_only/);
  await user(a);
  await db.query("select undo_confirm_claim($1,$2)", [orgA, claim]);
  const row = (await db.query("select status, amount from payments where id=$1", [claim])).rows[0];
  assert.deepEqual(row, { status: "pending", amount: "700.00" });
  assert.equal(await balance(), "0.00");
  // Второй раз вернуть нечего.
  await assert.rejects(db.query("select undo_confirm_claim($1,$2)", [orgA, claim]), /undo_expired/);
  await owner();
});

test("returns by lines: price as bought, no more than bought, stock comes back, reversal undoes it", async () => {
  await owner();
  await user(a);
  const k = (n) => `aaaa7777-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const stock = async (id) => Number((await db.query("select stock from product_balances where id=$1", [id])).rows[0].stock);
  const balance = async (id) => (await db.query("select balance from customer_balances where id=$1", [id])).rows[0].balance;
  const breaker = (
    await db.query("select save_product($1,null,'Автомат 16А возврат',null,'шт','360','300','0',array[]::text[],'20') as id", [orgA])
  ).rows[0].id;
  const buyer = (await db.query("insert into customers(organization_id,name) values ($1,'Возврат Медербек') returning id", [orgA])).rows[0].id;
  const other = (await db.query("insert into customers(organization_id,name) values ($1,'Другой клиент') returning id", [orgA])).rows[0].id;
  const sale = (
    await db.query("select commit_sale_items($1,$2,$3,false,$4) as id", [
      orgA, buyer, JSON.stringify([{ product: breaker, qty: "10", price: "360" }]), k(1),
    ])
  ).rows[0].id;
  const item = (await db.query("select id from sale_items where sale_id=$1", [sale])).rows[0].id;
  assert.equal(await stock(breaker), 10);
  assert.equal(await balance(buyer), "3600.00");

  // Вернул 2 шт: сумма по цене покупки, долг и остаток.
  const ret = (
    await db.query("select commit_return($1,$2,$3,'Вернул 2 автомата',$4) as id", [orgA, buyer, JSON.stringify([{ sale_item: item, qty: "2" }]), k(2)])
  ).rows[0].id;
  assert.deepEqual(
    (await db.query("select kind,amount from payments where id=$1", [ret])).rows[0],
    { kind: "return", amount: "720.00" },
  );
  assert.equal(await balance(buyer), "2880.00");
  assert.equal(await stock(breaker), 12);
  // Повтор ключа — та же запись.
  assert.equal(
    (await db.query("select commit_return($1,$2,$3,'Вернул 2 автомата',$4) as id", [orgA, buyer, JSON.stringify([{ sale_item: item, qty: "2" }]), k(2)])).rows[0].id,
    ret,
  );
  // Больше купленного (осталось 8), чужая строка, чужой магазин — отказ.
  await assert.rejects(
    db.query("select commit_return($1,$2,$3,'x',$4)", [orgA, buyer, JSON.stringify([{ sale_item: item, qty: "9" }]), k(3)]),
    /return_over_qty/,
  );
  await assert.rejects(
    db.query("select commit_return($1,$2,$3,'x',$4)", [orgA, other, JSON.stringify([{ sale_item: item, qty: "1" }]), k(4)]),
    /invalid_line/,
  );
  await user(b);
  await assert.rejects(
    db.query("select commit_return($1,$2,$3,'x',$4)", [orgA, buyer, JSON.stringify([{ sale_item: item, qty: "1" }]), k(5)]),
    /not_a_member/,
  );

  // Продажа по фото: строки распознанной накладной; склад не меняется.
  await owner();
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,'ret-1','ret-1','image/jpeg','sale','digitized') returning id",
      [orgA],
    )
  ).rows[0].id;
  const line = (
    await db.query("insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,1,'Кара 24',5,'шт',100) returning id", [orgA, doc])
  ).rows[0].id;
  await db.query(
    "insert into sales(organization_id,customer_id,total,status,document_id,idempotency_key) values ($1,$2,500,'posted',$3,$4)",
    [orgA, buyer, doc, k(6)],
  );
  await user(a);
  await db.query("select commit_return($1,$2,$3,'Вернул кару',$4)", [orgA, buyer, JSON.stringify([{ document_line: line, qty: "5" }]), k(7)]);
  assert.equal(await balance(buyer), "2880.00");
  await assert.rejects(
    db.query("select commit_return($1,$2,$3,'x',$4)", [orgA, buyer, JSON.stringify([{ document_line: line, qty: "1" }]), k(8)]),
    /return_over_qty/,
  );

  // Отмена возврата: долг и остаток назад, вернуть можно снова; больше долга — отказ.
  await db.query("select reverse_payment($1,$2,'Ошиблись')", [orgA, ret]);
  assert.equal(await balance(buyer), "3600.00");
  assert.equal(await stock(breaker), 10);
  await db.query("select commit_adjustment($1,'incoming',$2,'discount','1000','Скидка',$3)", [orgA, buyer, k(11)]);
  assert.equal(await balance(buyer), "2600.00");
  await assert.rejects(
    db.query("select commit_return($1,$2,$3,'x',$4)", [orgA, buyer, JSON.stringify([{ sale_item: item, qty: "10" }]), k(9)]),
    /over_debt/,
  );
  await db.query("select commit_return($1,$2,$3,'Вернул 7',$4)", [orgA, buyer, JSON.stringify([{ sale_item: item, qty: "7" }]), k(10)]);
  assert.equal(await balance(buyer), "80.00");
  assert.equal(await stock(breaker), 17);
  await owner();
});
test("record drafts: only the author sees and edits them, other shops get nothing, ledger untouched", async () => {
  await user(a);
  const sold = (await db.query("select count(*)::int as n from sales")).rows[0].n;
  const id = (
    await db.query("select save_record_draft($1,null,'sale',$2) as id", [orgA, JSON.stringify({ party: "x", lines: [] })])
  ).rows[0].id;
  assert.equal((await db.query("select save_record_draft($1,$2,'sale',$3) as id", [orgA, id, '{"party":"y"}'])).rows[0].id, id);
  assert.equal((await db.query("select data->>'party' as p from record_drafts where id=$1", [id])).rows[0].p, "y");
  // Тот же черновик другим видом или не объектом — нельзя.
  await assert.rejects(db.query("select save_record_draft($1,$2,'purchase','{}')", [orgA, id]), /draft_gone/);
  await assert.rejects(db.query("select save_record_draft($1,null,'payment','{}')", [orgA]), /invalid_draft/);
  await assert.rejects(db.query("select save_record_draft($1,null,'sale','[]')", [orgA]), /invalid_draft/);
  // Напрямую в таблицу писать нельзя.
  await assert.rejects(db.query("update record_drafts set data='{}' where id=$1", [id]), /permission denied/);
  // Чужой магазин: не видит, не меняет, не стирает.
  await user(b);
  assert.equal((await db.query("select * from record_drafts")).rows.length, 0);
  await assert.rejects(db.query("select save_record_draft($1,$2,'sale','{}')", [orgA, id]), /not_a_member/);
  await assert.rejects(db.query("select save_record_draft($1,$2,'sale','{}')", [orgB, id]), /draft_gone/);
  await db.query("select delete_record_draft($1,$2)", [orgB, id]);
  await user(a);
  assert.equal((await db.query("select count(*)::int as n from record_drafts where id=$1", [id])).rows[0].n, 1);
  // Стёртый не воскресает; повторное стирание — не ошибка; в журнале — создан и стёрт.
  await db.query("select delete_record_draft($1,$2)", [orgA, id]);
  await db.query("select delete_record_draft($1,$2)", [orgA, id]);
  await assert.rejects(db.query("select save_record_draft($1,$2,'sale','{}')", [orgA, id]), /draft_gone/);
  assert.deepEqual(
    (await db.query("select action from audit_events where entity_id=$1 order by created_at, action", [id])).rows.map((r) => r.action).sort(),
    ["draft.created", "draft.deleted"],
  );
  assert.equal((await db.query("select count(*)::int as n from sales")).rows[0].n, sold);
  await owner();
});
test("correction: «Исправить» changes nothing until the new sale is written; then the old one is replaced in the same step", async () => {
  const k = (n) => `aaaa8888-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const seller = "44444444-4444-4444-8444-444444444444";
  const otherSeller = "55555555-5555-4555-8555-555555555555";
  const stranger = "66666666-6666-4666-8666-666666666666";
  const balance = async (id) => (await db.query("select balance from customer_balances where id=$1", [id])).rows[0].balance;
  await owner();
  await db.query("insert into auth.users values ($1),($2),($3) on conflict do nothing", [seller, otherSeller, stranger]);
  await db.query(
    "insert into organization_members(organization_id,user_id,role) values ($1,$2,'staff'),($1,$3,'staff') on conflict do nothing",
    [orgA, seller, otherSeller],
  );
  const buyer = (await db.query("insert into customers(organization_id,name) values ($1,'Исправление Айбек') returning id", [orgA])).rows[0].id;
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,'fix-1','image/jpeg','sale','digitized') returning id",
      [orgA, `${orgA}/sale/fix-1.jpg`],
    )
  ).rows[0].id;
  await db.query(
    "insert into document_pages(organization_id,document_id,page_no,storage_path,file_hash,mime_type) values ($1,$2,2,$3,'fix-2','image/jpeg'),($1,$2,3,$4,'fix-3','image/jpeg')",
    [orgA, doc, `${orgA}/sale/fix-2.jpg`, `${orgA}/sale/fix-3.jpg`],
  );
  await db.query("insert into document_lines(organization_id,document_id,n,name_raw,qty,unit,price) values ($1,$2,1,'Carla 18',5,'шт',20)", [orgA, doc]);
  // Продажа продавца.
  const sale = (
    await db.query(
      "insert into sales(organization_id,customer_id,total,status,document_id,idempotency_key,created_by) values ($1,$2,100,'posted',$3,$4,$5) returning id",
      [orgA, buyer, doc, k(1), seller],
    )
  ).rows[0].id;
  assert.equal(await balance(buyer), "100.00");

  // Старых «отменить отдельно от записи» больше нет.
  await user(seller);
  await assert.rejects(db.query("select correct_sale($1,$2)", [orgA, sale]), /does not exist/);
  // Не из магазина и чужой продавец — отказ.
  await user(stranger);
  await assert.rejects(db.query("select start_correction($1,'sale',$2)", [orgA, sale]), /access_denied/);
  await user(otherSeller);
  await assert.rejects(db.query("select start_correction($1,'sale',$2)", [orgA, sale]), /owner_only/);

  // «Исправить» своей продажи: копия фото со всеми страницами, продажа — как была.
  await user(seller);
  const copy = (await db.query("select start_correction($1,'sale',$2) as id", [orgA, sale])).rows[0].id;
  assert.notEqual(copy, doc);
  await owner();
  assert.deepEqual((await db.query("select kind,status,file_hash from documents where id=$1", [copy])).rows[0], {
    kind: "sale",
    status: "uploaded",
    file_hash: "fix-1",
  });
  assert.deepEqual(
    (await db.query("select page_no,file_hash from document_pages where document_id=$1 order by page_no", [copy])).rows,
    [{ page_no: 2, file_hash: "fix-2" }, { page_no: 3, file_hash: "fix-3" }],
  );
  assert.equal((await db.query("select count(*)::int as n from document_lines where document_id=$1", [doc])).rows[0].n, 1);
  // Бросили исправление — ничего не изменилось.
  assert.equal((await db.query("select reversed_at from sales where id=$1", [sale])).rows[0].reversed_at, null);
  assert.equal(await balance(buyer), "100.00");

  // Записали: новая продажа и отмена старой — одним шагом; продавец — тот же.
  await user(seller);
  const fixed = (
    await db.query("select commit_sale_correction($1,null,$2,$3,'80',false,$4,$5) as id", [sale, orgA, buyer, k(5), copy])
  ).rows[0].id;
  await owner();
  assert.deepEqual((await db.query("select reversed_at is not null as r, reversal_comment from sales where id=$1", [sale])).rows[0], {
    r: true,
    reversal_comment: "Исправление: заменена новой продажей",
  });
  assert.deepEqual((await db.query("select corrected_from, made_by, maker_id from sales where id=$1", [fixed])).rows[0], {
    corrected_from: sale,
    made_by: seller,
    maker_id: seller,
  });
  assert.equal(await balance(buyer), "80.00");
  // Повтор после сбоя связи — та же запись, ничего не задвоилось.
  await user(seller);
  assert.equal(
    (await db.query("select commit_sale_correction($1,null,$2,$3,'80',false,$4,$5) as id", [sale, orgA, buyer, k(5), copy])).rows[0].id,
    fixed,
  );
  // Вторая замена той же продажи — отказ, новая запись не появилась.
  await assert.rejects(
    db.query("select commit_sale_correction($1,null,$2,$3,'70',false,$4)", [sale, orgA, buyer, k(6)]),
    /already_corrected/,
  );
  await owner();
  assert.equal((await db.query("select count(*)::int as n from sales where idempotency_key=$1", [k(6)])).rows[0].n, 0);
  assert.equal(await balance(buyer), "80.00");

  // Чужой продавец не может заменить продажу через запись — и ничего не пишется.
  await user(otherSeller);
  await assert.rejects(
    db.query("select commit_sale_correction($1,null,$2,$3,'10',false,$4)", [fixed, orgA, buyer, k(7)]),
    /owner_only/,
  );
  await owner();
  assert.equal((await db.query("select count(*)::int as n from sales where idempotency_key=$1", [k(7)])).rows[0].n, 0);
  assert.equal((await db.query("select reversed_at from sales where id=$1", [fixed])).rows[0].reversed_at, null);

  // Владелец исправляет продажу продавца: она остаётся за продавцом; выбрать
  // другого может только владелец, продавец — нет.
  const breaker = (
    await db.query("select id from products where organization_id=$1 and name='Автомат 16А возврат'", [orgA])
  ).rows[0].id;
  await user(seller);
  const sale3 = (
    await db.query("select commit_sale_items($1,$2,$3,false,$4) as id", [orgA, buyer, JSON.stringify([{ product: breaker, qty: "1", price: "360" }]), k(8)])
  ).rows[0].id;
  assert.equal((await db.query("select start_correction($1,'sale',$2) as id", [orgA, sale3])).rows[0].id, null);
  await assert.rejects(
    db.query("select commit_sale_items_correction($1,$2,$3,$4,$5,false,$6)", [sale3, otherSeller, orgA, buyer, JSON.stringify([{ product: breaker, qty: "1", price: "300" }]), k(9)]),
    /owner_only/,
  );
  await user(a);
  const byOwner = (
    await db.query("select commit_sale_items_correction($1,null,$2,$3,$4,false,$5) as id", [sale3, orgA, buyer, JSON.stringify([{ product: breaker, qty: "1", price: "300" }]), k(10)])
  ).rows[0].id;
  await owner();
  assert.deepEqual((await db.query("select created_by, maker_id from sales where id=$1", [byOwner])).rows[0], { created_by: a, maker_id: seller });
  assert.notEqual((await db.query("select reversed_at from sales where id=$1", [sale3])).rows[0].reversed_at, null);

  // С возвратом товара — отказ и при «Исправить», и при записи.
  await user(a);
  const sale2 = (
    await db.query("select commit_sale_items($1,$2,$3,false,$4) as id", [orgA, buyer, JSON.stringify([{ product: breaker, qty: "2", price: "360" }]), k(2)])
  ).rows[0].id;
  const item = (await db.query("select id from sale_items where sale_id=$1", [sale2])).rows[0].id;
  await db.query("select commit_return($1,$2,$3,'Вернул 1',$4)", [orgA, buyer, JSON.stringify([{ sale_item: item, qty: "1" }]), k(3)]);
  await assert.rejects(db.query("select start_correction($1,'sale',$2)", [orgA, sale2]), /has_returns/);
  await assert.rejects(
    db.query("select commit_sale_correction($1,null,$2,$3,'1',false,$4)", [sale2, orgA, buyer, k(11)]),
    /has_returns/,
  );
  assert.equal((await db.query("select reversed_at from sales where id=$1", [sale2])).rows[0].reversed_at, null);

  // Отменённую продажу по фото — обратно: копия фото, продажа остаётся отменённой.
  await user(stranger);
  await assert.rejects(db.query("select restore_reversed_document($1,'sale',$2)", [orgA, sale]), /not_a_member/);
  await user(a);
  await assert.rejects(db.query("select restore_reversed_document($1,'purchase',$2)", [orgA, sale]), /invalid_record/);
  const restored = (await db.query("select restore_reversed_document($1,'sale',$2) as id", [orgA, sale])).rows[0].id;
  await owner();
  assert.equal((await db.query("select count(*)::int as n from document_pages where document_id=$1", [restored])).rows[0].n, 2);
  assert.equal((await db.query("select reversed_at is not null as r from sales where id=$1", [sale])).rows[0].r, true);
  await user(a);
  await assert.rejects(db.query("select restore_reversed_document($1,'sale',$2)", [orgA, sale2]), /invalid_record/);
  await owner();
});
test("correction of a purchase: paid-now payment is reversed together with it only when the new purchase is written", async () => {
  const k = (n) => `aaaa9999-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const supplierBalance = async (id) => (await db.query("select balance from supplier_balances where id=$1", [id])).rows[0].balance;
  await owner();
  const supplier = (await db.query("insert into suppliers(organization_id,name) values ($1,'Исправление поставщик') returning id", [orgA])).rows[0].id;
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,'pfix-1','image/jpeg','purchase','digitized') returning id",
      [orgA, `${orgA}/purchase/pfix-1.jpg`],
    )
  ).rows[0].id;
  await db.query(
    "insert into document_pages(organization_id,document_id,page_no,storage_path,file_hash,mime_type) values ($1,$2,2,$3,'pfix-2','image/jpeg')",
    [orgA, doc, `${orgA}/purchase/pfix-2.jpg`],
  );
  const purchase = (
    await db.query(
      "insert into purchases(organization_id,supplier_id,total,status,document_id,idempotency_key,created_by) values ($1,$2,500,'posted',$3,$4,$5) returning id,created_at",
      [orgA, supplier, doc, k(1), a],
    )
  ).rows[0];
  const paid = (
    await db.query(
      "insert into payments(organization_id,supplier_id,direction,amount,status,idempotency_key,created_by,created_at) values ($1,$2,'outgoing',200,'confirmed',$3,$4,$5::timestamptz + interval '5 seconds') returning id",
      [orgA, supplier, k(2), a, purchase.created_at],
    )
  ).rows[0].id;
  const other = (
    await db.query(
      "insert into payments(organization_id,supplier_id,direction,amount,status,idempotency_key,created_by,created_at) values ($1,$2,'outgoing',50,'confirmed',$3,$4,$5::timestamptz + interval '1 hour') returning id",
      [orgA, supplier, k(3), a, purchase.created_at],
    )
  ).rows[0].id;
  assert.equal(await supplierBalance(supplier), "250.00");

  await user(a);
  const copy = (await db.query("select start_correction($1,'purchase',$2) as id", [orgA, purchase.id])).rows[0].id;
  await owner();
  assert.deepEqual((await db.query("select kind,status from documents where id=$1", [copy])).rows[0], { kind: "purchase", status: "uploaded" });
  assert.deepEqual(
    (await db.query("select page_no,file_hash from document_pages where document_id=$1", [copy])).rows,
    [{ page_no: 2, file_hash: "pfix-2" }],
  );
  // «Исправить» ничего не отменило.
  assert.equal((await db.query("select reversed_at from purchases where id=$1", [purchase.id])).rows[0].reversed_at, null);
  assert.equal((await db.query("select reversed_at from payments where id=$1", [paid])).rows[0].reversed_at, null);
  assert.equal(await supplierBalance(supplier), "250.00");

  // Записали новый приход на 400: старый и его оплата отменены, другая оплата осталась.
  await user(a);
  await db.query("select commit_purchase_correction($1,null,$2,$3,'400',$4,$5)", [purchase.id, orgA, supplier, k(4), copy]);
  await owner();
  assert.notEqual((await db.query("select reversed_at from purchases where id=$1", [purchase.id])).rows[0].reversed_at, null);
  assert.notEqual((await db.query("select reversed_at from payments where id=$1", [paid])).rows[0].reversed_at, null);
  assert.equal((await db.query("select reversed_at from payments where id=$1", [other])).rows[0].reversed_at, null);
  assert.equal(await supplierBalance(supplier), "350.00");
  await user(a);
  await assert.rejects(db.query("select start_correction($1,'purchase',$2)", [orgA, purchase.id]), /invalid_correction/);
  await owner();
});
test("disabled seller: sees nothing, writes nothing even through functions; owner turns access back on", async () => {
  const k = (n) => `aaaacccc-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const seller = "44444444-4444-4444-8444-444444444444";
  await owner();
  const buyer = (await db.query("insert into customers(organization_id,name) values ($1,'Клиент отключённого') returning id", [orgA])).rows[0].id;
  const breaker = (
    await db.query("select id from products where organization_id=$1 and name='Автомат 16А возврат'", [orgA])
  ).rows[0].id;
  const line = JSON.stringify([{ product: breaker, qty: "1", price: "360" }]);
  await user(seller);
  assert.ok((await db.query("select count(*)::int as n from sales where organization_id=$1", [orgA])).rows[0].n > 0);
  // Отключить может только владелец и не себя.
  await assert.rejects(db.query("select set_member_disabled($1,$2,true)", [orgA, seller]), /owner_only/);
  await user(a);
  await assert.rejects(db.query("select set_member_disabled($1,$2,true)", [orgA, a]), /invalid_member/);
  await db.query("select set_member_disabled($1,$2,true)", [orgA, seller]);

  await user(seller);
  // Свою строку видит (приложение покажет «Доступ отключён»), данные магазина — нет.
  assert.equal(
    (await db.query("select disabled_at is not null as d from organization_members where organization_id=$1 and user_id=$2", [orgA, seller])).rows[0].d,
    true,
  );
  assert.equal((await db.query("select count(*)::int as n from sales where organization_id=$1", [orgA])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int as n from customers where organization_id=$1", [orgA])).rows[0].n, 0);
  await assert.rejects(db.query("select * from find_similar_records($1,'sale',null,$2,'360')", [orgA, buyer]), /not_a_member/);
  // Записать — ни продажу, ни клиента, даже прямым вызовом функций.
  await assert.rejects(db.query("select commit_sale_items($1,$2,$3,false,$4)", [orgA, buyer, line, k(1)]), /member_disabled|not_a_member/);
  await assert.rejects(db.query("select commit_sale($1,$2,'100',false,$3)", [orgA, buyer, k(2)]), /member_disabled|not_a_member/);
  await owner();
  assert.equal((await db.query("select count(*)::int as n from sales where idempotency_key in ($1,$2)", [k(1), k(2)])).rows[0].n, 0);

  // Вернули доступ — снова работает.
  await user(a);
  await db.query("select set_member_disabled($1,$2,false)", [orgA, seller]);
  await user(seller);
  assert.ok((await db.query("select count(*)::int as n from sales where organization_id=$1", [orgA])).rows[0].n > 0);
  await db.query("select commit_sale_items($1,$2,$3,false,$4)", [orgA, buyer, line, k(3)]);
  await owner();
  assert.deepEqual(
    (await db.query("select action from audit_events where organization_id=$1 and action like 'member.%abled' order by created_at", [orgA])).rows.map((r) => r.action),
    ["member.disabled", "member.enabled"],
  );
});
test("catalog: owner opens a link; anyone with it sees names and sale prices only; hidden, archived and priceless products stay out", async () => {
  const seller = "44444444-4444-4444-8444-444444444444";
  const catalog = async (token) => {
    await owner();
    await db.exec("SET ROLE anon;");
    const value = (await db.query("select get_catalog($1) as c", [token])).rows[0].c;
    await owner();
    return value;
  };
  await owner();
  const shown = (await db.query("select id from products where organization_id=$1 and name='Автомат 16А возврат'", [orgA])).rows[0].id;
  const free = (await db.query("insert into products(organization_id,name,sale_price) values ($1,'Каталог без цены',0) returning id", [orgA])).rows[0].id;
  const hidden = (await db.query("insert into products(organization_id,name,sale_price) values ($1,'Каталог скрытый',50) returning id", [orgA])).rows[0].id;
  const old = (
    await db.query("insert into products(organization_id,name,sale_price,archived_at) values ($1,'Каталог архив',50,now()) returning id", [orgA])
  ).rows[0].id;

  // Только владелец.
  await user(seller);
  await assert.rejects(db.query("select open_catalog_link($1)", [orgA]), /owner_only/);
  await user(a);
  const token = (await db.query("select open_catalog_link($1) as t", [orgA])).rows[0].t;
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.equal((await db.query("select open_catalog_link($1) as t", [orgA])).rows[0].t, token);
  await db.query("select set_catalog_visibility($1,$2::uuid[],'{}'::uuid[])", [orgA, [hidden]]);
  // Скрыть и показать одно и то же — отказ.
  await assert.rejects(db.query("select set_catalog_visibility($1,$2::uuid[],$2::uuid[])", [orgA, [shown]]), /invalid_catalog/);
  await user(seller);
  await assert.rejects(db.query("select set_catalog_visibility($1,'{}'::uuid[],'{}'::uuid[])", [orgA]), /owner_only/);

  const page = await catalog(token);
  assert.equal(page.shop_name, "Магазин A");
  const ids = page.products.map((p) => p.id);
  assert.ok(ids.includes(shown));
  for (const id of [free, hidden, old]) assert.ok(!ids.includes(id));
  // Ничего лишнего: ни остатков, ни закупки, ни кодов.
  // Модель и размер (20261030100000) — не секрет; закупки и остатков нет.
  assert.deepEqual(Object.keys(page.products.find((p) => p.id === shown)).sort(), [
    "category",
    "id",
    "model",
    "name",
    "photo",
    "price",
    "unit",
    "variant",
  ]);
  assert.equal(page.products.find((p) => p.id === shown).price, "360.00");
  assert.equal(await catalog("0".repeat(32)), null);
  // Фото товара: путь только своего магазина и товара; в каталоге — путь.
  await user(seller);
  const photo = `${orgA}/${shown}/abc.jpg`;
  assert.equal((await db.query("select set_product_photo($1,$2,$3) as old", [orgA, shown, photo])).rows[0].old, null);
  await assert.rejects(db.query("select set_product_photo($1,$2,$3)", [orgA, shown, `${orgB}/${shown}/x.jpg`]), /invalid_photo/);
  await assert.rejects(db.query("select set_product_photo($1,$2,$3)", [orgA, shown, `${orgA}/${shown}/../x.jpg`]), /invalid_photo/);
  await user(b);
  await assert.rejects(db.query("select set_product_photo($1,$2,null)", [orgA, shown]), /not_a_member/);
  assert.equal((await catalog(token)).products.find((p) => p.id === shown).photo, photo);
  await user(seller);
  assert.equal((await db.query("select set_product_photo($1,$2,null) as old", [orgA, shown])).rows[0].old, photo);
  assert.equal((await catalog(token)).products.find((p) => p.id === shown).photo, null);
  // Страница клиента: ссылка каталога его магазина — пока каталог включён.
  await owner();
  const clientLink = (
    await db.query("insert into share_links(organization_id,customer_id) select $1, id from customers where organization_id=$1 limit 1 returning token", [orgA])
  ).rows[0].token;
  await db.exec("SET ROLE anon;");
  assert.equal((await db.query("select get_catalog_token_by_link($1) as t", [clientLink])).rows[0].t, token);
  assert.equal((await db.query("select get_catalog_token_by_link($1) as t", ["0".repeat(32)])).rows[0].t, null);
  await owner();
  assert.equal(await catalog("not-a-token"), null);

  // Выключили — ссылка не открывается; включили снова — новая, старая мертва.
  await user(a);
  await db.query("select close_catalog_link($1)", [orgA]);
  assert.equal(await catalog(token), null);
  await db.exec("SET ROLE anon;");
  assert.equal((await db.query("select get_catalog_token_by_link($1) as t", [clientLink])).rows[0].t, null);
  await owner();
  await user(a);
  const fresh = (await db.query("select open_catalog_link($1) as t", [orgA])).rows[0].t;
  assert.notEqual(fresh, token);
  assert.equal(await catalog(token), null);
  assert.ok((await catalog(fresh)).products.length > 0);
  // Вернуть скрытый; архивный, скрытый раньше, при этом не трогается.
  await owner();
  await db.query("update products set catalog_hidden=true where id=$1", [old]);
  await user(a);
  await db.query("select set_catalog_visibility($1,'{}'::uuid[],$2::uuid[])", [orgA, [hidden]]);
  assert.ok((await catalog(fresh)).products.some((p) => p.id === hidden));
  await owner();
  assert.equal((await db.query("select catalog_hidden from products where id=$1", [old])).rows[0].catalog_hidden, true);
  await owner();
});
test("review fixes: disabled seller cannot delete, client link hides notes, reopen is not on someone else's name, «Исправить» reuses its photo copy", async () => {
  const k = (n) => `aaaadddd-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const seller = "44444444-4444-4444-8444-444444444444";
  const otherSeller = "55555555-5555-4555-8555-555555555555";
  await owner();
  const breaker = (await db.query("select id from products where organization_id=$1 and name='Автомат 16А возврат'", [orgA])).rows[0].id;
  const line = JSON.stringify([{ product: breaker, qty: "1", price: "360" }]);

  // 1. Отключённый сотрудник не удаляет — ни клиента без записей, ни черновик.
  const empty = (await db.query("insert into customers(organization_id,name) values ($1,'Пустой клиент') returning id", [orgA])).rows[0].id;
  await user(seller);
  const draft = (await db.query("select save_record_draft($1,null,'sale','{}'::jsonb) as id", [orgA])).rows[0].id;
  await user(a);
  await db.query("select set_member_disabled($1,$2,true)", [orgA, seller]);
  await user(seller);
  await assert.rejects(db.query("select delete_party($1,'customers',$2)", [orgA, empty]), /member|not_a/);
  await assert.rejects(db.query("select delete_record_draft($1,$2)", [orgA, draft]), /member|not_a/);
  await owner();
  assert.equal((await db.query("select count(*)::int as n from customers where id=$1", [empty])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from record_drafts where id=$1", [draft])).rows[0].n, 1);
  await user(a);
  await db.query("select set_member_disabled($1,$2,false)", [orgA, seller]);

  // 2. По ссылке клиента комментарии к оплатам не видны.
  await owner();
  const buyer = (await db.query("insert into customers(organization_id,name) values ($1,'Клиент со ссылкой') returning id", [orgA])).rows[0].id;
  await db.query(
    "insert into payments(organization_id,customer_id,direction,amount,status,idempotency_key,created_by,note) values ($1,$2,'incoming',100,'confirmed',$3,$4,'внутреннее: ненадёжный')",
    [orgA, buyer, k(1), a],
  );
  const token = (await db.query("insert into share_links(organization_id,customer_id) values ($1,$2) returning token", [orgA, buyer])).rows[0].token;
  await db.exec("SET ROLE anon;");
  const statement = (await db.query("select get_statement_by_token($1) as s", [token])).rows[0].s;
  await owner();
  assert.ok(statement.entries.length > 0);
  assert.ok(statement.entries.every((e) => !("note" in e)));

  // 3. «Открыть заново» чужой отменённой продажи продавцом — за ним самим.
  await user(seller);
  const sellers = (await db.query("select commit_sale_items($1,$2,$3,false,$4) as id", [orgA, buyer, line, k(2)])).rows[0].id;
  await user(a);
  await db.query("select reverse_sale($1,$2,'Ошибка')", [orgA, sellers]);
  await user(otherSeller);
  await assert.rejects(
    db.query("select commit_sale_items_correction($1,$2,$3,$4,$5,false,$6)", [sellers, seller, orgA, buyer, line, k(3)]),
    /owner_only/,
  );
  const reopened = (
    await db.query("select commit_sale_items_correction($1,null,$2,$3,$4,false,$5) as id", [sellers, orgA, buyer, line, k(4)])
  ).rows[0].id;
  await owner();
  assert.equal((await db.query("select maker_id from sales where id=$1", [reopened])).rows[0].maker_id, otherSeller);

  // 4. «Исправить» дважды без записи — одна и та же копия фото.
  const doc = (
    await db.query(
      "insert into documents(organization_id,storage_path,file_hash,mime_type,kind,status) values ($1,$2,'rev-1','image/jpeg','sale','digitized') returning id",
      [orgA, `${orgA}/sale/rev-1.jpg`],
    )
  ).rows[0].id;
  const photoSale = (
    await db.query(
      "insert into sales(organization_id,customer_id,total,status,document_id,idempotency_key,created_by) values ($1,$2,50,'posted',$3,$4,$5) returning id",
      [orgA, buyer, doc, k(5), a],
    )
  ).rows[0].id;
  await user(a);
  const first = (await db.query("select start_correction($1,'sale',$2) as id", [orgA, photoSale])).rows[0].id;
  const second = (await db.query("select start_correction($1,'sale',$2) as id", [orgA, photoSale])).rows[0].id;
  assert.equal(second, first);
  await owner();
  assert.equal((await db.query("select count(*)::int as n from documents where file_hash='rev-1'")).rows[0].n, 2);
});
test("cash moves: only the owner takes or puts cash, once per key, reversible, other shops see nothing", async () => {
  const k = (n) => `aaaabbbb-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  await user(a);
  const out = (await db.query("select commit_cash_move($1,'out','5000','Выручку домой',$2) as id", [orgA, k(1)])).rows[0].id;
  assert.equal((await db.query("select commit_cash_move($1,'out','5000','Выручку домой',$2) as id", [orgA, k(1)])).rows[0].id, out);
  await db.query("select commit_cash_move($1,'in','1000','Размен',$2)", [orgA, k(2)]);
  assert.deepEqual(
    (await db.query("select direction,amount,note,currency from cash_moves where organization_id=$1 order by direction", [orgA])).rows,
    [
      { direction: "in", amount: "1000.00", note: "Размен", currency: "KGS" },
      { direction: "out", amount: "5000.00", note: "Выручку домой", currency: "KGS" },
    ],
  );
  await assert.rejects(db.query("select commit_cash_move($1,'out','-5',null,$2)", [orgA, k(3)]), /invalid_cash_move/);
  await assert.rejects(db.query("select commit_cash_move($1,'sideways','5',null,$2)", [orgA, k(4)]), /invalid_cash_move/);
  await assert.rejects(db.query("insert into cash_moves(organization_id,direction,amount,currency,idempotency_key) values ($1,'in',1,'KGS',$2)", [orgA, k(5)]), /permission denied/);
  await db.query("select reverse_cash_move($1,$2)", [orgA, out]);
  await assert.rejects(db.query("select reverse_cash_move($1,$2)", [orgA, out]), /invalid_cash_move/);
  // Чужой магазин: не видит и не пишет.
  await user(b);
  assert.equal((await db.query("select * from cash_moves")).rows.length, 0);
  await assert.rejects(db.query("select commit_cash_move($1,'out','1',null,$2)", [orgA, k(6)]), /owner_only/);
  await owner();
});

test("categories: two levels, members sort products, owner deletes without losing products, Excel and the catalog", async () => {
  const seller = "44444444-4444-4444-8444-444444444444";
  await owner();
  const lamp = (await db.query("insert into products(organization_id,name,sale_price) values ($1,'Кат лампа',10) returning id", [orgA])).rows[0].id;
  const spot = (await db.query("insert into products(organization_id,name,sale_price) values ($1,'Кат светильник',20) returning id", [orgA])).rows[0].id;
  const manual = (await db.query("insert into products(organization_id,name,sku,sale_price) values ($1,'Кат ручной','KAT-1',30) returning id", [orgA])).rows[0].id;

  await user(seller);
  const light = (await db.query("select save_product_category($1,null,'  Освещение ') as id", [orgA])).rows[0].id;
  const spots = (await db.query("select save_product_category($1,null,'Светильники',$2) as id", [orgA, light])).rows[0].id;
  // Имя на уровне одно (без учёта регистра); третьего уровня нет.
  await assert.rejects(db.query("select save_product_category($1,null,'освещение')", [orgA]), /category_taken/);
  await assert.rejects(db.query("select save_product_category($1,null,'Глубже',$2)", [orgA, spots]), /invalid_category/);
  await assert.rejects(db.query("select save_product_category($1,null,'   ')", [orgA]), /invalid_category/);
  assert.equal((await db.query("select set_products_category($1,$2::uuid[],$3) as n", [orgA, [spot], spots])).rows[0].n, 1);
  assert.equal((await db.query("select set_products_category($1,$2::uuid[],$3) as n", [orgA, [spot], spots])).rows[0].n, 0);
  assert.equal((await db.query("select set_products_category($1,$2::uuid[],$3) as n", [orgA, [manual], light])).rows[0].n, 1);
  // Предложенные группы: только товарам без категории.
  assert.equal(
    (await db.query("select apply_category_groups($1,$2::jsonb) as n", [orgA, JSON.stringify([{ name: "Лампы", products: [lamp, manual] }])])).rows[0].n,
    1,
  );
  const lamps = (await db.query("select id from product_categories where organization_id=$1 and name='Лампы'", [orgA])).rows[0].id;
  assert.equal((await db.query("select category_id from products where id=$1", [manual])).rows[0].category_id, light);
  assert.equal((await db.query("select category_id from product_balances where id=$1", [lamp])).rows[0].category_id, lamps);

  // Чужой магазин — ничего не видит и не меняет.
  await user(b);
  assert.equal((await db.query("select count(*)::int as n from product_categories where organization_id=$1", [orgA])).rows[0].n, 0);
  await assert.rejects(db.query("select set_products_category($1,$2::uuid[],null)", [orgA, [spot]]), /not_a_member/);
  await assert.rejects(db.query("select set_products_category($1,$2::uuid[],$3)", [orgB, [spot], light]), /not_a_member|invalid_category/);

  // Excel: только владелец; по коду, подкатегория создаётся; пустая категория ничего не меняет.
  await user(seller);
  await assert.rejects(
    db.query("select set_import_categories($1,$2::jsonb)", [orgA, JSON.stringify([{ sku: "kat-1", name: "кат ручной", category: "Лампы" }])]),
    /owner_only/,
  );
  await assert.rejects(db.query("select import_products($1,$2)", [orgA, JSON.stringify([{ name: "Продавец грузит" }])]), /owner_only/);
  await user(a);
  assert.equal(
    (
      await db.query("select set_import_categories($1,$2::jsonb) as n", [
        orgA,
        JSON.stringify([
          { sku: "kat-1", name: "кат ручной", category: "освещение", subcategory: "Бра" },
          // Код чужой (название другое) — товар с этим кодом не трогаем.
          { sku: "KAT-1", name: "Совсем другой товар", category: "Лампы", subcategory: "" },
          { sku: null, name: "Кат лампа", category: "", subcategory: "" },
          { sku: null, name: "Нет такого", category: "Лампы", subcategory: "" },
        ]),
      ])
    ).rows[0].n,
    1,
  );
  const bra = (await db.query("select id,parent_id from product_categories where organization_id=$1 and name='Бра'", [orgA])).rows[0];
  assert.equal(bra.parent_id, light);
  assert.equal((await db.query("select category_id from products where id=$1", [manual])).rows[0].category_id, bra.id);
  assert.equal((await db.query("select category_id from products where id=$1", [lamp])).rows[0].category_id, lamps);

  // Каталог: категория товара и только категории с видимыми товарами.
  await user(a);
  const token = (await db.query("select open_catalog_link($1) as t", [orgA])).rows[0].t;
  await owner();
  await db.exec("SET ROLE anon;");
  const page = (await db.query("select get_catalog($1) as c", [token])).rows[0].c;
  await owner();
  assert.equal(page.products.find((p) => p.id === spot).category, spots);
  const names = page.categories.map((c) => c.name).sort();
  assert.deepEqual(names, ["Бра", "Лампы", "Освещение", "Светильники"]);

  // Удаляет только владелец; товары подкатегории — в её категорию, категории — без категории.
  await user(seller);
  await assert.rejects(db.query("select delete_product_category($1,$2)", [orgA, spots]), /owner_only/);
  await user(a);
  assert.equal((await db.query("select delete_product_category($1,$2) as n", [orgA, spots])).rows[0].n, 1);
  assert.equal((await db.query("select category_id from products where id=$1", [spot])).rows[0].category_id, light);
  assert.equal((await db.query("select delete_product_category($1,$2) as n", [orgA, light])).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int as n from products where id = any($1::uuid[]) and category_id is null", [[spot, manual]])).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int as n from product_categories where organization_id=$1", [orgA])).rows[0].n, 1);
  assert.ok((await db.query("select count(*)::int as n from audit_events where organization_id=$1 and action like 'category.%'", [orgA])).rows[0].n >= 5);
  await owner();
});
test("app_schema_version() returns the newest migration number for the pre-deploy check", async () => {
  const { latestMigration } = await import("../scripts/migration-version.mjs");
  await owner();
  assert.equal((await db.query("select public.app_schema_version() as v")).rows[0].v, latestMigration().version);
});

test("invoice of a staff sale: the staff member's name and the shop phone, not the shop's seller from settings", async () => {
  const staff = "77777777-7777-4777-8777-777777777777";
  const info = async (sale) => (await db.query("select private.sale_invoice_info($1,$2) as i", [orgA, sale])).rows[0].i;
  await owner();
  await db.query("insert into auth.users values ($1) on conflict do nothing", [staff]);
  await db.query(
    "insert into organization_members(organization_id,user_id,role,display_name) values ($1,$2,'staff','Асад') on conflict do nothing",
    [orgA, staff],
  );
  await db.query("update organizations set seller_name='Маликнур', seller_phone='+996 220 934 210', phone='+996 555 000 111' where id=$1", [orgA]);
  const buyer = (await db.query("insert into customers(organization_id,name) values ($1,'Накладная Улан') returning id", [orgA])).rows[0].id;
  const sell = async (by, key) =>
    (
      await db.query(
        "insert into sales(organization_id,customer_id,total,status,idempotency_key,created_by) values ($1,$2,100,'posted',$3,$4) returning id",
        [orgA, buyer, key, by],
      )
    ).rows[0].id;
  const staffSale = await sell(staff, "aaaa9999-0000-4000-8000-000000000001");
  // Имя для накладной не задано — имя в команде и телефон магазина.
  let i = await info(staffSale);
  assert.deepEqual([i.staff_seller_name, i.staff_seller_phone], ["Асад", "+996 555 000 111"]);
  // Задал своё — оно.
  await db.query("update organization_members set invoice_name='Асад Б.', invoice_phone='+996 700 1' where organization_id=$1 and user_id=$2", [orgA, staff]);
  i = await info(staffSale);
  assert.deepEqual([i.staff_seller_name, i.staff_seller_phone], ["Асад Б.", "+996 700 1"]);
  // Продажа владельца — как раньше: «Продавец» из Настроек магазина.
  i = await info(await sell(a, "aaaa9999-0000-4000-8000-000000000002"));
  assert.deepEqual([i.staff_seller_name ?? null, i.shop_seller_name], [null, "Маликнур"]);
  // Владелец исправил продажу и выбрал продавца (made_by) — на накладной продавец.
  const fixed = await sell(a, "aaaa9999-0000-4000-8000-000000000003");
  await db.query("update sales set made_by=$2 where id=$1", [fixed, staff]);
  i = await info(fixed);
  assert.equal(i.staff_seller_name, "Асад Б.");
});

test("catalog orders: a customer orders by the catalog link, prices come from stock, the shop makes a sale from it", async () => {
  const k = (n) => `aaaadddd-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const seller = "44444444-4444-4444-8444-444444444444";
  await user(a);
  const token = (await db.query("select open_catalog_link($1) as t", [orgA])).rows[0].t;
  await owner();
  const lamp = (await db.query("select id from products where organization_id=$1 and name='Автомат 16А возврат'", [orgA])).rows[0].id;
  const hidden = (
    await db.query("insert into products(organization_id,name,sale_price,catalog_hidden) values ($1,'Заказ скрытый',10,true) returning id", [orgA])
  ).rows[0].id;
  const buyer = (await db.query("insert into customers(organization_id,name,phone) values ($1,'Заказ Айгуль','+996555123456') returning id", [orgA])).rows[0].id;
  const clientLink = (await db.query("insert into share_links(organization_id,customer_id) values ($1,$2) returning token", [orgA, buyer])).rows[0].token;
  const otherBuyer = (await db.query("insert into customers(organization_id,name) values ($1,'Чужой клиент') returning id", [orgB])).rows[0].id;
  const otherLink = (await db.query("insert into share_links(organization_id,customer_id) values ($1,$2) returning token", [orgB, otherBuyer])).rows[0].token;

  const submit = async (items, phone, client = null, catalog = token) => {
    await owner();
    await db.exec("SET ROLE anon;");
    try {
      return (
        await db.query("select submit_catalog_order($1,$2::jsonb,'  Айгуль  ',$3,'к вечеру',$4) as id", [catalog, JSON.stringify(items), phone, client])
      ).rows[0].id;
    } finally {
      await owner();
    }
  };
  // Без телефона и не с личной страницы — нельзя; мусор и чужие ссылки — отказ.
  await assert.rejects(submit([{ id: lamp, qty: "2" }], null), /phone_required/);
  await assert.rejects(submit([{ id: lamp, qty: "2" }], "12"), /invalid_phone/);
  await assert.rejects(submit([{ id: lamp, qty: "2" }], null, otherLink), /phone_required/);
  await assert.rejects(submit([], "+996 555 000 222"), /invalid_order/);
  await assert.rejects(submit([{ id: lamp, qty: "0" }], "+996 555 000 222"), /invalid_order/);
  await assert.rejects(submit([{ id: lamp, qty: "abc" }], "+996 555 000 222"), /invalid_order/);
  await assert.rejects(submit([{ id: "not-a-uuid", qty: "1" }], "+996 555 000 222"), /invalid_order/);
  await assert.rejects(submit([{ id: lamp, qty: "1" }, { id: lamp, qty: "2" }], "+996 555 000 222"), /invalid_order/);
  await assert.rejects(submit([{ id: hidden, qty: "1" }], "+996 555 000 222"), /order_changed/);
  await assert.rejects(submit([{ id: lamp, qty: "1" }], "+996 555 000 222", null, "0".repeat(32)), /invalid_catalog/);

  // Цена — со склада, даже если браузер прислал свою.
  const order = await submit([{ id: lamp, qty: "2.5", price: "1" }], "+996 555 000 222");
  const row = (await db.query("select * from catalog_orders where id=$1", [order])).rows[0];
  assert.equal(row.status, "new");
  assert.equal(row.buyer_name, "Айгуль");
  assert.equal(row.note, "к вечеру");
  assert.equal(row.customer_id, null);
  assert.equal(row.total, "900.00");
  assert.deepEqual(row.items, [{ product_id: lamp, name: "Автомат 16А возврат", unit: row.items[0].unit, qty: "2.5", price: "360.00" }]);
  // С личной страницы клиента — заказ сразу его, телефон не нужен.
  const mine = await submit([{ id: lamp, qty: "1" }], null, clientLink);
  assert.equal((await db.query("select customer_id from catalog_orders where id=$1", [mine])).rows[0].customer_id, buyer);

  // Видят только в своём магазине; продавец — тоже.
  await user(b);
  assert.equal((await db.query("select count(*)::int as n from catalog_orders")).rows[0].n, 0);
  await assert.rejects(db.query("select set_catalog_order_dismissed($1,$2,true)", [orgA, order]), /not_a_member/);
  await user(seller);
  assert.equal((await db.query("select count(*)::int as n from catalog_orders where organization_id=$1", [orgA])).rows[0].n, 2);

  // «Сделать продажу»: только со своим черновиком.
  const draft = (
    await db.query("select save_record_draft($1,null,'sale',$2::jsonb) as id", [orgA, JSON.stringify({ party: buyer, lines: [] })])
  ).rows[0].id;
  await user(a);
  await assert.rejects(db.query("select accept_catalog_order($1,$2,$3)", [orgA, mine, draft]), /invalid_draft/);
  await user(seller);
  await db.query("select accept_catalog_order($1,$2,$3)", [orgA, mine, draft]);
  // Владелец не перехватит начатый продавцом заказ, пока черновик продавца жив.
  await user(a);
  const ownerDraft = (
    await db.query("select save_record_draft($1,null,'sale',$2::jsonb) as id", [orgA, JSON.stringify({ party: buyer, lines: [] })])
  ).rows[0].id;
  await assert.rejects(db.query("select accept_catalog_order($1,$2,$3)", [orgA, mine, ownerDraft]), /order_in_progress/);
  await db.query("select delete_record_draft($1,$2)", [orgA, ownerDraft]);
  await user(seller);
  // Черновик не от заказа — продажа заказ не трогает.
  const line = JSON.stringify([{ product: lamp, qty: "1", price: "360" }]);
  const sale = (await db.query("select commit_sale_items($1,$2,$3,false,$4) as id", [orgA, buyer, line, k(1)])).rows[0].id;
  assert.equal((await db.query("select complete_catalog_order($1,$2,$3) as ok", [orgA, k(2), sale])).rows[0].ok, false);
  assert.equal((await db.query("select complete_catalog_order($1,$2,$3) as ok", [orgA, draft, sale])).rows[0].ok, true);
  let state = (await db.query("select status,sale_id,handled_by from catalog_orders where id=$1", [mine])).rows[0];
  assert.deepEqual([state.status, state.sale_id, state.handled_by], ["sold", sale, seller]);
  // Проданный не убрать и не начать заново.
  await assert.rejects(db.query("select set_catalog_order_dismissed($1,$2,true)", [orgA, mine]), /order_handled/);
  await assert.rejects(db.query("select accept_catalog_order($1,$2,$3)", [orgA, mine, draft]), /order_handled/);

  // «Убрать» и «Вернуть».
  await db.query("select set_catalog_order_dismissed($1,$2,true)", [orgA, order]);
  await assert.rejects(db.query("select set_catalog_order_dismissed($1,$2,true)", [orgA, order]), /order_handled/);
  await db.query("select set_catalog_order_dismissed($1,$2,false)", [orgA, order]);
  state = (await db.query("select status from catalog_orders where id=$1", [order])).rows[0];
  assert.equal(state.status, "new");

  // «Мои заказы» для клиента: только товары, сумма, статус — без телефона и имени.
  await owner();
  await db.exec("SET ROLE anon;");
  const byIds = (await db.query("select get_catalog_orders($1,$2::uuid[]) as v", [token, [order, k(9)]])).rows[0].v;
  assert.deepEqual(byIds.map((o) => [o.id, o.status, o.total]), [[order, "new", "900.00"]]);
  assert.deepEqual(Object.keys(byIds[0]).sort(), ["created_at", "id", "items", "status", "total"]);
  assert.deepEqual(byIds[0].items, [{ name: "Автомат 16А возврат", unit: row.items[0].unit, qty: "2.5", price: "360.00" }]);
  assert.deepEqual((await db.query("select get_catalog_orders($1,$2::uuid[]) as v", ["0".repeat(32), [order]])).rows[0].v, []);
  const clientOrders = (await db.query("select get_client_orders($1) as v", [clientLink])).rows[0].v;
  assert.deepEqual(clientOrders.map((o) => [o.id, o.status, o.sale_id]), [[mine, "sold", sale]]);
  assert.deepEqual((await db.query("select get_client_orders($1) as v", [otherLink])).rows[0].v, []);
  await owner();
  await user(seller);

  // Напрямую в таблицу — нельзя ни клиенту, ни продавцу.
  await assert.rejects(db.query("update catalog_orders set status='sold' where id=$1", [order]), /permission denied/);
  await owner();
  await db.exec("SET ROLE anon;");
  await assert.rejects(db.query("select * from catalog_orders"), /permission denied/);
  await owner();
  assert.deepEqual(
    (await db.query("select action from audit_events where organization_id=$1 and action like 'catalog_order.%' order by created_at, action", [orgA])).rows.map((r) => r.action),
    ["catalog_order.submitted", "catalog_order.submitted", "catalog_order.accepted", "catalog_order.sold", "catalog_order.dismissed", "catalog_order.restored"],
  );
});

test("business profile: existing shops stay untouched, only the owner sets the type, every change is logged", async () => {
  const seller = "44444444-4444-4444-8444-444444444444";
  await owner();
  // Миграция только добавила пустые колонки — у всех магазинов null, как было.
  const before = (await db.query("select count(*)::int as n from organizations where business_type is not null or module_overrides is not null")).rows[0].n;
  assert.equal(before, 0);
  const sales = (await db.query("select count(*)::int as n from sales where organization_id=$1", [orgA])).rows[0].n;

  // Продавец, чужой и аноним — нельзя.
  await user(seller);
  await assert.rejects(db.query("select set_business_profile($1,'restaurant',null)", [orgA]), /owner_required/);
  await user(b);
  await assert.rejects(db.query("select set_business_profile($1,'restaurant',null)", [orgA]), /owner_required/);
  await owner();
  await db.exec("SET ROLE anon;");
  await assert.rejects(db.query("select set_business_profile($1,'restaurant',null)", [orgA]), /permission denied/);
  await owner();
  // Напрямую колонку не поменять даже владельцу.
  await user(a);
  await assert.rejects(db.query("update organizations set business_type='restaurant' where id=$1", [orgA]), /permission denied/);

  // Мусор — отказ.
  await assert.rejects(db.query("select set_business_profile($1,'Ресторан',null)", [orgA]), /invalid_business_type/);
  await assert.rejects(db.query("select set_business_profile($1,'restaurant',array['catalog'])", [orgA]), /invalid_modules/);
  await assert.rejects(db.query("select set_business_profile($1,'restaurant',array['+catalog',null])", [orgA]), /invalid_modules/);

  // Владелец: вид и поправки; пустой список поправок хранится как null.
  await db.query("select set_business_profile($1,'restaurant',array['+catalog','-stock'])", [orgA]);
  let row = (await db.query("select business_type,module_overrides from organizations where id=$1", [orgA])).rows[0];
  assert.deepEqual([row.business_type, row.module_overrides], ["restaurant", ["+catalog", "-stock"]]);
  await db.query("select set_business_profile($1,'shop','{}')", [orgA]);
  row = (await db.query("select business_type,module_overrides from organizations where id=$1", [orgA])).rows[0];
  assert.deepEqual([row.business_type, row.module_overrides], ["shop", null]);
  await db.query("select set_business_profile($1,null,null)", [orgA]);

  await owner();
  // Чужой магазин и записи не тронуты.
  row = (await db.query("select business_type,module_overrides from organizations where id=$1", [orgB])).rows[0];
  assert.deepEqual([row.business_type, row.module_overrides], [null, null]);
  assert.equal((await db.query("select count(*)::int as n from sales where organization_id=$1", [orgA])).rows[0].n, sales);
  const log = (
    await db.query("select actor_id,metadata from audit_events where organization_id=$1 and action='organization.business_profile' order by created_at", [orgA])
  ).rows;
  assert.equal(log.length, 3);
  assert.equal(log[0].actor_id, a);
  assert.deepEqual(log[0].metadata, {
    from: { type: null, modules: null },
    to: { type: "restaurant", modules: ["+catalog", "-stock"] },
  });
});

test("product models: sizes and colors become ordinary products, existing products stay untouched", async () => {
  const seller = "44444444-4444-4444-8444-444444444444";
  await owner();
  // Миграция: у всех прежних товаров колонки пустые.
  assert.equal((await db.query("select count(*)::int as n from products where model_id is not null or variant_attrs is not null")).rows[0].n, 0);
  const before = (await db.query("select id,name,sale_price from products where organization_id=$1 order by id", [orgA])).rows;

  const axes = (sizes, colors = ["Чёрный"]) => JSON.stringify([{ key: "size", values: sizes }, { key: "color", values: colors }]);
  const rows = (list) => JSON.stringify(list.map(([size, color, qty]) => ({ attrs: { size, color }, qty })));
  const save = (model, name, ax, rs, price = "1200", apply = false) =>
    db.query("select save_product_model($1,$2,$3,$4::jsonb,$5::jsonb,$6,'700',null,$7) as id", [orgA, model, name, ax, rs, price, apply]);

  // Продавец тоже может (товары меняют все участники), чужой — нет.
  await user(b);
  await assert.rejects(save(null, "Футболка", axes(["S"]), rows([["S", "Чёрный", "1"]])), /not_a_member/);
  await user(seller);
  const model = (await save(null, " Футболка  Nike ", axes(["S", "M"]), rows([["S", "Чёрный", "3"], ["M", "Чёрный", "0"]]))).rows[0].id;
  await owner();
  let variants = (
    await db.query(
      "select p.name,p.unit,p.sale_price,p.purchase_price,p.variant_attrs,b.stock from products p join product_balances b on b.id=p.id where p.model_id=$1 order by p.name",
      [model],
    )
  ).rows;
  assert.deepEqual(
    variants.map((v) => [v.name, v.unit, v.sale_price, v.purchase_price, Number(v.stock)]),
    [
      ["Футболка Nike (M, Чёрный)", "шт", "1200.00", "700.00", 0],
      ["Футболка Nike (S, Чёрный)", "шт", "1200.00", "700.00", 3],
    ],
  );
  assert.deepEqual(variants[1].variant_attrs, { size: "S", color: "Чёрный" });

  // Новый размер и цвет: создаются только недостающие, старые не задваиваются и не меняются.
  await user(a);
  await save(model, "другое имя", axes(["S", "M", "L"], ["Чёрный", "Белый"]), rows([["S", "Чёрный", "5"], ["L", "Белый", "2"]]), "1500");
  await owner();
  variants = (await db.query("select name,sale_price from products where model_id=$1 order by name", [model])).rows;
  assert.deepEqual(
    variants.map((v) => [v.name, v.sale_price]),
    [
      ["Футболка Nike (L, Белый)", "1500.00"],
      ["Футболка Nike (M, Чёрный)", "1200.00"],
      ["Футболка Nike (S, Чёрный)", "1200.00"],
    ],
  );
  const s = (await db.query("select b.stock from products p join product_balances b on b.id=p.id where p.name='Футболка Nike (S, Чёрный)'")).rows[0];
  assert.equal(Number(s.stock), 3, "an existing size keeps its stock");
  assert.deepEqual((await db.query("select axes from product_models where id=$1", [model])).rows[0].axes[0].values, ["S", "M", "L"]);

  // «Цена для всех размеров» — только товарам этой модели.
  await user(a);
  await save(model, null, axes(["S", "M", "L"], ["Чёрный", "Белый"]), "[]", "1300", true);
  await owner();
  assert.deepEqual(
    (await db.query("select distinct sale_price from products where model_id=$1", [model])).rows.map((r) => r.sale_price),
    ["1300.00"],
  );
  assert.deepEqual((await db.query("select id,name,sale_price from products where organization_id=$1 and model_id is null order by id", [orgA])).rows, before);

  // Мусор и занятые названия — отказ, ничего не создаётся.
  await user(a);
  await assert.rejects(save(null, "Куртка", axes(["S", "s"]), rows([["S", "Чёрный", "1"]])), /invalid_axes/);
  await assert.rejects(save(null, "Куртка", axes(["S"]), rows([["XL", "Чёрный", "1"]])), /invalid_variants/);
  await assert.rejects(save(null, "Куртка", axes(["S"]), JSON.stringify([{ attrs: { size: "S" }, qty: "1" }])), /invalid_variants/);
  await assert.rejects(save(null, "Куртка", axes(["S"]), rows([["S", "Чёрный", "-1"]])), /invalid_variants/);
  await assert.rejects(save(null, "Куртка", axes(["S"]), "[]"), /invalid_variants/);
  await assert.rejects(save(null, "Футболка Nike", axes(["M"]), rows([["M", "Чёрный", "1"]])), /name_taken/);
  await owner();
  assert.equal((await db.query("select count(*)::int as n from product_models where organization_id=$1", [orgA])).rows[0].n, 1);

  // Чужой магазин не видит модели; напрямую в таблицу не написать.
  await user(b);
  assert.equal((await db.query("select count(*)::int as n from product_models")).rows[0].n, 0);
  await assert.rejects(db.query("insert into product_models(organization_id,name,axes) values ($1,'x','[]')", [orgB]), /permission denied/);
  await owner();
  assert.ok((await db.query("select count(*)::int as n from audit_events where action='product_model.saved' and entity_id=$1", [model])).rows[0].n >= 3);
});

test("catalog: products of a model carry the model and size, models come with their order of sizes", async () => {
  await user(a);
  const token = (await db.query("select open_catalog_link($1) as t", [orgA])).rows[0].t;
  await owner();
  await db.exec("SET ROLE anon;");
  const catalog = (await db.query("select get_catalog($1) as c", [token])).rows[0].c;
  await owner();
  const shirt = catalog.products.find((p) => p.name === "Футболка Nike (M, Чёрный)");
  assert.ok(shirt.model);
  assert.deepEqual(shirt.variant, { size: "M", color: "Чёрный" });
  assert.deepEqual(
    catalog.models.map((m) => [m.id, m.name, m.axes[0].values]),
    [[shirt.model, "Футболка Nike", ["S", "M", "L"]]],
  );
  // Обычные товары — как раньше, без модели.
  const plain = catalog.products.find((p) => p.name === "Автомат 16А возврат");
  assert.equal(plain.model, null);
  assert.equal(plain.variant, null);
  assert.deepEqual(Object.keys(catalog).sort(), ["categories", "currency", "models", "products", "shop_name", "shop_phone"]);
});

test("product models: unit and minimum come from the form, new colors keep the model's unit", async () => {
  const axes = (colors) => JSON.stringify([{ key: "color", values: colors }]);
  const rows = (colors) => JSON.stringify(colors.map((color) => ({ attrs: { color }, qty: "0" })));
  const save = (model, colors, unit, min = "0") =>
    db.query("select save_product_model($1,$2,'Габардин',$3::jsonb,$4::jsonb,'450','300',null,false,$5,$6) as id", [
      orgA, model, axes(colors), rows(colors), unit, min,
    ]);
  await user(a);
  const model = (await save(null, ["Чёрный", "Белый"], "м", "5")).rows[0].id;
  // К модели в метрах добавили цвет — тоже метры и тот же минимум, что бы ни прислала форма.
  await save(model, ["Чёрный", "Белый", "Красный"], "шт");
  await assert.rejects(save(null, ["Синий"], "ведро"), /invalid_unit/);
  await assert.rejects(save(null, ["Синий"], "м", "-1"), /invalid_qty/);
  await owner();
  assert.deepEqual(
    (await db.query("select name,unit,min_stock from products where model_id=$1 order by name", [model])).rows.map((r) => [
      r.name, r.unit, Number(r.min_stock),
    ]),
    [
      ["Габардин (Белый)", "м", 5],
      ["Габардин (Красный)", "м", 5],
      ["Габардин (Чёрный)", "м", 5],
    ],
  );
  assert.equal((await db.query("select count(*)::int as n from product_models where organization_id=$1 and name='Габардин'", [orgA])).rows[0].n, 1);
});

test("push: each member subscribes own phone; only the server with the secret gets targets; orders to all, claims to owners", async () => {
  const seller = "44444444-4444-4444-8444-444444444444";
  const sub = (n) => [`https://push.example.com/${n}`, `key${n}`, `auth${n}`];
  // Тестовый секрет вместо настоящего (в миграции — хеш секрета из Vercel).
  await owner();
  await db.query("update private.push_settings set secret_hash = encode(sha256(convert_to('test-secret','UTF8')),'hex')");

  await user(a);
  await db.query("select save_push_subscription($1,$2,$3,$4,'Chrome')", [orgA, ...sub(1)]);
  await user(seller);
  await db.query("select save_push_subscription($1,$2,$3,$4,null)", [orgA, ...sub(2)]);
  await assert.rejects(db.query("select save_push_subscription($1,'http://x','k','a',null)", [orgA]), /invalid_subscription/);
  // Видит только свои телефоны; напрямую в таблицу не написать.
  assert.deepEqual((await db.query("select endpoint from push_subscriptions")).rows.map((r) => r.endpoint), [sub(2)[0]]);
  await assert.rejects(db.query("insert into push_subscriptions(organization_id,user_id,endpoint,p256dh,auth) values ($1,$2,'https://x','k','a')", [orgA, seller]), /permission denied/);
  // Чужой магазин — нельзя.
  await user(b);
  await assert.rejects(db.query("select save_push_subscription($1,$2,$3,$4,null)", [orgA, ...sub(3)]), /not_a_member/);

  // Без секрета — никому (и вошедшему тоже).
  await owner();
  const order = (await db.query("select id from catalog_orders where organization_id=$1 and status='new' limit 1", [orgA])).rows[0].id;
  await user(a);
  await assert.rejects(db.query("select push_targets('wrong',$1,$2)", ["order", order]), /forbidden/);
  await owner();
  await db.exec("SET ROLE anon;");
  await assert.rejects(db.query("select push_targets(null,$1,$2)", ["order", order]), /forbidden/);
  const forOrder = (await db.query("select push_targets('test-secret','order',$1) as t", [order])).rows[0].t;
  assert.deepEqual(forOrder.targets.map((t) => t.endpoint).sort(), [sub(1)[0], sub(2)[0]]);
  assert.equal(forOrder.kind, "order");
  assert.ok(Number(forOrder.total) > 0);

  // Заявка «Я оплатил» — только владельцу.
  await owner();
  const claim = (await db.query("select id from payments where organization_id=$1 and status='pending' limit 1", [orgA])).rows[0]?.id;
  assert.ok(claim, "a pending claim exists from the claims test");
  if (claim) {
    await db.exec("SET ROLE anon;");
    const forClaim = (await db.query("select push_targets('test-secret','claim',$1) as t", [claim])).rows[0].t;
    assert.deepEqual(forClaim.targets.map((t) => t.endpoint), [sub(1)[0]]);
    await owner();
  }
  // Уже обработанное или чужое — пусто.
  await db.exec("SET ROLE anon;");
  assert.equal((await db.query("select push_targets('test-secret','order',$1) as t", ["00000000-0000-4000-8000-000000000000"])).rows[0].t, null);
  await assert.rejects(db.query("select push_targets('test-secret','other',$1)", [order]), /invalid_kind/);

  // Отключённый продавец уведомлений не получает.
  await owner();
  await db.query("update organization_members set disabled_at=now() where organization_id=$1 and user_id=$2", [orgA, seller]);
  await db.exec("SET ROLE anon;");
  assert.deepEqual(
    (await db.query("select push_targets('test-secret','order',$1) as t", [order])).rows[0].t.targets.map((t) => t.endpoint),
    [sub(1)[0]],
  );
  // Сервис ответил «подписки нет» — убираем; выключить свою — сам сотрудник.
  await db.query("select drop_push_subscription('test-secret',$1)", [sub(2)[0]]);
  await owner();
  await db.query("update organization_members set disabled_at=null where organization_id=$1 and user_id=$2", [orgA, seller]);
  await user(seller);
  await db.query("select delete_push_subscription($1)", [sub(1)[0]]);
  await owner();
  assert.deepEqual((await db.query("select endpoint from push_subscriptions")).rows.map((r) => r.endpoint), [sub(1)[0]], "a member cannot remove another's phone");
  await user(a);
  await db.query("select delete_push_subscription($1)", [sub(1)[0]]);
  await owner();
  assert.equal((await db.query("select count(*)::int as n from push_subscriptions")).rows[0].n, 0);
  assert.deepEqual(
    (await db.query("select action from audit_events where action like 'push.%' order by created_at, action")).rows.map((r) => r.action),
    ["push.subscribed", "push.subscribed", "push.expired", "push.unsubscribed"],
  );
});

test("rentals: a thing goes out once, payment is a plain sale, deposit is a cash move, late return adds extra days", async () => {
  const k = (n) => `aaaaeeee-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  await owner();
  const suit = (await db.query("insert into products(organization_id,name,sale_price) values ($1,'Прокат костюм 48',1000) returning id", [orgA])).rows[0].id;
  const shirt = (await db.query("insert into products(organization_id,name,sale_price) values ($1,'Прокат рубашка 48',400) returning id", [orgA])).rows[0].id;
  await db.query("insert into inventory_movements(organization_id,product_id,qty_delta,reason) values ($1,$2,1,'opening'),($1,$3,1,'opening')", [orgA, suit, shirt]);
  const client = (await db.query("insert into customers(organization_id,name) values ($1,'Прокат Омаа') returning id", [orgA])).rows[0].id;
  const items = JSON.stringify([{ product: suit, price: "1000" }, { product: shirt, price: "400" }]);
  const issue = (key, list = items, amount = "2800", deposit = "2000") =>
    db.query("select issue_rental($1,$2,$3::jsonb,2,$4,true,'passport','Медина',$5,null,$6) as id", [orgA, client, list, amount, deposit, key]);

  await user(a);
  await assert.rejects(issue(k(9), "[]"), /invalid_rental/);
  const rental = (await issue(k(1))).rows[0].id;
  assert.equal((await issue(k(1))).rows[0].id, rental);
  // Костюм на руках — второй раз не выдать.
  await assert.rejects(issue(k(2), JSON.stringify([{ product: suit, price: "1000" }])), /item_busy/);
  const row = (await db.query("select * from rentals where id=$1", [rental])).rows[0];
  assert.equal(row.collateral_note, "Медина");
  assert.equal(row.deposit, "2000.00");
  const sale = (await db.query("select total,paid_immediately,note,reversed_at from sales where id=$1", [row.sale_id])).rows[0];
  assert.deepEqual([sale.total, sale.paid_immediately, sale.reversed_at], ["2800.00", true, null]);
  assert.match(sale.note, /Прокат на 2 дн\.: Прокат костюм 48, Прокат рубашка 48/);
  // Склад прокат не списывает; залог — в кассе с пометкой выдачи.
  assert.equal(Number((await db.query("select stock from product_balances where id=$1", [suit])).rows[0].stock), 1);
  assert.deepEqual(
    (await db.query("select direction,amount from cash_moves where rental_id=$1", [rental])).rows,
    [{ direction: "in", amount: "2000.00" }],
  );

  // Вернули рубашку — выдача ещё открыта; потом костюм с доплатой и залогом обратно.
  const shirtLine = (await db.query("select id from rental_items where rental_id=$1 and product_id=$2", [rental, shirt])).rows[0].id;
  assert.equal((await db.query("select return_rental($1,$2,$3::uuid[],null,null,null) as done", [orgA, rental, [shirtLine]])).rows[0].done, false);
  assert.equal((await db.query("select return_rental($1,$2,null,'1400',false,true) as done", [orgA, rental])).rows[0].done, true);
  const closed = (await db.query("select returned_at,extra_sale_id,deposit_returned_at from rentals where id=$1", [rental])).rows[0];
  assert.ok(closed.returned_at && closed.deposit_returned_at);
  assert.deepEqual(
    Object.values((await db.query("select total,paid_immediately from sales where id=$1", [closed.extra_sale_id])).rows[0]),
    ["1400.00", false],
  );
  assert.deepEqual(
    (await db.query("select direction,amount from cash_moves where rental_id=$1 order by direction", [rental])).rows.map(Object.values),
    [["in", "2000.00"], ["out", "2000.00"]],
  );
  // Вернули — можно выдать снова; продавцу отменять нельзя, владельцу — да, и всё вместе с ней.
  const again = (await issue(k(3), JSON.stringify([{ product: suit, price: "1000" }]), "2000", "")).rows[0].id;
  // Продажу проката мимо проката не отменить и не «отменить - ошиблись».
  const againSale = (await db.query("select sale_id from rentals where id=$1", [again])).rows[0].sale_id;
  await assert.rejects(db.query("select reverse_sale($1,$2,'ошибка')", [orgA, againSale]), /rental_sale/);
  await assert.rejects(db.query("select undo_recent($1,'sale',$2)", [orgA, againSale]), /rental_sale/);
  await assert.rejects(db.query("select undo_recent($1,'sale',$2)", [orgA, closed.extra_sale_id]), /rental_sale|undo_expired/);
  // Клиенту с долгом в другой валюте прокат не выдать.
  await owner();
  const dollar = (await db.query("insert into customers(organization_id,name,currency) values ($1,'Прокат в долларах','USD') returning id", [orgA])).rows[0].id;
  await user(a);
  await assert.rejects(
    db.query("select issue_rental($1,$2,$3::jsonb,1,'100',true,'none',null,null,null,$4)", [orgA, dollar, JSON.stringify([{ product: shirt, price: "100" }]), k(8)]),
    /rental_currency/,
  );
  await assert.rejects(db.query("select reverse_rental($1,$2,'ошиблись')", [orgB, again]), /owner_only/);
  await db.query("select reverse_rental($1,$2,'не тот клиент')", [orgA, again]);
  const reversed = (await db.query("select r.reversed_at, s.reversed_at as sale_reversed from rentals r join sales s on s.id=r.sale_id where r.id=$1", [again])).rows[0];
  assert.ok(reversed.reversed_at && reversed.sale_reversed);
  assert.equal((await db.query("select count(*)::int as n from rental_items where rental_id=$1 and returned_at is null", [again])).rows[0].n, 0);

  // Частично: продажа на всё в долг и оплата наличными на часть; отмена — обе.
  const partKey = k(6);
  await assert.rejects(
    db.query("select issue_rental($1,$2,$3::jsonb,1,'1000',false,'none',null,null,null,$4,'1000') as id", [orgA, client, JSON.stringify([{ product: shirt, price: "1000" }]), k(7)]),
    /invalid_rental/,
  );
  const part = (
    await db.query("select issue_rental($1,$2,$3::jsonb,2,'2000',false,'passport',null,null,null,$4,'1000') as id", [
      orgA, client, JSON.stringify([{ product: shirt, price: "1000" }]), partKey,
    ])
  ).rows[0].id;
  const partRow = (await db.query("select sale_id,payment_id from rentals where id=$1", [part])).rows[0];
  assert.deepEqual(Object.values((await db.query("select total,paid_immediately from sales where id=$1", [partRow.sale_id])).rows[0]), ["2000.00", false]);
  assert.deepEqual(
    Object.values((await db.query("select amount,method,note,direction from payments where id=$1", [partRow.payment_id])).rows[0]),
    ["1000.00", "cash", "Прокат: часть оплаты", "incoming"],
  );
  await db.query("select reverse_rental($1,$2,'ошиблись')", [orgA, part]);
  assert.ok((await db.query("select reversed_at from payments where id=$1", [partRow.payment_id])).rows[0].reversed_at);

  // Чужой магазин ничего не видит и не выдаёт.
  await user(b);
  assert.equal((await db.query("select * from rentals")).rows.length, 0);
  await assert.rejects(issue(k(4)), /not_a_member/);
  await assert.rejects(db.query("insert into rentals(organization_id,customer_id,days,due_on,collateral_kind,idempotency_key) values ($1,$2,1,current_date,'none',$3)", [orgA, client, k(5)]), /permission denied/);
  await owner();
});

test("admin console: data only with the second key; people with last action, shop page, notes, business type, team", async () => {
  const c = "3c3c3c3c-3333-4333-8333-333333333333";
  await owner();
  await db.query(
    `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,'new-c@example.com',now(),'{"business_type":"prokat"}')`,
    [c],
  );
  await db.query("update auth.users set email='owner-a@example.com', last_sign_in_at=now()+interval '1 minute' where id=$1", [a]);
  await db.query("insert into private.platform_admins(user_id) values ($1) on conflict do nothing", [b]);
  const businessBefore = (await db.query("select business_type from organizations where id=$1", [orgA])).rows[0].business_type;

  // Без второго ключа аккаунт знает, что он админ (чтобы спросить код), но данных не видит.
  await user(b, "aal1");
  assert.equal((await db.query("select am_i_platform_admin() as v")).rows[0].v, true);
  await assert.rejects(db.query("select * from admin_people()"), /admin_only/);
  await assert.rejects(db.query("select * from admin_shops()"), /admin_only/);

  await user(b);
  const people = (await db.query("select * from admin_people()")).rows;
  const shop = people.find((r) => r.kind === "shop" && r.org_id === orgA);
  assert.equal(shop.email, "owner-a@example.com");
  assert.equal(shop.last_action, "auth.login"); // вход позже последней записи
  assert.equal(shop.last_action_role, "owner");
  assert.ok(shop.customers > 0 && shop.first_record_at);
  const account = people.find((r) => r.user_id === c);
  assert.equal(account.kind, "account");
  assert.equal(account.last_action, "auth.confirmed");
  assert.equal(account.business_type, "prokat");

  // Страница магазина: участники и последние действия — без клиентов и сумм.
  const page = (await db.query("select admin_shop($1) as v", [orgA])).rows[0].v;
  assert.ok(page.members.some((m) => m.role === "owner" && m.email === "owner-a@example.com"));
  assert.ok(page.actions.length > 1);
  assert.deepEqual(Object.keys(page.actions[0]).sort(), ["action", "at", "role", "who"]);
  assert.ok(page.records_30d > 0);
  await assert.rejects(db.query("select admin_shop(gen_random_uuid())"), /invalid_shop/);
  const person = (await db.query("select admin_account($1) as v", [c])).rows[0].v;
  assert.ok(person.confirmed_at && person.shop_id === null);

  // Заметки и «связаться снова».
  await db.query("select admin_add_note($1,null,'Звонил, перезвонить','2026-11-01')", [orgA]);
  await db.query("select admin_add_note(null,$1,'Написал в WhatsApp',null)", [c]);
  await assert.rejects(db.query("select admin_add_note($1,$2,'обоим',null)", [orgA, c]), /invalid_target/);
  await assert.rejects(db.query("select admin_add_note($1,null,'  ',null)", [orgA]), /invalid_note/);
  assert.equal((await db.query("select body from admin_notes($1,null)", [orgA])).rows[0].body, "Звонил, перезвонить");
  assert.equal(
    (await db.query("select next_contact::text as d, last_note from admin_people() where org_id=$1", [orgA])).rows[0].d,
    "2026-11-01",
  );
  assert.equal((await db.query("select last_note from admin_people() where user_id=$1", [c])).rows[0].last_note, "Написал в WhatsApp");
  await user(a);
  await assert.rejects(db.query("select * from private.admin_notes"), /permission denied/);
  await assert.rejects(db.query("select * from admin_notes($1,null)", [orgA]), /admin_only/);
  await assert.rejects(db.query("select admin_set_business($1,'prokat')", [orgA]), /admin_only/);

  // Вид бизнеса от админа — тем же событием, что у владельца (с пометкой).
  await user(b);
  await db.query("select admin_set_business($1,'prokat')", [orgA]);
  await owner();
  assert.equal((await db.query("select business_type from organizations where id=$1", [orgA])).rows[0].business_type, "prokat");
  const changed = (await db.query("select metadata from audit_events where organization_id=$1 and action='organization.business_profile' order by created_at desc limit 1", [orgA])).rows[0].metadata;
  assert.equal(changed.by_admin, true);
  await user(b);
  await db.query("select admin_set_business($1,$2)", [orgA, businessBefore]);

  // Продление пробного не делает магазин оплатившим; отметка оплаты — делает.
  await owner();
  const trialShop = (await db.query("insert into organizations(name,created_by,creation_key) values ('Пробный',$1,gen_random_uuid()) returning id", [c])).rows[0].id;
  await db.query("insert into audit_events(organization_id,actor_id,action,metadata) values ($1,$2,'organization.created','{\"trial\":true}')", [trialShop, c]);
  await user(b);
  const isTrial = async () => (await db.query("select trial from admin_people() where org_id=$1", [trialShop])).rows[0].trial;
  assert.equal(await isTrial(), true);
  await assert.rejects(db.query("select admin_extend($1,'2020-01-01',false)", [trialShop]), /invalid_date/);
  await db.query("select admin_extend($1,current_date+14,false)", [trialShop]);
  assert.equal(await isTrial(), true);
  await db.query("select admin_extend($1,current_date+40,true)", [trialShop]);
  assert.equal(await isTrial(), false);
  assert.equal((await db.query("select (admin_shop($1)->>'paid_until')::date = current_date+40 as ok", [trialShop])).rows[0].ok, true);
  await user(a);
  await assert.rejects(db.query("select admin_extend($1,current_date+400,true)", [trialShop]), /admin_only/);
  await user(b);

  // Команда: новый админ — по email готового аккаунта; себя не убрать.
  await assert.rejects(db.query("select admin_add_admin('nobody@example.com')"), /no_account/);
  assert.equal((await db.query("select admin_add_admin(' NEW-C@example.com ') as id")).rows[0].id, c);
  await assert.rejects(db.query("select admin_add_admin('new-c@example.com')"), /already_admin/);
  await owner();
  await db.query("insert into auth.mfa_factors(user_id,status) values ($1,'verified'),($2,'unverified')", [b, c]);
  await user(b);
  const team = (await db.query("select * from admin_team()")).rows;
  assert.deepEqual(team.map((t) => [t.user_id, t.has_mfa]).sort(), [[b, true], [c, false]].sort());
  assert.ok(!(await db.query("select * from admin_people()")).rows.some((r) => r.user_id === c && r.kind === "account"));
  await assert.rejects(db.query("select admin_remove_admin($1)", [b]), /cannot_remove_self/);
  await db.query("select admin_remove_admin($1)", [c]);
  await assert.rejects(db.query("select admin_remove_admin($1)", [c]), /not_admin/);
  await user(a);
  await assert.rejects(db.query("select admin_add_admin('new-c@example.com')"), /admin_only/);
  await owner();
  assert.deepEqual(
    (await db.query("select action from private.admin_events where target_user=$1 order by created_at", [c])).rows.map((r) => r.action),
    ["admin.added", "admin.removed"],
  );
  await db.query("delete from private.platform_admins where user_id=$1", [b]);
});

test("admin funnel: steps per self-registered person, active = 3 records within 7 days; sellers and admins left out", async () => {
  const d = "3d3d3d3d-3333-4333-8333-333333333333",
    seller = "3e3e3e3e-3333-4333-8333-333333333333";
  await owner();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'funnel-d@example.com',now()),($2,'seller-e@example.com',now())", [d, seller]);
  const shop = (await db.query("insert into organizations(name,created_by,creation_key,paid_until) values ('Воронка',$1,gen_random_uuid(),current_date+3) returning id", [d])).rows[0].id;
  await db.query("insert into organization_members(organization_id,user_id) values ($1,$2)", [shop, d]);
  await db.query("insert into organization_members(organization_id,user_id,role) values ($1,$2,'staff')", [shop, seller]);
  await db.query("insert into audit_events(organization_id,actor_id,action,metadata) values ($1,$2,'organization.created','{\"trial\":true}')", [shop, d]);
  await db.query("insert into organization_invites(organization_id,display_name,created_by) values ($1,'Айгуль',$2)", [shop, d]);
  const customer = (await db.query("insert into customers(organization_id,name) values ($1,'Клиент') returning id", [shop])).rows[0].id;
  const record = (ago) =>
    db.query(
      `insert into payments(organization_id,customer_id,direction,amount,idempotency_key,created_at)
       values ($1,$2,'incoming',1,gen_random_uuid(),now()-interval '${ago}')`,
      [shop, customer],
    );
  // Три записи, но не за 7 дней (12 дней, 3 дня, час назад) — ещё не «активен».
  for (const ago of ["12 days", "3 days", "1 hour"]) await record(ago);
  await db.query("insert into private.platform_admins(user_id) values ($1) on conflict do nothing", [b]);

  await user(b, "aal1");
  await assert.rejects(db.query("select * from admin_funnel()"), /admin_only/);
  await user(b);
  assert.equal((await db.query("select active_at from admin_funnel() where user_id=$1", [d])).rows[0].active_at, null);
  // Ещё одна 2 дня назад — три записи за 7 дней (3 дня, 2 дня, час назад).
  await owner();
  await record("2 days");
  await user(b);
  const rows = (await db.query("select * from admin_funnel()")).rows;
  const row = rows.find((r) => r.user_id === d);
  assert.equal(row.org_id, shop);
  assert.equal(row.customers, 1);
  assert.ok(row.first_customer_at && row.first_record_at && row.last_record_at);
  assert.equal(row.records_7d, 3);
  assert.equal(row.active_at.getTime(), row.last_record_at.getTime()); // третья запись окна, не первая
  assert.equal(row.trial, true);
  assert.equal(row.paid_at, null);
  assert.equal(row.pending_invites, 1);
  assert.ok(!rows.some((r) => r.user_id === seller)); // продавец по приглашению — не в воронке
  assert.ok(!rows.some((r) => r.user_id === b)); // админ — тоже

  await db.query("select admin_extend($1,current_date+30,true)", [shop]);
  const paid = (await db.query("select paid_at, trial from admin_funnel() where user_id=$1", [d])).rows[0];
  assert.ok(paid.paid_at);
  assert.equal(paid.trial, false);
  await user(a);
  await assert.rejects(db.query("select * from admin_funnel()"), /admin_only/);
  await owner();
  await db.query("delete from private.platform_admins where user_id=$1", [b]);
});

test("morning digest: the server key (service_role) reads people and funnel; other roles and claims do not", async () => {
  await owner();
  await db.exec(`SET ROLE service_role; SELECT set_config('request.jwt.claim.sub','',false); SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);`);
  assert.ok((await db.query("select * from admin_people()")).rows.length > 0);
  assert.ok((await db.query("select * from admin_funnel()")).rows.length > 0);
  // Обычный вход без админа не становится сервером: роль в токене подписана Supabase.
  await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a}',false); SELECT set_config('request.jwt.claims','{"sub":"${a}","role":"authenticated","aal":"aal2"}',false);`);
  await assert.rejects(db.query("select * from admin_people()"), /admin_only/);
  await db.exec("RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claims','{\"role\":\"anon\"}',false);");
  await assert.rejects(db.query("select * from admin_people()"), /permission denied/);
  await owner();
});

test("admin requests: status, notes with a contact date, match with a Depter account by email or shop phone", async () => {
  await owner();
  await db.query("update auth.users set email='owner-a@example.com' where id=$1", [a]);
  await db.query("update organizations set phone='+996 555 77 88 99' where id=$1", [orgA]);
  // Прямо в таблицу: лимит send_feedback (30 в час) уже выбран прошлым тестом.
  await db.query(
    "insert into private.feedback_messages(name,contact,message) values ('Мария','OWNER-A@example.com','Не приходит письмо'),('Азамат','0555 778 899','Хочу подключить'),('Гость','+996 700 000 001','Сколько стоит?')",
  );
  await db.query("insert into private.platform_admins(user_id) values ($1) on conflict do nothing", [b]);

  await user(b);
  const rows = (await db.query("select * from admin_feedback()")).rows;
  const byName = (n) => rows.find((r) => r.name === n);
  assert.equal(byName("Мария").status, "new");
  assert.equal(byName("Мария").match_user, a); // по email, без учёта регистра
  assert.equal(byName("Азамат").match_org, orgA); // по последним 9 цифрам телефона магазина
  assert.equal(byName("Гость").match_user, null);

  const id = byName("Гость").id;
  await db.query("select admin_set_feedback_status($1,'contacted')", [id]);
  await assert.rejects(db.query("select admin_set_feedback_status($1,'lost')", [id]), /invalid_status/);
  await db.query("select admin_add_feedback_note($1,'Написал в WhatsApp, ждёт цену','2026-11-01')", [id]);
  await assert.rejects(db.query("select admin_add_feedback_note($1,'',null)", [id]), /invalid_note/);
  const after = (await db.query("select status, status_at, next_contact::text as d, last_note from admin_feedback() where id=$1", [id])).rows[0];
  assert.equal(after.status, "contacted");
  assert.ok(after.status_at);
  assert.equal(after.d, "2026-11-01");
  assert.equal(after.last_note, "Написал в WhatsApp, ждёт цену");
  assert.equal((await db.query("select body from admin_feedback_notes($1)", [id])).rows.length, 1);

  // Без второго ключа и владельцу магазина — нельзя; сводке (серверный ключ) — читать можно.
  await user(b, "aal1");
  await assert.rejects(db.query("select admin_set_feedback_status($1,'done')", [id]), /admin_only/);
  await user(a);
  await assert.rejects(db.query("select * from admin_feedback()"), /admin_only/);
  await assert.rejects(db.query("select admin_add_feedback_note($1,'x',null)", [id]), /admin_only/);
  await owner();
  await db.exec(`SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);`);
  assert.ok((await db.query("select * from admin_feedback()")).rows.length >= 3);
  await owner();
  assert.equal((await db.query("select count(*)::int as n from private.admin_events where action='feedback.status'")).rows[0].n, 1);
  await db.query("delete from private.platform_admins where user_id=$1", [b]);
});
