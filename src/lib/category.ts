/**
 * Категории товаров (просьба пользователя 23.10.2026): категория и
 * подкатегория. Здесь — без базы: подписи и подсказки по названиям.
 *
 * Подсказка смотрит на слово в начале и в конце названия: «Светильник
 * CARLA-18» и «CARLA-18 светильник» — одно и то же. Коды, числа, размеры и
 * прилагательные («двойная», «белая») пропускаются. Подсказка только
 * предлагает — категорию ставит человек нажатием.
 */

export type Category = { id: string; name: string; parent_id: string | null };
export type NamedProduct = { id: string; name: string; category_id: string | null };

/** Служебные слова и единицы — не вид товара. */
const STOP = new Set([
  "для", "под", "над", "без", "или", "при", "про", "через", "между", "от", "до", "на", "из",
  "шт", "штук", "штука", "упак", "уп", "мм", "см", "метр", "метров", "кг", "гр", "грамм", "мл", "литр",
  "вт", "ватт", "цвет", "цвета", "размер", "новый", "новая", "new", "set", "pcs",
]);

/** Прилагательные: «двойная», «белый», «светодиодное» — не вид товара. */
const ADJECTIVE = /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ым|им)$/;

const normalize = (word: string) => word.toLowerCase().replace(/ё/g, "е");

/** Основа слова без окончания: «лампы», «лампа» → «ламп». */
export function stem(word: string): string {
  const w = normalize(word);
  const cut = w.replace(/[аяыиеоуюэьй]{1,2}$/, "");
  return cut.length >= 3 ? cut : w;
}

