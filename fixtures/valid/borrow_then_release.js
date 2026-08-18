const user = { name: "Summer", age: 30 };

{
  const r = ref(user);
  console.log(r.name);
}

update(mut(user));
