const user = { name: "Summer", age: 30 };

const a = ref(user);
const b = ref(user);

console.log(a.name, b.name);
