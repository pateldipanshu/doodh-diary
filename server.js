require("dotenv").config();
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const { MONGODB_URI, JWT_SECRET } = process.env;
const PORT = process.env.PORT || 3000;
if (!MONGODB_URI || !JWT_SECRET) {
  console.error("Missing MONGODB_URI or JWT_SECRET. Set them in .env or in your host's environment settings.");
  process.exit(1);
}

const { Schema } = mongoose;
const toJSON = { transform: (_d, r) => { r.id = String(r._id); delete r._id; delete r.__v; delete r.familyId; delete r.byId; return r; } };
const CATS = ["Feed", "Medicine", "Labour", "Other"];

const Family = mongoose.model("Family", new Schema({ name: String, code: { type: String, unique: true } }, { timestamps: true }));
const User = mongoose.model("User", new Schema({ name: String, phone: { type: String, unique: true }, hash: String, familyId: { type: Schema.Types.ObjectId, index: true } }, { timestamps: true }));
const entrySchema = new Schema({ familyId: { type: Schema.Types.ObjectId, required: true }, date: String, shift: { type: String, enum: ["M", "E"] }, qty: Number, fat: Number, snf: Number, rate: Number, amt: Number, by: String, byId: Schema.Types.ObjectId }, { toJSON });
entrySchema.index({ familyId: 1, date: 1, shift: 1 }, { unique: true });
const Entry = mongoose.model("Entry", entrySchema);
const expSchema = new Schema({ familyId: { type: Schema.Types.ObjectId, required: true, index: true }, date: String, cat: { type: String, enum: CATS }, amt: Number, by: String, byId: Schema.Types.ObjectId }, { toJSON });
const Expense = mongoose.model("Expense", expSchema);
const paidSchema = new Schema({ familyId: { type: Schema.Types.ObjectId, required: true }, month: String, amount: Number });
paidSchema.index({ familyId: 1, month: 1 }, { unique: true });
const Paid = mongoose.model("Paid", paidSchema);

// ---------- helpers ----------
const num = (v, min, max) => { const n = Number(v); return v !== "" && v !== null && v !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : null; };
const r2 = (n) => Math.round(n * 100) / 100;
const okDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const okMonth = (s) => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
function cleanEntry(b) {
  if (!b) return null;
  const qty = num(b.qty, 0.01, 10000), fat = num(b.fat, 0, 20), snf = num(b.snf, 0, 20), rate = num(b.rate, 0, 1000);
  const amt = b.amt === undefined || b.amt === null || b.amt === "" ? (qty !== null && rate !== null ? qty * rate : null) : num(b.amt, 0, 1e7);
  if (!okDate(b.date) || !["M", "E"].includes(b.shift) || [qty, fat, snf, rate, amt].includes(null)) return null;
  return { date: b.date, shift: b.shift, qty, fat, snf, rate, amt: r2(amt) };
}
function cleanExp(b) {
  if (!b) return null;
  const amt = num(b.amt, 0.01, 1e7);
  return okDate(b.date) && CATS.includes(b.cat) && amt !== null ? { date: b.date, cat: b.cat, amt: r2(amt) } : null;
}
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const sign = (u) => jwt.sign({ uid: String(u._id) }, JWT_SECRET, { expiresIn: "90d" });

async function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || "").replace(/^Bearer /, "");
    const { uid } = jwt.verify(t, JWT_SECRET);
    const user = await User.findById(uid);
    if (!user) return bad(res, "Please log in again.", 401);
    req.user = user;
    next();
  } catch (e) { return bad(res, "Please log in again.", 401); }
}

// ---------- app ----------
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } }));

app.get("/api/health", (_q, s) => s.json({ ok: true }));

app.post("/api/auth/register", h(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 40);
  const digits = String(b.phone || "").replace(/\D/g, "");
  const pw = String(b.password || "");
  if (!name) return bad(res, "Enter your name.");
  if (digits.length < 10 || digits.length > 13) return bad(res, "Enter a valid 10-digit mobile number.");
  if (pw.length < 6) return bad(res, "Password must be at least 6 characters.");
  const phone = digits.slice(-10);
  let fam = null, fname = "";
  if (b.familyCode) {
    fam = await Family.findOne({ code: String(b.familyCode).trim().toUpperCase() });
    if (!fam) return bad(res, "Family code not found. Check it with your family member.", 404);
  } else {
    fname = String(b.familyName || "").trim().slice(0, 50);
    if (!fname) return bad(res, "Enter a family name.");
  }
  if (await User.findOne({ phone })) return bad(res, "This mobile number is already registered. Log in instead.", 409);
  for (let i = 0; i < 5 && !fam; i++) {
    try { fam = await Family.create({ name: fname, code: makeCode() }); } catch (e) { if (e.code !== 11000) throw e; }
  }
  if (!fam) return bad(res, "Could not create the family. Try again.", 500);
  const user = await User.create({ name, phone, hash: await bcrypt.hash(pw, 10), familyId: fam._id });
  res.json({ token: sign(user) });
}));