/** Слова-кандидаты из названия: только буквы, без кодов и чисел. */
function words(name: string): string[] {
  const tokens = name
    .split(/[\s,;/\\()+«»"'*|]+/)
    .map((t) => t.replace(/^[-.:]+|[-.:]+$/g, ""))
    .filter((t) => t && !/\d/.test(t));
  const pick = (re: RegExp) =>
    tokens
      .map((t) => t.split("-")[0])
      .filter((t) => re.test(t) && t.length >= 3 && !STOP.has(normalize(t)));
  // Латиницу берём, только если русских слов нет: «Philips лампа» — это лампа.
  const ru = pick(/^[а-яё]+$/i);
  return ru.length ? ru : pick(/^[a-z]+$/i).filter((t) => t !== t.toUpperCase() || t.length > 3);
}

/**
 * Вид товара по названию: первое и последнее «существительное» (без
 * прилагательных). Одно слово — оба одинаковые; нет слов — пусто.
 */
export function nameKeys(name: string): { first: string; last: string; firstWord: string } | null {
  const all = words(name);
  if (!all.length) return null;
  const nouns = all.filter((w) => !ADJECTIVE.test(normalize(w)) || normalize(w).length <= 4);
  const list = nouns.length ? nouns : all;
  return { first: stem(list[0]), last: stem(list[list.length - 1]), firstWord: list[0] };
}

/** «Освещение / Светильники» — подпись категории с верхней. */
export function categoryLabel(categories: Category[], id: string | null | undefined): string | null {
  if (!id) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const c = byId.get(id);
  if (!c) return null;
  const parent = c.parent_id ? byId.get(c.parent_id) : null;
  return parent ? `${parent.name} / ${c.name}` : c.name;
}

/** Категории деревом: верхние по алфавиту, под каждой — её подкатегории. */
export function categoryTree(categories: Category[]): { category: Category; children: Category[] }[] {
  const sorted = [...categories].sort((x, y) => x.name.localeCompare(y.name, "ru"));
  return sorted
    .filter((c) => !c.parent_id)
    .map((category) => ({ category, children: sorted.filter((c) => c.parent_id === category.id) }));
}

/** id категории и всех её подкатегорий — для отбора «вся категория». */
export function categoryWithChildren(categories: Category[], id: string): string[] {
  return [id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)];
}

/**
 * Подсказки: основа слова → категория. Учится на том, как магазин уже
 * разложил товары (слово в начале названия весит больше), плюс слова из
 * самих названий категорий («Светильники» → «светильник»).
 */
export function categoryHints(categories: Category[], products: NamedProduct[]): Record<string, string> {
  const known = new Set(categories.map((c) => c.id));
  const votes = new Map<string, Map<string, number>>();
  const vote = (key: string, category: string, weight: number) => {
    const row = votes.get(key) ?? new Map<string, number>();
    row.set(category, (row.get(category) ?? 0) + weight);
    votes.set(key, row);
  };
  for (const c of categories) for (const w of words(c.name)) vote(stem(w), c.id, 3);
  for (const p of products) {
    if (!p.category_id || !known.has(p.category_id)) continue;
    const keys = nameKeys(p.name);
    if (!keys) continue;
    vote(keys.first, p.category_id, 2);
    if (keys.last !== keys.first) vote(keys.last, p.category_id, 1);
  }
  const hints: Record<string, string> = {};
  for (const [key, row] of votes) {
    const ranked = [...row.entries()].sort((x, y) => y[1] - x[1]);
    // Только уверенно: голосов хватает и вторая категория заметно меньше.
    if (ranked[0][1] >= 2 && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) hints[key] = ranked[0][0];
  }
  return hints;
}

/** Подсказка для одного товара: сначала слово в начале названия, потом в конце. */
export function suggestCategory(name: string, hints: Record<string, string>): string | null {
  const keys = nameKeys(name);
  if (!keys) return null;
  return hints[keys.first] ?? hints[keys.last] ?? null;
}

export type CategoryGroup = { key: string; name: string; products: { id: string; name: string }[] };

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * Новые категории для товаров без категории и без подсказки: товары с одним
 * видом («Светильник …», «… светильник») — в группу. Слово в начале
 * важнее; в конце — если по началу группа не собирается. Группа — от двух
 * товаров, крупные сначала.
 */
export function categoryGroups(products: NamedProduct[], hints: Record<string, string> = {}): CategoryGroup[] {
  const free = products
    .filter((p) => !p.category_id && !suggestCategory(p.name, hints))
    .map((p) => ({ product: p, keys: nameKeys(p.name) }))
    .filter((x): x is { product: NamedProduct; keys: NonNullable<ReturnType<typeof nameKeys>> } => Boolean(x.keys));
  const count = new Map<string, number>();
  for (const { keys } of free) {
    count.set(keys.first, (count.get(keys.first) ?? 0) + 1);
    if (keys.last !== keys.first) count.set(keys.last, (count.get(keys.last) ?? 0) + 1);
  }
  const groups = new Map<string, { forms: Map<string, number>; products: { id: string; name: string }[] }>();
  for (const { product, keys } of free) {
    const firstCount = count.get(keys.first) ?? 0;
    const lastCount = count.get(keys.last) ?? 0;
    const key = firstCount >= 2 ? keys.first : lastCount >= 2 ? keys.last : null;
    if (!key) continue;
    const group = groups.get(key) ?? { forms: new Map<string, number>(), products: [] as { id: string; name: string }[] };
    // Как слово написано в названии — для имени категории.
    const form = (key === keys.first ? keys.firstWord : words(product.name).reverse().find((w) => stem(w) === key)) ?? key;
    const lower = normalize(form);
    group.forms.set(lower, (group.forms.get(lower) ?? 0) + 1);
    group.products.push({ id: product.id, name: product.name });
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.products.length >= 2)
    .map(([key, g]) => ({
      key,
      name: capitalize([...g.forms.entries()].sort((x, y) => y[1] - x[1])[0][0]),
      products: g.products.sort((x, y) => x.name.localeCompare(y.name, "ru")),
    }))
    .sort((x, y) => y.products.length - x.products.length || x.name.localeCompare(y.name, "ru"));
}

/** Тексты ошибок категорий. */
export const CATEGORY_ERROR_TEXT: Record<string, string> = {
  category_taken: "Такая категория уже есть.",
  invalid_category: "Название категории - от 1 до 60 символов.",
  owner_only: "Удалять категории может только владелец.",
  blocked: "Магазин в режиме «только просмотр» - изменения не сохраняются.",
  save: "Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.",
};
