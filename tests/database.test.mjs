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
  assert.equal(rows.length, 16);
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
