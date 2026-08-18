// Same kind of "real" code, but with ref/mut/move sprinkled in at a few points —
// inside a loop, inside a closure, and across a plain (unwrapped) function call.
// Only the very last block is *meant* to trigger a diagnostic; everything above it
// should stay silent even though it mixes loops, closures, and independent functions.

function processOrders(orders) {
  const total = { amount: 0, count: 0 };

  for (const order of orders) {
    const view = ref(order);
    console.log(`order ${view.id}: ${view.amount}`);
    mutateTotal(mut(total), order.amount);
  }

  return total;
}

function mutateTotal(totalRef, amount) {
  totalRef.amount += amount;
  totalRef.count += 1;
}

function scheduleReminder(order) {
  const snapshot = ref(order);
  setTimeout(() => {
    console.log(`reminder for ${snapshot.id}`);
  }, 1000);
}

function archiveOrder(order) {
  const id = order.id;
  send(move(order));
  return id;
}

const pending = { id: "A-1", amount: 500 };
scheduleReminder(pending);
// `pending` was never wrapped at *this* call site, so Rusty makes no claim about it here —
// archiveOrder's own `order` parameter is a separate, independently-tracked binding.
const archivedId = archiveOrder(pending);
console.log(archivedId);

// This part IS meant to be flagged: writing through the original binding while an
// alias (`cartRef`) still holds an active read borrow on the same owner.
const cart = { id: "C-1", amount: 200 };
const cartRef = ref(cart);
cart.amount = 999;
console.log(cartRef.amount);
