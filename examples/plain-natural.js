// Ordinary JS with no Rusty primitives at all — classes, private fields, loops,
// destructuring, spread, closures, async/await, optional chaining. Nothing here
// opts into Rusty tracking, so `rusty check` should report exactly zero diagnostics.
// This is the baseline false-positive check: does Rusty stay silent on code that
// never asked for it?

class Inventory {
  #stock = new Map();

  constructor(items = []) {
    for (const item of items) {
      this.#stock.set(item.sku, item);
    }
  }

  restock(sku, qty) {
    const current = this.#stock.get(sku);
    if (!current) return;
    current.qty += qty;
  }

  list() {
    return [...this.#stock.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }
}

function summarizeInventory(inventory) {
  const rows = inventory.list().map(({ sku, qty, price }) => `${sku}: ${qty} x ${price}`);
  return rows.join("\n");
}

async function loadItems(url) {
  const response = await fetch(url);
  const data = await response.json();
  return data.items ?? [];
}

async function main() {
  const items = await loadItems("https://example.test/items");
  const inventory = new Inventory(items);

  for (const item of items) {
    inventory.restock(item.sku, 10);
  }

  const { sku: firstSku } = items[0] ?? {};
  const backup = JSON.parse(JSON.stringify(items));

  console.log(summarizeInventory(inventory));
  console.log(firstSku, backup.length);

  const highValue = items.filter((item) => item.price > 100).map((item) => ({ ...item, tag: "premium" }));

  return highValue;
}

main().catch((err) => console.error(err));
