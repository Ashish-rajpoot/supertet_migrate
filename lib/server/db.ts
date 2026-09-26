/* ===========================================================
   db.ts - cached MongoDB connection
   Next.js route handlers run per-request (and the dev server
   hot-reloads modules), so a single connection is cached on
   globalThis - the same idea as server/index.js used one
   connect() at boot.
   =========================================================== */
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/supertet";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  bootstrapped: boolean;
};

const g = globalThis as unknown as { _mongoose?: MongooseCache };

/** Cached mongoose connection. Safe to call from every route handler. */
export async function connectDb(): Promise<typeof mongoose> {
  if (!g._mongoose) g._mongoose = { conn: null, promise: null, bootstrapped: false };
  const cached = g._mongoose;

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, { bufferCommands: false, serverSelectionTimeoutMS: 8000 })
      .then((m) => m);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  // server/index.js created/refreshed the default admin on every boot -
  // keep that behaviour the first time the database is touched.
  if (!cached.bootstrapped) {
    cached.bootstrapped = true;
    try {
      const { ensureDefaultAdmin } = await import("./bootstrap-admin");
      await ensureDefaultAdmin();
    } catch (err) {
      console.error("[db] bootstrap-admin failed", err);
    }
  }

  return cached.conn;
}

/** True when MongoDB is reachable - powers /api/status and the offline banner. */
export async function pingDb(): Promise<boolean> {
  try {
    if (mongoose.connection.readyState !== 1) await connectDb();
    await mongoose.connection.db!.admin().ping();
    return true;
  } catch {
    return false;
  }
}
