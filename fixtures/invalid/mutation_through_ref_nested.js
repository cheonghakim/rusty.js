const user = { name: "Summer", profile: { name: "Summer" } };

const r = ref(user);

r.profile.name = "Kim";