app.post("/api/auth/login", h(async (req, res) => {
  const b = req.body || {};
  const phone = String(b.phone || "").replace(/\D/g, "").slice(-10);
  const user = await User.findOne({ phone });
  if (!user || !(await bcrypt.compare(String(b.password || ""), user.hash))) return bad(res, "Wrong mobile number or password.", 401);
  res.json({ token: sign(user) });
}));

// everything below needs login; data is always limited to the user's own family
app.use("/api", auth);

app.get("/api/data", h(async (req, res) => {
  const fid = req.user.familyId;
  const [fam, members, entries, exps, paidDocs] = await Promise.all([
    Family.findById(fid), User.find({ familyId: fid }).select("name"),
    Entry.find({ familyId: fid }).sort({ date: 1 }), Expense.find({ familyId: fid }).sort({ date: 1 }), Paid.find({ familyId: fid })
  ]);
  const paid = {}; paidDocs.forEach((p) => { paid[p.month] = p.amount; });
  res.json({ user: { name: req.user.name }, family: { name: fam.name, code: fam.code, members: members.map((m) => m.name) }, entries, exps, paid });
}));

app.post("/api/entries", h(async (req, res) => {
  const e = cleanEntry(req.body);
  if (!e) return bad(res, "Check the slip: date, shift, litres, fat, SNF and rate are needed.");
  const doc = await Entry.create({ ...e, familyId: req.user.familyId, by: req.user.name, byId: req.user._id });
  res.status(201).json(doc);
}));
app.delete("/api/entries/:id", h(async (req, res) => {
  const d = await Entry.findOneAndDelete({ _id: req.params.id, familyId: req.user.familyId });
  if (!d) return bad(res, "Slip not found.", 404);
  res.json({ ok: true });
}));

app.post("/api/expenses", h(async (req, res) => {
  const e = cleanExp(req.body);
  if (!e) return bad(res, "Check the expense: date, type and amount are needed.");
  const doc = await Expense.create({ ...e, familyId: req.user.familyId, by: req.user.name, byId: req.user._id });
  res.status(201).json(doc);
}));
app.delete("/api/expenses/:id", h(async (req, res) => {
  const d = await Expense.findOneAndDelete({ _id: req.params.id, familyId: req.user.familyId });
  if (!d) return bad(res, "Expense not found.", 404);
  res.json({ ok: true });
}));

app.put("/api/paid/:month", h(async (req, res) => {
  const month = req.params.month;
  if (!okMonth(month)) return bad(res, "Invalid month.");
  const filter = { familyId: req.user.familyId, month };
  if (req.body && (req.body.amount === null || req.body.amount === undefined)) { await Paid.deleteOne(filter); return res.json({ ok: true }); }
  const amount = num(req.body.amount, 0, 1e8);
  if (amount === null) return bad(res, "Enter a valid amount.");
  await Paid.updateOne(filter, { $set: { amount: r2(amount) } }, { upsert: true });
  res.json({ ok: true });
}));

// import an old offline backup; existing records are kept, nothing is deleted
app.post("/api/import", h(async (req, res) => {
  const b = req.body || {}, fid = req.user.familyId;
  const entries = (Array.isArray(b.entries) ? b.entries.slice(0, 5000) : []).map(cleanEntry).filter(Boolean);
  const exps = (Array.isArray(b.exps) ? b.exps.slice(0, 5000) : []).map(cleanExp).filter(Boolean);
  let ne = 0, nx = 0;
  if (entries.length) {
    const r = await Entry.bulkWrite(entries.map((e) => ({ updateOne: { filter: { familyId: fid, date: e.date, shift: e.shift }, update: { $setOnInsert: { ...e, familyId: fid, by: req.user.name, byId: req.user._id } }, upsert: true } })), { ordered: false });
    ne = r.upsertedCount;
  }
  if (exps.length) {
    const r = await Expense.bulkWrite(exps.map((e) => ({ updateOne: { filter: { familyId: fid, date: e.date, cat: e.cat, amt: e.amt }, update: { $setOnInsert: { ...e, familyId: fid, by: req.user.name, byId: req.user._id } }, upsert: true } })), { ordered: false });
    nx = r.upsertedCount;
  }
  for (const [m, v] of Object.entries(b.paid || {})) {
    const a = num(v, 0, 1e8);
    if (okMonth(m) && a !== null) await Paid.updateOne({ familyId: fid, month: m }, { $setOnInsert: { amount: r2(a) } }, { upsert: true });
  }
  res.json({ entries: ne, exps: nx });
}));

app.use("/api", (_q, s) => bad(s, "Not found.", 404));
app.use(express.static(path.join(__dirname, "public")));
app.use((err, _q, res, _n) => {
  if (err && err.code === 11000) return bad(res, "A slip for this date and shift already exists in your family diary.", 409);
  if (err && (err.name === "CastError" || err.type === "entity.parse.failed")) return bad(res, "Invalid request.");
  console.error(err);
  bad(res, "Server error. Please try again.", 500);
});

mongoose.connect(MONGODB_URI, { dbName: "doodh_diary", serverSelectionTimeoutMS: 10000 })
  .then(() => app.listen(PORT, () => console.log("Doodh Diary running on port " + PORT)))
  .catch((e) => { console.error("Could not connect to MongoDB:", e.message, "\nCheck MONGODB_URI and Atlas Network Access (IP allow list)."); process.exit(1); });
