const user = { name: "Summer", age: 30 };

const copy = clone(user);
copy.name = "Kim";

console.log(user.name);
