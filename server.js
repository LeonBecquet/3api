import express from "express";
import http from "http";
import { MongoClient, ObjectId } from "mongodb";

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "foodexpress";
const app = express();
app.use(express.json());
const server = http.createServer(app);
const client = new MongoClient(MONGO_URI);
let db, Users, Restaurants, Menus;

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

const pag = (q) => {
  const page = Math.max(1, parseInt(q.page || "1", 10));
  const limit = Math.max(1, Math.min(100, parseInt(q.limit || "10", 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

app.post("/users", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase();
    const username = String(req.body.username || "");
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ error: "email & password required" });
    const exists = await Users.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already used" });
    const role = req.body.role === "admin" ? "admin" : "user";
    const doc = { email, username, password, role, createdAt: new Date() };
    const r = await Users.insertOne(doc);
    res.status(201).json({ _id: String(r.insertedId), email, username, role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/auth/login", async (req, res) => {
  const email = String(req.body.email || "").toLowerCase();
  const pwd = String(req.body.password || "");
  const u = await Users.findOne({ email });
  if (!u) return res.status(401).json({ error: "Invalid credentials" });
  if (u.password !== pwd) return res.status(401).json({ error: "Invalid credentials" });
  res.json({ user: { _id: String(u._id), email: u.email, username: u.username, role: u.role } });
});

app.get("/users", auth, requireAdmin, async (_req, res) => {
  const list = await Users.find({}, { projection: { password: 0 } }).toArray();
  res.json(list.map(u => ({ ...u, _id: String(u._id) })));
});

app.get("/users/:id", auth, selfOrAdmin("id"), async (req, res) => {
  const u = await Users.findOne({ _id: new ObjectId(req.params.id) }, { projection: { password: 0 } });
  if (!u) return res.status(404).json({ error: "Not found" });
  res.json({ ...u, _id: String(u._id) });
});

app.put("/users/:id", auth, selfOrAdmin("id"), async (req, res) => {
  const updates = {};
  if (req.body.email) updates.email = String(req.body.email).toLowerCase();
  if (req.body.username !== undefined) updates.username = String(req.body.username);
  if (req.body.password !== undefined) updates.password = String(req.body.password);
  if (req.user.role === "admin" && req.body.role) updates.role = req.body.role;

  const r = await Users.findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: updates },
    { returnDocument: "after", projection: { password: 0 } }
  );
  if (!r.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...r.value, _id: String(r.value._id) });
});

app.delete("/users/:id", auth, selfOrAdmin("id"), async (req, res) => {
  const r = await Users.deleteOne({ _id: new ObjectId(req.params.id) });
  if (!r.deletedCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

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

app.get("/restaurants/:id", async (req, res) => {
  const r = await Restaurants.findOne({ _id: new ObjectId(req.params.id) });
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json({ ...r, _id: String(r._id) });
});

app.post("/restaurants", auth, requireAdmin, async (req, res) => {
  const { name, address, phone = "", opening_hours = "" } = req.body || {};
  if (!name || !address) return res.status(400).json({ error: "name & address required" });
  const doc = { name, address, phone, opening_hours, createdAt: new Date() };
  const r = await Restaurants.insertOne(doc);
  res.status(201).json({ _id: String(r.insertedId), ...doc });
});

app.put("/restaurants/:id", auth, requireAdmin, async (req, res) => {
  const r = await Restaurants.findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body || {} },
    { returnDocument: "after" }
  );
  if (!r.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...r.value, _id: String(r.value._id) });
});

app.delete("/restaurants/:id", auth, requireAdmin, async (req, res) => {
  const r = await Restaurants.deleteOne({ _id: new ObjectId(req.params.id) });
  if (!r.deletedCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

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

app.get("/menus/:id", async (req, res) => {
  const m = await Menus.findOne({ _id: new ObjectId(req.params.id) });
  if (!m) return res.status(404).json({ error: "Not found" });
  res.json({ ...m, _id: String(m._id) });
});

app.post("/menus", auth, requireAdmin, async (req, res) => {
  const { restaurant_id, name, description = "", price, category = "" } = req.body || {};
  if (!restaurant_id || !name || price === undefined)
    return res.status(400).json({ error: "restaurant_id, name, price required" });
  const doc = { restaurant_id, name, description, price: Number(price), category, createdAt: new Date() };
  const r = await Menus.insertOne(doc);
  res.status(201).json({ _id: String(r.insertedId), ...doc });
});

app.put("/menus/:id", auth, requireAdmin, async (req, res) => {
  const r = await Menus.findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body || {} },
    { returnDocument: "after" }
  );
  if (!r.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...r.value, _id: String(r.value._id) });
});

app.delete("/menus/:id", auth, requireAdmin, async (req, res) => {
  const r = await Menus.deleteOne({ _id: new ObjectId(req.params.id) });
  if (!r.deletedCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

async function boot() {
  await client.connect();
  db = client.db(DB_NAME);
  Users = db.collection("users");
  Restaurants = db.collection("restaurants");
  Menus = db.collection("menus");
  await Users.createIndex({ email: 1 }, { unique: true });

  server.listen(PORT, () => console.log(`API http://localhost:${PORT}`));
}
boot().catch((err) => {
  console.error("Mongo error:", err);
  process.exit(1);
});