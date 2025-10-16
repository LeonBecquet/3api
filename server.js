// server.js — FoodExpress (ultra simple, 1 fichier, sans cors/bcrypt/jwt/crypto)
// Dépendances: express, mongodb

import express from "express";
import http from "http";
import { MongoClient, ObjectId } from "mongodb";

// ====== CONFIG ======
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "foodexpress";

// ====== APP / DB ======
const app = express();
app.use(express.json());
const server = http.createServer(app);

const client = new MongoClient(MONGO_URI);
let db, Users, Restaurants, Menus;

// ====== AUTH NAÏVE (TP) ======
// Pas de token. Le client met l'id utilisateur dans l'en-tête X-User-Id.
async function auth(req, res, next) {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(401).json({ error: "Unauthorized (missing X-User-Id)" });
  try {
    const u = await Users.findOne({ _id: new ObjectId(String(userId)) });
    if (!u) return res.status(401).json({ error: "Unauthorized (user not found)" });
    req.user = { _id: String(u._id), role: u.role, email: u.email, username: u.username };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ error: "Forbidden" });
}
const selfOrAdmin = (param = "id") => (req, res, next) => {
  if (req.user?.role === "admin") return next();
  if (req.user?._id === req.params[param]) return next();
  return res.status(403).json({ error: "Forbidden" });
};

