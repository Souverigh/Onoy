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
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key, email text); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated; INSERT INTO auth.users VALUES ('${a}'),('${b}');`,
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
  assert.equal(rows.length, 22);
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

test("create_organization: a new shop needs an unused signup code; retries and old shops don't", async () => {
  await owner();
  const code = (await db.query("insert into private.shop_signup_codes(note) values ('тест') returning code")).rows[0].code;
  assert.match(code, /^[0-9A-F]{10}$/);
  await user(b);
  await assert.rejects(
    db.query("select create_organization('Без кода','cccccccc-0000-4000-8000-000000000001','')"),
    /invalid_code/,
  );
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