// ====== UTILS ======
const pag = (q) => {
  const page = Math.max(1, parseInt(q.page || "1", 10));
  const limit = Math.max(1, Math.min(100, parseInt(q.limit || "10", 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ====== USERS ======

// POST /users  (public: create account)
app.post("/users", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase();
    const username = String(req.body.username || "");
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ error: "email & password required" });

    const exists = await Users.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already used" });

    // ⚠️ mot de passe en clair (choix volontaire pour TP)
    const doc = { email, username, password, role: "user", createdAt: new Date() };
    const r = await Users.insertOne(doc);
    res.status(201).json({ _id: String(r.insertedId), email, username, role: "user" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /auth/login  (public) — renvoie l'user, pas de token
app.post("/auth/login", async (req, res) => {
  const email = String(req.body.email || "").toLowerCase();
  const pwd = String(req.body.password || "");
  const u = await Users.findOne({ email });
  if (!u) return res.status(401).json({ error: "Invalid credentials" });
  if (u.password !== pwd) return res.status(401).json({ error: "Invalid credentials" });
  res.json({ user: { _id: String(u._id), email: u.email, username: u.username, role: u.role } });
});

// GET /users  (admin only)
app.get("/users", auth, requireAdmin, async (_req, res) => {
  const list = await Users.find({}, { projection: { password: 0 } }).toArray();
  res.json(list.map(u => ({ ...u, _id: String(u._id) })));
});

// GET /users/:id  (self or admin)
app.get("/users/:id", auth, selfOrAdmin("id"), async (req, res) => {
  const u = await Users.findOne({ _id: new ObjectId(req.params.id) }, { projection: { password: 0 } });
  if (!u) return res.status(404).json({ error: "Not found" });
  res.json({ ...u, _id: String(u._id) });
});

// PUT /users/:id  (self or admin; admin peut changer role)
app.put("/users/:id", auth, selfOrAdmin("id"), async (req, res) => {
  const updates = {};
  if (req.body.email) updates.email = String(req.body.email).toLowerCase();
  if (req.body.username !== undefined) updates.username = String(req.body.username);
  if (req.body.password !== undefined) updates.password = String(req.body.password); // toujours en clair (TP)
  if (req.user.role === "admin" && req.body.role) updates.role = req.body.role;

  const r = await Users.findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: updates },
    { returnDocument: "after", projection: { password: 0 } }
  );
  if (!r.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...r.value, _id: String(r.value._id) });
});

// DELETE /users/:id  (self or admin)
app.delete("/users/:id", auth, selfOrAdmin("id"), async (req, res) => {
  const r = await Users.deleteOne({ _id: new ObjectId(req.params.id) });
  if (!r.deletedCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ====== RESTAURANTS ======

// GET /restaurants?sort=name|address&order=asc|desc&page&limit (public)
app.get("/restaurants", async (req, res) => {
  const { page, limit, skip } = pag(req.query);
  const sortField = ["name", "address"].includes(req.query.sort) ? req.query.sort : "name";
  const order = (req.query.order || "asc").toLowerCase() === "desc" ? -1 : 1;
  const total = await Restaurants.countDocuments();
  const items = await Restaurants.find({})
    .sort({ [sortField]: order })
    .skip(skip)
    .limit(limit)
    .toArray();
  res.json({ page, totalPages: Math.max(1, Math.ceil(total / limit)), total, items });
});

// GET /restaurants/:id (public)
app.get("/restaurants/:id", async (req, res) => {
  const r = await Restaurants.findOne({ _id: new ObjectId(req.params.id) });
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json({ ...r, _id: String(r._id) });
});

// POST /restaurants (admin)
app.post("/restaurants", auth, requireAdmin, async (req, res) => {
  const { name, address, phone = "", opening_hours = "" } = req.body || {};
  if (!name || !address) return res.status(400).json({ error: "name & address required" });
  const doc = { name, address, phone, opening_hours, createdAt: new Date() };
  const r = await Restaurants.insertOne(doc);
  res.status(201).json({ _id: String(r.insertedId), ...doc });
});

// PUT /restaurants/:id (admin)
app.put("/restaurants/:id", auth, requireAdmin, async (req, res) => {
  const r = await Restaurants.findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body || {} },
    { returnDocument: "after" }
  );
  if (!r.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...r.value, _id: String(r.value._id) });
});

// DELETE /restaurants/:id (admin)
app.delete("/restaurants/:id", auth, requireAdmin, async (req, res) => {
  const r = await Restaurants.deleteOne({ _id: new ObjectId(req.params.id) });
  if (!r.deletedCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ====== MENUS ======

// GET /menus?restaurant_id&sort=price|category&order=asc|desc&page&limit (public)
app.get("/menus", async (req, res) => {
  const { page, limit, skip } = pag(req.query);
  const q = {};
  if (req.query.restaurant_id) q.restaurant_id = req.query.restaurant_id;
  const sortField = ["price", "category"].includes(req.query.sort) ? req.query.sort : "price";
  const order = (req.query.order || "asc").toLowerCase() === "desc" ? -1 : 1;
  const total = await Menus.countDocuments(q);
  const items = await Menus.find(q).sort({ [sortField]: order }).skip(skip).limit(limit).toArray();
  res.json({ page, totalPages: Math.max(1, Math.ceil(total / limit)), total, items });
});

// GET /menus/:id (public)
app.get("/menus/:id", async (req, res) => {
  const m = await Menus.findOne({ _id: new ObjectId(req.params.id) });
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json({ ...m, _id: String(m._id) });
});

// POST /menus (admin)
app.post("/menus", auth, requireAdmin, async (req, res) => {
  const { restaurant_id, name, description = "", price, category = "" } = req.body || {};
  if (!restaurant_id || !name || price === undefined)
    return res.status(400).json({ error: "restaurant_id, name, price required" });
  const doc = { restaurant_id, name, description, price: Number(price), category, createdAt: new Date() };
  const r = await Menus.insertOne(doc);
  res.status(201).json({ _id: String(r.insertedId), ...doc });
});

// PUT /menus/:id (admin)
app.put("/menus/:id", auth, requireAdmin, async (req, res) => {
  const r = await Menus.findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body || {} },
    { returnDocument: "after" }
  );
  if (!r.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...r.value, _id: String(r.value._id) });
});

// DELETE /menus/:id (admin)
app.delete("/menus/:id", auth, requireAdmin, async (req, res) => {
  const r = await Menus.deleteOne({ _id: new ObjectId(req.params.id) });
  if (!r.deletedCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ====== BOOT ======
async function boot() {
  await client.connect();
  db = client.db(DB_NAME);
  Users = db.collection("users");
  Restaurants = db.collection("restaurants");
  Menus = db.collection("menus");
  await Users.createIndex({ email: 1 }, { unique: true }); // email unique

  server.listen(PORT, () => console.log(`API http://localhost:${PORT}`));
}
boot().catch((err) => {
  console.error("Mongo error:", err);
  process.exit(1);
});
